"""Transactional workspace launch tests."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.api.routes import workspaces
from backend.app.core.git_worktrees import CreatedWorktree
from backend.app.models.schemas import ParallelWorkspaceRequest


class FakeManager:
    def __init__(self, fail_at: int | None = None) -> None:
        self.fail_at = fail_at
        self.created: list[str] = []
        self.removed: list[str] = []

    def create_agent(self, agent_id, name, command, args, cwd, autostart):
        if self.fail_at == len(self.created):
            raise RuntimeError("PTY failed")
        self.created.append(agent_id)
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
