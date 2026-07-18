"""CLI discovery and profile persistence tests."""

from __future__ import annotations

from pathlib import Path
import os

import pytest

from backend.app.core.cli_registry import CliRegistry


def test_custom_cli_is_persisted_and_resolved(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    executable = tmp_path / "agent.exe"
    executable.write_bytes(b"fake")
    registry = CliRegistry(tmp_path / "profiles.json")
    monkeypatch.setattr(registry, "_version", lambda executable, args: ("agent 1.2.3", ""))

    saved = registry.save_custom("team-agent", "Team Agent", str(executable), "--safe")
    restored = CliRegistry(tmp_path / "profiles.json")._load_custom()

    assert saved["installed"] is True
    assert saved["version"] == "agent 1.2.3"
    assert restored == [{"id": "team-agent", "name": "Team Agent", "executable": str(executable), "args": "--safe"}]


def test_custom_cli_rejects_missing_executable(tmp_path: Path) -> None:
    registry = CliRegistry(tmp_path / "profiles.json")
    with pytest.raises(ValueError, match="does not exist"):
        registry.save_custom("missing", "Missing", str(tmp_path / "missing.exe"))


def test_remove_custom_profile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    executable = tmp_path / "agent.exe"
    executable.write_bytes(b"fake")
    registry = CliRegistry(tmp_path / "profiles.json")
    monkeypatch.setattr(registry, "_version", lambda executable, args: ("", ""))
    registry.save_custom("custom", "Custom", str(executable))

    registry.remove_custom("custom")

    assert registry._load_custom() == []


def test_custom_profile_cannot_shadow_builtin(tmp_path: Path) -> None:
    executable = tmp_path / "codex.exe"
    executable.write_bytes(b"fake")
    with pytest.raises(ValueError, match="conflicts"):
        CliRegistry(tmp_path / "profiles.json").save_custom("codex", "Fake Codex", str(executable))


def test_macos_finder_path_includes_homebrew_and_nvm(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    homebrew = Path("/opt/homebrew/bin")
    nvm_bin = tmp_path / ".nvm" / "versions" / "node" / "v22.0.0" / "bin"
    nvm_bin.mkdir(parents=True)
    original_is_dir = Path.is_dir
    monkeypatch.setattr("backend.app.core.cli_registry.sys.platform", "darwin")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(
        Path, "is_dir", lambda path: path == homebrew or original_is_dir(path)
    )
    monkeypatch.setenv("PATH", "/usr/bin:/bin")

    search_path = CliRegistry._search_path().split(os.pathsep)

    assert str(homebrew) in search_path
    assert str(nvm_bin) in search_path
