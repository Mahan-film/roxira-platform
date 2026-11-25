"""Tests for decision B7 in the box merge gate (scripts/ops/ci_box/merge_gate): protected paths are class
"owner sentence required" and are released only by an `OWNER-OK #<PR> <head sha7>` comment from a configured owner id.

Stdlib unittest, fixtures only (gh is a fake callable, no network). The gate module is loaded lazily and under its own
name because scripts/ci/merge_gate.py (another module) is also called `merge_gate`.
"""
import importlib.util
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE_DIR = ROOT / "scripts/ops/ci_box/merge_gate"
mg = ch = None

HEAD = "a" * 40
BOT_ID, OWNER_ID, OTHER_ID = 111, 222, 333
CHECKS = ["c1", "c2"]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def setUpModule():
    global mg, ch
    saved_path, saved_mod = list(sys.path), sys.modules.get("merge_gate")
    try:
        mg = _load("merge_gate", GATE_DIR / "merge_gate.py")
        ch = _load("box_compare_history_b7", GATE_DIR / "compare_history.py")
    finally:
        sys.path[:] = saved_path
        if saved_mod is not None:
            sys.modules["merge_gate"] = saved_mod
        else:
            sys.modules.pop("merge_gate", None)


def cfg(**kw):
    c = mg.load_config(None)
    c.update(required_checks=CHECKS, review_comment_author_ids=[BOT_ID], owner_approver_ids=[OWNER_ID], **kw)
    return c


def review(head=HEAD):
    return {"body": f"Cross-family review (m, family x) @ {head}\n\nVerdict: no blocker",
            "user": {"login": "bot", "id": BOT_ID}, "created_at": "2026-01-01T00:00:00Z"}


def owner(body="OWNER-OK #7 " + HEAD[:7], uid=OWNER_ID):
    return {"body": body, "user": {"login": "o", "id": uid}, "created_at": "2026-01-01T00:00:01Z"}


class FakeApi:
    def __init__(self, files, comments=(), n_files=None):
        self.files = [{"filename": f} for f in files]
        if n_files:
            self.files += [{"filename": f"docs/f{i}.md"} for i in range(n_files)]
        self.comments = list(comments)
        self.calls = []

    def __call__(self, method, path, fields=None, paginate=False):
        self.calls.append((method, path, fields))
        if method in ("PUT", "POST"):
            return {"sha": "b" * 40}
        if path.endswith("/files?per_page=100"):
            return self.files
        if "/comments?" in path:
            return list(self.comments)
        if "/check-runs" in path:
            return [{"check_runs": [{"name": n, "status": "completed", "conclusion": "success", "id": 1} for n in CHECKS]}]
        if "/compare/" in path:
            return {"behind_by": 0}
        raise AssertionError(path)

    def did(self, method, suffix):
        return [c for c in self.calls if c[0] == method and c[1].endswith(suffix)]


def pr(n=7):
    return {"number": n, "title": "t", "labels": [{"name": "merge-queue"}], "draft": False,
            "base": {"ref": "main"}, "head": {"sha": HEAD}, "mergeable_state": "clean"}


def evaluate(files, comments=(), n_files=None, **kw):
    api = FakeApi(files, [review()] + list(comments), n_files)
    st, code, why = mg.Gate(cfg(**kw), api, mg.State(os.devnull), True).evaluate(pr())
    return st, code, why


class ProtectedGlobs(unittest.TestCase):
    def hit(self, path):
        return bool(mg.protected_hits([{"filename": path}], mg.DEFAULTS["protected_globs"]))

    def test_protected_examples(self):
        for p in (
            "output_apps/enterprise_hub/migrations/1789900018000-X.ts", "migrations/1.sql",
            "output_apps/enterprise_hub/modules/invoicing/services/payment-gateway.adapter.ts",
            "src/billing/ledger.py", "output_apps/ecosystem_core/src/billing/x.py",
            "output_apps/enterprise_hub/modules/auth/services/login.service.ts",
            "output_apps/generated_modules/unifiedauth/x.py",
            "Dockerfile.prod", "docker-compose.prod.yml", "scripts/ops/deploy.sh", "scripts/ops/pull-deploy.sh",
            "scripts/ops/autodeploy/autodeploy.sh", "deploy/systemd/roxira-backup.service",
            ".github/workflows/ci.yml",
            "scripts/ops/ci_box/merge_gate/merge_gate.py", "scripts/ops/ci_box/merge_gate/merge_gate.example.toml",
            "src/ops/test_box_merge_gate_b7.py", "src/ops/test_merge_gate_run.py", "docs/ops/MERGE_GATE_SPEC.md",
        ):
            self.assertTrue(self.hit(p), p)

    def test_unprotected_examples(self):
        for p in ("docs/ops/AUTO_MERGE.md", "docs/migrations_notes.md", "src/ops/test_orch.py", "README.md",
                  "docker-compose.yml", "scripts/ops/deploy/x.sh", "docs/authors.md", "src/crm_agents/x.py"):
            self.assertFalse(self.hit(p), p)

    def test_example_toml_and_code_default_do_not_drift(self):
        with open(GATE_DIR / "merge_gate.example.toml", "rb") as fh:
            ex = tomllib.load(fh)
        self.assertEqual(ex["protected_globs"], mg.DEFAULTS["protected_globs"])
        self.assertEqual(ex["owner_approver_ids"], [])
        self.assertNotIn("owner_label", ex)

    def test_config_replaces_the_list(self):
        st, code, _ = evaluate(["Dockerfile.prod"], protected_globs=["nothing/**"])
        self.assertEqual(st, mg.MERGE)


class OwnerSentence(unittest.TestCase):
    def test_protected_pr_without_marker_is_owner_class_not_merge(self):
        st, code, why = evaluate(["output_apps/enterprise_hub/migrations/1.ts"])
        self.assertEqual((st, code), (mg.OWNER, "owner"))
        self.assertIn("owner sentence required", why)
        self.assertIn("OWNER-OK #7 aaaaaaa", why)

    def test_unprotected_pr_merges_without_marker(self):
        self.assertEqual(evaluate(["docs/x.md"])[0], mg.MERGE)

    def test_marker_from_owner_id_for_this_head_releases(self):
        self.assertEqual(evaluate(["Dockerfile.prod"], [owner()])[0], mg.MERGE)
        long_sha = owner("Approved.\nOWNER-OK #7 " + HEAD[:20].upper() + "\nthanks")
        self.assertEqual(evaluate(["Dockerfile.prod"], [long_sha])[0], mg.MERGE)

    def test_wrong_author_pr_or_head_is_rejected(self):
        for c in (owner(uid=OTHER_ID), owner(uid=BOT_ID), owner("OWNER-OK #8 " + HEAD[:7]),
                  owner("OWNER-OK #7 " + "b" * 7), owner("OWNER-OK #7 aaaaaa")):  # last: 6 chars, too short
            self.assertEqual(evaluate([".github/workflows/ci.yml"], [c])[0], mg.OWNER, c["body"])

    def test_marker_must_start_a_line(self):
        for body in ("> OWNER-OK #7 aaaaaaa", "please OWNER-OK #7 aaaaaaa", "OWNER-OK #7 aaaaaaa and more"):
            self.assertEqual(evaluate(["Dockerfile.prod"], [owner(body)])[0], mg.OWNER, body)

    def test_fails_closed_without_owner_ids(self):
        api = FakeApi(["Dockerfile.prod"], [review(), owner()])
        c = cfg()
        c["owner_approver_ids"] = []
        self.assertEqual(mg.Gate(c, api, mg.State(os.devnull), True).evaluate(pr())[0], mg.OWNER)

    def test_marker_does_not_skip_the_other_rules(self):
        api = FakeApi(["Dockerfile.prod"], [owner()])  # no review comment
        st, code, _ = mg.Gate(cfg(), api, mg.State(os.devnull), True).evaluate(pr())
        self.assertEqual((st, code), (mg.REFUSE, "review"))

    def test_truncated_file_list_needs_owner_sentence(self):
        self.assertEqual(evaluate(["docs/x.md"], n_files=mg.PR_FILES_CAP)[0], mg.OWNER)

    def test_owner_label_no_longer_counts(self):
        p = pr()
        p["labels"].append({"name": "owner-approved"})
        api = FakeApi(["Dockerfile.prod"], [review()])
        self.assertEqual(mg.Gate(cfg(), api, mg.State(os.devnull), True).evaluate(p)[0], mg.OWNER)


class TickBehaviour(unittest.TestCase):
    def gate(self, api, dry=False, d="/nonexistent"):
        api.prs = [pr()]
        orig = api.__call__

        def call(method, path, fields=None, paginate=False):
            if "/pulls?state=open" in path:
                return [pr()]
            if path.endswith("/pulls/7"):
                return pr()
            return orig(method, path, fields, paginate)

        return mg.Gate(dict(cfg(), queue_mode="legacy"), call, mg.State(os.devnull), dry), api

    def test_owner_class_never_merges_and_is_reported_once_per_head(self):
        api = FakeApi(["scripts/ops/deploy.sh"], [review()])
        g, api = self.gate(api)
        for _ in range(3):
            self.assertIsNone(g.tick())
        self.assertFalse(api.did("PUT", "/merge"))
        self.assertFalse(api.did("PUT", "/update-branch"))
        posts = api.did("POST", "/comments")
        self.assertEqual(len(posts), 1)
        body = posts[0][2]["body"]
        self.assertIn("owner sentence required", body)
        self.assertTrue(all(not ln.upper().startswith("OWNER-OK") for ln in body.splitlines()))

    def test_gate_comment_can_never_self_approve(self):
        api = FakeApi(["scripts/ops/deploy.sh"], [review()])
        g, api = self.gate(api)
        g.tick()
        posted = api.did("POST", "/comments")[0][2]["body"]
        # Even if the gate's own comment is posted by an owner-id account (shared token), it is not a marker.
        api.comments.append(owner(posted))
        self.assertEqual(g.evaluate(pr())[0], mg.OWNER)

    def test_marker_then_merge_with_head_guard(self):
        api = FakeApi(["scripts/ops/deploy.sh"], [review(), owner()])
        g, api = self.gate(api)
        self.assertEqual(g.tick(), "7")
        self.assertEqual(api.did("PUT", "/merge")[0][2], {"sha": HEAD, "merge_method": "squash"})

    def test_dry_run_sends_nothing(self):
        api = FakeApi(["scripts/ops/deploy.sh"], [review()])
        g, api = self.gate(api, dry=True)
        self.assertIsNone(g.tick())
        self.assertFalse(api.did("POST", "/comments") or api.did("PUT", "/merge"))


class HistoryReplay(unittest.TestCase):
    def rows(self, comments):
        class Api(FakeApi):
            def __call__(self, method, path, fields=None, paginate=False):
                if "pulls?state=closed" in path:
                    return [{"number": 7, "merged_at": "2026-01-02T00:00:00Z"}] if "page=1" in path else []
                if path.endswith("/pulls/7"):
                    return {"number": 7, "title": "x", "labels": [], "merged_at": "2026-01-02T00:00:00Z",
                            "merge_commit_sha": "m" * 40, "merged_by": {"id": 9}, "head": {"sha": HEAD}}
                if "/commits/" in path and "/check-runs" not in path:
                    return {"parents": [{"sha": "p" * 40}]}
                return super().__call__(method, path, fields, paginate)

        rep = ch.build_report(cfg(), ch.ReadOnlyAsOf(Api(["Dockerfile.prod"], [review()] + comments)), 5)
        return rep["summary"]

    def test_replay_uses_the_owner_sentence(self):
        self.assertEqual(self.rows([])["blocked_by_rule"], {"protected": 1})
        self.assertEqual(self.rows([owner()])["merged_but_gate_blocks"], 0)
        late = dict(owner(), created_at="2026-02-01T00:00:00Z")  # after the merge: ignored
        self.assertEqual(self.rows([late])["blocked_by_rule"], {"protected": 1})


if __name__ == "__main__":
    unittest.main()
