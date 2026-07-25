"""Write-side Git operations: branch integration and safety snapshots.

Every endpoint is scoped to a worktree that currently has a terminal open, and
each one either completes or rolls itself back. These are the only routes that
modify a repository, so they stay separate from the read-only Git context API.
"""

from __future__ import annotations

import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.app.api.routes.git import worktree_context
from backend.app.core.git_worktrees import (
    create_pull_request,
    create_snapshot,
    delete_snapshot,
    integrate_branch,
    list_snapshots,
    merge_preview,
    restore_snapshot,
)
from backend.app.models.schemas import (
    IntegrationRequest,
    MergePreview,
    PullRequestRequest,
    Snapshot,
    SnapshotActionRequest,
    SnapshotCreateRequest,
    SnapshotList,
)

router = APIRouter()

_GIT_ERRORS = (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired)


def _branch_of(context: dict[str, Any]) -> str:
    branch = str(context.get("branch", ""))
    if not branch:
        raise HTTPException(
            status_code=409, detail="A detached checkout cannot be integrated by Vibe Spam"
        )
    return branch


def _repository_of(context: dict[str, Any]) -> str:
    repository = str(context.get("repository_root", ""))
    if not repository:
        raise HTTPException(status_code=409, detail="Cannot resolve the repository for this worktree")
    return repository


@router.get("/preview", response_model=MergePreview)
def preview(worktree_id: str = Query(..., min_length=1, max_length=128)) -> MergePreview:
    """Dry-run integrating a worktree's branch into the main checkout."""

    context = worktree_context(worktree_id)
    try:
        return MergePreview.model_validate(
            merge_preview(_repository_of(context), _branch_of(context))
        )
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:500]) from exc


@router.post("/integrate")
def integrate(body: IntegrationRequest) -> dict[str, Any]:
    context = worktree_context(body.worktree_id)
    try:
        return integrate_branch(_repository_of(context), _branch_of(context), body.mode)
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:1000]) from exc


@router.post("/pull-request")
def pull_request(body: PullRequestRequest) -> dict[str, Any]:
    context = worktree_context(body.worktree_id)
    try:
        return create_pull_request(
            _repository_of(context), _branch_of(context), body.title, body.body
        )
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:1000]) from exc


@router.get("/snapshots", response_model=SnapshotList)
def snapshots(worktree_id: str = Query(..., min_length=1, max_length=128)) -> SnapshotList:
    context = worktree_context(worktree_id)
    path = str(context["root"])
    try:
        items = [Snapshot.model_validate(item) for item in list_snapshots(path)]
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:500]) from exc
    return SnapshotList(worktree_id=worktree_id, path=path, snapshots=items)


@router.post("/snapshots", response_model=Snapshot)
def take_snapshot(body: SnapshotCreateRequest) -> Snapshot:
    context = worktree_context(body.worktree_id)
    try:
        return Snapshot.model_validate({
            "created_at": "",
            **create_snapshot(str(context["root"]), body.label),
        })
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:500]) from exc


@router.post("/snapshots/restore")
def restore(body: SnapshotActionRequest) -> dict[str, Any]:
    context = worktree_context(body.worktree_id)
    try:
        return restore_snapshot(str(context["root"]), body.tag)
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:500]) from exc


@router.post("/snapshots/delete")
def forget_snapshot(body: SnapshotActionRequest) -> dict[str, str]:
    context = worktree_context(body.worktree_id)
    try:
        delete_snapshot(str(context["root"]), body.tag)
    except _GIT_ERRORS as exc:
        raise HTTPException(status_code=409, detail=str(exc)[:500]) from exc
    return {"status": "deleted", "tag": body.tag}
