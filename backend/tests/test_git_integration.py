"""Merge preview, branch integration and safety snapshots."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.app.core.git_worktrees import (
    GitStatusCache,
    WorktreeService,
    create_pull_request,
    create_snapshot,
    delete_snapshot,
    integrate_branch,
    list_snapshots,
    merge_preview,
    restore_snapshot,
)


def _git(path: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(path), *args], check=True, capture_output=True, text=True
    ).stdout


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


def _branch_with_change(repo: Path, branch: str, file_name: str, content: str) -> None:
    service = WorktreeService()
    created = service.create(str(repo), branch, "main")
    (created.path / file_name).write_text(content, encoding="utf-8")
    _git(created.path, "add", ".")
    _git(created.path, "commit", "-m", f"{branch} work")
    # Keep the branch, drop the worktree: integration happens in the main checkout.
    _git(repo, "worktree", "remove", "--force", str(created.path))


def test_preview_reports_a_clean_merge(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _branch_with_change(repo, "vibe/alpha", "solo.txt", "alpha\n")

    preview = merge_preview(str(repo), "vibe/alpha")

    assert preview["clean"] is True
    assert preview["conflicts"] == []
    assert preview["ahead"] == 1
    assert preview["behind"] == 0
    assert preview["target"] == "main"


def test_preview_lists_conflicting_files(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _branch_with_change(repo, "vibe/alpha", "shared.txt", "alpha\n")
    (repo / "shared.txt").write_text("main\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "main work")

    preview = merge_preview(str(repo), "vibe/alpha")

    assert preview["clean"] is False
    assert preview["conflicts"] == ["shared.txt"]


def test_merge_integrates_the_branch(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _branch_with_change(repo, "vibe/alpha", "solo.txt", "alpha\n")

    result = integrate_branch(str(repo), "vibe/alpha", "merge")

    assert result["status"] == "integrated"
    assert (repo / "solo.txt").read_text(encoding="utf-8") == "alpha\n"
    assert "vibe/alpha" in _git(repo, "log", "-1", "--pretty=%s")


def test_cherry_pick_replays_the_commits(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _branch_with_change(repo, "vibe/alpha", "solo.txt", "alpha\n")

    result = integrate_branch(str(repo), "vibe/alpha", "cherry-pick")

    assert result["mode"] == "cherry-pick"
    assert (repo / "solo.txt").read_text(encoding="utf-8") == "alpha\n"
    assert "vibe/alpha work" in _git(repo, "log", "-1", "--pretty=%s")


def test_conflicting_merge_is_rolled_back(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _branch_with_change(repo, "vibe/alpha", "shared.txt", "alpha\n")
    (repo / "shared.txt").write_text("main\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "main work")

    with pytest.raises(RuntimeError, match="rolled back"):
        integrate_branch(str(repo), "vibe/alpha", "merge")

    # No half-applied merge is left behind.
    assert not (repo / ".git" / "MERGE_HEAD").exists()
    assert GitStatusCache(ttl=0).get(str(repo))["dirty"] is False
    assert (repo / "shared.txt").read_text(encoding="utf-8") == "main\n"


def test_integration_refuses_a_dirty_main_checkout(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _branch_with_change(repo, "vibe/alpha", "solo.txt", "alpha\n")
    (repo / "shared.txt").write_text("uncommitted\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="uncommitted changes"):
        integrate_branch(str(repo), "vibe/alpha", "merge")


@pytest.mark.parametrize("branch", ["--force", "../escape", "bad branch"])
def test_integration_rejects_unsafe_refs(tmp_path: Path, branch: str) -> None:
    repo = _repository(tmp_path)

    with pytest.raises(ValueError, match="Invalid branch"):
        merge_preview(str(repo), branch)


def test_snapshot_round_trip(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    (repo / "shared.txt").write_text("valuable work\n", encoding="utf-8")

    snapshot = create_snapshot(str(repo), "before agent run")
    listed = list_snapshots(str(repo))

    assert snapshot["tag"].startswith("vibe-safety/main/")
    assert [item["tag"] for item in listed] == [snapshot["tag"]]
    assert listed[0]["label"] == "before agent run"

    # The agent destroys the work.
    _git(repo, "reset", "--hard", "HEAD")
    assert (repo / "shared.txt").read_text(encoding="utf-8") == "base\n"

    restore_snapshot(str(repo), snapshot["tag"])

    assert (repo / "shared.txt").read_text(encoding="utf-8") == "valuable work\n"

    delete_snapshot(str(repo), snapshot["tag"])
    assert list_snapshots(str(repo)) == []


def test_snapshot_of_a_clean_checkout_points_at_head(tmp_path: Path) -> None:
    repo = _repository(tmp_path)

    snapshot = create_snapshot(str(repo))

    assert snapshot["sha"] == _git(repo, "rev-parse", "HEAD").strip()


def test_only_vibe_snapshots_can_be_restored(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    _git(repo, "tag", "v1.0")

    with pytest.raises(ValueError, match="Only Vibe Spam restore points"):
        restore_snapshot(str(repo), "v1.0")


def test_pull_request_without_gh_explains_itself(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repository(tmp_path)
    monkeypatch.setattr("backend.app.core.git_worktrees.shutil.which", lambda name: None)

    with pytest.raises(RuntimeError, match="GitHub CLI"):
        create_pull_request(str(repo), "vibe/alpha", "Title", "Body")
