"""Offline unit tests for scripts/dev/owner_ok.sh using a stub gh CLI."""

from __future__ import annotations

import json
import os
import stat
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "owner_ok.sh"


def _setup_stub(
    tmp_path: Path,
    *,
    pr_json: dict,
    comments_json: list[dict],
    second_head: str | None = None,
) -> tuple[Path, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    log_file = tmp_path / "gh_calls.log"
    state_file = tmp_path / "head_calls.txt"
    (tmp_path / "pr.json").write_text(json.dumps(pr_json), encoding="utf-8")
    (tmp_path / "comments.json").write_text(json.dumps(comments_json), encoding="utf-8")

    gh_stub = bin_dir / "gh"
    gh_stub.write_text(
        f"""#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "{log_file}"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  if [[ "$*" == *"--jq .headRefOid"* ]]; then
    count=0
    [ -f "{state_file}" ] && count=$(cat "{state_file}")
    count=$((count + 1))
    echo "$count" > "{state_file}"
    echo "{second_head or pr_json['headRefOid']}"
    exit 0
  fi
  cat "{tmp_path / 'pr.json'}"
  exit 0
fi
if [ "$1" = "api" ]; then
  cat "{tmp_path / 'comments.json'}"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "comment" ]; then
  echo "commented"
  exit 0
fi
exit 1
""",
        encoding="utf-8",
    )
    gh_stub.chmod(gh_stub.stat().st_mode | stat.S_IXUSR)
    return bin_dir, log_file


def _base_pr(head: str = "abcdef1234567890abcdef1234567890abcdef12") -> dict:
    return {
        "number": 1484,
        "title": "[needs owner] feat(merge-gate): harden gate",
        "state": "OPEN",
        "headRefOid": head,
        "files": [{"path": "scripts/ops/ci_box/merge_gate/merge_gate.py"}],
        "commits": [{"committedDate": "2026-11-25T05:00:00Z"}],
    }


def _desk_comment(sha: str, verdict: str, created_at: str = "2026-11-25T05:10:00Z") -> dict:
    return {
        "user": {"login": "github-actions[bot]"},
        "created_at": created_at,
        "body": f"Cross-family review (nvidia/nemotron, family nvidia) @ {sha}\n\n**Blocker**\n- none\n\nVerdict: {verdict}\n",
    }


def test_dry_run_shows_files_verdict_and_sha7_without_posting(tmp_path: Path) -> None:
    head = "abcdef1234567890abcdef1234567890abcdef12"
    bin_dir, log_file = _setup_stub(
        tmp_path,
        pr_json=_base_pr(head),
        comments_json=[_desk_comment(head, "no blocker")],
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    res = subprocess.run(["bash", str(SCRIPT), "--dry-run", "1484"], env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    assert "scripts/ops/ci_box/merge_gate/merge_gate.py" in res.stdout
    assert "Desk verdict at head: no blocker" in res.stdout
    assert "[dry-run] would post: OWNER-OK #1484 abcdef1" in res.stdout
    assert "pr comment" not in log_file.read_text(encoding="utf-8")


def test_confirm_y_posts_owner_ok_marker(tmp_path: Path) -> None:
    head = "1234567890abcdef1234567890abcdef12345678"
    bin_dir, log_file = _setup_stub(
        tmp_path,
        pr_json=_base_pr(head),
        comments_json=[_desk_comment(head, "no blocker")],
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    res = subprocess.run(
        ["bash", str(SCRIPT), "1484"],
        input="y\n",
        env=env,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr
    assert "Posted: OWNER-OK #1484 1234567" in res.stdout
    assert "pr comment 1484 --repo Mahan-film/roxira-platform --body OWNER-OK #1484 1234567" in log_file.read_text(
        encoding="utf-8"
    )


def test_decline_n_aborts_without_posting(tmp_path: Path) -> None:
    head = "1234567890abcdef1234567890abcdef12345678"
    bin_dir, log_file = _setup_stub(
        tmp_path,
        pr_json=_base_pr(head),
        comments_json=[_desk_comment(head, "no blocker")],
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    res = subprocess.run(
        ["bash", str(SCRIPT), "1484"],
        input="N\n",
        env=env,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "Cancelled." in res.stdout
    assert "pr comment" not in log_file.read_text(encoding="utf-8")


def test_refuses_when_newer_blocker_comment_exists(tmp_path: Path) -> None:
    head = "abcdef1234567890abcdef1234567890abcdef12"
    bin_dir, log_file = _setup_stub(
        tmp_path,
        pr_json=_base_pr(head),
        comments_json=[
            _desk_comment(head, "no blocker"),
            {"user": {"login": "mahan-films"}, "created_at": "2026-11-25T05:20:00Z", "body": "BLOCKER: missing check"},
        ],
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    res = subprocess.run(["bash", str(SCRIPT), "--dry-run", "1484"], env=env, capture_output=True, text=True)
    assert res.returncode == 1
    assert "REFUSE:" in res.stderr
    assert "pr comment" not in log_file.read_text(encoding="utf-8")


def test_refuses_when_desk_verdict_at_head_is_blocker(tmp_path: Path) -> None:
    head = "abcdef1234567890abcdef1234567890abcdef12"
    bin_dir, _ = _setup_stub(
        tmp_path,
        pr_json=_base_pr(head),
        comments_json=[_desk_comment(head, "blocker")],
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    res = subprocess.run(["bash", str(SCRIPT), "1484"], input="y\n", env=env, capture_output=True, text=True)
    assert res.returncode == 1
    assert "blocker" in res.stderr.lower()


def test_refuses_when_head_changes_before_post(tmp_path: Path) -> None:
    head = "abcdef1234567890abcdef1234567890abcdef12"
    new_head = "9999999234567890abcdef1234567890abcdef12"
    bin_dir, log_file = _setup_stub(
        tmp_path,
        pr_json=_base_pr(head),
        comments_json=[_desk_comment(head, "no blocker")],
        second_head=new_head,
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    res = subprocess.run(["bash", str(SCRIPT), "1484"], input="y\n", env=env, capture_output=True, text=True)
    assert res.returncode == 1
    assert "head changed" in res.stderr
    assert "pr comment" not in log_file.read_text(encoding="utf-8")
