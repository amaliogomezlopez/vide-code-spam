"""Session snapshot persistence."""

from __future__ import annotations

import json
from pathlib import Path

from backend.app.core.session_store import SessionStore


def _descriptor(agent_id: str) -> dict[str, object]:
    return {
        "id": agent_id,
        "name": agent_id.upper(),
        "command": "codex.exe",
        "args": "",
        "cwd": "D:/repo",
        "cli_id": "codex",
        "process_cwd": None,
    }


def test_record_and_reload(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    SessionStore(path).record([_descriptor("one"), _descriptor("two")])

    restored = SessionStore(path).previous()

    assert [item["id"] for item in restored] == ["one", "two"]
    assert restored[0]["cli_id"] == "codex"


def test_shutdown_does_not_erase_the_restorable_snapshot(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    store = SessionStore(path)
    store.record([_descriptor("one")])

    store.freeze()
    store.record([])  # stop_all() during shutdown

    assert [item["id"] for item in SessionStore(path).previous()] == ["one"]


def test_previous_is_captured_before_the_first_write(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    path.write_text(json.dumps([_descriptor("old")]), encoding="utf-8")
    store = SessionStore(path)

    store.record([])  # app started with no terminals open

    assert [item["id"] for item in store.previous()] == ["old"]
    assert json.loads(path.read_text(encoding="utf-8")) == []


def test_clear_forgets_everything(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    store = SessionStore(path)
    store.record([_descriptor("one")])

    store.clear()

    assert store.previous() == []
    assert SessionStore(path).previous() == []


def test_corrupted_or_partial_entries_are_ignored(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    path.write_text(
        json.dumps([{"id": "no-command"}, "nonsense", _descriptor("good")]), encoding="utf-8"
    )

    assert [item["id"] for item in SessionStore(path).previous()] == ["good"]


def test_unreadable_file_is_treated_as_empty(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    path.write_text("{ not json", encoding="utf-8")

    assert SessionStore(path).previous() == []
