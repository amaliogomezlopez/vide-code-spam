"""Cross-worktree conflict detection."""

from __future__ import annotations

import subprocess
from pathlib import Path

from backend.app.core.git_worktrees import (
    WorktreeService,
    find_overlaps,
    head_revision,
    list_changed_files,
    list_worktrees,
    touched_files,
)


def _git(path: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True)


def _repository(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "tests@example.invalid")
    _git(repo, "config", "user.name", "Vibe Tests")
    (repo / "shared.py").write_text("base\n", encoding="utf-8")
    (repo / "only-backend.py").write_text("base\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    return repo


def test_find_overlaps_is_a_pure_set_intersection() -> None:
    overlaps = find_overlaps({
        "a": {"src/app.ts", "src/only-a.ts"},
        "b": {"src/app.ts", "src/only-b.ts"},
        "c": {"src/app.ts"},
    })

    assert overlaps[0]["path"] == "src/app.ts"
    assert overlaps[0]["worktree_ids"] == ["a", "b", "c"]
    assert len(overlaps) == 1


def test_find_overlaps_ignores_single_owner_files() -> None:
    assert find_overlaps({"a": {"one.txt"}, "b": {"two.txt"}}) == []


def test_touched_files_covers_commits_and_working_tree(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    backend = service.create(str(repo), "vibe/backend", "main")
    frontend = service.create(str(repo), "vibe/frontend", "main")
    base = head_revision(str(repo))

    # One agent commits its change, the other leaves it uncommitted: both are
    # equally capable of producing a conflict later.
    (backend.path / "shared.py").write_text("backend\n", encoding="utf-8")
    (backend.path / "only-backend.py").write_text("backend\n", encoding="utf-8")
    _git(backend.path, "add", ".")
    _git(backend.path, "commit", "-m", "backend work")
    (frontend.path / "shared.py").write_text("frontend\n", encoding="utf-8")
    (frontend.path / "new-frontend.py").write_text("new\n", encoding="utf-8")

    backend_files = touched_files(str(backend.path), base)
    frontend_files = touched_files(str(frontend.path), base)
    overlaps = find_overlaps({"backend": backend_files, "frontend": frontend_files})

    assert "shared.py" in backend_files
    assert "only-backend.py" in backend_files
    assert frontend_files == {"shared.py", "new-frontend.py"}
    assert [item["path"] for item in overlaps] == ["shared.py"]

    service.rollback(backend)
    service.rollback(frontend)


def test_changed_files_report_status_codes(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    (repo / "shared.py").write_text("dirty\n", encoding="utf-8")
    (repo / "untracked.txt").write_text("new\n", encoding="utf-8")

    changes = list_changed_files(str(repo))

    assert {item["path"] for item in changes} == {"shared.py", "untracked.txt"}
    tracked = next(item for item in changes if item["path"] == "shared.py")
    untracked = next(item for item in changes if item["path"] == "untracked.txt")
    assert tracked["code"] == "M"
    assert tracked["untracked"] is False
    assert untracked["untracked"] is True


def test_worktree_inventory_lists_checkouts_without_terminals(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    service = WorktreeService()
    created = service.create(str(repo), "vibe/orphan", "main")

    entries = list_worktrees(str(repo))

    assert entries[0]["is_main"] is True
    linked = next(item for item in entries if item["branch"] == "vibe/orphan")
    assert linked["is_main"] is False
    assert linked["exists"] is True
    assert Path(linked["path"]) == created.path

    service.rollback(created)


def test_touched_files_without_base_reports_working_tree_only(tmp_path: Path) -> None:
    repo = _repository(tmp_path)
    (repo / "shared.py").write_text("dirty\n", encoding="utf-8")

    assert touched_files(str(repo)) == {"shared.py"}
