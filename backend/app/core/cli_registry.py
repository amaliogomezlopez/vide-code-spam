"""Discover supported coding CLIs and persist user-defined executable profiles."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CliDefinition:
    id: str
    name: str
    commands: tuple[str, ...]
    version_args: tuple[str, ...]
    install_url: str
    kind: str = "coding-agent"
    supports_wsl: bool = True


BUILTIN_CLIS: tuple[CliDefinition, ...] = (
    CliDefinition("codex", "Codex", ("codex",), ("--version",), "https://developers.openai.com/codex/cli/"),
    CliDefinition("claude", "Claude Code", ("claude",), ("--version",), "https://docs.anthropic.com/en/docs/claude-code/getting-started"),
    CliDefinition("kimi", "Kimi Code", ("kimi",), ("--version",), "https://www.kimi.com/code/docs/en/"),
    CliDefinition("grok", "Grok Build", ("grok",), ("--version",), "https://docs.x.ai/build/overview"),
    CliDefinition("opencode", "OpenCode", ("opencode",), ("--version",), "https://opencode.ai/docs"),
    CliDefinition("aider", "Aider", ("aider",), ("--version",), "https://aider.chat/docs/install.html"),
    CliDefinition("mini-agent", "MiniMax Mini-Agent", ("mini-agent",), ("--version",), "https://platform.minimax.io/docs/token-plan/mini-agent"),
    CliDefinition("mmx", "MiniMax MMX", ("mmx",), ("--version",), "https://platform.minimax.io/docs/token-plan/minimax-cli", kind="general-assistant"),
)


def _config_dir() -> Path:
    if os.name == "nt" and os.getenv("APPDATA"):
        return Path(os.environ["APPDATA"]) / "vibe-spam"
    return Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "vibe-spam"


class CliRegistry:
    def __init__(self, profiles_path: Path | None = None) -> None:
        self._path = profiles_path or (_config_dir() / "cli-profiles.json")
        self._lock = threading.RLock()
        self._cache: tuple[float, list[dict[str, Any]]] | None = None

    @staticmethod
    def _search_path() -> str:
        home = Path.home()
        candidates = [home / ".local" / "bin", home / ".cargo" / "bin"]
        if os.name == "nt":
            appdata = Path(os.getenv("APPDATA", home))
            local = Path(os.getenv("LOCALAPPDATA", home))
            candidates += [
                appdata / "npm", local / "Microsoft" / "WinGet" / "Links",
                home / "scoop" / "shims", appdata / "Python" / "Scripts",
            ]
        elif sys.platform == "darwin":
            # Apps launched from Finder inherit a very small PATH. Include the
            # standard Homebrew and user-level locations used by coding CLIs.
            candidates += [
                Path("/opt/homebrew/bin"), Path("/usr/local/bin"),
                home / ".npm-global" / "bin", home / ".bun" / "bin",
                home / "Library" / "pnpm",
            ]
            candidates += sorted((home / ".nvm" / "versions" / "node").glob("*/bin"))
        return os.pathsep.join([os.getenv("PATH", ""), *(str(path) for path in candidates if path.is_dir())])

    def _load_custom(self) -> list[dict[str, str]]:
        with self._lock:
            try:
                value = json.loads(self._path.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                return []
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict) and all(isinstance(v, str) for v in item.values())]

    def _save_custom(self, profiles: list[dict[str, str]]) -> None:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self._path.with_suffix(".tmp")
            temporary.write_text(json.dumps(profiles, indent=2, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self._path)

    def save_custom(self, profile_id: str, name: str, executable: str, args: str = "") -> dict[str, Any]:
        if profile_id in {item.id for item in BUILTIN_CLIS}:
            raise ValueError("Custom CLI id conflicts with a built-in CLI")
        candidate = Path(executable).expanduser()
        resolved = shutil.which(executable) if not candidate.is_absolute() else str(candidate.resolve())
        if not resolved or not Path(resolved).is_file():
            raise ValueError("Executable does not exist or is not available on PATH")
        profiles = [item for item in self._load_custom() if item.get("id") != profile_id]
        profiles.append({"id": profile_id, "name": name, "executable": resolved, "args": args})
        self._save_custom(profiles)
        self._cache = None
        return self._scan_custom(profiles[-1])

    def remove_custom(self, profile_id: str) -> None:
        profiles = self._load_custom()
        remaining = [item for item in profiles if item.get("id") != profile_id]
        if len(remaining) == len(profiles):
            raise ValueError(f"CLI profile {profile_id} not found")
        self._save_custom(remaining)
        self._cache = None

    @staticmethod
    def _version(executable: str, args: tuple[str, ...]) -> tuple[str, str]:
        command = [executable, *args]
        if os.name == "nt" and Path(executable).suffix.lower() in {".cmd", ".bat"}:
            command = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", subprocess.list2cmdline([executable, *args])]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=3, check=False, encoding="utf-8", errors="replace")
            output = (result.stdout or result.stderr).strip().splitlines()
            return (output[0][:200] if output else "", "" if result.returncode == 0 else f"version exited {result.returncode}")
        except (OSError, subprocess.TimeoutExpired) as exc:
            return "", str(exc)[:200]

    @staticmethod
    def _wsl_paths(definitions: list[CliDefinition]) -> dict[str, str]:
        if not definitions or os.name != "nt" or shutil.which("wsl.exe") is None:
            return {}
        commands = [item.commands[0] for item in definitions]
        script = "for c in " + " ".join(commands) + "; do p=$(command -v \"$c\"); [ -n \"$p\" ] && printf '%s=%s\\n' \"$c\" \"$p\"; done"
        try:
            result = subprocess.run(
                ["wsl.exe", "--exec", "sh", "-lc", script], capture_output=True, text=True,
                timeout=5, check=False, encoding="utf-8", errors="replace",
            )
        except (OSError, subprocess.TimeoutExpired):
            return {}
        paths: dict[str, str] = {}
        for line in result.stdout.splitlines():
            command, separator, path = line.partition("=")
            if separator and command in commands and path.startswith("/"):
                paths[command] = path
        return paths

    def _scan_builtin(self, definition: CliDefinition) -> dict[str, Any]:
        resolved = next((path for command in definition.commands if (path := shutil.which(command, path=self._search_path()))), "")
        version, error = self._version(resolved, definition.version_args) if resolved else ("", "")
        return {
            **asdict(definition), "commands": list(definition.commands), "version_args": list(definition.version_args),
            "installed": bool(resolved), "path": resolved, "runtime": "native",
            "version": version, "diagnostic": error, "custom": False, "default_args": "",
        }

    def _scan_custom(self, profile: dict[str, str]) -> dict[str, Any]:
        executable = profile.get("executable", "")
        installed = bool(executable and Path(executable).is_file())
        version, error = self._version(executable, ("--version",)) if installed else ("", "Executable not found")
        return {
            "id": profile.get("id", ""), "name": profile.get("name", "Custom"), "commands": [executable],
            "version_args": ["--version"], "install_url": "", "kind": "custom", "supports_wsl": False,
            "installed": installed, "path": executable, "runtime": "native", "version": version,
            "diagnostic": error, "custom": True, "default_args": profile.get("args", ""),
        }

    def scan(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        with self._lock:
            if self._cache and now - self._cache[0] < 5:
                return [dict(item) for item in self._cache[1]]
        with ThreadPoolExecutor(max_workers=len(BUILTIN_CLIS)) as pool:
            builtins = list(pool.map(self._scan_builtin, BUILTIN_CLIS))
        missing = [definition for definition, result in zip(BUILTIN_CLIS, builtins, strict=True) if not result["installed"] and definition.supports_wsl]
        wsl_paths = self._wsl_paths(missing)
        for definition, cli_result in zip(BUILTIN_CLIS, builtins, strict=True):
            wsl_path = wsl_paths.get(definition.commands[0])
            if wsl_path:
                cli_result.update({"installed": True, "path": wsl_path, "runtime": "wsl", "diagnostic": ""})
        scan_results = builtins + [self._scan_custom(item) for item in self._load_custom()]
        with self._lock:
            self._cache = (now, scan_results)
        return [dict(item) for item in scan_results]

    def resolve(self, cli_id: str) -> dict[str, Any]:
        match = next((item for item in self.scan() if item["id"] == cli_id), None)
        if match is None:
            raise ValueError(f"CLI {cli_id} is not registered")
        if not match["installed"]:
            raise ValueError(f"CLI {match['name']} is not installed")
        return match


_registry: CliRegistry | None = None


def get_cli_registry() -> CliRegistry:
    global _registry
    if _registry is None:
        _registry = CliRegistry()
    return _registry
