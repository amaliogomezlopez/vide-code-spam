"""Transactional workspace launch tests."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.api.routes import workspaces
from backend.app.core.git_worktrees import CreatedWorktree
from backend.app.models.schemas import ParallelWorkspaceRequest, WorktreeRemoveRequest


class FakeManager:
    def __init__(self, fail_at: int | None = None) -> None:
        self.fail_at = fail_at
        self.created: list[str] = []
        self.created_cwds: list[str] = []
        self.process_cwds: list[str | None] = []
        self.cli_ids: list[str] = []
        self.envs: list[dict[str, str]] = []
        self.removed: list[str] = []

    def create_agent(
        self, agent_id, name, command, args, cwd, autostart,
        process_cwd=None, cli_id="", env=None,
    ):
        if self.fail_at == len(self.created):
            raise RuntimeError("PTY failed")
        self.created.append(agent_id)
        self.created_cwds.append(cwd)
        self.process_cwds.append(process_cwd)
        self.cli_ids.append(cli_id)
        self.envs.append(dict(env or {}))
        return SimpleNamespace(id=agent_id, name=name)

    def remove_agent(self, agent_id: str) -> None:
        self.removed.append(agent_id)


class FakeWorktrees:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.created: list[CreatedWorktree] = []
        self.rolled_back: list[CreatedWorktree] = []

    def create(self, repo_path: str, branch: str, base_ref: str, destination: str = "") -> CreatedWorktree:
        item = CreatedWorktree(self.root / branch.replace("/", "-"), branch, self.root)
        self.created.append(item)
        return item

    def rollback(self, item: CreatedWorktree) -> None:
        self.rolled_back.append(item)


class FakeRemovalManager:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.stopped: list[str] = []
        self.started: list[str] = []
        self.removed: list[str] = []

    def list_agents(self) -> list[dict[str, object]]:
        return self.rows

    def stop_agent(self, agent_id: str) -> None:
        self.stopped.append(agent_id)

    def start_agent(self, agent_id: str) -> None:
        self.started.append(agent_id)

    def remove_agent(self, agent_id: str) -> None:
        self.removed.append(agent_id)


class FakeRemovalService:
    def __init__(self, worktree: CreatedWorktree, *, dirty: bool = False, fail: bool = False) -> None:
        self.worktree = worktree
        self.dirty = dirty
        self.fail = fail
        self.removed = False

    def describe(self, path: str) -> CreatedWorktree:
        assert path == str(self.worktree.path)
        return self.worktree

    def ensure_clean(self, _worktree: CreatedWorktree) -> None:
        if self.dirty:
            raise RuntimeError("Refusing to remove dirty worktree")

    def remove(self, _worktree: CreatedWorktree, *, delete_branch: bool) -> None:
        assert delete_branch is False
        if self.fail:
            raise RuntimeError("Git refused removal")
        self.removed = True


def _request() -> ParallelWorkspaceRequest:
    return ParallelWorkspaceRequest.model_validate({
        "repository": "C:/repo",
        "base_ref": "main",
        "workers": [
            {"name": "Backend", "role": "backend", "cli_id": "codex", "use_worktree": True},
            {"name": "Frontend", "role": "frontend", "cli_id": "codex", "use_worktree": True},
        ],
    })


def test_workspace_launch_rolls_back_agents_and_worktrees(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = FakeManager(fail_at=1)
    service = FakeWorktrees(tmp_path)
    registry = SimpleNamespace(resolve=lambda cli_id: {
        "runtime": "native", "path": "codex", "commands": ["codex"], "default_args": "",
    })
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "get_cli_registry", lambda: registry)
    monkeypatch.setattr(workspaces, "repository_root", lambda path: tmp_path)
    monkeypatch.setattr(workspaces, "worktree_service", service)

    with pytest.raises(HTTPException, match="rolled back"):
        workspaces.launch_workspace(_request())

    assert manager.removed == manager.created
    assert service.rolled_back == list(reversed(service.created))


def test_wsl_arguments_remain_individual() -> None:
    command, args, cwd = workspaces._launch_details(
        {"runtime": "wsl", "commands": ["claude"], "default_args": "--model sonnet"},
        "D:/repo with spaces",
        "--permission-mode plan",
    )
    assert command == "wsl.exe"
    assert '--cd "D:/repo with spaces"' in args
    assert "--model sonnet" in args
    assert cwd == ""


def test_workspace_launch_preserves_each_terminal_folder(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = FakeManager()
    registry = SimpleNamespace(resolve=lambda cli_id: {
        "runtime": "native", "path": "codex", "commands": ["codex"], "default_args": "",
    })
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "get_cli_registry", lambda: registry)

    request = ParallelWorkspaceRequest.model_validate({
        "workers": [
            {"name": "API", "role": "terminal", "cli_id": "codex", "cwd": "D:/repos/api"},
            {"name": "Web", "role": "terminal", "cli_id": "codex", "cwd": "D:/repos/web"},
        ],
    })

    result = workspaces.launch_workspace(request)

    assert result["status"] == "launched"
    assert manager.created_cwds == ["D:/repos/api", "D:/repos/web"]
    assert [agent["cwd"] for agent in result["agents"]] == manager.created_cwds


def test_each_worker_gets_its_own_dev_server_port(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = FakeManager()
    registry = SimpleNamespace(resolve=lambda cli_id: {
        "runtime": "native", "path": "codex", "commands": ["codex"], "default_args": "",
    })
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "get_cli_registry", lambda: registry)
    request = ParallelWorkspaceRequest.model_validate({
        "workers": [
            {"name": "API", "role": "terminal", "cli_id": "codex", "cwd": "D:/repos/api"},
            {"name": "Web", "role": "terminal", "cli_id": "codex", "cwd": "D:/repos/web"},
        ],
    })

    result = workspaces.launch_workspace(request)

    ports = [agent["port"] for agent in result["agents"]]
    assert len(set(ports)) == 2
    assert all(port > 0 for port in ports)
    assert manager.envs[0]["PORT"] == str(ports[0])
    assert manager.envs[1]["VITE_PORT"] == str(ports[1])


def test_ports_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = FakeManager()
    registry = SimpleNamespace(resolve=lambda cli_id: {
        "runtime": "native", "path": "codex", "commands": ["codex"], "default_args": "",
    })
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "get_cli_registry", lambda: registry)
    request = ParallelWorkspaceRequest.model_validate({
        "assign_ports": False,
        "workers": [{"name": "API", "role": "terminal", "cli_id": "codex", "cwd": "D:/repos/api"}],
    })

    result = workspaces.launch_workspace(request)

    assert result["agents"][0]["port"] == 0
    assert manager.envs[0] == {}


def test_wsl_workspace_keeps_git_context_path(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = FakeManager()
    registry = SimpleNamespace(resolve=lambda cli_id: {
        "runtime": "wsl", "path": "", "commands": ["codex"], "default_args": "",
    })
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "get_cli_registry", lambda: registry)
    request = ParallelWorkspaceRequest.model_validate({
        "workers": [{
            "name": "WSL", "role": "terminal", "cli_id": "codex", "cwd": "D:/repos/api",
        }],
    })

    workspaces.launch_workspace(request)

    assert manager.created_cwds == ["D:/repos/api"]
    assert manager.process_cwds == [""]


def _removal_rows(worktree: Path) -> list[dict[str, object]]:
    return [
        {"id": "one", "status": "running", "git": {"root": str(worktree)}},
        {"id": "two", "status": "stopped", "git": {"root": str(worktree)}},
        {"id": "other", "status": "running", "git": {"root": str(worktree.parent / "other")}},
    ]


def test_remove_worktree_closes_every_attached_terminal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    linked = tmp_path / "linked"
    worktree = CreatedWorktree(linked, "feature/test", tmp_path / "repo")
    manager = FakeRemovalManager(_removal_rows(linked))
    service = FakeRemovalService(worktree)
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "worktree_service", service)

    result = workspaces.remove_worktree(WorktreeRemoveRequest(path=str(linked)))

    assert service.removed is True
    assert manager.stopped == ["one", "two"]
    assert manager.removed == ["one", "two"]
    assert result["removed_agent_ids"] == ["one", "two"]


def test_dirty_worktree_keeps_terminal_registrations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    linked = tmp_path / "linked"
    worktree = CreatedWorktree(linked, "feature/test", tmp_path / "repo")
    manager = FakeRemovalManager(_removal_rows(linked))
    service = FakeRemovalService(worktree, dirty=True)
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "worktree_service", service)

    with pytest.raises(HTTPException) as exc_info:
        workspaces.remove_worktree(WorktreeRemoveRequest(path=str(linked)))

    assert exc_info.value.status_code == 409
    assert manager.stopped == []
    assert manager.removed == []


def test_failed_worktree_removal_restarts_previously_running_terminals(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    linked = tmp_path / "linked"
    worktree = CreatedWorktree(linked, "feature/test", tmp_path / "repo")
    manager = FakeRemovalManager(_removal_rows(linked))
    service = FakeRemovalService(worktree, fail=True)
    monkeypatch.setattr(workspaces, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(workspaces, "worktree_service", service)

    with pytest.raises(HTTPException):
        workspaces.remove_worktree(WorktreeRemoveRequest(path=str(linked)))

    assert manager.stopped == ["one", "two"]
    assert manager.started == ["one"]
    assert manager.removed == []
