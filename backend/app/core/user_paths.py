"""Shared location for per-user configuration written by the backend."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

_write_lock = threading.Lock()


def config_dir() -> Path:
    """Return the per-user configuration directory for Vibe Spam."""

    if os.name == "nt" and os.getenv("APPDATA"):
        return Path(os.environ["APPDATA"]) / "vibe-spam"
    return Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "vibe-spam"


def config_file(name: str) -> Path:
    return config_dir() / name


def read_json(path: Path, default: Any) -> Any:
    """Read a JSON document, returning ``default`` when it is missing or broken."""

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError, UnicodeDecodeError):
        return default


def write_json(path: Path, payload: Any) -> None:
    """Atomically persist a JSON document, ignoring read-only environments."""

    with _write_lock:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            temporary.replace(path)
        except OSError:
            # Persistence is a convenience; a locked or read-only profile must
            # never take down the running session.
            return
