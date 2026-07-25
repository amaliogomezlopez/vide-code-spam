"""Per-user runtime configuration that survives restarts of the packaged app.

The `.env` file is a developer convenience: it is read relative to the working
directory, which is meaningless for an installed executable. Anything the user
can change from the Settings dialog lives here instead, in the same per-user
folder used for CLI profiles and the session snapshot.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from backend.app.config import get_settings
from backend.app.core.user_paths import config_file, read_json, write_json

STT_PROVIDERS = ("faster-whisper", "openwhispr")
CLEANER_PROVIDERS = ("ollama", "groq", "none")
WHISPER_DEVICES = ("cpu", "cuda", "auto")
WHISPER_COMPUTE_TYPES = ("int8", "int8_float16", "float16", "float32", "auto")
DEFAULT_SCROLLBACK_CHARS = 200_000
MIN_SCROLLBACK_CHARS = 20_000
MAX_SCROLLBACK_CHARS = 2_000_000
WHISPER_MODEL_SIZES = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v2",
    "large-v3",
    "large-v3-turbo",
)

# Fields that force a fresh STT engine when they change.
_ENGINE_FIELDS = (
    "stt_provider",
    "whisper_model_size",
    "whisper_language",
    "whisper_device",
    "whisper_compute_type",
    "whisper_beam_size",
)


@dataclass(frozen=True)
class RuntimeConfig:
    stt_provider: str
    cleaner_provider: str
    whisper_model_size: str
    whisper_language: str
    whisper_device: str
    whisper_compute_type: str
    whisper_beam_size: int
    preload_model: bool
    scrollback_chars: int
    device_explicit: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "stt_provider": self.stt_provider,
            "cleaner_provider": self.cleaner_provider,
            "whisper_model_size": self.whisper_model_size,
            "whisper_language": self.whisper_language,
            "whisper_device": self.whisper_device,
            "whisper_compute_type": self.whisper_compute_type,
            "whisper_beam_size": self.whisper_beam_size,
            "preload_model": self.preload_model,
            "scrollback_chars": self.scrollback_chars,
        }


def _choice(value: Any, allowed: tuple[str, ...], fallback: str) -> str:
    text = str(value).strip().lower()
    return text if text in allowed else fallback


def _defaults() -> RuntimeConfig:
    settings = get_settings()
    return RuntimeConfig(
        stt_provider=_choice(settings.stt_provider, STT_PROVIDERS, "faster-whisper"),
        cleaner_provider=_choice(settings.llm_cleaner_provider, CLEANER_PROVIDERS, "none"),
        whisper_model_size=settings.whisper_model_size,
        whisper_language=settings.whisper_language,
        whisper_device=_choice(settings.whisper_device, WHISPER_DEVICES, "cpu"),
        whisper_compute_type=_choice(
            settings.whisper_compute_type, WHISPER_COMPUTE_TYPES, "int8"
        ),
        whisper_beam_size=settings.whisper_beam_size,
        preload_model=True,
        scrollback_chars=DEFAULT_SCROLLBACK_CHARS,
        device_explicit="whisper_device" in settings.model_fields_set,
    )


def _apply(base: RuntimeConfig, patch: dict[str, Any]) -> RuntimeConfig:
    updated = base
    if "stt_provider" in patch:
        updated = replace(
            updated, stt_provider=_choice(patch["stt_provider"], STT_PROVIDERS, base.stt_provider)
        )
    if "cleaner_provider" in patch:
        updated = replace(
            updated,
            cleaner_provider=_choice(
                patch["cleaner_provider"], CLEANER_PROVIDERS, base.cleaner_provider
            ),
        )
    if "whisper_model_size" in patch:
        model = str(patch["whisper_model_size"]).strip()
        updated = replace(
            updated,
            whisper_model_size=model if model in WHISPER_MODEL_SIZES else base.whisper_model_size,
        )
    if "whisper_language" in patch:
        language = str(patch["whisper_language"]).strip().lower()
        updated = replace(
            updated,
            whisper_language=language
            if language and len(language) <= 16 and language.replace("-", "").isalpha()
            else base.whisper_language,
        )
    if "whisper_device" in patch:
        device = _choice(patch["whisper_device"], WHISPER_DEVICES, base.whisper_device)
        updated = replace(updated, whisper_device=device, device_explicit=True)
    if "whisper_compute_type" in patch:
        updated = replace(
            updated,
            whisper_compute_type=_choice(
                patch["whisper_compute_type"], WHISPER_COMPUTE_TYPES, base.whisper_compute_type
            ),
        )
    if "whisper_beam_size" in patch:
        try:
            beam = int(patch["whisper_beam_size"])
        except (TypeError, ValueError):
            beam = base.whisper_beam_size
        updated = replace(updated, whisper_beam_size=max(1, min(10, beam)))
    if "preload_model" in patch:
        updated = replace(updated, preload_model=bool(patch["preload_model"]))
    if "scrollback_chars" in patch:
        try:
            scrollback = int(patch["scrollback_chars"])
        except (TypeError, ValueError):
            scrollback = base.scrollback_chars
        updated = replace(
            updated,
            scrollback_chars=max(MIN_SCROLLBACK_CHARS, min(MAX_SCROLLBACK_CHARS, scrollback)),
        )
    return updated


class UserConfigStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or config_file("config.json")
        self._lock = threading.RLock()
        self._cached: RuntimeConfig | None = None

    def load(self) -> RuntimeConfig:
        with self._lock:
            if self._cached is None:
                stored = read_json(self._path, {})
                patch = stored if isinstance(stored, dict) else {}
                self._cached = _apply(_defaults(), patch)
            return self._cached

    def update(self, patch: dict[str, Any]) -> tuple[RuntimeConfig, bool]:
        """Persist a partial update. Returns the config and whether STT must reload."""

        with self._lock:
            current = self.load()
            updated = _apply(current, patch)
            self._cached = updated
            payload = updated.as_dict()
            if not updated.device_explicit:
                # Never freeze an implicit device: the CUDA build relies on the
                # "not explicitly chosen" state to auto-detect its runtime.
                payload.pop("whisper_device", None)
        write_json(self._path, payload)
        engine_changed = any(
            getattr(current, field) != getattr(updated, field) for field in _ENGINE_FIELDS
        )
        return updated, engine_changed

    def invalidate(self) -> None:
        with self._lock:
            self._cached = None


_store: UserConfigStore | None = None
_store_lock = threading.Lock()


def get_user_config_store() -> UserConfigStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = UserConfigStore()
        return _store


def get_runtime_config() -> RuntimeConfig:
    return get_user_config_store().load()
