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
    status: str = "stopped"  # running | stopped | error
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


class WorktreeRemoveRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=4096)
    delete_branch: bool = False
