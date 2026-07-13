"""Clean and format raw transcription before sending to an agent."""

from __future__ import annotations

from backend.app.config import RuntimeState
from backend.app.services.llm.base import LLMEngine
from backend.app.services.llm.groq_engine import GroqEngine
from backend.app.services.llm.ollama_engine import OllamaEngine

SYSTEM_PROMPT = """You are a transcription formatter.
Take the raw speech-to-text output below and rewrite it as clean, well-punctuated text.
Preserve all technical terms, file paths, commands, and code snippets exactly.
Do not add explanations. Return only the corrected text.

Raw transcription:
"""


def _build_cleaner(provider: str) -> LLMEngine | None:
    if provider == "groq":
        return GroqEngine()
    if provider == "ollama":
        return OllamaEngine()
    return None


class TextFormatter:
    def __init__(self, runtime_state: RuntimeState | None = None) -> None:
        self._runtime = runtime_state or RuntimeState()

    async def format(self, text: str) -> str:
        provider = self._runtime.cleaner_provider
        cleaner = _build_cleaner(provider)
        if cleaner is None:
            return text.strip()
        return await cleaner.clean(SYSTEM_PROMPT + text)
