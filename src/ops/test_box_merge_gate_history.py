"""Tests for the box merge gate additions (scripts/ops/ci_box/merge_gate): hold rules, review authors by
numeric id, the dry-run history comparison and the dry-run pointer of the direct-push alert.

Stdlib unittest, no network (gh is a fake callable). The modules are loaded lazily and under their own
names because scripts/ci/merge_gate.py (another module) is also called `merge_gate`.
"""
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE_DIR = ROOT / "scripts/ops/ci_box/merge_gate"
mg = ch = cmp_ = None

HEAD = "a" * 40
BOT_ID, HUMAN_ID, OTHER_ID = 111, 222, 333
CHECKS = ["c1", "c2"]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def setUpModule():
    global mg, ch, cmp_
    saved_path, saved_mod = list(sys.path), sys.modules.get("merge_gate")
    try:
        mg = _load("merge_gate", GATE_DIR / "merge_gate.py")  # siblings import it under this name
        ch = _load("box_compare_history", GATE_DIR / "compare_history.py")
        cmp_ = _load("box_check_main_push", GATE_DIR / "check_main_push.py")
    finally:
        sys.path[:] = saved_path
        if saved_mod is not None:
            sys.modules["merge_gate"] = saved_mod
        else:
            sys.modules.pop("merge_gate", None)


def cfg(**kw):
    c = mg.load_config(None)
    c.update(required_checks=CHECKS, **kw)
    return c


def review(verdict="no blocker", uid=BOT_ID, head=HEAD, login="github-actions[bot]", at="2026-01-01T00:00:00Z"):
    return {
        "body": f"Cross-family review (m, family x) @ {head}\n\nVerdict: {verdict}",
        "user": {"login": login, "id": uid},
        "created_at": at,
    }


def run(name, conclusion="success"):
    return {"name": name, "status": "completed", "conclusion": conclusion, "id": 1}


class FakeApi:
    def __init__(self, comments=(), runs=None, files=None, behind=0, merged_prs=None):
        self.comments = list(comments)
        self.runs = runs if runs is not None else [run(n) for n in CHECKS]
        self.files = files or [{"filename": "docs/x.md"}]
        self.behind = behind
        self.merged = merged_prs if merged_prs is not None else [{"number": 7, "merged_at": "2026-01-02T00:00:00Z"}]
        self.calls = []

    def __call__(self, method, path, fields=None, paginate=False):
        self.calls.append((method, path))
        if "pulls?state=closed" in path:
            return list(self.merged) if "page=1" in path else []
        if path.endswith("/pulls/7"):
            return {
                "number": 7, "title": "x", "labels": [], "merged_at": "2026-01-02T00:00:00Z",
                "merge_commit_sha": "m" * 40, "merged_by": {"id": 9}, "head": {"sha": HEAD},
            }
        if path.endswith("/files?per_page=100"):
            return self.files
        if "/comments?" in path:
            return list(self.comments)
        if "/check-runs" in path:
            return [{"check_runs": self.runs}]
        if "/commits/" in path:
            return {"parents": [{"sha": "p" * 40}]}
        if "/compare/" in path:
            return {"behind_by": self.behind}
        raise AssertionError(path)


class HoldAndAuthorRules(unittest.TestCase):
    def gate(self, api=None, **kw):
        return mg.Gate(cfg(**kw), api or FakeApi(), mg.State(os.devnull), True)

    def test_label_and_title_hold(self):
        g = self.gate()
        self.assertIn("needs-human", g.hold_reason({"number": 1, "title": "ok"}, {"needs-human"}))
        self.assertIn("[needs owner]", g.hold_reason({"number": 1, "title": "Fix [Needs Owner] thing"}, set()))
        self.assertEqual("", g.hold_reason({"number": 1, "title": "ok"}, set()))

    def test_blocker_comment_from_allowlisted_id_holds_until_unblock(self):
        def c(body, uid):
            return {"body": body, "user": {"id": uid}}

        g = self.gate(FakeApi(comments=[c("BLOCKER: schema", HUMAN_ID)]), approver_ids=[HUMAN_ID])
        self.assertTrue(g.hold_reason({"number": 1, "title": "t"}, set()))
        g = self.gate(FakeApi(comments=[c("BLOCKER: x", HUMAN_ID), c("unblock: fixed", HUMAN_ID)]), approver_ids=[HUMAN_ID])
        self.assertEqual("", g.hold_reason({"number": 1, "title": "t"}, set()))
        g = self.gate(FakeApi(comments=[c("BLOCKER: x", OTHER_ID)]), approver_ids=[HUMAN_ID])
        self.assertEqual("", g.hold_reason({"number": 1, "title": "t"}, set()), "non-allowlisted id is ignored")

    def test_review_author_ids_replace_login_check(self):
        spoof = review(uid=OTHER_ID)  # right login, wrong id
        ok, _ = self.gate(FakeApi(comments=[spoof])).review_ok(1, HEAD)
        self.assertTrue(ok, "login-only mode still trusts the login (documented gap)")
        g = self.gate(FakeApi(comments=[spoof]), review_comment_author_ids=[BOT_ID])
        self.assertFalse(g.review_ok(1, HEAD)[0])
        g = self.gate(FakeApi(comments=[review(uid=BOT_ID, login="renamed")]), review_comment_author_ids=[BOT_ID])
        self.assertTrue(g.review_ok(1, HEAD)[0])

    def test_blocker_verdict_and_other_head_are_refused(self):
        self.assertFalse(self.gate(FakeApi(comments=[review("blocker")])).review_ok(1, HEAD)[0])
        self.assertFalse(self.gate(FakeApi(comments=[review(head="b" * 40)])).review_ok(1, HEAD)[0])


class UpToDateRule(unittest.TestCase):
    def evaluate(self, **kw):
        pr = {
            "number": 7, "title": "t", "labels": [{"name": "merge-queue"}], "draft": False,
            "base": {"ref": "main"}, "head": {"sha": HEAD}, "mergeable_state": "clean",
        }
        api = FakeApi(comments=[review()], behind=2)
        return mg.Gate(cfg(**kw), api, mg.State(os.devnull), True).evaluate(pr)[0]

    def test_behind_pr_merges_by_default_and_waits_when_required(self):
        # decision B7-2: the default is false, a green head that is only behind main merges
        self.assertEqual(self.evaluate(), mg.MERGE)
        self.assertEqual(self.evaluate(require_up_to_date=False), mg.MERGE)
        self.assertEqual(self.evaluate(require_up_to_date=True), mg.BEHIND)

    def test_hold_label_wins_over_green_checks(self):
        pr = {"number": 7, "title": "t", "labels": [{"name": "merge-queue"}, {"name": "needs-human"}],
              "draft": False, "base": {"ref": "main"}, "head": {"sha": HEAD}, "mergeable_state": "clean"}
        st, code, _ = mg.Gate(cfg(), FakeApi(comments=[review()]), mg.State(os.devnull), True).evaluate(pr)
        self.assertEqual((st, code), (mg.REFUSE, "hold"))


class HistoryComparison(unittest.TestCase):
    def report(self, api, **kw):
        return ch.build_report(cfg(**kw), ch.ReadOnlyAsOf(api), 5)

    def test_clean_merged_pr_would_merge(self):
        rep = self.report(FakeApi(comments=[review()]))
        self.assertEqual(rep["summary"]["agree_would_merge"], 1)
        self.assertEqual(rep["summary"]["merged_but_gate_blocks"], 0)

    def test_failures_are_reported_per_rule(self):
        api = FakeApi(
            comments=[],
            runs=[run("c1"), run("c2", "failure")],
            files=[{"filename": ".github/workflows/ci.yml"}],
            behind=3,
        )
        rep = self.report(api, require_up_to_date=True)
        s = rep["summary"]
        self.assertEqual(s["merged_but_gate_blocks"], 1)
        self.assertEqual(set(s["blocked_by_rule"]), {"protected", "review", "checks", "behind"})
        md = ch.render_md(rep)
        self.assertIn("WOULD BLOCK", md)
        self.assertIn("#7", md)

    def test_comments_after_the_merge_are_ignored(self):
        late = review(at="2026-02-01T00:00:00Z")  # posted after merged_at
        rep = self.report(FakeApi(comments=[late]))
        self.assertEqual(rep["summary"]["blocked_by_rule"].get("review"), 1)

    def test_check_runs_started_after_the_merge_are_ignored(self):
        late_fail = dict(run("c2", "failure"), id=2, started_at="2026-03-01T00:00:00Z")
        rep = self.report(FakeApi(comments=[review()], runs=[run("c1"), run("c2"), late_fail]))
        self.assertEqual(rep["summary"]["merged_but_gate_blocks"], 0)

    def test_behind_is_informational_when_up_to_date_is_not_required(self):
        api = FakeApi(comments=[review()], behind=4)
        self.assertEqual(self.report(api, require_up_to_date=True)["summary"]["blocked_by_rule"], {"behind": 1})
        self.assertEqual(self.report(api)["summary"]["merged_but_gate_blocks"], 0)  # default since B7-2
        self.assertEqual(self.report(api, require_up_to_date=False)["summary"]["merged_but_gate_blocks"], 0)

    def test_only_get_requests_are_ever_sent(self):
        api = FakeApi(comments=[review()])
        self.report(api)
        self.assertTrue(api.calls and all(m == "GET" for m, _ in api.calls))
        with self.assertRaises(mg.GhError):
            ch.ReadOnlyAsOf(api)("PUT", "repos/o/r/pulls/1/merge")


class DryRunPointer(unittest.TestCase):
    def test_dry_run_writes_only_its_own_pointer(self):
        class Api:
            def __call__(self, method, path, fields=None, paginate=False):
                return {"sha": "c" * 40}

        with tempfile.TemporaryDirectory() as d:
            sent = []
            rc = cmp_.check({"repo": "o/r", "base": "main"}, Api(), Path(d), True, sent.append)
            self.assertEqual(rc, 0)
            self.assertEqual(sorted(p.name for p in Path(d).iterdir()), [cmp_.STATE_FILE + ".dryrun"])
            self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main()
