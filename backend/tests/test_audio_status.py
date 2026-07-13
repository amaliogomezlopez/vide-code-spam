"""STT readiness endpoint behavior."""

from __future__ import annotations

from types import SimpleNamespace

from backend.app.api.routes import audio


class DummyEngine:
    def __init__(self) -> None:
        self.started = False

    def start_preload(self) -> None:
        self.started = True

    def status(self) -> dict[str, object]:
        return {
            "state": "loading",
            "ready": False,
            "model": "large-v3-turbo",
            "device": "cpu",
        }


def test_status_starts_lazy_preload_and_reports_effective_profile(monkeypatch) -> None:
    engine = DummyEngine()
    runtime = SimpleNamespace(stt_provider="faster-whisper")
    monkeypatch.setattr(audio, "get_runtime_state", lambda: runtime)
    monkeypatch.setattr(audio, "get_transcriber", lambda state: engine)

    result = audio.stt_status()

    assert engine.started
    assert result == {
        "state": "loading",
        "ready": False,
        "model": "large-v3-turbo",
        "device": "cpu",
    }
