from __future__ import annotations

import pathlib
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional

from src.automation.provider_base import get_env_var

_TASK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class GitWorktreeManager:
    """Runs autonomous coding tasks in isolated git worktrees.

    Generated code is staged and validated inside a throwaway worktree so the
    live server source under the main worktree is never touched.
    """

    def __init__(
        self,
        repo_path: Optional[str] = None,
        worktrees_root: Optional[str] = None,
    ) -> None:
        self.repo_path = pathlib.Path(
            repo_path or get_env_var("ROXIRA_REPO_PATH", "/opt/roxira_platform")
        ).resolve()
        self.worktrees_root = pathlib.Path(
            worktrees_root
            or get_env_var("FACTORY_WORKTREES_ROOT", str(self.repo_path / ".factory_worktrees"))
        ).resolve()
        self.worktrees_root.mkdir(parents=True, exist_ok=True)

    def _git(
        self, *args: str, cwd: Optional[pathlib.Path] = None, timeout: int = 120
    ) -> Dict[str, Any]:
        try:
            proc = subprocess.run(
                ["git", *args],
                cwd=str(cwd or self.repo_path),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return {
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "ok": proc.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {"returncode": -1, "stdout": "", "stderr": "git command timed out", "ok": False}
        except FileNotFoundError:
            return {
                "returncode": -1,
                "stdout": "",
                "stderr": "git executable not found",
                "ok": False,
            }

    @staticmethod
    def _validate_task_id(task_id: str) -> str:
        if not _TASK_ID_RE.match(task_id or ""):
            raise ValueError(f"invalid task_id: {task_id!r}")
        return task_id

    def is_git_repo(self) -> bool:
        return self._git("rev-parse", "--is-inside-work-tree")["ok"]

    def current_branch(self) -> str:
        return self._git("rev-parse", "--abbrev-ref", "HEAD")["stdout"]

    def worktree_path(self, task_id: str) -> pathlib.Path:
        return self.worktrees_root / self._validate_task_id(task_id)

    def branch_name(self, task_id: str) -> str:
        return f"factory/{self._validate_task_id(task_id)}"

    def create(self, task_id: str, base_ref: str = "HEAD") -> Dict[str, Any]:
        if not self.is_git_repo():
            return {"status": "ERROR", "error": f"{self.repo_path} is not a git repository"}
        path = self.worktree_path(task_id)
        branch = self.branch_name(task_id)
        if path.exists():
            return {"status": "EXISTS", "task_id": task_id, "path": str(path), "branch": branch}

        existing = self._git("rev-parse", "--verify", "--quiet", branch)
        if existing["ok"]:
            result = self._git("worktree", "add", str(path), branch)
        else:
            result = self._git("worktree", "add", "-b", branch, str(path), base_ref)
        if not result["ok"]:
            return {"status": "ERROR", "task_id": task_id, "error": result["stderr"]}
        return {"status": "CREATED", "task_id": task_id, "path": str(path), "branch": branch}

    def list(self) -> List[Dict[str, str]]:
        result = self._git("worktree", "list", "--porcelain")
        if not result["ok"]:
            return []
        entries: List[Dict[str, str]] = []
        current: Dict[str, str] = {}
        for line in result["stdout"].splitlines():
            if line.startswith("worktree "):
                if current:
                    entries.append(current)
                current = {"path": line.split(" ", 1)[1]}
            elif line.startswith("branch "):
                current["branch"] = line.split(" ", 1)[1]
            elif line == "detached":
                current["branch"] = "DETACHED"
        if current:
            entries.append(current)
        return entries

    def run(
        self,
        task_id: str,
        command: List[str],
        timeout: int = 300,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        if not path.is_dir():
            return {"status": "ERROR", "error": f"worktree not found: {path}"}
        try:
            proc = subprocess.run(
                command,
                cwd=str(path),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            return {
                "status": "SUCCESS" if proc.returncode == 0 else "FAILED",
                "returncode": proc.returncode,
                "stdout": proc.stdout[-8000:],
                "stderr": proc.stderr[-8000:],
            }
        except subprocess.TimeoutExpired:
            return {"status": "ERROR", "error": "task command timed out"}
        except FileNotFoundError as exc:
            return {"status": "ERROR", "error": str(exc)}

    def write_file(self, task_id: str, relative_path: str, content: str) -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        if not path.is_dir():
            return {"status": "ERROR", "error": f"worktree not found: {path}"}
        target = (path / relative_path).resolve()
        if path != target and path not in target.parents:
            return {"status": "ERROR", "error": "path escapes worktree"}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"status": "WRITTEN", "path": str(target)}

    def validate_python(self, task_id: str, relative_path: str) -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        target = path / relative_path
        if not target.is_file():
            return {"status": "ERROR", "error": f"file not found: {target}"}
        return self.run(task_id, ["python3", "-m", "py_compile", str(target)])

    def remove(
        self, task_id: str, force: bool = True, delete_branch: bool = False
    ) -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        args = ["worktree", "remove", str(path)]
        if force:
            args.append("--force")
        result = self._git(*args)
        if not result["ok"] and path.exists():
            shutil.rmtree(path, ignore_errors=True)
            result = {"ok": True, "stdout": "removed manually", "stderr": ""}
        if result["ok"] and delete_branch:
            self._git("branch", "-D", self.branch_name(task_id))
        return {"status": "REMOVED" if result["ok"] else "ERROR", **result}

    def prune(self) -> Dict[str, Any]:
        return self._git("worktree", "prune")

    def cleanup_all(self) -> Dict[str, Any]:
        removed = []
        root = str(self.worktrees_root)
        for entry in self.list():
            if entry.get("path", "").startswith(root):
                task_id = pathlib.Path(entry["path"]).name
                self.remove(task_id, delete_branch=True)
                removed.append(task_id)
        return {"status": "SUCCESS", "removed": removed}
