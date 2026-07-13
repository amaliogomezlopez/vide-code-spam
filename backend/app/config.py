"""Configuration loaded from environment variables."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    host: str = "127.0.0.1"
    port: int = 8000
    frontend_url: str = "http://localhost:5173"
    log_level: str = "info"
    vibe_spam_api_token: str = ""
    trusted_proxy_mode: bool = False

    # Audio
    sample_rate: int = 16000
    audio_format: str = "webm"
    max_audio_bytes: int = 20 * 1024 * 1024

    # STT
    # El portable CPU respeta siempre cpu/int8. Para autodetección de un build
    # que incluya las DLL CUDA usa WHISPER_DEVICE=auto; para forzar GPU, cuda.
    # whisper_language=es evita detección automática; usa "auto" si es multilingüe.
    stt_provider: str = "faster-whisper"  # faster-whisper | openwhispr
    whisper_model_size: str = "large-v3-turbo"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_beam_size: int = 1
    whisper_language: str = "es"
    openwhispr_url: str = "http://localhost:8001/transcribe"

    # LLM Cleaner
    llm_cleaner_provider: str = "none"  # ollama | groq | none
    llm_cleaner_model: str = "llama3.1:8b"
    llm_cleaner_temperature: float = 0.0
    ollama_base_url: str = "http://localhost:11434"
    groq_api_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"

    # Agent CLI overrides (JSON string)
    agent_overrides: str = "{}"

    def get_agent_overrides(self) -> dict[str, dict[str, Any]]:
        try:
            value = json.loads(self.agent_overrides)
            if not isinstance(value, dict):
                return {}
            return {key: item for key, item in value.items() if isinstance(item, dict)}
        except (json.JSONDecodeError, TypeError):
            return {}


@dataclass
class RuntimeState:
    """Mutable runtime state (not persisted to env)."""

    stt_provider: str = field(init=False)
    cleaner_provider: str = field(init=False)

    def __post_init__(self) -> None:
        settings = get_settings()
        self.stt_provider = settings.stt_provider
        self.cleaner_provider = settings.llm_cleaner_provider


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_runtime_state() -> RuntimeState:
    return RuntimeState()
