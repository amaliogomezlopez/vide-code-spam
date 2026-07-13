"""Prepare a small FLEURS manifest for ASR benchmarks.

Example:
  python scripts/prepare_fleurs_manifest.py --config es_419 --limit 10
"""

from __future__ import annotations

import argparse
import csv
import io
import re
from pathlib import Path


def safe_name(text: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "-", text.strip().lower())
    return text.strip("-")[:60] or "sample"


def main() -> int:
    parser = argparse.ArgumentParser(description="Download FLEURS samples for ASR benchmarking.")
    parser.add_argument("--config", default="es_419", help="FLEURS config, e.g. es_419.")
    parser.add_argument("--split", default="test")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--output-dir", default="benchmark-results/fleurs-es")
    args = parser.parse_args()

    from datasets import Audio, load_dataset
    import soundfile as sf

    output_dir = Path(args.output_dir)
    audio_dir = output_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.csv"

    dataset = load_dataset("google/fleurs", args.config, split=args.split)
    dataset = dataset.cast_column("audio", Audio(decode=False))

    rows: list[dict[str, str]] = []
    for idx, item in enumerate(dataset.select(range(min(args.limit, len(dataset))))):
        reference = str(item.get("transcription") or item.get("raw_transcription") or "").strip()
        audio = item["audio"]
        audio_bytes = audio.get("bytes")
        audio_path = audio.get("path")
        if audio_bytes is not None:
            array, sampling_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32")
        elif audio_path:
            array, sampling_rate = sf.read(audio_path, dtype="float32")
        else:
            raise RuntimeError(f"Sample {idx} has no audio bytes or path.")
        if getattr(array, "ndim", 1) > 1:
            array = array.mean(axis=1)
        if sampling_rate != 16000:
            import librosa

            array = librosa.resample(array, orig_sr=sampling_rate, target_sr=16000)
            sampling_rate = 16000
        wav_path = audio_dir / f"{idx:03d}-{safe_name(reference)}.wav"
        sf.write(wav_path, array, sampling_rate)
        rows.append({"audio": str(wav_path.relative_to(output_dir)), "reference": reference})

    with manifest_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["audio", "reference"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} samples to {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
