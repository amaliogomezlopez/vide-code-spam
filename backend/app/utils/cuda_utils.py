"""Ensure CUDA 12 libraries are discoverable on Windows (CPU or GPU)."""

from __future__ import annotations

import logging
import os
import platform
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _find_nvidia_dll_dirs() -> list[str]:
    """Return candidate directories containing nvidia CUDA DLLs."""
    dirs: list[str] = []
    roots: list[Path] = []

    pyinstaller_root = getattr(sys, "_MEIPASS", None)
    if pyinstaller_root:
        roots.append(Path(pyinstaller_root))

    site_packages = Path(sys.executable).parent.parent / "Lib" / "site-packages"
    if site_packages.exists():
        roots.append(site_packages)

    for root in roots:
        for pkg in (
            "nvidia",
            "ctranslate2",
            "nvidia_cublas_cu12",
            "nvidia_cudnn_cu12",
            "nvidia_cuda_runtime_cu12",
        ):
            pkg_path = root / pkg
            if not pkg_path.exists():
                continue
            candidates = [pkg_path, *pkg_path.rglob("bin")]
            for dll_dir in candidates:
                if any(dll_dir.glob("*.dll")):
                    dirs.append(str(dll_dir))
    return dirs


def configure_cuda_path() -> None:
    """Add bundled NVIDIA DLL directories to PATH on Windows."""
    if platform.system() != "Windows":
        return

    existing = set(os.environ.get("PATH", "").split(os.pathsep))
    added: list[str] = []
    add_dll_directory = getattr(os, "add_dll_directory", None)
    for dll_dir in _find_nvidia_dll_dirs():
        if dll_dir not in existing:
            os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")
            try:
                if add_dll_directory is not None:
                    add_dll_directory(dll_dir)
            except OSError:
                pass
            added.append(dll_dir)

    if added:
        logger.info("Added NVIDIA DLL directories to PATH: %s", added)
