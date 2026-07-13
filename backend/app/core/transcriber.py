"""Factory and facade for STT engines."""

from __future__ import annotations

import threading

from backend.app.config import RuntimeState, get_runtime_state
from backend.app.services.stt.base import STTEngine
from backend.app.services.stt.faster_whisper_engine import FasterWhisperEngine
from backend.app.services.stt.openwhispr_engine import OpenWhisprEngine

# Singleton: the Whisper model is expensive to load and warm up. Without this
# cache, each new /ws/audio connection created a fresh FasterWhisperEngine and,
# if the WS reconnected between dictations, the cached model reference was lost
# and the model reloaded on the next dictation (multi-second penalty).
_transcriber: STTEngine | None = None
_transcriber_provider: str | None = None
_transcriber_lock = threading.RLock()


def get_transcriber(runtime_state: RuntimeState | None = None) -> STTEngine:
    global _transcriber, _transcriber_provider
    provider = (runtime_state or get_runtime_state()).stt_provider
    with _transcriber_lock:
        if _transcriber is None or _transcriber_provider != provider:
            if provider == "openwhispr":
                _transcriber = OpenWhisprEngine()
            else:
                _transcriber = FasterWhisperEngine()
            _transcriber_provider = provider
        return _transcriber


def reset_transcriber() -> None:
    """Clear the cached engine (primarily for controlled shutdown/tests)."""
    global _transcriber, _transcriber_provider
    with _transcriber_lock:
        _transcriber = None
        _transcriber_provider = None
