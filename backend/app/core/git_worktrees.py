"""Safe Git status and worktree lifecycle helpers."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SAFE_REF = re.compile(r"^[A-Za-z0-9._/-]+$")
_FIELD_SEPARATOR = "\x1f"
_RECORD_SEPARATOR = "\x1e"

# Git refuses to run when a concurrent process holds `index.lock` or
# `packed-refs.lock`. Several agents sharing one repository hit this constantly,
# so every call is serialized per checkout and retried on contention instead of
# surfacing a scary error to the user.
_LOCK_CONTENTION = ("index.lock", "packed-refs.lock", "another git process", "file exists")
_LOCK_RETRIES = 3
_LOCK_RETRY_DELAY = 0.12

_path_locks: dict[str, threading.RLock] = {}
_path_locks_guard = threading.Lock()


class NotGitRepositoryError(ValueError):
    """The directory exists but is not inside a Git repository."""


def _normalize(path: Path | str) -> str:
    return os.path.normcase(str(path))


def _lock_for(key: str) -> threading.RLock:
    with _path_locks_guard:
        lock = _path_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _path_locks[key] = lock
        return lock


def _is_lock_contention(result: subprocess.CompletedProcess[str]) -> bool:
    message = (result.stderr or "").lower()
    return any(token in message for token in _LOCK_CONTENTION)


def _git(
    repo: Path,
    *args: str,
    timeout: int = 15,
    lock_key: Path | str | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a Git command, serialized per checkout and retried on lock contention."""

    with _lock_for(_normalize(lock_key if lock_key is not None else repo)):
        result = subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=timeout,
            check=False, encoding="utf-8", errors="replace",
        )
        for attempt in range(_LOCK_RETRIES):
            if result.returncode == 0 or not _is_lock_contention(result):
                return result
            time.sleep(_LOCK_RETRY_DELAY * (attempt + 1))
            result = subprocess.run(
                ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=timeout,
                check=False, encoding="utf-8", errors="replace",
            )
        return result


def repository_root(path: str) -> Path:
    candidate = Path(path).expanduser().resolve()
    if not candidate.is_dir():
        raise FileNotFoundError(f"Directory does not exist: {candidate}")
    result = _git(candidate, "rev-parse", "--show-toplevel")
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip()
        if "not a git repository" in message.lower():
            raise NotGitRepositoryError(f"Not a Git repository: {candidate}")
        raise RuntimeError(message[:1000] or f"Cannot inspect Git repository: {candidate}")
    return Path(result.stdout.strip()).resolve()


def _absolute_git_dir(worktree: Path, value: str) -> Path:
    directory = Path(value.strip())
    return directory.resolve() if directory.is_absolute() else (worktree / directory).resolve()


def _stable_path_id(prefix: str, path: Path) -> str:
    normalized = os.path.normcase(str(path.resolve()))
    digest = hashlib.sha256(normalized.encode("utf-8", errors="surrogatepass")).hexdigest()[:16]
    return f"{prefix}-{digest}"


def _unquote(path: str) -> str:
    """Undo Git's C-style quoting for paths with unusual characters."""

    value = path.strip()
    if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
        try:
            return value[1:-1].encode("utf-8").decode("unicode_escape")
        except UnicodeDecodeError:
            return value[1:-1]
    return value


def _status_entry(line: str) -> tuple[str, str] | None:
    """Map one porcelain-v2 line to ``(path, single-letter code)``."""

    if line.startswith("? "):
        return _unquote(line[2:]), "?"
    if line.startswith("! "):
        return None
    if line.startswith("1 "):
        fields = line.split(" ", 8)
        if len(fields) < 9:
            return None
        return _unquote(fields[8]), _code(fields[1])
    if line.startswith("2 "):
        fields = line.split(" ", 9)
        if len(fields) < 10:
            return None
        return _unquote(fields[9].split("\t", 1)[0]), _code(fields[1])
    if line.startswith("u "):
        fields = line.split(" ", 10)
        if len(fields) < 11:
            return None
        return _unquote(fields[10]), "U"
    return None


def _code(xy: str) -> str:
    if len(xy) < 2:
        return "M"
    return xy[0] if xy[0] != "." else xy[1]


def _parse_status_v2(output: str) -> dict[str, Any]:
    branch = ""
    head = ""
    upstream = ""
    ahead = 0
    behind = 0
    staged = 0
    unstaged = 0
    untracked = 0
    tracked_changed = 0

    for line in output.splitlines():
        if line.startswith("# branch.oid "):
            value = line.removeprefix("# branch.oid ").strip()
            head = "" if value == "(initial)" else value
        elif line.startswith("# branch.head "):
            value = line.removeprefix("# branch.head ").strip()
            branch = "" if value == "(detached)" else value
        elif line.startswith("# branch.upstream "):
            upstream = line.removeprefix("# branch.upstream ").strip()
        elif line.startswith("# branch.ab "):
            match = re.search(r"\+(\d+)\s+-(\d+)", line)
            if match:
                ahead = int(match.group(1))
                behind = int(match.group(2))
        elif line.startswith(("1 ", "2 ", "u ")):
            parts = line.split(maxsplit=2)
            xy = parts[1] if len(parts) > 1 else ".."
            if len(xy) >= 2:
                staged += int(xy[0] != ".")
                unstaged += int(xy[1] != ".")
                tracked_changed += int(xy != "..")
        elif line.startswith("? "):
            untracked += 1

    return {
        "branch": branch,
        "head": head,
        "detached": not branch and bool(head),
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
        "changed": tracked_changed + untracked,
        "dirty": bool(staged or unstaged or untracked),
    }


class GitStatusCache:
    def __init__(self, ttl: float = 5.0) -> None:
        self._ttl = ttl
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._aliases: dict[str, str] = {}
        self._lock = threading.Lock()

    def get(self, path: str) -> dict[str, Any]:
        if not path:
            return {"is_git": False, "branch": "", "dirty": False, "ahead": 0, "behind": 0}
        candidate_key = os.path.normcase(str(Path(path).expanduser().resolve()))
        now = time.monotonic()
        cached_key = candidate_key
        stale_value: dict[str, Any] | None = None
        with self._lock:
            cached_key = self._aliases.get(candidate_key, candidate_key)
            cached = self._cache.get(cached_key)
            if cached and now - cached[0] < self._ttl:
                return cached[1]
            if cached:
                stale_value = dict(cached[1])
        key = cached_key
        try:
            root = repository_root(path)
            key = os.path.normcase(str(root))
            with self._lock:
                self._aliases[candidate_key] = key
                cached = self._cache.get(key)
                if cached and now - cached[0] < self._ttl:
                    return cached[1]
                if cached:
                    stale_value = dict(cached[1])

            status_result = _git(root, "status", "--porcelain=v2", "--branch")
            if status_result.returncode != 0:
                raise ValueError((status_result.stderr or status_result.stdout).strip())
            common_result = _git(root, "rev-parse", "--git-common-dir")
            if common_result.returncode != 0:
                raise ValueError("Cannot resolve the repository Git directory")
            common_dir = _absolute_git_dir(root, common_result.stdout)
            repository_path = common_dir.parent if common_dir.name == ".git" else root
            status = _parse_status_v2(status_result.stdout)
            value = {
                "is_git": True,
                "root": str(root),
                "worktree_name": root.name,
                "worktree_id": _stable_path_id("worktree", root),
                "common_dir": str(common_dir),
                "repository_root": str(repository_path),
                "repository_name": repository_path.name,
                "repository_id": _stable_path_id("repo", common_dir),
                "is_worktree": (root / ".git").is_file(),
                "is_main_worktree": (root / ".git").is_dir(),
                "error": "",
                "stale": False,
                **status,
            }
        except NotGitRepositoryError:
            value = {"is_git": False, "branch": "", "dirty": False, "ahead": 0, "behind": 0}
            key = candidate_key
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            message = str(exc).strip()[:1000] or "Git status is temporarily unavailable"
            if stale_value and stale_value.get("is_git"):
                value = {**stale_value, "error": message, "stale": True}
            else:
                value = {
                    "is_git": False,
                    "branch": "",
                    "dirty": False,
                    "ahead": 0,
                    "behind": 0,
                    "error": message,
                    "stale": False,
                }
        with self._lock:
            self._cache[key] = (now, value)
        return value


def list_commits(path: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return a compact, delimiter-safe commit history for one worktree."""

    root = repository_root(path)
    safe_limit = max(1, min(limit, 100))
    pretty = (
        f"%H{_FIELD_SEPARATOR}%h{_FIELD_SEPARATOR}%an{_FIELD_SEPARATOR}"
        f"%aI{_FIELD_SEPARATOR}%s{_FIELD_SEPARATOR}%D{_RECORD_SEPARATOR}"
    )
    result = _git(root, "log", f"-n{safe_limit}", f"--pretty=format:{pretty}")
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip()
        if "does not have any commits yet" in message:
            return []
        raise RuntimeError(message[:1000] or "Cannot read Git history")

    commits: list[dict[str, Any]] = []
    for record in result.stdout.split(_RECORD_SEPARATOR):
        fields = record.strip("\r\n").split(_FIELD_SEPARATOR)
        if len(fields) != 6:
            continue
        sha, short_sha, author, authored_at, subject, refs = fields
        commits.append({
            "sha": sha,
            "short_sha": short_sha,
            "author": author,
            "authored_at": authored_at,
            "subject": subject,
            "refs": [item.strip() for item in refs.split(",") if item.strip()],
        })
    return commits


def list_changed_files(path: str, limit: int = 300) -> list[dict[str, Any]]:
    """Return the files a worktree has modified, staged or left untracked."""

    root = repository_root(path)
    result = _git(root, "status", "--porcelain=v2", "--branch")
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:1000] or "Cannot read status")
    changes: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        entry = _status_entry(line)
        if entry is None:
            continue
        file_path, code = entry
        changes.append({"path": file_path, "code": code, "untracked": code == "?"})
        if len(changes) >= max(1, min(limit, 1000)):
            break
    changes.sort(key=lambda item: (item["untracked"], item["path"].lower()))
    return changes


def touched_files(path: str, base_ref: str = "") -> set[str]:
    """Files a worktree changed: working tree plus commits since ``base_ref``.

    ``base_ref`` should be a revision reachable from the shared object store
    (typically the main checkout's HEAD). When it is missing or unrelated, only
    uncommitted changes are reported so the caller still gets useful data.
    """

    root = repository_root(path)
    files = {item["path"] for item in list_changed_files(path, limit=1000)}
    if not base_ref:
        return files
    merge_base = _git(root, "merge-base", "HEAD", base_ref)
    if merge_base.returncode != 0:
        return files
    revision = merge_base.stdout.strip()
    if not revision:
        return files
    diff = _git(root, "diff", "--name-only", revision, "HEAD")
    if diff.returncode != 0:
        return files
    for line in diff.stdout.splitlines():
        candidate = _unquote(line)
        if candidate:
            files.add(candidate)
    return files


def find_overlaps(entries: dict[str, set[str]]) -> list[dict[str, Any]]:
    """Given ``{worktree_id: touched files}``, list files claimed by 2+ worktrees.

    Pure function so the conflict rule stays testable without a real repository.
    """

    owners: dict[str, list[str]] = {}
    for worktree_id, files in entries.items():
        for file_path in files:
            owners.setdefault(file_path, []).append(worktree_id)
    overlaps = [
        {"path": file_path, "worktree_ids": sorted(ids)}
        for file_path, ids in owners.items()
        if len(ids) > 1
    ]
    overlaps.sort(key=lambda item: (-len(item["worktree_ids"]), str(item["path"]).lower()))
    return overlaps


def head_revision(path: str) -> str:
    """Resolve HEAD for a checkout, returning an empty string on a fresh repo."""

    root = repository_root(path)
    result = _git(root, "rev-parse", "HEAD")
    return result.stdout.strip() if result.returncode == 0 else ""


def list_worktrees(path: str) -> list[dict[str, Any]]:
    """Inventory every worktree of a repository, including ones with no terminal."""

    root = repository_root(path)
    result = _git(root, "worktree", "list", "--porcelain")
    if result.returncode != 0:
        raise RuntimeError(
            (result.stderr or result.stdout).strip()[:1000] or "Cannot list Git worktrees"
        )
    worktrees: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            if current is not None:
                worktrees.append(current)
            worktree_path = Path(line.removeprefix("worktree ").strip())
            current = {
                "id": _stable_path_id("worktree", worktree_path),
                "path": str(worktree_path),
                "name": worktree_path.name,
                "head": "",
                "branch": "",
                "detached": False,
                "locked": False,
                "prunable": False,
                "is_main": not worktrees,
                "exists": worktree_path.is_dir(),
            }
        elif current is None:
            continue
        elif line.startswith("HEAD "):
            current["head"] = line.removeprefix("HEAD ").strip()
        elif line.startswith("branch "):
            current["branch"] = line.removeprefix("branch ").strip().removeprefix("refs/heads/")
        elif line.startswith("detached"):
            current["detached"] = True
        elif line.startswith("locked"):
            current["locked"] = True
        elif line.startswith("prunable"):
            current["prunable"] = True
    if current is not None:
        worktrees.append(current)
    return worktrees


def _validate_ref(ref: str, label: str) -> str:
    value = ref.strip()
    if not value or not _SAFE_REF.fullmatch(value) or value.startswith(("-", "/")) or ".." in value:
        raise ValueError(f"Invalid {label}")
    return value


def current_branch(path: str) -> str:
    root = repository_root(path)
    result = _git(root, "branch", "--show-current")
    return result.stdout.strip() if result.returncode == 0 else ""


def ahead_behind(path: str, target: str, branch: str) -> tuple[int, int]:
    """Commits ``branch`` is ahead of / behind ``target``."""

    root = repository_root(path)
    result = _git(root, "rev-list", "--left-right", "--count", f"{target}...{branch}")
    if result.returncode != 0:
        return 0, 0
    parts = result.stdout.split()
    if len(parts) != 2:
        return 0, 0
    behind, ahead = int(parts[0]), int(parts[1])
    return ahead, behind


def merge_preview(repository: str, branch: str, target: str = "") -> dict[str, Any]:
    """Dry-run a merge and report the files that would conflict.

    ``git merge-tree --write-tree`` resolves the merge in the object database
    without touching any working tree, so the answer costs nothing and cannot
    leave the repository half-merged.
    """

    root = repository_root(repository)
    branch_ref = _validate_ref(branch, "branch")
    target_ref = _validate_ref(target or current_branch(str(root)) or "HEAD", "target branch")
    ahead, behind = ahead_behind(str(root), target_ref, branch_ref)
    result = _git(
        root, "merge-tree", "--write-tree", "--name-only", "--no-messages",
        target_ref, branch_ref, timeout=60,
    )
    if result.returncode > 1:
        raise RuntimeError((result.stderr or result.stdout).strip()[:1000] or "Cannot preview merge")
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    # First line is the resulting tree object; the rest are conflicted paths.
    conflicts = [_unquote(line) for line in lines[1:]] if result.returncode == 1 else []
    return {
        "branch": branch_ref,
        "target": target_ref,
        "ahead": ahead,
        "behind": behind,
        "clean": result.returncode == 0,
        "conflicts": conflicts,
        "up_to_date": ahead == 0,
    }


def integrate_branch(repository: str, branch: str, mode: str = "merge") -> dict[str, Any]:
    """Merge or cherry-pick a branch into the repository's main checkout.

    The target working tree must be clean, and any failure is rolled back with
    the matching ``--abort`` so the user never lands in a half-applied state.
    """

    if mode not in {"merge", "cherry-pick"}:
        raise ValueError("Unsupported integration mode")
    root = repository_root(repository)
    branch_ref = _validate_ref(branch, "branch")
    target_ref = current_branch(str(root))
    if not target_ref:
        raise ValueError("The main checkout is detached; check out a branch before integrating")
    if target_ref == branch_ref:
        raise ValueError("The branch is already checked out in the main checkout")

    status = GitStatusCache(ttl=0).get(str(root))
    if status.get("error"):
        raise RuntimeError(f"Cannot verify the main checkout: {status['error']}")
    if status.get("dirty"):
        raise RuntimeError(
            "The main checkout has uncommitted changes. Commit or stash them before integrating."
        )

    if mode == "merge":
        command = ["merge", "--no-ff", branch_ref, "-m", f"Merge {branch_ref} into {target_ref}"]
        abort = ["merge", "--abort"]
    else:
        merge_base = _git(root, "merge-base", target_ref, branch_ref)
        if merge_base.returncode != 0 or not merge_base.stdout.strip():
            raise RuntimeError("Cannot find a common ancestor for cherry-pick")
        command = ["cherry-pick", f"{merge_base.stdout.strip()}..{branch_ref}"]
        abort = ["cherry-pick", "--abort"]

    result = _git(root, *command, timeout=120, lock_key=root)
    if result.returncode != 0:
        _git(root, *abort, timeout=60, lock_key=root)
        message = (result.stderr or result.stdout).strip()[:1000]
        raise RuntimeError(f"{mode} failed and was rolled back: {message}")
    return {
        "status": "integrated",
        "mode": mode,
        "branch": branch_ref,
        "target": target_ref,
        "output": (result.stdout or result.stderr).strip()[:1000],
    }


def create_pull_request(repository: str, branch: str, title: str, body: str) -> dict[str, Any]:
    """Open a pull request with the GitHub CLI when it is available."""

    root = repository_root(repository)
    branch_ref = _validate_ref(branch, "branch")
    if shutil.which("gh") is None:
        raise RuntimeError(
            "The GitHub CLI (gh) is not installed or not on PATH. "
            "Install it from https://cli.github.com to open pull requests from Vibe Spam."
        )
    push = _git(root, "push", "--set-upstream", "origin", branch_ref, timeout=180, lock_key=root)
    if push.returncode != 0:
        raise RuntimeError((push.stderr or push.stdout).strip()[:1000] or "Cannot push the branch")
    result = subprocess.run(
        ["gh", "pr", "create", "--head", branch_ref, "--title", title[:200] or branch_ref,
         "--body", body[:4000] or f"Opened from Vibe Spam for {branch_ref}."],
        cwd=str(root), capture_output=True, text=True, timeout=120, check=False,
        encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:1000] or "gh pr create failed")
    return {"status": "created", "url": (result.stdout or "").strip()[:500]}


SNAPSHOT_PREFIX = "vibe-safety"


def _snapshot_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    return slug[:60] or "checkout"


def create_snapshot(path: str, label: str = "") -> dict[str, Any]:
    """Tag a restore point for a checkout without touching its working tree.

    ``git stash create`` builds a commit from the current state and returns its
    id without modifying anything; tagging it keeps the state reachable so an
    agent running ``git reset --hard`` is no longer unrecoverable.
    """

    root = repository_root(path)
    stash = _git(root, "stash", "create", timeout=60, lock_key=root)
    if stash.returncode != 0:
        raise RuntimeError((stash.stderr or stash.stdout).strip()[:1000] or "Cannot snapshot")
    revision = stash.stdout.strip()
    if not revision:
        head = _git(root, "rev-parse", "HEAD")
        if head.returncode != 0:
            raise RuntimeError("The checkout has no commits to snapshot")
        revision = head.stdout.strip()
    branch = current_branch(str(root)) or "detached"
    tag = f"{SNAPSHOT_PREFIX}/{_snapshot_slug(branch)}/{int(time.time())}"
    message = label.strip()[:200] or f"Vibe Spam restore point for {branch}"
    created = _git(root, "tag", "-a", tag, revision, "-m", message, timeout=60, lock_key=root)
    if created.returncode != 0:
        raise RuntimeError((created.stderr or created.stdout).strip()[:1000] or "Cannot tag")
    return {"tag": tag, "sha": revision, "branch": branch, "label": message}


def list_snapshots(path: str) -> list[dict[str, Any]]:
    root = repository_root(path)
    branch = current_branch(str(root)) or "detached"
    pattern = f"{SNAPSHOT_PREFIX}/{_snapshot_slug(branch)}/*"
    result = _git(
        root, "tag", "--list", pattern,
        f"--format=%(refname:short){_FIELD_SEPARATOR}%(objectname){_FIELD_SEPARATOR}"
        f"%(creatordate:iso-strict){_FIELD_SEPARATOR}%(contents:subject)",
    )
    if result.returncode != 0:
        return []
    snapshots: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        fields = line.split(_FIELD_SEPARATOR)
        if len(fields) != 4:
            continue
        snapshots.append({
            "tag": fields[0], "sha": fields[1], "created_at": fields[2], "label": fields[3],
        })
    snapshots.sort(key=lambda item: str(item["created_at"]), reverse=True)
    return snapshots


def restore_snapshot(path: str, tag: str) -> dict[str, Any]:
    """Restore tracked files from a snapshot into the checkout."""

    root = repository_root(path)
    if not tag.startswith(f"{SNAPSHOT_PREFIX}/"):
        raise ValueError("Only Vibe Spam restore points can be restored")
    _validate_ref(tag, "restore point")
    exists = _git(root, "rev-parse", "--verify", f"{tag}^{{commit}}")
    if exists.returncode != 0:
        raise ValueError("The restore point no longer exists")
    result = _git(root, "checkout", tag, "--", ".", timeout=120, lock_key=root)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:1000] or "Cannot restore")
    return {"status": "restored", "tag": tag}


def delete_snapshot(path: str, tag: str) -> None:
    root = repository_root(path)
    if not tag.startswith(f"{SNAPSHOT_PREFIX}/"):
        raise ValueError("Only Vibe Spam restore points can be deleted")
    _validate_ref(tag, "restore point")
    result = _git(root, "tag", "-d", tag, lock_key=root)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:1000] or "Cannot delete")


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
        result = _git(
            repository, "worktree", "add", "-b", branch, str(target), base_ref,
            timeout=60, lock_key=repository,
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout).strip()[:1000])
        return CreatedWorktree(path=target, branch=branch, repository=repository)

    def ensure_clean(self, worktree: CreatedWorktree) -> None:
        status = GitStatusCache(ttl=0).get(str(worktree.path))
        if status.get("error"):
            raise RuntimeError(f"Cannot verify worktree status: {status['error']}")
        if status.get("dirty"):
            raise RuntimeError(f"Refusing to remove dirty worktree: {worktree.path}")

    def remove(self, worktree: CreatedWorktree, *, delete_branch: bool = True) -> None:
        self.ensure_clean(worktree)
        result = _git(
            worktree.repository, "worktree", "remove", str(worktree.path),
            timeout=60, lock_key=worktree.repository,
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout).strip()[:1000])
        if delete_branch:
            _git(worktree.repository, "branch", "-D", worktree.branch, lock_key=worktree.repository)

    def rollback(self, worktree: CreatedWorktree) -> None:
        result = _git(
            worktree.repository, "worktree", "remove", "--force", str(worktree.path),
            timeout=60, lock_key=worktree.repository,
        )
        if result.returncode == 0:
            _git(worktree.repository, "branch", "-D", worktree.branch, lock_key=worktree.repository)


def copy_ignored_files(source: str, destination: str, patterns: list[str]) -> list[str]:
    """Copy small ignored files (``.env`` and friends) into a fresh worktree.

    A new worktree only contains tracked files, so agents routinely fail on a
    missing local ``.env``. Only regular files under 1 MiB are copied and
    directories are never traversed, keeping this far away from ``node_modules``.
    """

    source_root = Path(source).expanduser().resolve()
    target_root = Path(destination).expanduser().resolve()
    copied: list[str] = []
    if not source_root.is_dir() or not target_root.is_dir():
        return copied
    for pattern in patterns[:20]:
        cleaned = pattern.strip().replace("\\", "/")
        if not cleaned or cleaned.startswith("/") or ".." in cleaned:
            continue
        for candidate in sorted(source_root.glob(cleaned))[:20]:
            if not candidate.is_file():
                continue
            try:
                if candidate.stat().st_size > 1024 * 1024:
                    continue
                relative = candidate.relative_to(source_root)
                target = target_root / relative
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(candidate.read_bytes())
                copied.append(str(relative))
            except (OSError, ValueError):
                continue
    return copied


git_status_cache = GitStatusCache()
worktree_service = WorktreeService()
