"""Groq cheap/fast LLM cleaner implementation."""

from __future__ import annotations

import logging

from openai import AsyncOpenAI

from backend.app.config import get_settings
from backend.app.services.llm.base import LLMEngine

logger = logging.getLogger(__name__)


class GroqEngine(LLMEngine):
    def __init__(self) -> None:
        settings = get_settings()
        self._client = AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
        )
        self._model = settings.groq_model
        self._temperature = settings.llm_cleaner_temperature

    async def clean(self, text: str) -> str:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": "You correct punctuation and formatting."},
                    {"role": "user", "content": text},
                ],
                temperature=self._temperature,
            )
            return (response.choices[0].message.content or text).strip()
        except Exception as exc:
            logger.exception("Groq cleaning failed")
            raise RuntimeError(f"Groq error: {exc}") from exc
