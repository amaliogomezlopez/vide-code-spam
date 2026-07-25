"""Scrollback buffering and output fan-out for terminals."""

from __future__ import annotations

import threading
import time

from backend.app.core import agent_manager
from backend.app.core.agent_manager import SCROLLBACK_CHARS, AgentManager


class ScriptedSession:
    """PTY stub that emits a scripted list of chunks and then stays quiet."""

    def __init__(self, chunks: list[str]) -> None:
        self._chunks = list(chunks)
        self._lock = threading.Lock()
        self.alive = True
        self.closed = False
        self.writes: list[str] = []

    def write(self, data: str) -> None:
        self.writes.append(data)

    def read(self, timeout: float = 0.1) -> str:
        with self._lock:
            return self._chunks.pop(0) if self._chunks else ""

    def push(self, chunk: str) -> None:
        with self._lock:
            self._chunks.append(chunk)

    def is_alive(self) -> bool:
        return self.alive

    def close(self) -> None:
        self.closed = True
        self.alive = False

    def resize(self, cols: int, rows: int) -> None:
        return None

    def pid(self) -> int | None:
        """Part of the PtySession contract, read when resolving the real cwd."""

        return None


def _wait_for(predicate, timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def test_output_is_buffered_without_any_client(monkeypatch) -> None:
    session = ScriptedSession(["hello ", "world"])
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: session)
    manager = AgentManager()
    agent = manager.create_agent("one", "One", "fake", autostart=True)

    assert _wait_for(lambda: agent.snapshot() == "hello world")
    manager.stop_all()


def test_attach_replays_history_and_streams_new_output(monkeypatch) -> None:
    session = ScriptedSession(["first"])
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: session)
    manager = AgentManager()
    agent = manager.create_agent("one", "One", "fake", autostart=True)
    assert _wait_for(lambda: agent.snapshot() == "first")

    received: list[str | None] = []
    snapshot, unsubscribe = agent.attach(received.append)
    session.push("second")

    assert snapshot == "first"
    assert _wait_for(lambda: received == ["second"])
    unsubscribe()
    session.push("third")
    assert _wait_for(lambda: agent.snapshot() == "firstsecondthird")
    assert received == ["second"]
    manager.stop_all()


def test_exit_notifies_subscribers_once(monkeypatch) -> None:
    session = ScriptedSession([])
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: session)
    manager = AgentManager()
    agent = manager.create_agent("one", "One", "fake", autostart=True)
    received: list[str | None] = []
    agent.attach(received.append)

    session.alive = False

    assert _wait_for(lambda: received == [None])
    assert agent.refresh_status() == "stopped"
    manager.stop_all()


def test_scrollback_is_bounded(monkeypatch) -> None:
    session = ScriptedSession([])
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: session)
    manager = AgentManager()
    agent = manager.create_agent("one", "One", "fake", autostart=True)

    for _ in range(40):
        session.push("x" * 10_000)

    assert _wait_for(lambda: len(agent.snapshot()) <= SCROLLBACK_CHARS and agent.snapshot())
    assert len(agent.snapshot()) <= SCROLLBACK_CHARS
    manager.stop_all()


def test_descriptor_round_trips_the_launch_definition(monkeypatch) -> None:
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: ScriptedSession([]))
    manager = AgentManager()
    manager.create_agent(
        "one", "Codex 1", "codex.exe", args="--model x", cwd="D:/repo", cli_id="codex"
    )

    assert manager.descriptors() == [
        {
            "id": "one",
            "name": "Codex 1",
            "command": "codex.exe",
            "args": "--model x",
            "cwd": "D:/repo",
            "cli_id": "codex",
            "process_cwd": None,
            "env": {},
        }
    ]
    manager.stop_all()


def test_change_listener_sees_every_layout_change(monkeypatch) -> None:
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: ScriptedSession([]))
    manager = AgentManager()
    seen: list[int] = []
    manager.on_change(lambda descriptors: seen.append(len(descriptors)))

    manager.create_agent("one", "One", "fake")
    manager.create_agent("two", "Two", "fake")
    manager.remove_agent("one")

    assert seen == [1, 2, 1]
    manager.stop_all()
