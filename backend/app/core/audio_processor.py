"""Accumulate and normalize audio chunks from the frontend."""

from __future__ import annotations

import io
import logging

from pydub import AudioSegment

from backend.app.config import get_settings
from backend.app.utils.audio_utils import pcm_to_wav

logger = logging.getLogger(__name__)
settings = get_settings()


class AudioProcessor:
    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._total_bytes = 0
        self._format = settings.audio_format or "webm"
        self._sample_rate = settings.sample_rate
        self._channels = 1

    def configure(
        self, fmt: str, sample_rate: int | None = None, channels: int | None = None
    ) -> None:
        if fmt not in {"webm", "wav", "ogg", "mp3", "pcm_s16le"}:
            raise ValueError(f"Unsupported audio format: {fmt}")
        if sample_rate is not None and not 8000 <= sample_rate <= 192000:
            raise ValueError("Invalid audio sample rate")
        if channels is not None and not 1 <= channels <= 2:
            raise ValueError("Invalid audio channel count")
        self._format = fmt or self._format
        self._sample_rate = sample_rate or self._sample_rate
        self._channels = channels or self._channels

    def feed(self, chunk: bytes) -> None:
        next_size = self._total_bytes + len(chunk)
        if next_size > settings.max_audio_bytes:
            self._chunks.clear()
            self._total_bytes = 0
            raise ValueError("Audio recording exceeds the configured size limit")
        self._chunks.append(chunk)
        self._total_bytes = next_size

    def flush(self) -> bytes:
        if not self._chunks:
            return b""
        combined = b"".join(self._chunks)
        self._chunks.clear()
        self._total_bytes = 0
        return self._normalize(combined)

    def _normalize(self, audio_bytes: bytes) -> bytes:
        if self._format == "pcm_s16le":
            return pcm_to_wav(audio_bytes, sample_rate=self._sample_rate, channels=self._channels)

        try:
            fmt = self._format or settings.audio_format or "webm"
            segment = AudioSegment.from_file(io.BytesIO(audio_bytes), format=fmt)
        except Exception:
            logger.warning("Failed to decode audio as %s, returning raw", fmt)
            return audio_bytes

        segment = segment.set_frame_rate(settings.sample_rate).set_channels(1)
        # Export as WAV PCM for STT engines
        out = io.BytesIO()
        segment.export(out, format="wav")
        return out.getvalue()
