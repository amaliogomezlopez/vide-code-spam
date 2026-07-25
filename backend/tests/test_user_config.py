"""Per-user runtime configuration."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.core import user_config
from backend.app.core.user_config import UserConfigStore


def _env_without_explicit_device(monkeypatch: pytest.MonkeyPatch) -> None:
    """Simulate a machine whose .env never pins WHISPER_DEVICE."""

    monkeypatch.setattr(
        user_config,
        "get_settings",
        lambda: SimpleNamespace(
            stt_provider="faster-whisper",
            llm_cleaner_provider="none",
            whisper_model_size="large-v3-turbo",
            whisper_language="es",
            whisper_device="cpu",
            whisper_compute_type="int8",
            whisper_beam_size=1,
            model_fields_set=set(),
        ),
    )


def test_defaults_come_from_settings(tmp_path: Path) -> None:
    config = UserConfigStore(tmp_path / "config.json").load()

    assert config.stt_provider in {"faster-whisper", "openwhispr"}
    assert config.preload_model is True


def test_update_persists_and_reloads(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    store = UserConfigStore(path)

    config, engine_changed = store.update({"whisper_model_size": "small", "preload_model": False})

    assert config.whisper_model_size == "small"
    assert engine_changed is True
    reloaded = UserConfigStore(path).load()
    assert reloaded.whisper_model_size == "small"
    assert reloaded.preload_model is False


def test_cleaner_change_does_not_force_an_engine_reload(tmp_path: Path) -> None:
    store = UserConfigStore(tmp_path / "config.json")

    _, engine_changed = store.update({"cleaner_provider": "groq"})

    assert engine_changed is False


def test_invalid_values_fall_back_to_the_current_configuration(tmp_path: Path) -> None:
    store = UserConfigStore(tmp_path / "config.json")
    before = store.load()

    config, _ = store.update({
        "stt_provider": "definitely-not-a-provider",
        "whisper_model_size": "gigantic",
        "whisper_device": "quantum",
        "whisper_beam_size": 99,
        "whisper_language": "12345",
    })

    assert config.stt_provider == before.stt_provider
    assert config.whisper_model_size == before.whisper_model_size
    assert config.whisper_device == before.whisper_device
    assert config.whisper_beam_size == 10
    assert config.whisper_language == before.whisper_language


def test_implicit_device_is_never_frozen_on_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _env_without_explicit_device(monkeypatch)
    path = tmp_path / "config.json"

    UserConfigStore(path).update({"whisper_model_size": "base"})

    stored = json.loads(path.read_text(encoding="utf-8"))
    # The CUDA build relies on "device not chosen" to auto-detect its runtime.
    assert "whisper_device" not in stored
    assert UserConfigStore(path).load().device_explicit is False


def test_explicit_device_survives_a_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _env_without_explicit_device(monkeypatch)
    path = tmp_path / "config.json"
    UserConfigStore(path).update({"whisper_device": "cuda"})

    reloaded = UserConfigStore(path).load()

    assert reloaded.whisper_device == "cuda"
    assert reloaded.device_explicit is True
