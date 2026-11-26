"""Offline unit tests for scripts/dev/wave_gen.py using fake JSON fixtures only."""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "wave_gen.py"
spec = importlib.util.spec_from_file_location("wave_gen", SCRIPT)
wave_gen = importlib.util.module_from_spec(spec)
sys.modules["wave_gen"] = wave_gen
spec.loader.exec_module(wave_gen)


def _issue(num: int, lane: str, *, prio: int = 2, labels: list[str] | None = None, body: str = "") -> dict:
    all_labels = [f"lane:{lane}", f"prio:{prio}", *(labels or [])]
    return {
        "number": num,
        "title": f"Task {num}",
        "body": body or f"Done when: tests pass for #{num}",
        "state": "OPEN",
        "labels": [{"name": name} for name in all_labels],
    }


def _pr(num: int, lane: str, *, labels: list[str] | None = None, title: str = "PR") -> dict:
    return {
        "number": num,
        "title": title,
        "state": "OPEN",
        "headRefName": f"agent/antigravity-{lane.lower()}-mahan-films/{num}-slug",
        "labels": [{"name": name} for name in (labels or [])],
    }


def test_skips_needs_human_and_unmerged_after_deps():
    issues = [
        _issue(101, "L1", prio=1),
        _issue(102, "L1", prio=1, labels=["needs-human"]),
        _issue(103, "L1", prio=1, body="Blocked after T900\nDone when: green"),
        _issue(104, "L1", prio=2, body="Follow-up after #888\nDone when: ok"),
    ]
    out = wave_gen.build_wave(
        issues,
        [],
        merged_refs={888},
        wave_number=39,
        wave_date="2026-11-25",
    )
    assert "## WAVE 39 (wave_gen, 2026-11-25)" in out
    assert "#101" in out
    assert "#104" in out
    # #102 and #103 appear only under Skipped, not in L1 queue rows
    queue_section = out.split("### Skipped")[0]
    assert "#102" not in queue_section
    assert "#103" not in queue_section
    assert "`needs-human`: #102" in out
    assert "#103 waiting on #900" in out


def test_wip_limit_8_and_max_6_rows_per_lane():
    issues = [_issue(200 + i, "L2", prio=1) for i in range(10)]
    issues += [_issue(300 + i, "L3", prio=1) for i in range(4)]
    prs = [_pr(1000 + i, "L3") for i in range(8)]  # L3 at 8/8 WIP
    # WAITING-OWNER / needs-human PRs do not count toward L2's WIP cap
    prs += [_pr(1100 + i, "L2", labels=["needs-human"]) for i in range(4)]

    out = wave_gen.build_wave(issues, prs, wave_number=40, wave_date="2026-11-25")
    l2_block = out.split("- **L2**")[1].split("- **L3**")[0]
    l3_block = out.split("- **L3**")[1]
    for idx in range(6):
        assert f"#{200 + idx}" in l2_block
    assert "#206" not in l2_block
    assert "WIP limit 8 reached" in l3_block
    assert "#300" not in l3_block


def test_cli_dry_run_default_and_post_gated_by_wave_posters(tmp_path: Path):
    issues_file = tmp_path / "issues.json"
    prs_file = tmp_path / "prs.json"
    issues_file.write_text(json.dumps([_issue(55, "L1", prio=1)]), encoding="utf-8")
    prs_file.write_text(json.dumps([]), encoding="utf-8")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    posted_flag = tmp_path / "posted.txt"
    gh_stub = bin_dir / "gh"
    gh_stub.write_text(
        f"""#!/usr/bin/env bash
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo "mahan-films"
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then
  echo "$*" > "{posted_flag}"
  echo "https://github.com/Mahan-film/roxira-platform/issues/592#issuecomment-1"
  exit 0
fi
exit 1
""",
        encoding="utf-8",
    )
    gh_stub.chmod(gh_stub.stat().st_mode | stat.S_IXUSR)
    base_env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    base_env.pop("WAVE_POSTERS", None)

    # Default (no --post): prints dry-run wave, does not invoke gh issue comment
    dry = subprocess.run(
        [sys.executable, str(SCRIPT), "--issues-file", str(issues_file), "--prs-file", str(prs_file)],
        env=base_env,
        capture_output=True,
        text=True,
    )
    assert dry.returncode == 0, dry.stderr
    assert "## WAVE 1" in dry.stdout
    assert not posted_flag.exists()

    # --post without WAVE_POSTERS fails closed
    denied = subprocess.run(
        [sys.executable, str(SCRIPT), "--post", "--issues-file", str(issues_file), "--prs-file", str(prs_file)],
        env=base_env,
        capture_output=True,
        text=True,
    )
    assert denied.returncode == 1
    assert "not authorized in WAVE_POSTERS" in denied.stderr
    assert not posted_flag.exists()

    # --post with matching login in WAVE_POSTERS succeeds
    allowed_env = {**base_env, "WAVE_POSTERS": "other-user,mahan-films"}
    ok = subprocess.run(
        [sys.executable, str(SCRIPT), "--post", "--issues-file", str(issues_file), "--prs-file", str(prs_file)],
        env=allowed_env,
        capture_output=True,
        text=True,
    )
    assert ok.returncode == 0, ok.stderr
    assert posted_flag.exists()
