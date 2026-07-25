"""Transactional multi-project and Git worktree workspace endpoints."""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import time
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.app.core.agent_manager import get_agent_manager
from backend.app.core.cli_registry import get_cli_registry
from backend.app.core.ports import reserve_ports, worker_port_env
from backend.app.core.git_worktrees import (
    CreatedWorktree,
    copy_ignored_files,
    repository_root,
    worktree_service,
)
from backend.app.models.schemas import ParallelWorkspaceRequest, WorktreeRemoveRequest

router = APIRouter()


def _same_path(left: str, right: str) -> bool:
    return os.path.normcase(os.path.realpath(left)) == os.path.normcase(os.path.realpath(right))


def _launch_details(cli: dict[str, Any], cwd: str, extra_args: str) -> tuple[str, str, str]:
    default_args = str(cli.get("default_args", "")).strip()
    combined = " ".join(item for item in (default_args, extra_args.strip()) if item)
    if cli["runtime"] == "wsl":
        command = "wsl.exe"
        parts = ["--cd", cwd, "--exec", cli["commands"][0]]
        if combined:
            parts.extend(shlex.split(combined, posix=True))
        return command, subprocess.list2cmdline(parts), ""
    return str(cli["path"]), combined, cwd


@router.post("/launch")
def launch_workspace(body: ParallelWorkspaceRequest) -> dict[str, Any]:
    manager = get_agent_manager()
    created_agents: list[str] = []
    created_worktrees: list[CreatedWorktree] = []
    response: list[dict[str, Any]] = []
    try:
        repository = repository_root(body.repository) if body.repository else None
        stamp = int(time.time() * 1000)
        # Each worker gets its own dev-server port so parallel `npm run dev`
        # invocations neither collide nor silently attach to a sibling's server.
        ports = reserve_ports(len(body.workers)) if body.assign_ports else []
        for index, worker in enumerate(body.workers):
            cli = get_cli_registry().resolve(worker.cli_id)
            cwd = worker.cwd.strip()
            worktree: CreatedWorktree | None = None
            copied: list[str] = []
            if worker.use_worktree:
                if repository is None:
                    raise ValueError("A Git repository is required for worktree workers")
                role_slug = re.sub(r"[^a-z0-9-]+", "-", worker.role.lower()).strip("-") or "worker"
                branch = worker.branch.strip() or f"vibe/{role_slug}-{stamp}-{index + 1}"
                worktree = worktree_service.create(str(repository), branch, body.base_ref, worker.destination)
                created_worktrees.append(worktree)
                cwd = str(worktree.path)
                if body.copy_ignored:
                    # A fresh worktree only has tracked files; without the local
                    # .env the agent's first command usually fails.
                    copied = copy_ignored_files(str(repository), cwd, body.copy_ignored)
            elif not cwd:
                cwd = str(repository) if repository else os.getcwd()
            command, args, process_cwd = _launch_details(cli, cwd, worker.args)
            agent_id = f"workspace-{stamp}-{index + 1}"
            port = ports[index] if index < len(ports) else 0
            agent = manager.create_agent(
                agent_id,
                worker.name,
                command,
                args,
                cwd,
                autostart=True,
                process_cwd=process_cwd,
                cli_id=worker.cli_id,
                env=worker_port_env(port) if port else None,
            )
            created_agents.append(agent_id)
            response.append({
                "id": agent.id, "name": agent.name, "cli_id": worker.cli_id, "role": worker.role,
                "cwd": cwd, "branch": worktree.branch if worktree else "", "worktree": bool(worktree),
                "copied_files": copied, "port": port,
            })
        return {"status": "launched", "agents": response}
    except (ValueError, RuntimeError, OSError) as exc:
        for agent_id in reversed(created_agents):
            try:
                manager.remove_agent(agent_id)
            except (ValueError, RuntimeError):
                pass
        for worktree in reversed(created_worktrees):
            worktree_service.rollback(worktree)
        raise HTTPException(status_code=400, detail=f"Workspace launch rolled back: {exc}") from exc


@router.post("/worktrees/remove")
def remove_worktree(body: WorktreeRemoveRequest) -> dict[str, Any]:
    manager = get_agent_manager()
    try:
        worktree = worktree_service.describe(body.path)
        worktree_service.ensure_clean(worktree)
        attached_agents = [
            agent
            for agent in manager.list_agents()
            if agent.get("git", {}).get("root")
            and _same_path(str(agent["git"]["root"]), str(worktree.path))
        ]
        running_ids = {
            str(agent["id"]) for agent in attached_agents if agent.get("status") == "running"
        }
        stopped_ids: list[str] = []
        try:
            for agent in attached_agents:
                agent_id = str(agent["id"])
                manager.stop_agent(agent_id)
                stopped_ids.append(agent_id)
            worktree_service.remove(worktree, delete_branch=body.delete_branch)
        except (ValueError, RuntimeError, OSError) as exc:
            restart_errors: list[str] = []
            for agent_id in stopped_ids:
                if agent_id not in running_ids:
                    continue
                try:
                    manager.start_agent(agent_id)
                except (ValueError, RuntimeError, OSError) as restart_exc:
                    restart_errors.append(f"{agent_id}: {restart_exc}")
            if restart_errors:
                raise RuntimeError(
                    f"{exc}. Some terminals could not be restarted: {'; '.join(restart_errors)}"
                ) from exc
            raise

        removed_ids: list[str] = []
        for agent in attached_agents:
            agent_id = str(agent["id"])
            try:
                manager.remove_agent(agent_id)
                removed_ids.append(agent_id)
            except ValueError:
                # A concurrent close already removed this registration.
                removed_ids.append(agent_id)
        return {"status": "removed", "path": body.path, "removed_agent_ids": removed_ids}
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
