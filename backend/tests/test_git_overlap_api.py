"""Overlap report built from real repositories and open agents."""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from backend.app.api.routes import git
from backend.app.core.git_worktrees import GitStatusCache, WorktreeService


def _git(path: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True)


def _repository(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "tests@example.invalid")
    _git(repo, "config", "user.name", "Vibe Tests")
    (repo / "shared.txt").write_text("base\n", encoding="utf-8")
    (repo / "solo.txt").write_text("base\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    return repo


def _install_agents(monkeypatch: pytest.MonkeyPatch, paths: dict[str, str]) -> None:
    cache = GitStatusCache(ttl=0)
    rows: list[dict[str, Any]] = [
        {"id": agent_id, "name": agent_id, "status": "running", "cwd": path,
         "git": cache.get(path)}
        for agent_id, path in paths.items()
    ]
    monkeypatch.setattr(git, "get_agent_manager", lambda: SimpleNamespace(list_agents=lambda: rows))
    git._overlap_cache = None


def test_committed_work_is_compared_against_the_main_checkout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: using a compared worktree as the base hid its own commits.

    The alpha worktree commits its work, so diffing it against its own HEAD
    produced an empty file set and the conflict on shared.txt disappeared.
    """

    repo = _repository(tmp_path)
    service = WorktreeService()
    alpha = service.create(str(repo), "vibe/alpha", "main")
    beta = service.create(str(repo), "vibe/beta", "main")

    (alpha.path / "shared.txt").write_text("alpha\n", encoding="utf-8")
    (alpha.path / "solo.txt").write_text("alpha\n", encoding="utf-8")
    _git(alpha.path, "add", ".")
    _git(alpha.path, "commit", "-m", "alpha work")
    (beta.path / "shared.txt").write_text("beta\n", encoding="utf-8")

    # Neither worktree is the main checkout: no terminal is open there.
    _install_agents(monkeypatch, {"alpha": str(alpha.path), "beta": str(beta.path)})
    report = git.overlap_report(refresh=True)

    assert len(report.repositories) == 1
    repository = report.repositories[0]
    assert [item.path for item in repository.conflicts] == ["shared.txt"]
    alpha_entry = next(item for item in repository.worktrees if item.branch == "vibe/alpha")
    beta_entry = next(item for item in repository.worktrees if item.branch == "vibe/beta")
    assert alpha_entry.files == 2
    assert beta_entry.files == 1
    assert repository.shared_checkouts == []

    service.rollback(alpha)
    service.rollback(beta)


def test_two_terminals_in_one_checkout_are_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repository(tmp_path)
    _install_agents(monkeypatch, {"one": str(repo), "two": str(repo)})

    report = git.overlap_report(refresh=True)

    assert len(report.repositories) == 1
    assert len(report.repositories[0].shared_checkouts) == 1


def test_independent_files_produce_no_conflict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    alpha = service.create(str(repo), "vibe/alpha", "main")
    beta = service.create(str(repo), "vibe/beta", "main")
    (alpha.path / "solo.txt").write_text("alpha\n", encoding="utf-8")
    (beta.path / "shared.txt").write_text("beta\n", encoding="utf-8")

    _install_agents(monkeypatch, {"alpha": str(alpha.path), "beta": str(beta.path)})
    report = git.overlap_report(refresh=True)

    assert report.repositories[0].conflicts == []

    service.rollback(alpha)
    service.rollback(beta)


def test_single_worktree_is_not_compared(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repository(tmp_path)
    _install_agents(monkeypatch, {"one": str(repo)})

    assert git.overlap_report(refresh=True).repositories == []


def test_inventory_includes_checkouts_without_terminals(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    alpha = service.create(str(repo), "vibe/alpha", "main")
    _install_agents(monkeypatch, {"alpha": str(alpha.path)})

    inventory = git.worktree_inventory()

    entries = inventory.repositories[0].worktrees
    assert len(entries) == 2
    main_entry = next(item for item in entries if item.is_main)
    linked = next(item for item in entries if not item.is_main)
    assert main_entry.terminals == 0
    assert linked.terminals == 1

    service.rollback(alpha)
