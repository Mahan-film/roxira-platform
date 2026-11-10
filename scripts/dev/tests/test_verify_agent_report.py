"""Offline tests for scripts/dev/verify_agent_report.py (fixture dicts only, no gh/git)."""

import importlib.util
import pathlib

_p = pathlib.Path(__file__).resolve().parents[1] / "verify_agent_report.py"
_spec = importlib.util.spec_from_file_location("verify_agent_report", _p)
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)

SHA = "e0df414d1234567890abcdef1234567890abcdef"

REPORT = """REPORT WAVE 5 2026-11-12
DONE:
T60 | PR #675 @ e0df414d | MERGEABLE | CI green | review: no blocker
  files: a.ts, b.ts
  tests: npx jest x => 12/12
  not checked: nothing
T41 | PR #665 | MERGED | CI green | not checked: x
SKIPPED:
T65 | done in output_apps/enterprise_hub/modules/accounting/services/fiscal-year.service.ts (fiscal-years.pg.spec.ts)
T66 | nothing to do
BLOCKED:
T70 | needs owner
"""


def pr_json(**kw):
    base = {
        "number": 675, "state": "OPEN", "headRefOid": SHA, "mergeable": "MERGEABLE",
        "createdAt": "2026-11-12T01:00:00Z", "updatedAt": "2026-11-12T02:00:00Z",
        "statusCheckRollup": [{"status": "COMPLETED", "conclusion": "SUCCESS"}],
        "comments": [{"body": "Cross-family review of e0df414\nVerdict: no blocker"}],
    }
    base.update(kw)
    return base


def row(**kw):
    base = {"task": "T60", "pr": 675, "sha": "e0df414d", "state": "MERGEABLE", "ci": "green",
            "review": "no blocker", "tests": "jest 12/12"}
    base.update(kw)
    return base


def test_parse_both_forms():
    r = v.parse_report(REPORT)
    assert len(r["done"]) == 2
    a, b = r["done"]
    assert (a["task"], a["pr"], a["sha"], a["state"], a["ci"], a["review"]) == (
        "T60", 675, "e0df414d", "MERGEABLE", "green", "no blocker")
    assert a["tests"] == "npx jest x => 12/12"
    assert (b["pr"], b["sha"], b["state"], b["review"], b["tests"]) == (665, None, "MERGED", None, None)


def test_parse_skipped_blocked():
    r = v.parse_report(REPORT)
    assert r["skipped"][0]["path"].endswith("fiscal-year.service.ts")
    assert r["skipped"][1]["path"] is None
    assert r["blocked"][0]["task"] == "T70"


def test_derive_ci():
    assert v.derive_ci([]) == "none"
    assert v.derive_ci([{"status": "COMPLETED", "conclusion": "SUCCESS"}]) == "green"
    assert v.derive_ci([{"status": "IN_PROGRESS", "conclusion": ""}]) == "pending"
    assert v.derive_ci([{"status": "COMPLETED", "conclusion": "FAILURE"},
                        {"status": "QUEUED"}]) == "red"
    assert v.derive_ci([{"status": "COMPLETED", "conclusion": "CANCELLED"}]) == "red"


def test_latest_review():
    ok = {"body": "Cross-family review of e0df414\nVerdict: no blocker"}
    bad = {"body": "Cross-family review of e0df414\nVerdict: blocker - x"}
    old = {"body": "Cross-family review of 1111111\nVerdict: no blocker"}
    assert v.latest_review([ok], SHA) == "no blocker"
    assert v.latest_review([ok, bad], SHA) == "blocker"
    assert v.latest_review([bad, ok], SHA) == "no blocker"
    assert v.latest_review([ok, old], SHA) == "stale"
    assert v.latest_review([{"body": "lgtm"}], SHA) == "none yet"


def test_compare_clean():
    assert v.compare(row(), pr_json(), "2026-11-10") == []


def test_compare_not_found():
    assert v.compare(row(), None, None) == ["PR not found"]


def test_compare_sha_mismatch():
    assert any("sha mismatch" in p for p in v.compare(row(sha="deadbeef"), pr_json(), None))


def test_compare_mergeable_but_merged():
    probs = v.compare(row(), pr_json(state="MERGED"), None)
    assert any("claimed MERGEABLE" in p for p in probs)


def test_compare_ci_pending():
    pj = pr_json(statusCheckRollup=[{"status": "IN_PROGRESS"}])
    assert any("claimed CI green" in p for p in v.compare(row(), pj, None))


def test_compare_blocker_even_if_unclaimed():
    pj = pr_json(comments=[{"body": "Cross-family review of e0df414\nVerdict: blocker"}])
    probs = v.compare(row(review=None), pj, None)
    assert any("blocker" in p for p in probs)


def test_compare_old_pr():
    pj = pr_json(updatedAt="2026-11-01T00:00:00Z")
    assert any("older than this wave" in p for p in v.compare(row(), pj, "2026-11-10"))


def test_compare_missing_tests():
    assert "no test evidence" in v.compare(row(tests=None), pr_json(), None)


def test_check_skipped():
    assert v.check_skipped({"task": "T", "path": None}, lambda p: True)
    assert v.check_skipped({"task": "T", "path": "a/b.ts"}, lambda p: False)
    assert v.check_skipped({"task": "T", "path": "a/b.ts"}, lambda p: True) == []
