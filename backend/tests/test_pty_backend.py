"""PTY transport behavior independent of the host platform."""

from __future__ import annotations

import socket
import os

import pytest

from backend.app.core.pty_backend import WinPtySession, split_command_args


class FakeTransport:
    def __init__(self, payload: bytes | None) -> None:
        self.payload = payload
        self.timeout: float | None = None

    def gettimeout(self) -> float | None:
        return self.timeout

    def settimeout(self, timeout: float | None) -> None:
        self.timeout = timeout

    def recv(self, size: int) -> bytes:
        if self.payload is None:
            raise socket.timeout
        payload, self.payload = self.payload, b""
        return payload


class FakeProcess:
    def __init__(self, payload: bytes | None) -> None:
        self.fileobj = FakeTransport(payload)

    def isalive(self) -> bool:
        return True


def test_winpty_reads_the_process_transport() -> None:
    session = WinPtySession("fake", FakeProcess("á-output".encode()))

    assert session.read(timeout=0.01) == "á-output"


def test_winpty_timeout_returns_without_output() -> None:
    session = WinPtySession("fake", FakeProcess(None))

    assert session.read(timeout=0.01) == ""


@pytest.mark.skipif(os.name != "nt", reason="Windows quoting contract")
def test_windows_args_remove_quotes_without_damaging_backslashes() -> None:
    args = split_command_args(r'--cd "D:\repo with spaces" --exec claude', windows=True)

    assert args == ["--cd", r"D:\repo with spaces", "--exec", "claude"]


def test_unix_args_preserve_spaced_values() -> None:
    assert split_command_args('--model "fast model"', windows=False) == ["--model", "fast model"]
