"""Isolated ASR benchmark for Vibe Spam.

Examples:
  python scripts/stt_benchmark.py --audio samples/dictado.wav --engine faster-whisper
  python scripts/stt_benchmark.py --manifest samples/asr_manifest.csv --engine faster-whisper --engine nemotron

Manifest CSV columns:
  audio,reference
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import time
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable


NEMOTRON_MODEL_ID = "nvidia/nemotron-3.5-asr-streaming-0.6b"


@dataclass(frozen=True)
class Sample:
    audio: Path
    reference: str = ""


@dataclass
class Result:
    engine: str
    audio: str
    duration_s: float
    cold_s: float
    inference_s: float
    total_s: float
    rtf: float
    wer: float | None
    cer: float | None
    transcript: str
    reference: str
    error: str = ""
    cuda_available: bool | None = None
    gpu_name: str | None = None
    peak_vram_mb: float | None = None


def normalize_text(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\sáéíóúüñ]", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def edit_distance(a: list[str] | str, b: list[str] | str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(
                min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + (0 if ca == cb else 1),
                )
            )
        prev = curr
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float | None:
    ref_words = normalize_text(reference).split()
    hyp_words = normalize_text(hypothesis).split()
    if not ref_words:
        return None
    return edit_distance(ref_words, hyp_words) / len(ref_words)


def cer(reference: str, hypothesis: str) -> float | None:
    ref = normalize_text(reference).replace(" ", "")
    hyp = normalize_text(hypothesis).replace(" ", "")
    if not ref:
        return None
    return edit_distance(ref, hyp) / len(ref)


def audio_duration(path: Path) -> float:
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wav:
                rate = wav.getframerate()
                return wav.getnframes() / rate if rate else 0.0
        except Exception:
            pass
    try:
        from pydub import AudioSegment

        return len(AudioSegment.from_file(path)) / 1000
    except Exception:
        return 0.0


def gpu_info() -> tuple[bool | None, str | None, Callable[[], float | None]]:
    try:
        import torch

        if not torch.cuda.is_available():
            return False, None, lambda: None
        torch.cuda.reset_peak_memory_stats()
        name = torch.cuda.get_device_name(0)

        def peak_mb() -> float | None:
            return torch.cuda.max_memory_allocated() / (1024 * 1024)

        return True, name, peak_mb
    except Exception:
        return None, None, lambda: None


class FasterWhisperRunner:
    def __init__(self, model_size: str, device: str, compute_type: str, language: str) -> None:
        started = time.perf_counter()
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.language = None if language == "auto" else language
        self.cold_s = time.perf_counter() - started

    def transcribe(self, path: Path) -> str:
        segments, _ = self.model.transcribe(
            str(path),
            beam_size=1,
            language=self.language,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        return " ".join(segment.text for segment in segments).strip()


class NemotronRunner:
    def __init__(self, model_id: str, language: str) -> None:
        started = time.perf_counter()
        import torch
        from transformers import AutoModelForRNNT, AutoProcessor

        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForRNNT.from_pretrained(
            model_id,
            device_map="auto",
            torch_dtype="auto",
        )
        self.language = language
        self.cold_s = time.perf_counter() - started

    def transcribe(self, path: Path) -> str:
        import numpy as np
        import soundfile as sf

        sampling_rate = self.processor.feature_extractor.sampling_rate
        audio, source_rate = sf.read(path, dtype="float32")
        if getattr(audio, "ndim", 1) > 1:
            audio = audio.mean(axis=1)
        if source_rate != sampling_rate:
            import librosa

            audio = librosa.resample(audio, orig_sr=source_rate, target_sr=sampling_rate)
        audio = np.asarray(audio, dtype=np.float32)
        inputs = self.processor(
            audio,
            sampling_rate=sampling_rate,
            language=self.language,
            return_tensors="pt",
        )
        inputs = inputs.to(self.model.device, dtype=self.model.dtype)
        with self.torch.inference_mode():
            output = self.model.generate(**inputs, return_dict_in_generate=True)
        decoded = self.processor.decode(output.sequences, skip_special_tokens=True)
        if isinstance(decoded, list):
            return " ".join(str(item).strip() for item in decoded if str(item).strip())
        return str(decoded).strip()


def read_manifest(path: Path) -> list[Sample]:
    samples: list[Sample] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            audio = row.get("audio") or row.get("path") or ""
            if not audio:
                continue
            sample_path = Path(audio)
            if not sample_path.is_absolute():
                sample_path = path.parent / sample_path
            samples.append(Sample(sample_path, row.get("reference", "") or ""))
    return samples


def build_samples(args: argparse.Namespace) -> list[Sample]:
    samples: list[Sample] = []
    if args.manifest:
        samples.extend(read_manifest(Path(args.manifest)))
    for item in args.audio:
        samples.append(Sample(Path(item), args.reference or ""))
    return samples


def write_outputs(results: list[Result], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "stt_benchmark_results.json"
    csv_path = output_dir / "stt_benchmark_results.csv"
    json_path.write_text(
        json.dumps([asdict(result) for result in results], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(results[0]).keys()))
        writer.writeheader()
        writer.writerows(asdict(result) for result in results)
    try:
        import matplotlib.pyplot as plt

        good = [result for result in results if not result.error]
        if good:
            labels = [f"{Path(r.audio).stem}\n{r.engine}" for r in good]
            plt.figure(figsize=(max(8, len(good) * 1.4), 5))
            plt.bar(labels, [r.inference_s for r in good])
            plt.ylabel("Inference seconds")
            plt.xticks(rotation=35, ha="right")
            plt.tight_layout()
            plt.savefig(output_dir / "latency_by_sample.png", dpi=160)
            plt.close()

            quality = [r for r in good if r.wer is not None]
            if quality:
                plt.figure(figsize=(7, 5))
                for r in quality:
                    plt.scatter(r.inference_s, r.wer, label=f"{Path(r.audio).stem} / {r.engine}")
                plt.xlabel("Inference seconds")
                plt.ylabel("WER")
                plt.legend(fontsize=8)
                plt.tight_layout()
                plt.savefig(output_dir / "latency_vs_wer.png", dpi=160)
                plt.close()
    except Exception as exc:
        print(f"[warn] Could not render charts: {exc}")


def summarize(results: list[Result]) -> None:
    print("\nSummary")
    print("=======")
    for engine in sorted({result.engine for result in results}):
        group = [result for result in results if result.engine == engine and not result.error]
        failed = [result for result in results if result.engine == engine and result.error]
        if not group:
            print(f"{engine}: all failed ({len(failed)} failures)")
            continue
        inference = [r.inference_s for r in group]
        rtfs = [r.rtf for r in group if math.isfinite(r.rtf)]
        wers = [r.wer for r in group if r.wer is not None]
        print(
            f"{engine}: n={len(group)}, "
            f"median_inference={statistics.median(inference):.3f}s, "
            f"median_rtf={statistics.median(rtfs):.3f}, "
            f"median_wer={(statistics.median(wers) if wers else float('nan')):.3f}, "
            f"failed={len(failed)}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark ASR engines on local audio files.")
    parser.add_argument("--audio", action="append", default=[], help="Audio file to benchmark.")
    parser.add_argument("--manifest", help="CSV manifest with audio,reference columns.")
    parser.add_argument("--reference", help="Reference text for all --audio samples.")
    parser.add_argument(
        "--engine",
        action="append",
        choices=["faster-whisper", "nemotron"],
        default=[],
        help="Engine to run. Can be passed multiple times.",
    )
    parser.add_argument("--output-dir", default="benchmark-results/stt")
    parser.add_argument("--language", default="es-ES", help="Nemotron language, e.g. es-ES or auto.")
    parser.add_argument("--whisper-language", default="es")
    parser.add_argument("--whisper-model", default="large-v3-turbo")
    parser.add_argument("--whisper-device", default="auto")
    parser.add_argument("--whisper-compute-type", default="auto")
    parser.add_argument("--nemotron-model", default=NEMOTRON_MODEL_ID)
    args = parser.parse_args()

    samples = build_samples(args)
    if not samples:
        parser.error("Provide --audio or --manifest.")
    engines = args.engine or ["faster-whisper"]

    runners: dict[str, FasterWhisperRunner | NemotronRunner] = {}
    results: list[Result] = []
    cuda_available, gpu_name, peak_mb = gpu_info()

    for engine in engines:
        try:
            if engine == "faster-whisper":
                runners[engine] = FasterWhisperRunner(
                    model_size=args.whisper_model,
                    device=args.whisper_device,
                    compute_type=args.whisper_compute_type,
                    language=args.whisper_language,
                )
            elif engine == "nemotron":
                runners[engine] = NemotronRunner(args.nemotron_model, args.language)
        except Exception as exc:
            for sample in samples:
                duration = audio_duration(sample.audio)
                results.append(
                    Result(
                        engine=engine,
                        audio=str(sample.audio),
                        duration_s=duration,
                        cold_s=0.0,
                        inference_s=0.0,
                        total_s=0.0,
                        rtf=float("inf"),
                        wer=None,
                        cer=None,
                        transcript="",
                        reference=sample.reference,
                        error=f"runner init failed: {exc}",
                        cuda_available=cuda_available,
                        gpu_name=gpu_name,
                        peak_vram_mb=peak_mb(),
                    )
                )
            continue

        runner = runners[engine]
        for sample in samples:
            duration = audio_duration(sample.audio)
            start = time.perf_counter()
            transcript = ""
            error = ""
            try:
                transcript = runner.transcribe(sample.audio)
            except Exception as exc:
                error = str(exc)
            inference_s = time.perf_counter() - start
            rtf = inference_s / duration if duration > 0 else float("inf")
            result = Result(
                engine=engine,
                audio=str(sample.audio),
                duration_s=duration,
                cold_s=runner.cold_s,
                inference_s=inference_s,
                total_s=runner.cold_s + inference_s,
                rtf=rtf,
                wer=wer(sample.reference, transcript) if sample.reference else None,
                cer=cer(sample.reference, transcript) if sample.reference else None,
                transcript=transcript,
                reference=sample.reference,
                error=error,
                cuda_available=cuda_available,
                gpu_name=gpu_name,
                peak_vram_mb=peak_mb(),
            )
            results.append(result)
            status = "ok" if not error else f"error: {error}"
            print(f"{engine} | {sample.audio.name} | {inference_s:.3f}s | rtf={rtf:.3f} | {status}")

    if results:
        write_outputs(results, Path(args.output_dir))
        summarize(results)
        print(f"\nWrote results to {Path(args.output_dir).resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
