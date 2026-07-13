"""STT provider cache behavior."""

from __future__ import annotations

from types import SimpleNamespace

from backend.app.core import transcriber


class DummyFaster:
    pass


class DummyOpenWhispr:
    pass


def test_provider_change_replaces_cached_engine(monkeypatch) -> None:
    monkeypatch.setattr(transcriber, "FasterWhisperEngine", DummyFaster)
    monkeypatch.setattr(transcriber, "OpenWhisprEngine", DummyOpenWhispr)
    transcriber.reset_transcriber()
    state = SimpleNamespace(stt_provider="faster-whisper")

    first = transcriber.get_transcriber(state)
    state.stt_provider = "openwhispr"
    second = transcriber.get_transcriber(state)

    assert isinstance(first, DummyFaster)
    assert isinstance(second, DummyOpenWhispr)
    assert first is not second
    transcriber.reset_transcriber()
