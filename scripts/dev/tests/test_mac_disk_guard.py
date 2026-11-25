"""Offline tests for scripts/dev/mac_disk_guard.sh."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "mac_disk_guard.sh"


def _git(cwd: Path, *args: str, env: dict[str, str] | None = None) -> str:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    res = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        env=merged_env,
        check=True,
        capture_output=True,
        text=True,
    )
    return res.stdout.strip()


def _make_worktree(
    repo: Path,
    wt_dir: Path,
    branch: str,
    *,
    push: bool = True,
    age_hours: int = 6,
) -> Path:
    old_ts = str(int(time.time()) - age_hours * 3600)
    commit_env = {
        "GIT_AUTHOR_DATE": f"{old_ts} +0000",
        "GIT_COMMITTER_DATE": f"{old_ts} +0000",
    }
    _git(repo, "worktree", "add", "-q", "-b", branch, str(wt_dir), "main")
    (wt_dir / f"{branch}.txt").write_text(f"data for {branch}\n")
    _git(wt_dir, "add", ".")
    _git(wt_dir, "commit", "-q", "-m", f"add {branch}", env=commit_env)
    if push:
        _git(wt_dir, "push", "-q", "-u", "origin", branch)

    # Backdate logs/HEAD mtime so is_wt_idle sees the intended age.
    git_dir = Path(_git(wt_dir, "rev-parse", "--git-dir"))
    if not git_dir.is_absolute():
        git_dir = wt_dir / git_dir
    logs_head = git_dir / "logs" / "HEAD"
    if logs_head.exists():
        old_epoch = time.time() - age_hours * 3600
        os.utime(logs_head, (old_epoch, old_epoch))
    return wt_dir


def test_tier2_removes_only_idle_safe_worktree(tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    remote.mkdir()
    _git(remote, "init", "--bare", "-q", "-b", "main")

    repo = tmp_path / "roxira-platform"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    (repo / "README.md").write_text("root\n")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-q", "-m", "init")
    _git(repo, "remote", "add", "origin", str(remote))
    _git(repo, "push", "-q", "-u", "origin", "main")

    wt_root = tmp_path / "wt"
    wt_root.mkdir()

    dirty = _make_worktree(repo, wt_root / "dirty", "dirty", push=True, age_hours=6)
    (dirty / "dirty.txt").write_text("uncommitted\n")

    unpushed = _make_worktree(repo, wt_root / "unpushed", "unpushed", push=False, age_hours=6)
    locked = _make_worktree(repo, wt_root / "locked", "locked", push=True, age_hours=6)
    _git(repo, "worktree", "lock", str(locked))

    in_use = _make_worktree(repo, wt_root / "in-use", "in-use", push=True, age_hours=6)
    fresh = _make_worktree(repo, wt_root / "fresh", "fresh", push=True, age_hours=0)
    idle_safe = _make_worktree(repo, wt_root / "idle-safe", "idle-safe", push=True, age_hours=6)

    proc = subprocess.Popen(["sleep", "30"], cwd=str(in_use))
    time.sleep(0.1)
    try:
        env = os.environ.copy()
        env.update(
            {
                "FAKE_FREE_GB": "10",
                "SKIP_TOOL_CACHES": "1",
                "DEV_ROOT": str(tmp_path),
                "REPO_DIR": str(repo),
                "TMP_RVDESK": str(tmp_path / "rvdesk"),
                "LOG_FILE": str(tmp_path / "guard.log"),
            }
        )
        res = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
        assert res.returncode == 0, res.stderr

        assert dirty.exists()
        assert unpushed.exists()
        assert locked.exists()
        assert in_use.exists()
        assert fresh.exists()
        assert not idle_safe.exists()
    finally:
        proc.terminate()
        proc.wait(timeout=5)
