"""Agent lifecycle regression tests."""

from __future__ import annotations

import pytest
import threading

from backend.app.core import agent_manager
from backend.app.core.agent_manager import AgentManager


class FakeSession:
    def __init__(self) -> None:
        self.alive = True
        self.closed = False
        self.writes: list[str] = []

    def write(self, data: str) -> None:
        self.writes.append(data)

    def read(self, timeout: float = 0.1) -> str:
        return ""

    def is_alive(self) -> bool:
        return self.alive

    def close(self) -> None:
        self.closed = True
        self.alive = False

    def resize(self, cols: int, rows: int) -> None:
        return None


def test_dead_process_status_is_refreshed(monkeypatch) -> None:
    session = FakeSession()
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: session)
    manager = AgentManager()
    manager.create_agent("dead", "Dead", "fake", autostart=True)

    session.alive = False

    assert manager.list_agents()[0]["status"] == "stopped"


def test_failed_autostart_rolls_back_agent(monkeypatch) -> None:
    def fail_spawn(*args, **kwargs):
        raise FileNotFoundError("missing")

    monkeypatch.setattr(agent_manager, "spawn_pty", fail_spawn)
    manager = AgentManager()

    with pytest.raises(RuntimeError, match="Failed to start"):
        manager.create_agent("missing", "Missing", "missing", autostart=True)

    assert manager.list_agents() == []


def test_removed_agent_cannot_restart(monkeypatch) -> None:
    session = FakeSession()
    calls = 0

    def spawn(*args, **kwargs):
        nonlocal calls
        calls += 1
        return session

    monkeypatch.setattr(agent_manager, "spawn_pty", spawn)
    manager = AgentManager()
    agent = manager.create_agent("one", "One", "fake", autostart=True)
    manager.remove_agent("one")

    with pytest.raises(RuntimeError, match="removed"):
        agent.write("hello")
    assert calls == 1
    assert session.closed


def test_only_one_terminal_reader_is_allowed(monkeypatch) -> None:
    monkeypatch.setattr(agent_manager, "spawn_pty", lambda *args, **kwargs: FakeSession())
    manager = AgentManager()
    manager.create_agent("one", "One", "fake")

    manager.claim_terminal("one")
    with pytest.raises(RuntimeError, match="already has"):
        manager.claim_terminal("one")
    manager.release_terminal("one")
    assert manager.claim_terminal("one").id == "one"


def test_stop_all_disposes_every_process(monkeypatch) -> None:
    sessions: list[FakeSession] = []

    def spawn(*args, **kwargs):
        session = FakeSession()
        sessions.append(session)
        return session

    monkeypatch.setattr(agent_manager, "spawn_pty", spawn)
    manager = AgentManager()
    manager.create_agent("one", "One", "fake", autostart=True)
    manager.create_agent("two", "Two", "fake", autostart=True)

    manager.stop_all()

    assert manager.list_agents() == []
    assert all(session.closed for session in sessions)


def test_remove_during_start_closes_late_session(monkeypatch) -> None:
    entered = threading.Event()
    release = threading.Event()
    session = FakeSession()

    def slow_spawn(*args, **kwargs):
        entered.set()
        assert release.wait(timeout=2)
        return session

    monkeypatch.setattr(agent_manager, "spawn_pty", slow_spawn)
    manager = AgentManager()
    errors: list[Exception] = []

    def create() -> None:
        try:
            manager.create_agent("slow", "Slow", "fake", autostart=True)
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=create)
    thread.start()
    assert entered.wait(timeout=2)
    manager.remove_agent("slow")
    release.set()
    thread.join(timeout=2)

    assert not thread.is_alive()
    assert errors
    assert session.closed
    assert manager.list_agents() == []
