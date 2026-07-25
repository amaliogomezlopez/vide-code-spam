"""Read-only Git history API regression tests."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.api.routes import git


def test_commits_are_scoped_to_an_open_worktree(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = SimpleNamespace(list_agents=lambda: [{
        "id": "one",
        "git": {"is_git": True, "worktree_id": "worktree-1", "root": "D:/repo"},
    }])
    monkeypatch.setattr(git, "get_agent_manager", lambda: manager)
    monkeypatch.setattr(git, "list_commits", lambda path, limit: [{
        "sha": "abc",
        "short_sha": "abc",
        "author": "Test",
        "authored_at": "2026-07-22T10:00:00+02:00",
        "subject": "Add sidebar",
        "refs": ["HEAD -> main"],
    }])

    result = git.worktree_commits("worktree-1", 25)

    assert result.path == "D:/repo"
    assert result.commits[0].subject == "Add sidebar"


def test_unknown_worktree_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = SimpleNamespace(list_agents=lambda: [])
    monkeypatch.setattr(git, "get_agent_manager", lambda: manager)

    with pytest.raises(HTTPException) as exc_info:
        git.worktree_commits("missing", 50)

    assert exc_info.value.status_code == 404
