"""Restore the terminal layout from the previous run."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter

from backend.app.core.agent_manager import get_agent_manager
from backend.app.core.cli_registry import get_cli_registry
from backend.app.core.session_store import get_session_store
from backend.app.models.schemas import SessionAgent, SessionSnapshot

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=SessionSnapshot)
def previous_session() -> SessionSnapshot:
    """Terminals that were open when the app was last closed."""

    stored = get_session_store().previous()
    agents = [
        SessionAgent(
            id=str(item.get("id", "")),
            name=str(item.get("name", "")),
            command=str(item.get("command", "")),
            args=str(item.get("args", "")),
            cwd=str(item.get("cwd", "")),
            cli_id=str(item.get("cli_id", "")),
        )
        for item in stored
    ]
    open_ids = {agent["id"] for agent in get_agent_manager().list_agents()}
    restorable = bool(agents) and any(agent.id not in open_ids for agent in agents)
    return SessionSnapshot(agents=agents, restorable=restorable)


@router.post("/restore")
def restore_session() -> dict[str, Any]:
    """Reopen the stored terminals, skipping the ones that are no longer valid.

    Restoring is best-effort by design: a repository may have moved or a CLI may
    have been uninstalled, and losing four terminals because the fifth failed
    would be worse than a partial restore with an explicit report.
    """

    manager = get_agent_manager()
    registry = get_cli_registry()
    existing = {agent["id"] for agent in manager.list_agents()}
    restored: list[str] = []
    skipped: list[dict[str, str]] = []

    for item in get_session_store().previous():
        agent_id = str(item.get("id", ""))
        if not agent_id or agent_id in existing:
            continue
        cwd = str(item.get("cwd", ""))
        if cwd and not os.path.isdir(cwd):
            skipped.append({"id": agent_id, "reason": f"Folder no longer exists: {cwd}"})
            continue
        command = str(item.get("command", ""))
        cli_id = str(item.get("cli_id", ""))
        if cli_id:
            try:
                resolved = registry.resolve(cli_id)
            except ValueError as exc:
                skipped.append({"id": agent_id, "reason": str(exc)})
                continue
            # Re-resolve native CLIs, whose executable may have moved between
            # runs. A WSL agent is launched through `wsl.exe` with the Linux path
            # inside its arguments, so its command must stay untouched.
            if resolved.get("runtime") == "native":
                command = str(resolved["path"])
        process_cwd = item.get("process_cwd")
        stored_env = item.get("env")
        try:
            manager.create_agent(
                agent_id=agent_id,
                name=str(item.get("name", agent_id)),
                command=command,
                args=str(item.get("args", "")),
                cwd=cwd,
                autostart=True,
                process_cwd=None if process_cwd is None else str(process_cwd),
                cli_id=cli_id,
                env=stored_env if isinstance(stored_env, dict) else None,
            )
            restored.append(agent_id)
        except (ValueError, RuntimeError, OSError):
            # The reason reaches the UI, so it says what the user can act on and
            # nothing else; the underlying exception goes to the backend log
            # instead of being echoed back over HTTP.
            logger.warning("Could not restore terminal %s", agent_id, exc_info=True)
            skipped.append({
                "id": agent_id,
                "reason": f"{command or 'The command'} could not be started. See the backend log.",
            })

    return {"status": "restored", "restored": restored, "skipped": skipped}


@router.delete("")
def forget_session() -> dict[str, str]:
    get_session_store().clear()
    return {"status": "cleared"}
