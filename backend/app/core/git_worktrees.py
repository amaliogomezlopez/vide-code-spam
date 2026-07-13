"""Safe Git status and worktree lifecycle helpers."""

from __future__ import annotations

import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SAFE_REF = re.compile(r"^[A-Za-z0-9._/-]+$")


def _git(repo: Path, *args: str, timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=timeout,
        check=False, encoding="utf-8", errors="replace",
    )


def repository_root(path: str) -> Path:
    candidate = Path(path).expanduser().resolve()
    if not candidate.is_dir():
        raise ValueError(f"Directory does not exist: {candidate}")
    result = _git(candidate, "rev-parse", "--show-toplevel")
    if result.returncode != 0:
        raise ValueError(f"Not a Git repository: {candidate}")
    return Path(result.stdout.strip()).resolve()


class GitStatusCache:
    def __init__(self, ttl: float = 2.0) -> None:
        self._ttl = ttl
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def get(self, path: str) -> dict[str, Any]:
        if not path:
            return {"is_git": False, "branch": "", "dirty": False, "ahead": 0, "behind": 0}
        key = str(Path(path).expanduser().resolve())
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(key)
            if cached and now - cached[0] < self._ttl:
                return cached[1]
        try:
            root = repository_root(key)
            result = _git(root, "status", "--porcelain=v1", "--branch")
            lines = result.stdout.splitlines()
            header = lines[0] if lines else ""
            branch = header.removeprefix("## ").split("...")[0].strip()
            ahead_match = re.search(r"ahead (\d+)", header)
            behind_match = re.search(r"behind (\d+)", header)
            value = {
                "is_git": True, "root": str(root), "branch": branch, "dirty": len(lines) > 1,
                "ahead": int(ahead_match.group(1)) if ahead_match else 0,
                "behind": int(behind_match.group(1)) if behind_match else 0,
                "is_worktree": (root / ".git").is_file(),
            }
        except (ValueError, OSError, subprocess.TimeoutExpired):
            value = {"is_git": False, "branch": "", "dirty": False, "ahead": 0, "behind": 0}
        with self._lock:
            self._cache[key] = (now, value)
        return value


@dataclass(frozen=True)
class CreatedWorktree:
    path: Path
    branch: str
    repository: Path


class WorktreeService:
    def describe(self, path: str) -> CreatedWorktree:
        worktree = repository_root(path)
        if not (worktree / ".git").is_file():
            raise ValueError("The selected directory is not a linked worktree")
        common = _git(worktree, "rev-parse", "--git-common-dir")
        if common.returncode != 0:
            raise ValueError("Cannot resolve the worktree repository")
        common_dir = Path(common.stdout.strip())
        if not common_dir.is_absolute():
            common_dir = (worktree / common_dir).resolve()
        repository = common_dir.parent.resolve()
        branch_result = _git(worktree, "branch", "--show-current")
        branch = branch_result.stdout.strip()
        if not branch:
            raise ValueError("Detached worktrees cannot be removed by Vibe Spam")
        return CreatedWorktree(path=worktree, branch=branch, repository=repository)

    def create(self, repo_path: str, branch: str, base_ref: str, destination: str = "") -> CreatedWorktree:
        if not _SAFE_REF.fullmatch(branch) or branch.startswith(('-', '/')) or ".." in branch:
            raise ValueError("Invalid worktree branch name")
        if not _SAFE_REF.fullmatch(base_ref) or base_ref.startswith(('-', '/')) or ".." in base_ref:
            raise ValueError("Invalid base Git ref")
        repository = repository_root(repo_path)
        slug = branch.replace("/", "-")
        target = Path(destination).expanduser().resolve() if destination else repository.parent / f"{repository.name}-worktrees" / slug
        if target.exists():
            raise ValueError(f"Worktree destination already exists: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        result = _git(repository, "worktree", "add", "-b", branch, str(target), base_ref, timeout=60)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout).strip()[:1000])
        return CreatedWorktree(path=target, branch=branch, repository=repository)

    def remove(self, worktree: CreatedWorktree, *, delete_branch: bool = True) -> None:
        status = GitStatusCache(ttl=0).get(str(worktree.path))
        if status.get("dirty"):
            raise RuntimeError(f"Refusing to remove dirty worktree: {worktree.path}")
        result = _git(worktree.repository, "worktree", "remove", str(worktree.path), timeout=60)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout).strip()[:1000])
        if delete_branch:
            _git(worktree.repository, "branch", "-D", worktree.branch)

    def rollback(self, worktree: CreatedWorktree) -> None:
        result = _git(worktree.repository, "worktree", "remove", "--force", str(worktree.path), timeout=60)
        if result.returncode == 0:
            _git(worktree.repository, "branch", "-D", worktree.branch)


git_status_cache = GitStatusCache()
worktree_service = WorktreeService()
