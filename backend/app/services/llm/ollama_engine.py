"""Ollama LLM cleaner implementation."""

from __future__ import annotations

import logging

import httpx

from backend.app.config import get_settings
from backend.app.services.llm.base import LLMEngine

logger = logging.getLogger(__name__)


class OllamaEngine(LLMEngine):
    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = settings.ollama_base_url.rstrip("/")
        self._model = settings.llm_cleaner_model
        self._temperature = settings.llm_cleaner_temperature

    async def clean(self, text: str) -> str:
        payload = {
            "model": self._model,
            "prompt": text,
            "stream": False,
            "options": {"temperature": self._temperature},
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f"{self._base_url}/api/generate", json=payload)
                response.raise_for_status()
                data = response.json()
                return str(data.get("response", text)).strip()
        except Exception as exc:
            logger.exception("Ollama cleaning failed")
            raise RuntimeError(f"Ollama error: {exc}") from exc
