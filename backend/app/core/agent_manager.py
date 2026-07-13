"""Manage CLI agents running in pseudo-terminals."""

from __future__ import annotations

import logging
import shutil
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from backend.app.config import get_settings
from backend.app.core.pty_backend import DEFAULT_COLS, DEFAULT_ROWS, PtySession, spawn_pty
from backend.app.core.git_worktrees import git_status_cache

logger = logging.getLogger(__name__)


@dataclass
class AgentProcess:
    id: str
    name: str
    command: str
    args: str = ""
    cwd: str = ""
    status: str = "stopped"
    _session: PtySession | None = field(default=None, repr=False)
    _removed: bool = field(default=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    _start_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def start(self) -> None:
        with self._start_lock:
            self._start_once()

    def _start_once(self) -> None:
        with self._lock:
            if self._removed:
                raise RuntimeError(f"Agent {self.id} has been removed")
            if self.status == "running" and self._session and self._session.is_alive():
                return
            if self._session is not None:
                self._session.close()
                self._session = None
        resolved = shutil.which(self.command)
        if resolved:
            logger.info("Agent %s: '%s' resolved to %s", self.id, self.command, resolved)
        else:
            logger.warning(
                "Agent %s: command '%s' not found on PATH (cwd=%s). It may fail to start.",
                self.id,
                self.command,
                self.cwd,
            )
        try:
            session = spawn_pty(
                self.command,
                self.args,
                cwd=self.cwd or None,
                cols=DEFAULT_COLS,
                rows=DEFAULT_ROWS,
            )
            with self._lock:
                removed_while_starting = self._removed
                if not removed_while_starting:
                    self._session = session
                    self.status = "running"
            if removed_while_starting:
                session.close()
                raise RuntimeError(f"Agent {self.id} was removed while starting")
            logger.info(
                "Started agent %s: %s %s (cwd=%s)", self.id, self.command, self.args, self.cwd
            )
        except Exception as exc:
            with self._lock:
                self.status = "stopped" if self._removed else "error"
            logger.exception("Failed to start agent %s", self.id)
            raise RuntimeError(f"Failed to start {self.id}: {exc}") from exc

    def stop(self) -> None:
        with self._lock:
            session = self._session
            self._session = None
            self.status = "stopped"
        if session:
            session.close()

    def dispose(self) -> None:
        with self._lock:
            self._removed = True
        self.stop()

    def refresh_status(self) -> str:
        session_to_close: PtySession | None = None
        with self._lock:
            if self.status == "running" and (self._session is None or not self._session.is_alive()):
                session_to_close = self._session
                self.status = "stopped"
                self._session = None
            status = self.status
        if session_to_close is not None:
            session_to_close.close()
        return status

    def write(self, text: str) -> None:
        """Interactive write: send raw bytes/chars to the PTY (no newline)."""
        with self._lock:
            removed = self._removed
            session = self._session
        if removed:
            raise RuntimeError(f"Agent {self.id} has been removed")
        if session is None or not session.is_alive():
            self.start()
        with self._lock:
            if self._removed:
                raise RuntimeError(f"Agent {self.id} has been removed")
            if self._session is None:
                raise RuntimeError(f"Agent {self.id} is not running")
            self._session.write(text)

    def send_line(self, text: str) -> None:
        """Send a full line (used by voice transcription / send endpoint)."""
        self.write(text + "\r")

    def read(self, timeout: float = 0.1) -> str:
        if self._session is None:
            return ""
        return self._session.read(timeout=timeout)

    def resize(self, cols: int, rows: int) -> None:
        if self._session is not None:
            self._session.resize(cols, rows)


class AgentManager:
    def __init__(self) -> None:
        self._agents: dict[str, AgentProcess] = {}
        self._lock = threading.RLock()
        self._terminal_connections: set[str] = set()
        self._load_default_overrides()

    def _load_default_overrides(self) -> None:
        overrides = get_settings().get_agent_overrides()
        for agent_id, cfg in overrides.items():
            self.create_agent(
                agent_id=agent_id,
                name=cfg.get("name", agent_id.capitalize()),
                command=cfg.get("command", agent_id),
                args=cfg.get("args", ""),
                cwd=cfg.get("cwd", ""),
                autostart=False,
            )

    def create_agent(
        self,
        agent_id: str,
        name: str,
        command: str,
        args: str = "",
        cwd: str = "",
        autostart: bool = False,
    ) -> AgentProcess:
        with self._lock:
            if agent_id in self._agents:
                raise ValueError(f"Agent {agent_id} already exists")
            agent = AgentProcess(
                id=agent_id,
                name=name,
                command=command,
                args=args,
                cwd=cwd,
            )
            self._agents[agent_id] = agent
        if autostart:
            try:
                agent.start()
            except Exception:
                with self._lock:
                    self._agents.pop(agent_id, None)
                agent.dispose()
                raise
        return agent

    def remove_agent(self, agent_id: str) -> None:
        with self._lock:
            agent = self._agents.pop(agent_id, None)
            self._terminal_connections.discard(agent_id)
        if agent is None:
            raise ValueError(f"Agent {agent_id} not found")
        agent.dispose()

    def list_agents(self) -> list[dict[str, Any]]:
        with self._lock:
            agents = list(self._agents.values())
        return [
            {
                "id": agent.id,
                "name": agent.name,
                "command": agent.command,
                "args": agent.args,
                "cwd": agent.cwd,
                "status": agent.refresh_status(),
                "git": git_status_cache.get(agent.cwd),
            }
            for agent in agents
        ]

    def get_agent(self, agent_id: str) -> AgentProcess:
        with self._lock:
            agent = self._agents.get(agent_id)
        if agent is None:
            raise ValueError(f"Agent {agent_id} not found")
        return agent

    def claim_terminal(self, agent_id: str) -> AgentProcess:
        agent = self.get_agent(agent_id)
        with self._lock:
            if agent_id in self._terminal_connections:
                raise RuntimeError(f"Agent {agent_id} already has a terminal connection")
            self._terminal_connections.add(agent_id)
        return agent

    def release_terminal(self, agent_id: str) -> None:
        with self._lock:
            self._terminal_connections.discard(agent_id)

    def start_agent(self, agent_id: str) -> None:
        self.get_agent(agent_id).start()

    def stop_agent(self, agent_id: str) -> None:
        self.get_agent(agent_id).stop()

    def resize_agent(self, agent_id: str, cols: int, rows: int) -> None:
        self.get_agent(agent_id).resize(cols, rows)

    def send_to_agent(self, agent_id: str, text: str) -> None:
        agent = self.get_agent(agent_id)
        agent.send_line(text)

    def stop_all(self) -> None:
        with self._lock:
            agents = list(self._agents.values())
            self._agents.clear()
            self._terminal_connections.clear()
        for agent in agents:
            agent.dispose()


@lru_cache
def get_agent_manager() -> AgentManager:
    return AgentManager()
