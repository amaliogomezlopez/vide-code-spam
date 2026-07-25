"""Read-only Git context endpoints for open terminal worktrees."""

from __future__ import annotations

import subprocess
import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.app.core.agent_manager import get_agent_manager
from backend.app.core.git_worktrees import (
    find_overlaps,
    head_revision,
    list_changed_files,
    list_commits,
    list_worktrees,
    touched_files,
)
from backend.app.models.schemas import (
    GitChange,
    GitChangeList,
    GitCommit,
    GitCommitList,
    OverlapFile,
    OverlapReport,
    OverlapWorktree,
    RepositoryOverlap,
    RepositoryWorktrees,
    WorktreeEntry,
    WorktreeInventory,
)

router = APIRouter()

# Comparing worktrees costs several Git invocations per checkout, so the report
# is cached briefly: the sidebar polls it, the data changes slowly.
OVERLAP_TTL = 8.0
_overlap_cache: tuple[float, OverlapReport] | None = None
_overlap_lock = threading.Lock()


def _agent_worktrees() -> list[dict[str, Any]]:
    """Open agents that resolve to a Git worktree, with their Git context."""

    entries: list[dict[str, Any]] = []
    for agent in get_agent_manager().list_agents():
        git = agent.get("git", {})
        if git.get("is_git") and git.get("root"):
            entries.append({"agent": agent, "git": git})
    return entries


def worktree_context(worktree_id: str) -> dict[str, Any]:
    """Resolve a worktree id to its Git context, or 404.

    Ids only exist for checkouts with an open terminal, which keeps every Git
    operation scoped to what the user is actually working on.
    """

    for entry in _agent_worktrees():
        if entry["git"].get("worktree_id") == worktree_id:
            return dict(entry["git"])
    raise HTTPException(status_code=404, detail="The worktree is not attached to an open terminal")


def _worktree_path(worktree_id: str) -> str:
    return str(worktree_context(worktree_id)["root"])


@router.get("/worktrees/{worktree_id}/commits", response_model=GitCommitList)
def worktree_commits(
    worktree_id: str,
    limit: int = Query(default=50, ge=1, le=100),
) -> GitCommitList:
    """Read commits only for a worktree currently attached to an open agent."""

    for agent in get_agent_manager().list_agents():
        git = agent.get("git", {})
        if git.get("is_git") and git.get("worktree_id") == worktree_id:
            path = str(git["root"])
            try:
                commits = [GitCommit.model_validate(item) for item in list_commits(path, limit)]
            except (ValueError, RuntimeError, OSError) as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            return GitCommitList(
                worktree_id=worktree_id,
                path=path,
                commits=commits,
            )
    raise HTTPException(status_code=404, detail="The worktree is not attached to an open terminal")


@router.get("/worktrees/{worktree_id}/changes", response_model=GitChangeList)
def worktree_changes(
    worktree_id: str,
    limit: int = Query(default=300, ge=1, le=1000),
) -> GitChangeList:
    """List the files an agent has modified inside its checkout."""

    path = _worktree_path(worktree_id)
    try:
        changes = [GitChange.model_validate(item) for item in list_changed_files(path, limit)]
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return GitChangeList(worktree_id=worktree_id, path=path, changes=changes)


@router.get("/worktrees", response_model=WorktreeInventory)
def worktree_inventory() -> WorktreeInventory:
    """Every worktree of every known repository, including ones with no terminal.

    Terminals only reveal the worktrees currently in use; leftovers from previous
    sessions stay invisible (and pile up) without this inventory.
    """

    repositories: dict[str, dict[str, Any]] = {}
    terminal_counts: dict[str, int] = {}
    for entry in _agent_worktrees():
        git = entry["git"]
        repository_id = str(git.get("repository_id", ""))
        worktree_id = str(git.get("worktree_id", ""))
        terminal_counts[worktree_id] = terminal_counts.get(worktree_id, 0) + 1
        if repository_id and repository_id not in repositories:
            repositories[repository_id] = {
                "repository_id": repository_id,
                "repository_name": str(git.get("repository_name", "")),
                "repository_root": str(git.get("repository_root", "")),
                "probe": str(git["root"]),
            }

    result: list[RepositoryWorktrees] = []
    for repository in repositories.values():
        error = ""
        entries: list[WorktreeEntry] = []
        try:
            for item in list_worktrees(str(repository["probe"])):
                entries.append(
                    WorktreeEntry(
                        **item,
                        terminals=terminal_counts.get(str(item["id"]), 0),
                    )
                )
        except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            error = str(exc)[:500]
        result.append(
            RepositoryWorktrees(
                repository_id=str(repository["repository_id"]),
                repository_name=str(repository["repository_name"]),
                repository_root=str(repository["repository_root"]),
                worktrees=entries,
                error=error,
            )
        )
    return WorktreeInventory(repositories=result)


def _build_overlap_report() -> OverlapReport:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for entry in _agent_worktrees():
        grouped.setdefault(str(entry["git"].get("repository_id", "")), []).append(entry)

    repositories: list[RepositoryOverlap] = []
    for repository_id, entries in grouped.items():
        worktrees: dict[str, dict[str, Any]] = {}
        for entry in entries:
            git = entry["git"]
            worktree_id = str(git.get("worktree_id", ""))
            record = worktrees.setdefault(
                worktree_id,
                {
                    "root": str(git["root"]),
                    "name": str(git.get("worktree_name", "")),
                    "branch": str(git.get("branch", "")),
                    "is_main": bool(git.get("is_main_worktree")),
                    "agents": [],
                },
            )
            record["agents"].append(str(entry["agent"]["name"]))

        # Two agents writing in the same checkout is the highest-risk case: Git
        # cannot even see it as a conflict, the filesystem simply wins.
        shared = [
            str(record["name"])
            for record in worktrees.values()
            if len(record["agents"]) > 1
        ]
        if len(worktrees) < 2:
            if shared:
                repositories.append(
                    RepositoryOverlap(
                        repository_id=repository_id,
                        repository_name=str(entries[0]["git"].get("repository_name", "")),
                        shared_checkouts=shared,
                    )
                )
            continue

        # The baseline is the repository's main checkout, even when no terminal
        # is attached to it. Using one of the compared worktrees as the base
        # makes that worktree's own commits diff against themselves and vanish
        # from the report.
        repository_path = str(entries[0]["git"].get("repository_root", ""))
        error = ""
        base = ""
        files: dict[str, set[str]] = {}
        try:
            if repository_path:
                base = head_revision(repository_path)
            for worktree_id, record in worktrees.items():
                files[worktree_id] = touched_files(str(record["root"]), base)
        except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            error = str(exc)[:500]

        conflicts = [OverlapFile.model_validate(item) for item in find_overlaps(files)]
        repositories.append(
            RepositoryOverlap(
                repository_id=repository_id,
                repository_name=str(entries[0]["git"].get("repository_name", "")),
                base=base,
                worktrees=[
                    OverlapWorktree(
                        worktree_id=worktree_id,
                        name=str(record["name"]),
                        branch=str(record["branch"]),
                        files=len(files.get(worktree_id, set())),
                        agents=list(record["agents"]),
                    )
                    for worktree_id, record in worktrees.items()
                ],
                conflicts=conflicts[:200],
                shared_checkouts=shared,
                error=error,
            )
        )
    return OverlapReport(repositories=repositories, generated_at=time.time())


@router.get("/overlaps", response_model=OverlapReport)
def overlap_report(refresh: bool = Query(default=False)) -> OverlapReport:
    """Report files that more than one agent is changing in the same repository."""

    global _overlap_cache
    now = time.monotonic()
    with _overlap_lock:
        cached = _overlap_cache
        if not refresh and cached and now - cached[0] < OVERLAP_TTL:
            return cached[1]
    report = _build_overlap_report()
    with _overlap_lock:
        _overlap_cache = (now, report)
    return report
