"""Real Git worktree lifecycle regression tests."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.app.core import git_worktrees
from backend.app.core.git_worktrees import GitStatusCache, WorktreeService, list_commits


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


def test_main_checkout_and_linked_worktree_share_repository_identity(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    created = service.create(str(repo), "vibe/sidebar", "main")

    main_status = GitStatusCache(ttl=0).get(str(repo))
    worktree_status = GitStatusCache(ttl=0).get(str(created.path))

    assert main_status["repository_id"] == worktree_status["repository_id"]
    assert main_status["worktree_id"] != worktree_status["worktree_id"]
    assert main_status["is_main_worktree"] is True
    assert worktree_status["is_main_worktree"] is False

    service.rollback(created)


def test_status_reports_change_counts(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    (repo / "README.md").write_text("changed\n", encoding="utf-8")
    (repo / "new.txt").write_text("new\n", encoding="utf-8")

    status = GitStatusCache(ttl=0).get(str(repo))

    assert status["dirty"] is True
    assert status["unstaged"] == 1
    assert status["untracked"] == 1
    assert status["changed"] == 2


def test_changed_count_does_not_double_count_partially_staged_file(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    (repo / "README.md").write_text("staged\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    (repo / "README.md").write_text("staged and modified\n", encoding="utf-8")

    status = GitStatusCache(ttl=0).get(str(repo))

    assert status["staged"] == 1
    assert status["unstaged"] == 1
    assert status["changed"] == 1


def test_operational_git_error_preserves_last_known_context(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repository(tmp_path)
    cache = GitStatusCache(ttl=0)
    initial = cache.get(str(repo))

    def timeout(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired("git", 15)

    monkeypatch.setattr(git_worktrees, "_git", timeout)
    stale = cache.get(str(repo))

    assert initial["is_git"] is True
    assert stale["is_git"] is True
    assert stale["repository_id"] == initial["repository_id"]
    assert stale["stale"] is True
    assert "timed out" in stale["error"].lower()


def test_lists_recent_commits_with_refs(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    (repo / "second.txt").write_text("second\n", encoding="utf-8")
    _git(repo, "add", "second.txt")
    _git(repo, "commit", "-m", "second commit")

    commits = list_commits(str(repo), limit=10)

    assert [item["subject"] for item in commits[:2]] == ["second commit", "initial"]
    assert commits[0]["short_sha"]
    assert commits[0]["author"] == "Vibe Tests"
    assert any("main" in ref for ref in commits[0]["refs"])


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
