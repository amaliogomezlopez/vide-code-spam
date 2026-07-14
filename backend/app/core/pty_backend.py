"""Cross-platform pseudo-terminal backend for CLI agents."""

from __future__ import annotations

import codecs
import ctypes
import logging
import os
import platform
import shlex
import shutil
import socket
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_COLS = 80
DEFAULT_ROWS = 24
DEFAULT_TERM = "xterm-256color"


def split_command_args(args: str, *, windows: bool) -> list[str]:
    """Split arguments with the target OS rules, preserving Windows paths."""
    if not args:
        return []
    if not windows:
        return shlex.split(args, posix=True)
    windll: Any = getattr(ctypes, "windll")
    shell32: Any = windll.shell32
    kernel32: Any = windll.kernel32
    shell32.CommandLineToArgvW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
    shell32.CommandLineToArgvW.restype = ctypes.POINTER(ctypes.c_wchar_p)
    argc = ctypes.c_int()
    argv = shell32.CommandLineToArgvW(f"vibe-spam {args}", ctypes.byref(argc))
    if not argv:
        raise ValueError("Unable to parse Windows command arguments")
    try:
        return [argv[index] for index in range(1, argc.value)]
    finally:
        kernel32.LocalFree(argv)


def _build_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env.setdefault("TERM", DEFAULT_TERM)
    env["TERM"] = env.get("TERM") or DEFAULT_TERM
    env.setdefault("COLORTERM", "truecolor")
    env.setdefault("FORCE_COLOR", "1")
    if extra:
        env.update(extra)
    return env


class PtySession(ABC):
    @abstractmethod
    def write(self, data: str) -> None: ...

    @abstractmethod
    def read(self, timeout: float = 0.1) -> str: ...

    @abstractmethod
    def is_alive(self) -> bool: ...

    @abstractmethod
    def close(self) -> None: ...

    @abstractmethod
    def resize(self, cols: int, rows: int) -> None: ...


def _decode(data: Any) -> str:
    if isinstance(data, bytes):
        return data.decode("utf-8", errors="ignore")
    if isinstance(data, str):
        return data
    return str(data)


class WinPtySession(PtySession):
    def __init__(self, cmdline: str, process: Any) -> None:
        self._cmdline = cmdline
        self._process = process
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="ignore")

    def write(self, data: str) -> None:
        self._process.write(data)

    def read(self, timeout: float = 0.1) -> str:
        try:
            # PtyProcess.read() blocks indefinitely on its socket. Read the same
            # transport with a bounded timeout and an incremental UTF-8 decoder
            # so WebSocket cancellation cannot leak blocked worker threads.
            transport = self._process.fileobj
            previous_timeout = transport.gettimeout()
            transport.settimeout(timeout)
            try:
                data = transport.recv(8192)
            finally:
                transport.settimeout(previous_timeout)
            if not data or data == b"0011Ignore":
                return ""
            return self._decoder.decode(data)
        except (socket.timeout, TimeoutError):
            return ""
        except Exception as exc:
            if self.is_alive():
                logger.debug("winpty read failed: %s", exc)
            return ""

    def is_alive(self) -> bool:
        try:
            return bool(self._process.isalive())
        except Exception:
            return False

    def close(self) -> None:
        try:
            pty = getattr(self._process, "pty", None)
            if pty is not None and hasattr(pty, "cancel_io"):
                pty.cancel_io()
            self._process.close()
        except Exception:
            pass

    def resize(self, cols: int, rows: int) -> None:
        try:
            self._process.set_size(cols=cols, rows=rows)
        except Exception as exc:
            logger.debug("winpty resize failed: %s", exc)


class UnixPtySession(PtySession):
    def __init__(self, cmdline: str, process: Any) -> None:
        self._cmdline = cmdline
        self._process = process

    def write(self, data: str) -> None:
        self._process.send(data)

    def read(self, timeout: float = 0.1) -> str:
        import pexpect

        try:
            return _decode(self._process.read_nonblocking(size=8192, timeout=timeout))
        except pexpect.exceptions.TIMEOUT:
            return ""
        except pexpect.exceptions.EOF:
            return ""
        except Exception:
            return ""

    def is_alive(self) -> bool:
        try:
            return bool(self._process.isalive())
        except Exception:
            return False

    def close(self) -> None:
        try:
            self._process.close(force=True)
        except Exception:
            pass

    def resize(self, cols: int, rows: int) -> None:
        try:
            self._process.setwinsize(rows, cols)
        except Exception as exc:
            logger.debug("pexpect resize failed: %s", exc)


def spawn_pty(
    command: str,
    args: str = "",
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    cols: int = DEFAULT_COLS,
    rows: int = DEFAULT_ROWS,
) -> PtySession:
    is_windows = platform.system() == "Windows"
    cmd_list = [command, *split_command_args(args, windows=is_windows)]
    full_env = _build_env(env)

    if is_windows:
        import winpty

        resolved_command = shutil.which(command) or command
        argv = [resolved_command, *cmd_list[1:]]
        backend_name = os.environ.get("VIBE_SPAM_WINDOWS_PTY_BACKEND", "winpty").strip().lower()
        backend = winpty.Backend.ConPTY if backend_name == "conpty" else winpty.Backend.WinPTY
        process = winpty.PtyProcess.spawn(
            argv,
            env=full_env,
            cwd=cwd,
            dimensions=(rows, cols),
            backend=backend,
        )
        try:
            process.set_size(cols=cols, rows=rows)
        except Exception as exc:
            logger.debug("winpty initial set_size failed: %s", exc)
        return WinPtySession(" ".join(argv), process)

    import pexpect

    process = pexpect.spawn(
        cmd_list[0],
        cmd_list[1:],
        encoding="utf-8",
        codec_errors="ignore",
        env=full_env,
        cwd=cwd,
        dimensions=(rows, cols),
    )
    return UnixPtySession(" ".join(cmd_list), process)
