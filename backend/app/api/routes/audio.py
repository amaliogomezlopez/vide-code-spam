"""Audio/STT configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.app.api.routes.settings import apply_runtime_config
from backend.app.config import get_runtime_state
from backend.app.core.transcriber import get_transcriber, reset_transcriber
from backend.app.core.user_config import get_user_config_store

router = APIRouter()


@router.get("/providers")
async def list_providers() -> dict[str, list[str]]:
    return {
        "stt": ["faster-whisper", "openwhispr"],
        "cleaner": ["ollama", "groq", "none"],
    }


@router.get("/current")
async def current_providers() -> dict[str, str]:
    runtime = get_runtime_state()
    return {
        "stt_provider": runtime.stt_provider,
        "cleaner_provider": runtime.cleaner_provider,
    }


@router.get("/status")
def stt_status() -> dict[str, object]:
    runtime = get_runtime_state()
    transcriber = get_transcriber(runtime)
    transcriber.start_preload()
    return transcriber.status()


@router.post("/provider/{provider}")
async def set_stt_provider(provider: str) -> dict[str, str]:
    supported = {"faster-whisper", "openwhispr"}
    if provider not in supported:
        raise HTTPException(
            status_code=422, detail=f"Unsupported provider. Choose from {supported}"
        )
    # Persisted, so the choice survives a restart instead of silently reverting
    # to whatever the .env said.
    config, engine_changed = get_user_config_store().update({"stt_provider": provider})
    apply_runtime_config(config)
    if engine_changed:
        reset_transcriber()
    return {"stt_provider": provider}


@router.post("/cleaner/{provider}")
async def set_cleaner_provider(provider: str) -> dict[str, str]:
    supported = {"ollama", "groq", "none"}
    if provider not in supported:
        raise HTTPException(status_code=422, detail=f"Unsupported cleaner. Choose from {supported}")
    config, _ = get_user_config_store().update({"cleaner_provider": provider})
    apply_runtime_config(config)
    return {"cleaner_provider": provider}
