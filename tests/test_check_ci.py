"""Tests for scripts/ops/autodeploy/check_ci.py (T336 / #1285)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

CHECK_CI = Path(__file__).resolve().parents[1] / "scripts/ops/autodeploy/check_ci.py"


def _run_check_ci(sha: str, *, env: dict | None = None) -> tuple[int, str, str]:
    import os

    full_env = {**os.environ, **(env or {})}
    proc = subprocess.run(
        [sys.executable, str(CHECK_CI), sha],
        capture_output=True,
        text=True,
        env=full_env,
        timeout=15,
    )
    return proc.returncode, proc.stdout, proc.stderr


def test_override_env_returns_zero(tmp_path: Path) -> None:
    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_SKIP_CI_GATE": "1"})
    assert rc == 0
    assert "skipped: AUTODEPLOY_SKIP_CI_GATE=1" in err


def test_missing_sha_returns_three() -> None:
    rc, out, err = _run_check_ci("")
    assert rc == 3


def test_all_required_jobs_green(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    data = {
        "check_runs": [
            {"name": "Detect changes", "status": "completed", "conclusion": "success"},
            {"name": "Secret scan (new commits only)", "status": "completed", "conclusion": "success"},
            {"name": "Pytest (unit)", "status": "completed", "conclusion": "success"},
            {"name": "Frontend gate", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Undefined names", "status": "completed", "conclusion": "success"},
            {"name": "System inventory up to date", "status": "completed", "conclusion": "success"},
        ]
    }
    fixture.write_text(json.dumps(data), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 0
    assert "all required check-runs are green" in err


def test_skipped_job_is_accepted_as_green(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    data = {
        "check_runs": [
            {"name": "Detect changes", "status": "completed", "conclusion": "success"},
            {"name": "Secret scan (new commits only)", "status": "completed", "conclusion": "success"},
            {"name": "Pytest (unit)", "status": "completed", "conclusion": "skipped"},
            {"name": "Frontend gate", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "skipped"},
            {"name": "Undefined names", "status": "completed", "conclusion": "success"},
            {"name": "System inventory up to date", "status": "completed", "conclusion": "success"},
        ]
    }
    fixture.write_text(json.dumps(data), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 0
    assert "all required check-runs are green" in err


def test_pending_required_job_returns_two(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    data = {
        "check_runs": [
            {"name": "Detect changes", "status": "completed", "conclusion": "success"},
            {"name": "Secret scan (new commits only)", "status": "completed", "conclusion": "success"},
            {"name": "Pytest (unit)", "status": "in_progress", "conclusion": None},
            {"name": "Frontend gate", "status": "queued", "conclusion": None},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Undefined names", "status": "completed", "conclusion": "success"},
            {"name": "System inventory up to date", "status": "completed", "conclusion": "success"},
        ]
    }
    fixture.write_text(json.dumps(data), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 2
    assert "pending" in err


def test_missing_check_runs_returns_two(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    fixture.write_text(json.dumps({"check_runs": []}), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 2
    assert "no check-runs found" in err


def test_failed_required_job_returns_one(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    data = {
        "check_runs": [
            {"name": "Detect changes", "status": "completed", "conclusion": "success"},
            {"name": "Secret scan (new commits only)", "status": "completed", "conclusion": "success"},
            {"name": "Pytest (unit)", "status": "completed", "conclusion": "failure"},
            {"name": "Frontend gate", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Undefined names", "status": "completed", "conclusion": "success"},
            {"name": "System inventory up to date", "status": "completed", "conclusion": "success"},
        ]
    }
    fixture.write_text(json.dumps(data), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 1
    assert "failed" in err


def test_timed_out_job_returns_one(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    data = {
        "check_runs": [
            {"name": "Detect changes", "status": "completed", "conclusion": "success"},
            {"name": "Secret scan (new commits only)", "status": "completed", "conclusion": "timed_out"},
            {"name": "Pytest (unit)", "status": "completed", "conclusion": "success"},
            {"name": "Frontend gate", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Undefined names", "status": "completed", "conclusion": "success"},
            {"name": "System inventory up to date", "status": "completed", "conclusion": "success"},
        ]
    }
    fixture.write_text(json.dumps(data), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 1


def test_report_only_failure_is_ignored(tmp_path: Path) -> None:
    fixture = tmp_path / "checks.json"
    data = {
        "check_runs": [
            {"name": "Detect changes", "status": "completed", "conclusion": "success"},
            {"name": "Secret scan (new commits only)", "status": "completed", "conclusion": "success"},
            {"name": "Pytest (unit)", "status": "completed", "conclusion": "success"},
            {"name": "Frontend gate", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Backend (tsc + jest + Postgres specs)", "status": "completed", "conclusion": "success"},
            {"name": "Undefined names", "status": "completed", "conclusion": "success"},
            {"name": "System inventory up to date", "status": "completed", "conclusion": "success"},
            {"name": "Ruff (non-blocking)", "status": "completed", "conclusion": "failure"},
            {"name": "OSV-Scanner (report-only)", "status": "completed", "conclusion": "failure"},
        ]
    }
    fixture.write_text(json.dumps(data), encoding="utf-8")

    rc, out, err = _run_check_ci("abc12345", env={"AUTODEPLOY_CI_CHECK_FILE": str(fixture)})
    assert rc == 0
