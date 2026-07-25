"""Runtime settings persisted per user instead of in a .env file."""

from __future__ import annotations

from fastapi import APIRouter

from backend.app.config import get_runtime_state
from backend.app.core.user_config import RuntimeConfig, get_user_config_store
from backend.app.core.transcriber import reset_transcriber
from backend.app.models.schemas import RuntimeSettings, RuntimeSettingsUpdate

router = APIRouter()


def _as_response(config: RuntimeConfig) -> RuntimeSettings:
    return RuntimeSettings(**config.as_dict())


def apply_runtime_config(config: RuntimeConfig) -> None:
    """Mirror the persisted configuration onto the in-memory runtime state."""

    runtime = get_runtime_state()
    runtime.stt_provider = config.stt_provider
    runtime.cleaner_provider = config.cleaner_provider


@router.get("/runtime", response_model=RuntimeSettings)
def read_runtime_settings() -> RuntimeSettings:
    return _as_response(get_user_config_store().load())


@router.put("/runtime", response_model=RuntimeSettings)
def update_runtime_settings(body: RuntimeSettingsUpdate) -> RuntimeSettings:
    patch = body.model_dump(exclude_none=True)
    config, engine_changed = get_user_config_store().update(patch)
    apply_runtime_config(config)
    if engine_changed:
        # Model, device or language changed: drop the cached engine so the next
        # dictation builds one with the new configuration.
        reset_transcriber()
    return _as_response(config)
