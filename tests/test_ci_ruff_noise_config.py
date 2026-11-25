"""Regression tests for CI ruff PR-noise configuration (25d #1 + 25e 2a)."""

import tomllib
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_ci_workflow() -> dict:
    ci_path = REPO_ROOT / ".github" / "workflows" / "ci.yml"
    return yaml.safe_load(ci_path.read_text(encoding="utf-8"))


def test_ruff_job_uses_check_reporter_and_no_pr_comment() -> None:
    wf = _load_ci_workflow()
    ruff_job = wf["jobs"]["ruff"]

    perms = ruff_job["permissions"]
    assert perms.get("checks") == "write"
    assert perms.get("pull-requests") == "read"
    assert perms.get("contents") == "read"

    steps = ruff_job["steps"]
    reviewdog_steps = [
        s for s in steps if s.get("name") == "Reviewdog inline comments for ruff"
    ]
    assert len(reviewdog_steps) == 1
    run_cmd = reviewdog_steps[0]["run"]
    assert "-reporter=github-pr-check" in run_cmd
    assert "-reporter=github-pr-review" not in run_cmd

    all_step_runs = "\n".join(s.get("run", "") for s in steps)
    assert "ci-ruff-count" not in all_step_runs
    assert "gh pr comment" not in all_step_runs
    assert "GITHUB_STEP_SUMMARY" in all_step_runs


def test_semgrep_reviewdog_reporter_unchanged() -> None:
    wf = _load_ci_workflow()
    semgrep_job = wf["jobs"]["semgrep"]
    all_step_runs = "\n".join(s.get("run", "") for s in semgrep_job["steps"])
    assert '-name="semgrep" -reporter=github-pr-review' in all_step_runs


def test_pyproject_ignores_ambiguous_unicode_ruff_rules() -> None:
    pyproject_path = REPO_ROOT / "pyproject.toml"
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    ignored = set(data["tool"]["ruff"]["lint"].get("ignore", []))
    assert {"RUF001", "RUF002", "RUF003"}.issubset(ignored)
