"""Manage CLI agents running in pseudo-terminals."""

from __future__ import annotations

import logging
import os
import shutil
import sys
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from backend.app.config import get_settings
from backend.app.core.pty_backend import DEFAULT_COLS, DEFAULT_ROWS, PtySession, spawn_pty
from backend.app.core.git_worktrees import git_status_cache
from backend.app.core.user_config import DEFAULT_SCROLLBACK_CHARS, get_runtime_config

logger = logging.getLogger(__name__)

# Output kept per terminal so a reconnecting client (filter toggled, panel
# remounted, WebSocket dropped) sees its history instead of a blank screen.
# Read through scrollback_limit() so the user setting applies without a restart.
SCROLLBACK_CHARS = DEFAULT_SCROLLBACK_CHARS
_READ_TIMEOUT = 0.2
_IDLE_SLEEP = 0.01

# ``None`` signals "the process exited"; anything else is terminal output.
OutputCallback = Callable[[str | None], None]


def scrollback_limit() -> int:
    """Per-terminal scrollback budget, honouring the user setting."""

    try:
        return get_runtime_config().scrollback_chars
    except Exception:  # pragma: no cover - fall back to the built-in default
        return SCROLLBACK_CHARS


def _paths_differ(left: str, right: str) -> bool:
    if not left or not right:
        return False
    try:
        return os.path.normcase(os.path.realpath(left)) != os.path.normcase(
            os.path.realpath(right)
        )
    except OSError:  # pragma: no cover - unreadable path
        return False


@dataclass
class AgentProcess:
    id: str
    name: str
    command: str
    args: str = ""
    cwd: str = ""
    cli_id: str = ""
    process_cwd: str | None = field(default=None, repr=False)
    env: dict[str, str] = field(default_factory=dict, repr=False)
    status: str = "stopped"
    _session: PtySession | None = field(default=None, repr=False)
    _removed: bool = field(default=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    _start_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _buffer: deque[str] = field(default_factory=deque, repr=False)
    _buffer_chars: int = field(default=0, repr=False)
    _subscribers: list[OutputCallback] = field(default_factory=list, repr=False)
    _reader: threading.Thread | None = field(default=None, repr=False)
    _last_output_at: float = field(default=0.0, repr=False)

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
            spawn_cwd = self.cwd if self.process_cwd is None else self.process_cwd
            session = spawn_pty(
                self.command,
                self.args,
                cwd=spawn_cwd or None,
                env=self.env or None,
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
            self._start_reader(session)
            logger.info(
                "Started agent %s: %s %s (cwd=%s)", self.id, self.command, self.args, self.cwd
            )
        except Exception as exc:
            with self._lock:
                self.status = "stopped" if self._removed else "error"
            logger.exception("Failed to start agent %s", self.id)
            raise RuntimeError(f"Failed to start {self.id}: {exc}") from exc

    def _start_reader(self, session: PtySession) -> None:
        """Own the PTY from a single daemon thread.

        Draining the PTY here (instead of from each WebSocket) keeps the process
        from stalling on a full pipe when no terminal is attached, feeds the
        scrollback buffer, and frees the asyncio thread pool that also serves
        HTTP requests and Git calls.
        """

        reader = threading.Thread(
            target=self._read_loop,
            args=(session,),
            name=f"pty-reader-{self.id}",
            daemon=True,
        )
        with self._lock:
            self._reader = reader
        reader.start()

    def _read_loop(self, session: PtySession) -> None:
        while True:
            with self._lock:
                if self._removed or self._session is not session:
                    return
            try:
                data = session.read(timeout=_READ_TIMEOUT)
            except Exception:  # pragma: no cover - transport specific
                data = ""
                if not session.is_alive():
                    break
            if data:
                self._publish(data)
                continue
            if not session.is_alive():
                break
            time.sleep(_IDLE_SLEEP)

        with self._lock:
            exited = self._session is session
            if exited:
                self.status = "stopped"
                self._session = None
        if exited:
            session.close()
            self._publish(None)

    def _publish(self, data: str | None) -> None:
        with self._lock:
            if data is not None:
                self._buffer.append(data)
                self._buffer_chars += len(data)
                limit = scrollback_limit()
                while self._buffer_chars > limit and len(self._buffer) > 1:
                    self._buffer_chars -= len(self._buffer.popleft())
                self._last_output_at = time.time()
            subscribers = list(self._subscribers)
        for callback in subscribers:
            try:
                callback(data)
            except Exception:  # pragma: no cover - a dead client must not stop the reader
                logger.debug("Terminal subscriber failed for %s", self.id, exc_info=True)

    def subscribe(self, callback: OutputCallback) -> Callable[[], None]:
        """Register an output listener and return its unsubscribe function."""

        with self._lock:
            self._subscribers.append(callback)

        def unsubscribe() -> None:
            with self._lock:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)

        return unsubscribe

    def attach(self, callback: OutputCallback) -> tuple[str, Callable[[], None]]:
        """Atomically read the scrollback and start receiving new output.

        Doing both under one lock is what keeps a reconnecting terminal from
        either dropping or duplicating the output produced while it connects.
        """

        with self._lock:
            snapshot = "".join(self._buffer)
            self._subscribers.append(callback)

        def unsubscribe() -> None:
            with self._lock:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)

        return snapshot, unsubscribe

    def snapshot(self) -> str:
        with self._lock:
            return "".join(self._buffer)

    def last_output_at(self) -> float:
        with self._lock:
            return self._last_output_at

    def actual_cwd(self) -> str:
        """Directory the child process is really in, when the OS can tell us.

        The card shows the folder the terminal was launched in, but an agent can
        `cd` somewhere else and make that label a lie. Only Linux exposes this
        cheaply through /proc; elsewhere the caller keeps the launch directory
        and says so instead of guessing.
        """

        if not sys.platform.startswith("linux"):
            return ""
        with self._lock:
            session = self._session
        if session is None:
            return ""
        pid = session.pid()
        if pid is None:
            return ""
        try:
            return os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            return ""

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
            self._subscribers.clear()
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

    # No public read(): the reader thread owns the PTY transport. A second
    # reader would steal chunks from the scrollback and from every subscriber.
    # Use `attach()` to receive output.

    def resize(self, cols: int, rows: int) -> None:
        if self._session is not None:
            self._session.resize(cols, rows)

    def descriptor(self) -> dict[str, Any]:
        """Serializable definition used to restore this terminal later."""

        return {
            "id": self.id,
            "name": self.name,
            "command": self.command,
            "args": self.args,
            "cwd": self.cwd,
            "cli_id": self.cli_id,
            "process_cwd": self.process_cwd,
            "env": dict(self.env),
        }


class AgentManager:
    def __init__(self) -> None:
        self._agents: dict[str, AgentProcess] = {}
        self._lock = threading.RLock()
        self._terminal_connections: set[str] = set()
        self._change_listeners: list[Callable[[list[dict[str, Any]]], None]] = []
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

    def on_change(self, listener: Callable[[list[dict[str, Any]]], None]) -> None:
        """Notify a listener whenever the set of agents changes."""

        with self._lock:
            self._change_listeners.append(listener)

    def _notify_change(self) -> None:
        with self._lock:
            listeners = list(self._change_listeners)
            descriptors = [agent.descriptor() for agent in self._agents.values()]
        for listener in listeners:
            try:
                listener(descriptors)
            except Exception:  # pragma: no cover - persistence must never break the app
                logger.debug("Agent change listener failed", exc_info=True)

    def create_agent(
        self,
        agent_id: str,
        name: str,
        command: str,
        args: str = "",
        cwd: str = "",
        autostart: bool = False,
        process_cwd: str | None = None,
        cli_id: str = "",
        env: dict[str, str] | None = None,
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
                cli_id=cli_id,
                process_cwd=process_cwd,
                env=dict(env or {}),
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
        self._notify_change()
        return agent

    def remove_agent(self, agent_id: str) -> None:
        with self._lock:
            agent = self._agents.pop(agent_id, None)
            self._terminal_connections.discard(agent_id)
        if agent is None:
            raise ValueError(f"Agent {agent_id} not found")
        agent.dispose()
        self._notify_change()

    def list_agents(self) -> list[dict[str, Any]]:
        with self._lock:
            agents = list(self._agents.values())
        rows: list[dict[str, Any]] = []
        for agent in agents:
            actual_cwd = agent.actual_cwd()
            rows.append({
                "id": agent.id,
                "name": agent.name,
                "command": agent.command,
                "args": agent.args,
                "cwd": agent.cwd,
                "cli_id": agent.cli_id,
                "status": agent.refresh_status(),
                "last_output_at": agent.last_output_at(),
                "process_cwd_actual": actual_cwd,
                "cwd_drifted": _paths_differ(actual_cwd, agent.cwd),
                "git": git_status_cache.get(agent.cwd),
            })
        return rows

    def descriptors(self) -> list[dict[str, Any]]:
        with self._lock:
            return [agent.descriptor() for agent in self._agents.values()]

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
        self._notify_change()


@lru_cache
def get_agent_manager() -> AgentManager:
    return AgentManager()
