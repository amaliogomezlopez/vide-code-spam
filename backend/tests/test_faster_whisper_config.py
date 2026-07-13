"""Configuration precedence for faster-whisper."""

from __future__ import annotations

from types import SimpleNamespace

from backend.app.services.stt import faster_whisper_engine


def test_explicit_cpu_configuration_is_not_overridden(monkeypatch) -> None:
    settings = SimpleNamespace(
        whisper_model_size="tiny",
        whisper_device="cpu",
        whisper_compute_type="int8",
        whisper_beam_size=1,
        whisper_language="es",
        model_fields_set={"whisper_device", "whisper_compute_type"},
    )
    monkeypatch.setattr(faster_whisper_engine, "get_settings", lambda: settings)
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_detect_gpu",
        staticmethod(lambda: True),
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_check_vad_available",
        staticmethod(lambda: False),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert engine._device == "cpu"
    assert engine._compute_type == "int8"


def _settings(device: str, compute_type: str = "int8") -> SimpleNamespace:
    return SimpleNamespace(
        whisper_model_size="tiny",
        whisper_device=device,
        whisper_compute_type=compute_type,
        whisper_beam_size=1,
        whisper_language="es",
        model_fields_set=set(),
    )


def test_portable_defaults_remain_on_cpu_even_when_gpu_exists(monkeypatch) -> None:
    monkeypatch.setattr(faster_whisper_engine, "get_settings", lambda: _settings("cpu"))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine, "_detect_gpu", staticmethod(lambda: True)
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_cuda_runtime_available",
        staticmethod(lambda: True),
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_check_vad_available",
        staticmethod(lambda: False),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert (engine._device, engine._compute_type) == ("cpu", "int8")
    assert engine.status()["state"] == "not_loaded"
    assert engine.status()["ready"] is False


def test_auto_uses_cpu_when_cuda_runtime_is_incomplete(monkeypatch) -> None:
    monkeypatch.setattr(faster_whisper_engine, "get_settings", lambda: _settings("auto"))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine, "_detect_gpu", staticmethod(lambda: True)
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_cuda_runtime_available",
        staticmethod(lambda: False),
    )
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_check_vad_available",
        staticmethod(lambda: False),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert (engine._device, engine._compute_type) == ("cpu", "int8")


def test_cuda_build_marker_selects_gpu_without_env_override(monkeypatch) -> None:
    monkeypatch.setattr(faster_whisper_engine, "get_settings", lambda: _settings("cpu"))
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
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_check_vad_available",
        staticmethod(lambda: False),
    )

    engine = faster_whisper_engine.FasterWhisperEngine()

    assert (engine._device, engine._compute_type) == ("cuda", "float16")


def test_cuda_runtime_error_switches_session_to_cpu(monkeypatch) -> None:
    monkeypatch.setattr(faster_whisper_engine, "get_settings", lambda: _settings("cpu"))
    monkeypatch.setattr(
        faster_whisper_engine.FasterWhisperEngine,
        "_check_vad_available",
        staticmethod(lambda: False),
    )
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
