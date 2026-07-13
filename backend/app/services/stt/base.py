"""Base interface for speech-to-text engines."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class STTEngine(ABC):
    def preload(self) -> None:
        """Optionally initialize expensive provider resources."""
        return None

    def start_preload(self) -> None:
        """Start provider initialization; local engines may override asynchronously."""
        self.preload()

    def status(self) -> dict[str, Any]:
        """Return provider readiness without exposing credentials."""
        return {"state": "ready", "ready": True}

    @abstractmethod
    def transcribe(self, audio_bytes: bytes) -> str:
        """Transcribe audio bytes to text."""
        ...
