"""Audio/STT configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.app.config import get_runtime_state
from backend.app.core.transcriber import get_transcriber

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
    get_runtime_state().stt_provider = provider
    return {"stt_provider": provider}


@router.post("/cleaner/{provider}")
async def set_cleaner_provider(provider: str) -> dict[str, str]:
    supported = {"ollama", "groq", "none"}
    if provider not in supported:
        raise HTTPException(status_code=422, detail=f"Unsupported cleaner. Choose from {supported}")
    get_runtime_state().cleaner_provider = provider
    return {"cleaner_provider": provider}
