"""OpenWhispr HTTP STT implementation."""

from __future__ import annotations

import logging

import httpx

from backend.app.config import get_settings
from backend.app.services.stt.base import STTEngine

logger = logging.getLogger(__name__)


class OpenWhisprEngine(STTEngine):
    def __init__(self) -> None:
        self._url = get_settings().openwhispr_url

    def transcribe(self, audio_bytes: bytes) -> str:
        files = {"audio": ("audio.wav", audio_bytes, "audio/wav")}
        try:
            response = httpx.post(self._url, files=files, timeout=60.0)
            response.raise_for_status()
            data = response.json()
            return str(data.get("text", "")).strip()
        except Exception as exc:
            logger.exception("OpenWhispr transcription failed")
            raise RuntimeError(f"OpenWhispr error: {exc}") from exc

    def status(self) -> dict[str, object]:
        return {"state": "ready", "ready": True, "provider": "openwhispr"}
