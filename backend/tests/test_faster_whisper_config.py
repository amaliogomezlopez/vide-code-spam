"""Configuration precedence for faster-whisper."""

from __future__ import annotations

import pytest

from backend.app.core.user_config import RuntimeConfig
from backend.app.services.stt import faster_whisper_engine


def _config(device: str, compute_type: str = "int8", explicit: bool = False) -> RuntimeConfig:
    return RuntimeConfig(
        stt_provider="faster-whisper",
        cleaner_provider="none",
        whisper_model_size="tiny",
        whisper_language="es",
        whisper_device=device,
        whisper_compute_type=compute_type,
        whisper_beam_size=1,
        preload_model=True,
        scrollback_chars=200_000,
        device_explicit=explicit,
    )


def _use(monkeypatch: pytest.MonkeyPatch, config: RuntimeConfig) -> None:
    monkeypatch.setattr(faster_whisper_engine, "get_runtime_config", lambda: config)
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_check_vad_available",
        staticmethod(lambda: False),
    )


def test_explicit_cpu_configuration_is_not_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    _use(monkeypatch, _config("cpu", explicit=True))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_detect_gpu",
        staticmethod(lambda: True),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert engine._device == "cpu"
    assert engine._compute_type == "int8"


def test_portable_defaults_remain_on_cpu_even_when_gpu_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use(monkeypatch, _config("cpu"))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine, "_detect_gpu", staticmethod(lambda: True)
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_cuda_runtime_available",
        staticmethod(lambda: True),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert (engine._device, engine._compute_type) == ("cpu", "int8")
    assert engine.status()["state"] == "not_loaded"
    assert engine.status()["ready"] is False


def test_auto_uses_cpu_when_cuda_runtime_is_incomplete(monkeypatch: pytest.MonkeyPatch) -> None:
    _use(monkeypatch, _config("auto"))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine, "_detect_gpu", staticmethod(lambda: True)
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_cuda_runtime_available",
        staticmethod(lambda: False),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert (engine._device, engine._compute_type) == ("cpu", "int8")


def test_cuda_build_marker_selects_gpu_without_env_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use(monkeypatch, _config("cpu"))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_is_cuda_build",
        staticmethod(lambda: True),
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine, "_detect_gpu", staticmethod(lambda: True)
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_cuda_runtime_available",
        staticmethod(lambda: True),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert (engine._device, engine._compute_type) == ("cuda", "float16")


def test_user_selected_model_and_language_reach_the_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = RuntimeConfig(
        stt_provider="faster-whisper",
        cleaner_provider="none",
        whisper_model_size="small",
        whisper_language="auto",
        whisper_device="cpu",
        whisper_compute_type="int8",
        whisper_beam_size=3,
        preload_model=False,
        scrollback_chars=200_000,
        device_explicit=True,
    )
    _use(monkeypatch, config)

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert engine._model_size == "small"
    assert engine._language is None
    assert engine._beam_size == 3


def test_cuda_runtime_error_switches_session_to_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    _use(monkeypatch, _config("cpu"))
    engine = faster_whisper_engine.FasterWhisperEngine()
    engine._device = "cuda"
    engine._compute_type = "float16"
    engine._model = object()  # type: ignore[assignment]
    cpu_model = object()
    monkeypatch.setattr(engine, "_load", lambda: cpu_model)

    result = engine._switch_to_cpu(RuntimeError("Library cublas64_12.dll is not found"))

    assert result is cpu_model
    assert engine._model is None
    assert (engine._device, engine._compute_type) == ("cpu", "int8")
