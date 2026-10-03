"""Unit tests for scripts/ci/merge_gate.py (issue #351).

Pure decision logic only: no network, no keys, no gh/git calls. The module sits
under scripts/, outside pytest's ``testpaths = ["src"]``, so it is loaded by
file path here; the CLI is exercised in a subprocess so nothing loads at import.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "ci" / "merge_gate.py"

ALL_CHECKS = (
    "Detect changes",
    "Secret scan (new commits only)",
    "Pytest (unit)",
    "Frontend gate",
    "Undefined names",
    "System inventory up to date",
)


@pytest.fixture(scope="session")
def merge_gate():
    spec = importlib.util.spec_from_file_location("merge_gate", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pr(**overrides):
    pr = {
        "number": 351,
        "state": "OPEN",
        "is_draft": False,
        "author_login": "mahan-films",
        "head_ref": "issue-351",
        "head_sha": "abc123",
        "mergeable": "MERGEABLE",
        "labels": [],
        "additions": 10,
        "deletions": 5,
    }
    pr.update(overrides)
    return pr


def _checks(**conclusions):
    checks = [
        {"name": name, "status": "completed", "conclusion": conclusions.get(name, "success")}
        for name in ALL_CHECKS
    ]
    return checks


def _decide(merge_gate, pr=None, checks=None, files=None, expected_sha="abc123"):
    return merge_gate.decide(
        pr or _pr(),
        checks if checks is not None else _checks(),
        files if files is not None else ["src/ops/thing.py"],
        expected_sha=expected_sha,
        allowed_actors=["mahan-films", "github-actions[bot]"],
    )


def _reason(decision, needle):
    return any(needle in reason for reason in decision["reasons"])


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_merge_on_fully_compliant_pr(merge_gate):
    decision = _decide(merge_gate)
    assert decision == {"action": "merge", "reasons": []}


# ---------------------------------------------------------------------------
# Rule 1: open, not draft, no hold
# ---------------------------------------------------------------------------


def test_blocks_closed_pr(merge_gate):
    decision = _decide(merge_gate, pr=_pr(state="CLOSED"))
    assert decision["action"] == "block"
    assert _reason(decision, "not open")


def test_blocks_draft_pr(merge_gate):
    decision = _decide(merge_gate, pr=_pr(is_draft=True))
    assert decision["action"] == "block"
    assert _reason(decision, "draft")


def test_blocks_hold_label(merge_gate):
    decision = _decide(merge_gate, pr=_pr(labels=["hold"]))
    assert decision["action"] == "block"
    assert _reason(decision, "hold")


# ---------------------------------------------------------------------------
# Rule 2: branch shape and trusted author
# ---------------------------------------------------------------------------


def test_blocks_bad_head_ref(merge_gate):
    decision = _decide(merge_gate, pr=_pr(head_ref="feature/thing"))
    assert decision["action"] == "block"
    assert _reason(decision, "does not match ^issue-[0-9]+$")


def test_blocks_untrusted_author(merge_gate):
    decision = _decide(merge_gate, pr=_pr(author_login="random-user"))
    assert decision["action"] == "block"
    assert _reason(decision, "allowed_actors")


# ---------------------------------------------------------------------------
# Rule 3: head moved
# ---------------------------------------------------------------------------


def test_waits_when_head_moved(merge_gate):
    decision = _decide(merge_gate, expected_sha="newer456")
    assert decision["action"] == "wait"
    assert _reason(decision, "head moved")


# ---------------------------------------------------------------------------
# Rule 4: mergeability
# ---------------------------------------------------------------------------


def test_blocks_conflicting_mergeable(merge_gate):
    decision = _decide(merge_gate, pr=_pr(mergeable="CONFLICTING"))
    assert decision["action"] == "block"
    assert _reason(decision, "merge conflict")


def test_waits_on_unknown_mergeable(merge_gate):
    decision = _decide(merge_gate, pr=_pr(mergeable="UNKNOWN"))
    assert decision["action"] == "wait"
    assert _reason(decision, "mergeability unknown")


# ---------------------------------------------------------------------------
# Rule 5: required checks, Agent review, report-only jobs
# ---------------------------------------------------------------------------


def test_waits_when_required_check_missing(merge_gate):
    checks = [c for c in _checks() if c["name"] != "Pytest (unit)"]
    decision = _decide(merge_gate, checks=checks)
    assert decision["action"] == "wait"
    assert _reason(decision, "Pytest (unit)")


def test_waits_when_required_check_pending(merge_gate):
    checks = _checks(**{"Frontend gate": "success"})
    for check in checks:
        if check["name"] == "Frontend gate":
            check["status"] = "in_progress"
            check["conclusion"] = None
    decision = _decide(merge_gate, checks=checks)
    assert decision["action"] == "wait"
    assert _reason(decision, "Frontend gate")


def test_blocks_failed_required_check(merge_gate):
    decision = _decide(merge_gate, checks=_checks(**{"Pytest (unit)": "failure"}))
    assert decision["action"] == "block"
    assert _reason(decision, "Pytest (unit)")


def test_blocks_failed_extra_required_check(merge_gate):
    decision = _decide(merge_gate, checks=_checks(**{"Undefined names": "failure"}))
    assert decision["action"] == "block"
    assert _reason(decision, "Undefined names")


def test_collects_every_failing_check_reason(merge_gate):
    decision = _decide(
        merge_gate,
        checks=_checks(**{"Undefined names": "failure", "System inventory up to date": "failure"}),
    )
    assert decision["action"] == "block"
    assert _reason(decision, "Undefined names")
    assert _reason(decision, "System inventory up to date")


@pytest.mark.parametrize("conclusion", ["success", "skipped", "neutral"])
def test_agent_review_non_blocking_conclusions(merge_gate, conclusion):
    checks = _checks()
    checks.append({"name": "Agent review", "status": "completed", "conclusion": conclusion})
    assert _decide(merge_gate, checks=checks)["action"] == "merge"


def test_absent_agent_review_is_fine(merge_gate):
    assert _decide(merge_gate)["action"] == "merge"


def test_waits_while_agent_review_in_progress(merge_gate):
    checks = _checks()
    checks.append({"name": "Agent review", "status": "in_progress", "conclusion": None})
    decision = _decide(merge_gate, checks=checks)
    assert decision["action"] == "wait"
    assert _reason(decision, "agent review still running")


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out"])
def test_agent_review_rejection_blocks(merge_gate, conclusion):
    checks = _checks()
    checks.append({"name": "Agent review", "status": "completed", "conclusion": conclusion})
    decision = _decide(merge_gate, checks=checks)
    assert decision["action"] == "block"
    assert _reason(decision, "agent review rejected")


def test_report_only_check_may_be_red(merge_gate):
    checks = _checks()
    checks.append({"name": "Some report-only job", "status": "completed", "conclusion": "failure"})
    assert _decide(merge_gate, checks=checks)["action"] == "merge"


# ---------------------------------------------------------------------------
# Rule 6: size guard
# ---------------------------------------------------------------------------


def test_blocks_too_large(merge_gate):
    decision = _decide(merge_gate, pr=_pr(additions=1000, deletions=501))
    assert decision["action"] == "block"
    assert _reason(decision, "too large")


def test_allows_exactly_max_changed_lines(merge_gate):
    decision = _decide(merge_gate, pr=_pr(additions=1000, deletions=500))
    assert decision["action"] == "merge"


# ---------------------------------------------------------------------------
# Rule 7: sensitive paths and hub-approved
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        ".github/workflows/ci.yml",
        "scripts/ops/deploy.py",
        "config/models.yaml",
        "docker-compose.prod.yml",
        "nginx.conf",
        "db/migrations/0007_x.sql",
        "docker/Dockerfile",
        "src/factory_pipeline/budget.py",
        ".semgrep/rules.yml",
        "scripts/ci/merge_gate.py",
        "scripts/dev/rx",
        "output_apps/ecosystem_core/src/billing/invoice.py",
        "output_apps/ecosystem_core/src/auth/session.ts",
        "output_apps/nginx_config/default.conf",
        "output_apps/generated_modules/smartjudge/smartjudge_module.py",
        "output_apps/generated_modules/smartjudge/payment_service.py",
        "Dockerfile.prod",
    ],
)
def test_blocks_sensitive_path(merge_gate, path):
    decision = _decide(merge_gate, files=[path])
    assert decision["action"] == "block"
    assert _reason(decision, "needs label hub-approved")


@pytest.mark.parametrize(
    "path",
    [
        "src/ops/x.py",
        "output_apps/foo/ops/y.ts",
        "docs/ops/RX_AUTOMERGE.md",
    ],
)
def test_not_sensitive_when_ops_appears_midpath(merge_gate, path):
    decision = _decide(merge_gate, files=[path])
    assert decision["action"] == "merge"
    assert not _reason(decision, "hub-approved")


@pytest.mark.parametrize(
    "path",
    [
        "src/billing/test_x.py",
        "docs/ops/nginx.md",
    ],
)
def test_not_sensitive_for_lookalike_paths(merge_gate, path):
    decision = _decide(merge_gate, files=[path])
    assert decision["action"] == "merge"
    assert not _reason(decision, "hub-approved")


@pytest.mark.parametrize(
    "path",
    [
        "scripts/ops/a.sh",
        "ops/systemd/b.service",
        "db/x.sql",
    ],
)
def test_sensitive_prefix_and_suffix_matches(merge_gate, path):
    decision = _decide(merge_gate, files=[path])
    assert decision["action"] == "block"
    assert _reason(decision, "needs label hub-approved")


def test_sensitive_path_allowed_with_hub_approved(merge_gate):
    decision = _decide(
        merge_gate,
        pr=_pr(labels=["hub-approved"]),
        files=[".github/workflows/ci.yml"],
    )
    assert decision["action"] == "merge"


# ---------------------------------------------------------------------------
# Ordering: block beats wait beats merge
# ---------------------------------------------------------------------------


def test_block_beats_wait(merge_gate):
    decision = _decide(
        merge_gate,
        pr=_pr(mergeable="CONFLICTING"),
        expected_sha="newer456",
    )
    assert decision["action"] == "block"
    assert not _reason(decision, "head moved")


def test_wait_beats_merge(merge_gate):
    checks = _checks()
    for check in checks:
        if check["name"] == "Pytest (unit)":
            check["status"] = "queued"
            check["conclusion"] = None
    decision = _decide(merge_gate, checks=checks)
    assert decision["action"] == "wait"
    assert _reason(decision, "Pytest (unit)")


def test_block_beats_wait_when_check_fails_and_head_moved(merge_gate):
    decision = _decide(
        merge_gate,
        checks=_checks(**{"Pytest (unit)": "failure"}),
        expected_sha="newer456",
    )
    assert decision["action"] == "block"
    assert not _reason(decision, "head moved")


# ---------------------------------------------------------------------------
# CLI (subprocess; module must load nothing at import time)
# ---------------------------------------------------------------------------


def test_cli_prints_decision_and_writes_github_output(merge_gate, tmp_path):
    pr_path = tmp_path / "pr.json"
    checks_path = tmp_path / "checks.json"
    files_path = tmp_path / "files.txt"
    output_path = tmp_path / "github_output"
    pr_path.write_text(json.dumps(_pr()), encoding="utf-8")
    checks_path.write_text(json.dumps(_checks()), encoding="utf-8")
    files_path.write_text("src/ops/thing.py\n", encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--pr",
            str(pr_path),
            "--checks",
            str(checks_path),
            "--files",
            str(files_path),
            "--expected-sha",
            "abc123",
            "--actors",
            "mahan-films,github-actions[bot]",
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        env={**os.environ, "GITHUB_OUTPUT": str(output_path)},
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"action": "merge", "reasons": []}
    written = output_path.read_text(encoding="utf-8")
    assert "action=merge" in written
    assert "reasons=" in written
