"""Pydantic models for API requests/responses."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Agent(BaseModel):
    id: str
    name: str
    command: str
    args: str = ""
    cwd: str = ""
    cli_id: str = ""
    status: str = "stopped"  # running | stopped | error
    last_output_at: float = 0.0
    process_cwd_actual: str = ""
    cwd_drifted: bool = False
    git: dict[str, Any] = Field(default_factory=dict)


class CreateAgentRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(..., min_length=1, max_length=128)
    command: str = Field(..., min_length=1, max_length=4096)
    args: str = Field(default="", max_length=8192)
    cwd: str = Field(default="", max_length=4096)
    autostart: bool = True


class SendTextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1_048_576)


class ResizeRequest(BaseModel):
    cols: int = Field(..., ge=1, le=1000)
    rows: int = Field(..., ge=1, le=1000)


class CustomCliRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(..., min_length=1, max_length=128)
    executable: str = Field(..., min_length=1, max_length=4096)
    args: str = Field(default="", max_length=8192)


class WorkspaceWorkerRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    role: str = Field(default="worker", max_length=128)
    cli_id: str = Field(..., min_length=1, max_length=64)
    args: str = Field(default="", max_length=8192)
    cwd: str = Field(default="", max_length=4096)
    use_worktree: bool = False
    branch: str = Field(default="", max_length=256)
    destination: str = Field(default="", max_length=4096)


class ParallelWorkspaceRequest(BaseModel):
    repository: str = Field(default="", max_length=4096)
    base_ref: str = Field(default="main", min_length=1, max_length=256)
    workers: list[WorkspaceWorkerRequest] = Field(..., min_length=1, max_length=9)
    # Ignored files a fresh worktree needs so the agent can actually run the
    # project (a missing local .env is the most common failure).
    copy_ignored: list[str] = Field(default_factory=list, max_length=20)
    # Give each worker a distinct PORT/VITE_PORT so parallel dev servers do not
    # fight over 3000.
    assign_ports: bool = True


class WorktreeRemoveRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=4096)
    delete_branch: bool = False


class GitCommit(BaseModel):
    sha: str
    short_sha: str
    author: str
    authored_at: str
    subject: str
    refs: list[str] = Field(default_factory=list)


class GitCommitList(BaseModel):
    worktree_id: str
    path: str
    commits: list[GitCommit] = Field(default_factory=list)


class GitChange(BaseModel):
    path: str
    code: str
    untracked: bool = False


class GitChangeList(BaseModel):
    worktree_id: str
    path: str
    changes: list[GitChange] = Field(default_factory=list)


class WorktreeEntry(BaseModel):
    id: str
    path: str
    name: str
    head: str = ""
    branch: str = ""
    detached: bool = False
    locked: bool = False
    prunable: bool = False
    is_main: bool = False
    exists: bool = True
    terminals: int = 0


class RepositoryWorktrees(BaseModel):
    repository_id: str
    repository_name: str
    repository_root: str
    worktrees: list[WorktreeEntry] = Field(default_factory=list)
    error: str = ""


class WorktreeInventory(BaseModel):
    repositories: list[RepositoryWorktrees] = Field(default_factory=list)


class OverlapFile(BaseModel):
    path: str
    worktree_ids: list[str] = Field(default_factory=list)


class OverlapWorktree(BaseModel):
    worktree_id: str
    name: str
    branch: str
    files: int = 0
    agents: list[str] = Field(default_factory=list)


class RepositoryOverlap(BaseModel):
    repository_id: str
    repository_name: str
    base: str = ""
    worktrees: list[OverlapWorktree] = Field(default_factory=list)
    conflicts: list[OverlapFile] = Field(default_factory=list)
    shared_checkouts: list[str] = Field(default_factory=list)
    error: str = ""


class OverlapReport(BaseModel):
    repositories: list[RepositoryOverlap] = Field(default_factory=list)
    generated_at: float = 0.0


class SessionAgent(BaseModel):
    id: str
    name: str
    command: str
    args: str = ""
    cwd: str = ""
    cli_id: str = ""


class SessionSnapshot(BaseModel):
    agents: list[SessionAgent] = Field(default_factory=list)
    restorable: bool = False


class MergePreview(BaseModel):
    branch: str
    target: str
    ahead: int = 0
    behind: int = 0
    clean: bool = True
    up_to_date: bool = False
    conflicts: list[str] = Field(default_factory=list)


class IntegrationRequest(BaseModel):
    worktree_id: str = Field(..., min_length=1, max_length=128)
    mode: str = Field(default="merge", pattern=r"^(merge|cherry-pick)$")


class PullRequestRequest(BaseModel):
    worktree_id: str = Field(..., min_length=1, max_length=128)
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=4000)


class Snapshot(BaseModel):
    tag: str
    sha: str
    created_at: str = ""
    label: str = ""


class SnapshotList(BaseModel):
    worktree_id: str
    path: str
    snapshots: list[Snapshot] = Field(default_factory=list)


class SnapshotCreateRequest(BaseModel):
    worktree_id: str = Field(..., min_length=1, max_length=128)
    label: str = Field(default="", max_length=200)


class SnapshotActionRequest(BaseModel):
    worktree_id: str = Field(..., min_length=1, max_length=128)
    tag: str = Field(..., min_length=1, max_length=256)


class RuntimeSettings(BaseModel):
    stt_provider: str
    cleaner_provider: str
    whisper_model_size: str
    whisper_language: str
    whisper_device: str
    whisper_compute_type: str
    whisper_beam_size: int
    preload_model: bool
    scrollback_chars: int


class RuntimeSettingsUpdate(BaseModel):
    stt_provider: str | None = Field(default=None, max_length=64)
    cleaner_provider: str | None = Field(default=None, max_length=64)
    whisper_model_size: str | None = Field(default=None, max_length=64)
    whisper_language: str | None = Field(default=None, max_length=16)
    whisper_device: str | None = Field(default=None, max_length=16)
    whisper_compute_type: str | None = Field(default=None, max_length=32)
    whisper_beam_size: int | None = Field(default=None, ge=1, le=10)
    preload_model: bool | None = None
