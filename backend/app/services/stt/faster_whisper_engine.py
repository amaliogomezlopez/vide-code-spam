"""faster-whisper STT implementation."""

from __future__ import annotations

import logging
import math
import platform
import struct
import sys
import threading
import time
import wave
from typing import Any, cast

from faster_whisper import WhisperModel

from backend.app.config import get_settings
from backend.app.services.stt.base import STTEngine

logger = logging.getLogger(__name__)


class FasterWhisperEngine(STTEngine):
    def __init__(self) -> None:
        settings = get_settings()
        self._model_size = settings.whisper_model_size
        device = settings.whisper_device
        compute_type = settings.whisper_compute_type
        self._beam_size = settings.whisper_beam_size
        self._language = None if settings.whisper_language == "auto" else settings.whisper_language
        self._model: WhisperModel | None = None
        self._model_lock = threading.RLock()
        self._state = "not_loaded"
        self._warmup_error = ""
        self._warmup_seconds = 0.0
        self._preload_scheduled = False

        device_was_explicit = "whisper_device" in settings.model_fields_set
        if not device_was_explicit and device == "cpu" and self._is_cuda_build():
            device = "auto"
            compute_type = "auto"

        # CPU/offline is the portable contract. CUDA is selected only when the
        # user explicitly requests "cuda" or "auto"; defaults must never be
        # reinterpreted as implicit GPU opt-in because the CPU build deliberately
        # excludes ~1.9 GiB of NVIDIA runtime DLLs.
        if device == "auto":
            if self._detect_gpu() and self._cuda_runtime_available():
                device = "cuda"
                if compute_type in {"auto", "int8"}:
                    compute_type = "float16"
                logger.info(
                    "WHISPER_DEVICE=auto selected CUDA with a complete runtime."
                )
            else:
                device = "cpu"
                compute_type = "int8" if compute_type == "auto" else compute_type
                logger.info("WHISPER_DEVICE=auto selected CPU; CUDA runtime is unavailable.")
        elif device == "cuda" and not self._cuda_runtime_available():
            logger.error(
                "CUDA was requested but its runtime DLLs are incomplete; falling back to CPU."
            )
            device = "cpu"
            compute_type = "int8"

        self._device = device
        self._compute_type = compute_type

        # VAD (Silero) recorta silencios antes de transcribir. Requiere
        # `onnxruntime` y el modelo Silero (empaquetado o descargable). Si
        # onnxruntime no está o el .onnx falta, desactivamos el VAD en runtime y
        # seguimos transcribiendo sin recortar (ver _run_transcribe).
        self._vad_enabled = self._check_vad_available()

    @staticmethod
    def _detect_gpu() -> bool:
        """True si ctranslate2 detecta GPUs CUDA. Las DLLs CUDA ya deben estar
        en PATH (configure_cuda_path() corre antes que cualquier engine)."""
        try:
            import ctranslate2

            return bool(ctranslate2.get_cuda_device_count() > 0)
        except Exception:
            logger.warning("Could not query ctranslate2 CUDA device count", exc_info=True)
            return False

    @staticmethod
    def _cuda_runtime_available() -> bool:
        if platform.system() != "Windows":
            return FasterWhisperEngine._detect_gpu()
        import ctypes

        required = ("cublas64_12.dll", "cudnn64_9.dll")
        try:
            for library in required:
                ctypes.WinDLL(library)
        except (AttributeError, OSError):
            return False
        return True

    @staticmethod
    def _is_cuda_build() -> bool:
        from pathlib import Path

        return bool(getattr(sys, "frozen", False)) and (
            Path(sys.executable).resolve().parent / "cuda-build.marker"
        ).is_file()

    @staticmethod
    def _is_cuda_runtime_error(exc: RuntimeError) -> bool:
        message = str(exc).lower()
        return any(token in message for token in ("cublas", "cudnn", "cuda", "cudart"))

    def _switch_to_cpu(self, exc: RuntimeError) -> WhisperModel:
        if self._device != "cuda" or not self._is_cuda_runtime_error(exc):
            raise exc
        with self._model_lock:
            logger.error(
                "CUDA inference failed (%s); reloading faster-whisper on CPU so dictation can continue.",
                exc,
            )
            self._device = "cpu"
            self._compute_type = "int8"
            self._model = None
        return self._load()

    @staticmethod
    def _check_vad_available() -> bool:
        """True solo si onnxruntime está disponible Y el modelo Silero VAD
        existe ya sea en el bundle (PyInstaller _MEIPASS) o en el paquete."""
        try:
            import onnxruntime  # noqa: F401
        except Exception:
            logger.warning(
                "onnxruntime not available; VAD disabled (silence trimming off). "
                "Install/bundle onnxruntime to enable it."
            )
            return False
        if not FasterWhisperEngine._silero_vad_path():
            logger.warning(
                "Silero VAD model (silero_vad_*.onnx) not found in bundle or "
                "package; VAD disabled. Add it to PyInstaller --collect-all."
            )
            return False
        return True

    @staticmethod
    def _silero_vad_path() -> str | None:
        import os
        import sys

        package_file = getattr(__import__("faster_whisper"), "__file__", None)
        candidates = [os.path.join(getattr(sys, "_MEIPASS", ""), "faster_whisper", "assets")]
        if package_file:
            candidates.insert(0, os.path.join(os.path.dirname(package_file), "assets"))
        for assets_dir in candidates:
            if not assets_dir or not os.path.isdir(assets_dir):
                continue
            for name in os.listdir(assets_dir):
                if name.startswith("silero_vad") and name.endswith(".onnx"):
                    return os.path.join(assets_dir, name)
        return None

    def _load(self) -> WhisperModel:
        with self._model_lock:
            if self._model is not None:
                return self._model
            # Diagnóstico CUDA: loguear cuántos dispositivos detecta ctranslate2
            # ANTES de cargar. Si es 0 con device=cuda, ctranslate2 cae a CPU
            # silenciosamente y esa es la causa raíz de la latencia.
            cuda_devices = -1
            try:
                import ctranslate2

                cuda_devices = ctranslate2.get_cuda_device_count()
            except Exception:
                logger.warning("Could not query ctranslate2 CUDA device count", exc_info=True)

            logger.info(
                "Loading faster-whisper model: %s (device=%s compute_type=%s cuda_devices=%s)",
                self._model_size,
                self._device,
                self._compute_type,
                cuda_devices,
            )
            if self._device == "cuda" and cuda_devices == 0:
                logger.error(
                    "device=cuda but ctranslate2 reports 0 CUDA devices; "
                    "falling back to CPU. Check CUDA/cuDNN DLLs in PATH."
                )

            self._model = WhisperModel(
                self._model_size,
                device=self._device,
                compute_type=self._compute_type,
            )
            logger.info(
                "faster-whisper model loaded: device=%s compute_type=%s cuda_devices=%s",
                self._device,
                self._compute_type,
                cuda_devices,
            )
            return self._model

    def preload(self) -> None:
        """Load the model eagerly and run a warmup transcription.

        Loading the model alone is NOT enough: inference initializes compute
        kernels lazily. A non-silent transcription also proves that an optional
        CUDA runtime is genuinely loadable before the user's first dictation."""
        import io
        import tempfile
        import os

        with self._model_lock:
            if self._state == "ready":
                return
            self._state = "loading"
            self._warmup_error = ""
        preload_started = time.perf_counter()
        try:
            model = self._load()
        except Exception as exc:
            with self._model_lock:
                self._state = "error"
                self._warmup_error = str(exc)[:300]
            raise
        try:
            # 1s of 16 kHz mono signal as a WAV in memory -> temp file.
            sr = 16000
            # A quiet sine wave (not silence) plus VAD disabled below forces the
            # encoder to execute. Silence let incomplete CUDA builds pass warmup
            # because VAD removed every sample before cuBLAS was loaded.
            samples = b"".join(
                struct.pack("<h", int(1200 * math.sin(2 * math.pi * 440 * index / sr)))
                for index in range(sr)
            )
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(sr)
                w.writeframes(samples)
            warmup_wav = buf.getvalue()

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(warmup_wav)
                tmp_path = tmp.name
            try:
                logger.info("Running STT warmup inference (dummy 1s audio)…")
                # Consume the generator to force the encoder to execute.
                start = time.perf_counter()
                try:
                    segments, _ = self._run_transcribe(model, tmp_path, use_vad=False)
                    _ = list(segments)
                except RuntimeError as exc:
                    model = self._switch_to_cpu(exc)
                    segments, _ = self._run_transcribe(model, tmp_path, use_vad=False)
                    _ = list(segments)
                logger.info(
                    "STT warmup done in %.2fs; first real dictation will be fast",
                    time.perf_counter() - start,
                )
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
        except Exception:
            with self._model_lock:
                self._warmup_error = "Warmup failed; first dictation will retry inference"
            logger.warning(
                "Warmup transcription failed (the model is loaded anyway; "
                "first dictation may pay the CUDA init cost)",
                exc_info=True,
            )
        finally:
            with self._model_lock:
                self._warmup_seconds = time.perf_counter() - preload_started
                self._state = "ready"
            logger.info("Speech model is ready for dictation")

    def start_preload(self) -> None:
        with self._model_lock:
            if self._preload_scheduled or self._state in {"loading", "ready", "error"}:
                return
            self._preload_scheduled = True

        def _worker() -> None:
            try:
                self.preload()
            except Exception:
                logger.exception("Asynchronous faster-whisper preload failed")
            finally:
                with self._model_lock:
                    self._preload_scheduled = False

        threading.Thread(target=_worker, name="stt-preload", daemon=True).start()

    def status(self) -> dict[str, object]:
        with self._model_lock:
            return {
                "state": self._state,
                "ready": self._state == "ready",
                "provider": "faster-whisper",
                "model": self._model_size,
                "device": self._device,
                "compute_type": self._compute_type,
                "beam_size": self._beam_size,
                "warmup_seconds": round(self._warmup_seconds, 3),
                "warning": self._warmup_error,
                "build_profile": "cuda" if self._is_cuda_build() else "cpu",
            }

    def _run_transcribe(
        self, model: WhisperModel, path: str, *, use_vad: bool = True
    ) -> tuple[Any, Any]:
        """Call model.transcribe with VAD if available, falling back to no-VAD
        if the Silero model cannot be loaded at runtime (e.g. offline portable
        without a cached VAD model). Returns (segments, info)."""
        common_kwargs = dict(
            beam_size=self._beam_size,
            language=self._language,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        if not self._vad_enabled or not use_vad:
            return cast(tuple[Any, Any], model.transcribe(path, **common_kwargs))
        try:
            return cast(
                tuple[Any, Any],
                model.transcribe(
                    path,
                    vad_filter=True,
                    vad_parameters={
                        "min_silence_duration_ms": 500,
                        "speech_pad_ms": 200,
                    },
                    **common_kwargs,
                ),
            )
        except Exception as exc:
            # Típicamente: Silero VAD no se pudo descargar/cargar (offline).
            # Degradar con elegancia: desactivar VAD para esta sesión y reintentar.
            logger.warning(
                "VAD failed (%s); disabling VAD for this session and retrying without it.",
                exc,
            )
            self._vad_enabled = False
            return cast(tuple[Any, Any], model.transcribe(path, **common_kwargs))

    def transcribe(self, audio_bytes: bytes) -> str:
        import os
        import tempfile

        if self._state == "loading":
            raise RuntimeError("Speech model is still warming up; retry in a few seconds")
        model = self._load()
        start = time.perf_counter()
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            try:
                segments, _ = self._run_transcribe(model, tmp_path)
                text = " ".join(segment.text for segment in segments)
            except RuntimeError as exc:
                model = self._switch_to_cpu(exc)
                segments, _ = self._run_transcribe(model, tmp_path)
                text = " ".join(segment.text for segment in segments)

            # RTF (Real Time Factor) = duración_audio / tiempo_transcripción.
            # Con CUDA + large-v3-turbo esperado <0.1; ~1 o más indica que está
            # corriendo en CPU (causa raíz de latencia alta).
            audio_duration = self._wav_duration(tmp_path)
            elapsed = time.perf_counter() - start
            if audio_duration > 0:
                rtf = audio_duration / elapsed if elapsed > 0 else float("inf")
                logger.info(
                    "Transcribed %d bytes (%.2fs audio) in %.2fs (RTF=%.3f)",
                    len(audio_bytes),
                    audio_duration,
                    elapsed,
                    rtf,
                )
            else:
                logger.info(
                    "Transcribed %d bytes in %.2fs (duration unknown)", len(audio_bytes), elapsed
                )
            return text.strip()
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    @staticmethod
    def _wav_duration(path: str) -> float:
        """Read the duration of a WAV file from its header without decoding."""
        try:
            with wave.open(path, "rb") as wav:
                frames = wav.getnframes()
                rate = wav.getframerate()
                return frames / rate if rate else 0.0
        except Exception:
            return 0.0
