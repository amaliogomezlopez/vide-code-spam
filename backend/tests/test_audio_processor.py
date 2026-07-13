"""Basic tests for audio processing."""

from __future__ import annotations

from backend.app.core.audio_processor import AudioProcessor
from backend.app.core import audio_processor
from backend.app.utils.audio_utils import pcm_to_wav


def test_audio_processor_accepts_chunks() -> None:
    processor = AudioProcessor()
    pcm = b"\x00\x01" * 16000  # 1s of fake 16-bit mono at 16kHz
    wav = pcm_to_wav(pcm)
    processor.feed(wav[:1000])
    processor.feed(wav[1000:])
    result = processor.flush()
    assert len(result) > 0


def test_audio_processor_wraps_pcm_chunks_as_wav() -> None:
    processor = AudioProcessor()
    processor.configure("pcm_s16le", sample_rate=16000, channels=1)
    pcm = b"\x00\x00" * 16000
    processor.feed(pcm[:8000])
    processor.feed(pcm[8000:])
    result = processor.flush()
    assert result.startswith(b"RIFF")
    assert result[8:12] == b"WAVE"
    assert result.endswith(pcm)


def test_audio_processor_rejects_unbounded_recording(monkeypatch) -> None:
    monkeypatch.setattr(audio_processor.settings, "max_audio_bytes", 4)
    processor = AudioProcessor()

    processor.feed(b"1234")
    try:
        processor.feed(b"5")
    except ValueError as exc:
        assert "size limit" in str(exc)
    else:
        raise AssertionError("oversized audio was accepted")

    assert processor.flush() == b""
