"""Base interface for LLM cleaner engines."""

from __future__ import annotations

from abc import ABC, abstractmethod


class LLMEngine(ABC):
    @abstractmethod
    async def clean(self, text: str) -> str:
        """Return cleaned/formatted text asynchronously."""
        ...
