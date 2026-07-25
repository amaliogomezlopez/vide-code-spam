"""Persist the open terminal layout so a session survives an app restart."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from backend.app.core.user_paths import config_file, read_json, write_json

MAX_RESTORABLE_AGENTS = 12
_FIELDS = ("id", "name", "command", "args", "cwd", "cli_id", "process_cwd", "env")


def _sanitize(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    agent_id = str(entry.get("id", "")).strip()
    command = str(entry.get("command", "")).strip()
    if not agent_id or not command:
        return None
    process_cwd = entry.get("process_cwd")
    raw_env = entry.get("env")
    env = (
        {
            str(key)[:128]: str(value)[:1024]
            for key, value in list(raw_env.items())[:32]
        }
        if isinstance(raw_env, dict)
        else {}
    )
    return {
        "id": agent_id[:128],
        "name": str(entry.get("name", agent_id))[:128],
        "command": command[:4096],
        "args": str(entry.get("args", ""))[:8192],
        "cwd": str(entry.get("cwd", ""))[:4096],
        "cli_id": str(entry.get("cli_id", ""))[:64],
        "process_cwd": None if process_cwd is None else str(process_cwd)[:4096],
        "env": env,
    }


class SessionStore:
    """Snapshot of the terminals that were open the last time the app ran.

    The snapshot read at startup is kept in memory so the shutdown sequence
    (which closes every agent) cannot erase what the user is about to restore.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or config_file("session.json")
        self._lock = threading.Lock()
        self._previous: list[dict[str, Any]] | None = None
        self._frozen = False

    def previous(self) -> list[dict[str, Any]]:
        with self._lock:
            if self._previous is None:
                raw = read_json(self._path, [])
                entries = raw if isinstance(raw, list) else []
                sanitized = [item for item in (_sanitize(entry) for entry in entries) if item]
                self._previous = sanitized[:MAX_RESTORABLE_AGENTS]
            return [dict(item) for item in self._previous]

    def record(self, descriptors: list[dict[str, Any]]) -> None:
        """Persist the current layout. Ignored once the app starts shutting down."""

        self.previous()  # Make sure the startup snapshot is captured first.
        with self._lock:
            if self._frozen:
                return
            payload = [
                {key: descriptor.get(key) for key in _FIELDS}
                for descriptor in descriptors[:MAX_RESTORABLE_AGENTS]
            ]
        write_json(self._path, payload)

    def clear(self) -> None:
        with self._lock:
            self._previous = []
        write_json(self._path, [])

    def freeze(self) -> None:
        """Stop persisting changes (used while tearing the backend down)."""

        with self._lock:
            self._frozen = True


_store: SessionStore | None = None
_store_lock = threading.Lock()


def get_session_store() -> SessionStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = SessionStore()
        return _store
