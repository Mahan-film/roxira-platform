from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import merge_desk as md  # noqa: E402

HEAD = "abcdef1234567890"


def _pr(
    number: int = 101,
    *,
    title: str = "feat: sample",
    is_draft: bool = False,
    head_oid: str = HEAD,
    mergeable: str = "MERGEABLE",
    merge_state: str = "CLEAN",
    labels: list[str] | None = None,
    comments: list[str] | None = None,
    checks: list[dict] | None = None,
) -> dict:
    if comments is None:
        comments = [f"Cross-family review @ {head_oid[:7]}\nVerdict: no blocker"]
    if checks is None:
        checks = [{"__typename": "CheckRun", "name": "CI", "status": "COMPLETED", "conclusion": "SUCCESS"}]
    return {
        "number": number,
        "title": title,
        "isDraft": is_draft,
        "headRefOid": head_oid,
        "headRefName": f"feat/{number}",
        "baseRefName": "main",
        "mergeable": mergeable,
        "mergeStateStatus": merge_state,
        "labels": [{"name": lbl} for lbl in (labels or [])],
        "comments": [{"body": body} for body in comments],
        "statusCheckRollup": checks,
    }


def test_skips_draft() -> None:
    d = md.evaluate_pr(_pr(is_draft=True))
    assert d.action == "skip"


def test_skips_needs_human_and_needs_owner() -> None:
    assert md.evaluate_pr(_pr(labels=["needs-human"])).action == "skip"
    assert md.evaluate_pr(_pr(labels=["[needs owner]"])).action == "skip"
    assert md.evaluate_pr(_pr(title="[needs owner] ops change")).action == "skip"


def test_skips_blocker_or_stale_or_missing_verdict() -> None:
    assert md.evaluate_pr(_pr(comments=[])).action == "skip"
    assert md.evaluate_pr(_pr(comments=[f"Review @ {HEAD[:7]}\nVerdict: blocker"])).action == "skip"
    assert md.evaluate_pr(_pr(comments=["Review @ 1111111\nVerdict: no blocker"])).action == "skip"


def test_skips_failing_pending_or_empty_checks() -> None:
    assert md.evaluate_pr(_pr(checks=[])).action == "skip"
    assert (
        md.evaluate_pr(
            _pr(checks=[{"__typename": "CheckRun", "name": "CI", "status": "IN_PROGRESS", "conclusion": ""}])
        ).action
        == "skip"
    )
    assert (
        md.evaluate_pr(
            _pr(checks=[{"__typename": "CheckRun", "name": "CI", "status": "COMPLETED", "conclusion": "FAILURE"}])
        ).action
        == "skip"
    )


def test_rebases_when_behind_and_skips_with_no_rebase() -> None:
    behind = _pr(merge_state="BEHIND")
    assert md.evaluate_pr(behind, allow_rebase=True).action == "rebase"
    assert md.evaluate_pr(behind, allow_rebase=False).action == "skip"


def test_run_once_merges_at_most_one_and_notifies() -> None:
    prs = [_pr(101, title="first"), _pr(102, title="second")]
    calls: list[list[str]] = []
    sent: list[str] = []

    def fake_runner(args: list[str], repo: str | None = None) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args[:2] == ["pr", "list"]:
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(prs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    rc = md.run_once(
        repo="Mahan-film/roxira-platform",
        dry_run=False,
        runner=fake_runner,
        notifier=lambda msg: sent.append(msg) or True,
    )
    assert rc == 0
    assert ["pr", "merge", "101", "--squash"] in calls
    assert ["pr", "merge", "102", "--squash"] not in calls
    assert len(sent) == 1
    assert "#101" in sent[0]


def test_run_once_dry_run_never_merges_or_notifies() -> None:
    prs = [_pr(101)]
    calls: list[list[str]] = []
    sent: list[str] = []

    def fake_runner(args: list[str], repo: str | None = None) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout=json.dumps(prs), stderr="")

    rc = md.run_once(dry_run=True, runner=fake_runner, notifier=lambda msg: sent.append(msg) or True)
    assert rc == 0
    assert len(calls) == 1  # only pr list
    assert sent == []
