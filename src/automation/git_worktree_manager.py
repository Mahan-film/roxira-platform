from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional

_TASK_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


class GitWorktreeManager:
    """
    مدیریت پیشرفته درخت‌های کاری موازی (Git Worktrees).
    به‌صورت خودکار فایل‌های .env و پوشه‌های node_modules را لینک می‌کند تا
    ایجنت‌های موازی به تمام وابستگی‌ها و کلیدها در محیط ایزوله دسترسی داشته باشند.
    """

    def __init__(
        self,
        repo_path: Optional[pathlib.Path] = None,
        worktrees_root: Optional[pathlib.Path] = None,
    ) -> None:
        self.repo_path = (repo_path or pathlib.Path("/opt/roxira_platform")).resolve()
        self.worktrees_root = (
            worktrees_root or (self.repo_path / ".factory_worktrees")
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
        except Exception as exc:
            return {"returncode": -1, "stdout": "", "stderr": str(exc), "ok": False}

    def worktree_path(self, task_id: str) -> pathlib.Path:
        if not _TASK_ID_RE.match(task_id):
            raise ValueError(f"شناسه تسک نامعتبر است: {task_id}")
        return self.worktrees_root / task_id

    def create(self, task_id: str, base_ref: str = "HEAD") -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        branch = f"factory/{task_id}"

        if path.exists():
            return {"status": "EXISTS", "path": str(path), "branch": branch}

        # ۱. ساخت شاخه و ورک‌تری موقت
        res = self._git("worktree", "add", "-b", branch, str(path), base_ref)
        if not res["ok"]:
            # در صورت وجود قبلی شاخه، با checkout اضافه کن
            res = self._git("worktree", "add", str(path), branch)
            if not res["ok"]:
                return {"status": "ERROR", "error": res["stderr"]}

        # ۲. پیوند نمادین (Symlink) خودکار فایل‌های مخفی و وابستگی‌ها
        self._link_dependencies(path)

        return {"status": "CREATED", "path": str(path), "branch": branch}

    def _link_dependencies(self, target_path: pathlib.Path) -> None:
        """لینک کردن .env و node_modules ها برای کارکرد بیلد بدون کپی سنگین."""
        # لینک .env
        src_env = self.repo_path / ".env"
        dst_env = target_path / ".env"
        if src_env.exists() and not dst_env.exists():
            try:
                os.symlink(str(src_env), str(dst_env))
            except Exception:
                shutil.copy(str(src_env), str(dst_env))

        # لینک node_modules هاب سازمانی و فرانت‌اند
        modules_links = [
            ("output_apps/enterprise_hub/node_modules", "output_apps/enterprise_hub/node_modules"),
            ("output_apps/enterprise_hub/frontend/node_modules", "output_apps/enterprise_hub/frontend/node_modules"),
        ]
        for src_rel, dst_rel in modules_links:
            s = self.repo_path / src_rel
            d = target_path / dst_rel
            if s.exists() and not d.exists():
                d.parent.mkdir(parents=True, exist_ok=True)
                try:
                    os.symlink(str(s), str(d))
                except Exception:
                    pass

    def run(self, task_id: str, command: List[str], timeout: int = 180) -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        if not path.is_dir():
            return {"ok": False, "stderr": f"Worktree یافت نشد: {path}"}
        try:
            env = os.environ.copy()
            env["PYTHONPATH"] = f"{path}:{self.repo_path}:{env.get('PYTHONPATH', '')}"
            proc = subprocess.run(
                command,
                cwd=str(path),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            return {
                "ok": proc.returncode == 0,
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
            }
        except Exception as exc:
            return {"ok": False, "stderr": str(exc), "returncode": -1}

    def remove(self, task_id: str, force: bool = True, delete_branch: bool = True) -> Dict[str, Any]:
        path = self.worktree_path(task_id)
        args = ["worktree", "remove", str(path)]
        if force:
            args.append("--force")
        result = self._git(*args)
        if not result["ok"] and path.exists():
            shutil.rmtree(path, ignore_errors=True)
            result = {"ok": True, "stdout": "removed manually", "stderr": ""}
        if delete_branch:
            self._git("branch", "-D", f"factory/{task_id}")
        return {"status": "REMOVED" if result["ok"] else "ERROR", **result}
