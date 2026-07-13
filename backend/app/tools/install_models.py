"""Download and warm up local speech-to-text models."""

from __future__ import annotations

import argparse
import logging
import os
from collections.abc import Sequence


def install_faster_whisper_model() -> None:
    """Fetch the configured faster-whisper model into the local HF cache.

    The app intentionally does not commit or bundle model weights in the Git
    repository. Loading the model once here makes Hugging Face/faster-whisper
    download the files that will be reused by the desktop app at runtime.
    """

    from backend.app.utils.cuda_utils import configure_cuda_path

    configure_cuda_path()

    from backend.app.config import get_settings
    from backend.app.services.stt.faster_whisper_engine import FasterWhisperEngine

    settings = get_settings()
    print(
        "Installing faster-whisper model "
        f"{settings.whisper_model_size} "
        f"(device={settings.whisper_device}, compute_type={settings.whisper_compute_type})"
    )
    engine = FasterWhisperEngine()
    engine.preload()
    print("faster-whisper model is downloaded, loaded, and warmed up.")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--provider",
        choices=["faster-whisper", "openwhispr"],
        default=os.getenv("STT_PROVIDER", "faster-whisper"),
        help="STT provider to install. openwhispr has no local model files.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "info").upper(),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    if args.provider == "faster-whisper":
        install_faster_whisper_model()
    else:
        print("No local model files to install for provider: openwhispr")


if __name__ == "__main__":
    main()
