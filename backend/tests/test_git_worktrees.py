"""Real Git worktree lifecycle regression tests."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.app.core.git_worktrees import GitStatusCache, WorktreeService


def _git(path: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True)


def _repository(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "tests@example.invalid")
    _git(repo, "config", "user.name", "Vibe Tests")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "initial")
    return repo


def test_create_and_remove_clean_worktree(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    created = service.create(str(repo), "vibe/backend", "main")

    assert created.path.is_dir()
    assert GitStatusCache(ttl=0).get(str(created.path))["branch"] == "vibe/backend"
    assert service.describe(str(created.path)) == created

    service.remove(created, delete_branch=True)
    assert not created.path.exists()


def test_refuses_to_remove_dirty_worktree(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    created = service.create(str(repo), "vibe/dirty", "main")
    (created.path / "dirty.txt").write_text("do not lose me", encoding="utf-8")

    with pytest.raises(RuntimeError, match="dirty worktree"):
        service.remove(created)

    assert created.path.exists()
    service.rollback(created)


@pytest.mark.parametrize("branch", ["--force", "../escape", "bad branch", "/absolute"])
def test_rejects_unsafe_branch_names(tmp_path: Path, branch: str) -> None:
    repo = _repository(tmp_path)
    with pytest.raises(ValueError, match="Invalid worktree branch"):
        WorktreeService().create(str(repo), branch, "main")
