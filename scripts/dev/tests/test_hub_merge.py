"""Offline tests for scripts/dev/hub_merge.py (issue #1282).

Recorded fixtures (scripts/dev/tests/fixtures/hub_merge/pr<N>.json) replay #1197, #1199 and #1074
as they
stood before they were merged. gh is replaced by a fake api callable: no network, no git, no
subprocess.
The module under test is loaded in setUpModule (lesson 33: no work at import time).
Run: python3 scripts/dev/tests/test_hub_merge.py   (or python3 -m unittest by path)
"""

import base64
import contextlib
import importlib.util
import io
import json
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "hub_merge"
hm = None

SENTENCE = "go: merge it, owner approves the migration"
STATE = """## Open PRs
- Held for the owner: #1161 (deploy key, signed tags), #889 (parked, row #1093), #1072 (nginx/SSE),
  #1225 (proprietary LICENSE: desk reviews, hub never self-merges). Box hub PRs: #1205
  (queued, no blocker),
  #1233 (root script: needs a verdict).
- Lane PRs with real blockers: #1201 #1198.
"""


def setUpModule():
    global hm
    spec = importlib.util.spec_from_file_location("hub_merge", HERE.parent / "hub_merge.py")
    hm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hm)


def load(n):
    return json.loads((FIX / f"pr{n}.json").read_text())


class FakeApi:
    def __init__(self, fx, merge_error=False, open_prs=None, state_doc=None):
        self.fx = fx
        self.calls = []
        self.merge_error = merge_error
        self.open_prs = open_prs or []
        self.state_doc = state_doc

    def __call__(self, method, path, fields=None, paginate=False):
        self.calls.append((method, path, fields))
        fx = self.fx
        n = fx["pr"]["number"]
        if method == "PUT" and path.endswith(f"pulls/{n}/merge"):
            if self.merge_error:
                raise hm.GhError("405 head branch was modified")
            return {"sha": "b" * 40}
        if method == "POST" and path.endswith(f"issues/{n}/comments"):
            return {"id": 1}
        if "/contents/docs/STATE.md" in path:
            return {"content": base64.b64encode((self.state_doc or STATE).encode()).decode()}
        if "/check-runs" in path:
            return [{"check_runs": fx["check_runs"]}]
        if path.endswith(f"commits/{fx['pr']['head']['sha']}"):
            return {"commit": {"committer": {"date": fx["head_commit_date"]}}}
        if f"issues/{n}/comments?" in path:
            return fx["comments"]
        if f"pulls/{n}/reviews?" in path:
            return fx.get("reviews", [])
        if f"pulls/{n}/files?" in path:
            return fx["files"]
        if "/pulls?state=open" in path:
            return self.open_prs
        if path.endswith(f"pulls/{n}"):
            return fx["pr"]
        raise AssertionError(f"unexpected api call {method} {path}")

    def writes(self):
        return [c for c in self.calls if c[0] in ("POST", "PUT", "PATCH", "DELETE")]


def codes(res):
    return sorted({c for c, _ in res["reasons"]})


def evaluate(fx, **kw):
    return hm.Hub(FakeApi(fx, **kw), state_text=STATE).evaluate(fx["pr"]["number"])


def run_main(fx, argv, runner=None, **kw):
    api = FakeApi(fx, **kw)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = hm.main(argv, api=api, runner=runner or (lambda a: ""), state_text=STATE)
    return rc, out.getvalue(), err.getvalue(), api


def drop_comment(fx, cid):
    fx["comments"] = [c for c in fx["comments"] if c["id"] != cid]


def comment(cid, body, created, login="hub-account", updated=None):
    return {
        "id": cid,
        "user": {"login": login},
        "created_at": created,
        "updated_at": updated or created,
        "body": body,
    }


class RecordedPrs(unittest.TestCase):
    def test_1197_hub_blocker_newer_than_head_refuses_despite_clean_desk(self):
        fx = load(1197)
        res = evaluate(fx)
        # The desk said "no blocker" at the exact head (23:02); the hub re-review at 23:08 said
        # blocker.
        self.assertEqual(codes(res), ["blocker"])
        blockers = [t for c, t in res["reasons"] if c == "blocker"]
        self.assertEqual(len(blockers), 1)
        self.assertIn("7070667182", blockers[0])
        # Older blockers at older heads (18:42, 19:03, 19:19) are not newer than the head commit
        # (22:52).
        self.assertNotIn("7067455233", blockers[0])
        self.assertTrue(res["protected"])  # the migration
        rc, out, _, api = run_main(fx, ["1197", "--owner-sentence", SENTENCE])
        self.assertEqual(rc, 1)
        self.assertIn("[blocker]", out)
        self.assertEqual(api.writes(), [])

    def test_1197_migration_needs_owner_sentence(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)  # positive control: no hub blocker
        rc, out, _, _ = run_main(fx, ["1197"])
        self.assertEqual(rc, 1)
        self.assertIn("[protected]", out)
        self.assertNotIn("[blocker]", out)
        self.assertNotIn("[desk]", out)

    def test_1197_without_hub_blocker_passes_dry_run_and_writes_nothing(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        rc, out, _, api = run_main(fx, ["1197", "--owner-sentence", SENTENCE])
        self.assertEqual(rc, 0, out)
        self.assertIn("DRY RUN", out)
        self.assertEqual(api.writes(), [])

    def test_1197_apply_posts_sentence_then_merges_at_exact_head(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        rc, out, _, api = run_main(fx, ["1197", "--apply", "--owner-sentence", SENTENCE])
        self.assertEqual(rc, 0, out)
        w = api.writes()
        self.assertEqual([x[0] for x in w], ["POST", "PUT"])
        self.assertIn(SENTENCE, w[0][2]["body"])
        self.assertTrue(w[0][2]["body"].startswith("Owner approval"))
        self.assertEqual(w[1][1], "repos/Mahan-film/roxira-platform/pulls/1197/merge")
        self.assertEqual(w[1][2], {"sha": fx["pr"]["head"]["sha"], "merge_method": "squash"})
        self.assertIn("merged #1197", out)

    def test_1199_desk_blocker_at_exact_head_refuses(self):
        fx = load(1199)
        res = evaluate(fx)
        self.assertEqual(codes(res), ["blocker", "desk"])
        self.assertTrue(any("says Verdict: blocker" in t for c, t in res["reasons"] if c == "desk"))
        rc, _, _, api = run_main(fx, ["1199", "--apply", "--owner-sentence", SENTENCE])
        self.assertEqual(rc, 1)
        self.assertEqual(api.writes(), [])

    def test_1199_a_later_no_blocker_does_not_clear_the_blocker(self):
        fx = load(1199)
        head = fx["pr"]["head"]["sha"]
        body = f"Cross-family review (x via y, family z) @ {head}\n\nVerdict: no blocker"
        fx["comments"].append(comment(9, body, "2026-11-21T20:00:00Z", login="github-actions[bot]"))
        res = evaluate(fx)
        self.assertEqual(
            codes(res), ["blocker"]
        )  # desk is now clean, the earlier blocker still blocks

    def test_1074_desk_blocker_at_head_refuses_old_head_blocker_ignored(self):
        fx = load(1074)
        res = evaluate(fx)
        self.assertEqual(codes(res), ["blocker", "desk"])
        blockers = " ".join(t for c, t in res["reasons"] if c == "blocker")
        self.assertIn("7063850383", blockers)
        self.assertNotIn("7063149968", blockers)  # 13:16, before the head commit at 13:55

    def test_1074_with_clean_desk_verdict_at_head_passes_despite_old_blocker(self):
        fx = load(1074)
        for c in fx["comments"]:
            if c["id"] == 7063850383:
                c["body"] = c["body"].replace("Verdict: blocker", "Verdict: no blocker")
        rc, out, _, _ = run_main(fx, ["1074", "--owner-sentence", SENTENCE])
        self.assertEqual(rc, 0, out)


class Rules(unittest.TestCase):
    def base(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        return fx

    def test_baseline_only_protected(self):
        self.assertEqual(codes(evaluate(self.base())), [])
        self.assertTrue(evaluate(self.base())["protected"])

    def test_old_comment_edited_into_a_blocker_after_the_head(self):
        fx = self.base()
        fx["comments"].append(
            comment(
                10,
                "Looks fine\n\nVerdict: blocker",
                "2026-11-21T10:00:00Z",
                updated="2026-11-21T23:30:00Z",
            )
        )
        self.assertEqual(codes(evaluate(fx)), ["blocker"])

    def test_comment_exactly_at_head_date_counts(self):
        fx = self.base()
        fx["comments"].append(comment(10, "Verdict: blocker", fx["head_commit_date"]))
        self.assertEqual(codes(evaluate(fx)), ["blocker"])

    def test_blocker_in_a_pr_review_body_counts(self):
        fx = self.base()
        fx["reviews"] = [
            {
                "id": 5,
                "user": {"login": "hub-account"},
                "state": "COMMENTED",
                "submitted_at": "2026-11-21T23:30:00Z",
                "body": "Re-review.\nVerdict: blocker",
            }
        ]
        res = evaluate(fx)
        self.assertEqual(codes(res), ["blocker"])
        self.assertIn("review 5", res["reasons"][0][1])

    def test_blocker_heading_and_no_blocker_text_are_not_verdicts(self):
        fx = self.base()
        fx["comments"].append(
            comment(
                10,
                "**Blocker**\n- none\n\nno blocker here\nVerdict: no blocker",
                "2026-11-21T23:30:00Z",
            )
        )
        self.assertEqual(codes(evaluate(fx)), [])

    def test_owner_sentence_comment_never_parses_as_a_verdict(self):
        fx = self.base()
        sentence = "Verdict: blocker is resolved, go"
        fx["comments"].append(
            comment(
                10,
                f'Owner approval for protected paths, relayed by hub_merge.py: "{sentence}"',
                "2026-11-21T23:30:00Z",
            )
        )
        self.assertEqual(codes(evaluate(fx)), [])

    def test_desk_comment_by_a_stranger_does_not_count(self):
        fx = self.base()
        head = fx["pr"]["head"]["sha"]
        fx["comments"] = [c for c in fx["comments"] if c["id"] != 7070597731]
        fx["comments"].append(
            comment(
                10,
                f"Cross-family review (x) @ {head}\nVerdict: no blocker",
                "2026-11-21T23:30:00Z",
                login="someone",
            )
        )
        self.assertEqual(codes(evaluate(fx)), ["desk"])

    def test_desk_comment_naming_a_short_or_other_sha_does_not_count(self):
        fx = self.base()
        head = fx["pr"]["head"]["sha"]
        for c in fx["comments"]:
            if c["id"] == 7070597731:
                c["body"] = c["body"].replace(head, head[:7])
        self.assertEqual(codes(evaluate(fx)), ["desk"])

    def test_checks_failed_pending_missing_and_rerun(self):
        fx = self.base()
        fx["check_runs"].append(
            {"id": 1, "name": "Optional job", "status": "completed", "conclusion": "failure"}
        )
        res = evaluate(fx)
        self.assertEqual(codes(res), ["checks"])  # a non-required job counts too
        self.assertIn("Optional job (failure)", res["reasons"][0][1])
        fx["check_runs"].append(
            {"id": 2, "name": "Optional job", "status": "completed", "conclusion": "success"}
        )
        self.assertEqual(codes(evaluate(fx)), [])  # a later rerun of the same job wins
        fx["check_runs"].append(
            {"id": 3, "name": "Slow job", "status": "in_progress", "conclusion": None}
        )
        res = evaluate(fx)
        self.assertEqual(codes(res), ["checks"])
        self.assertIn("pending", res["reasons"][0][1])
        fx["check_runs"] = []
        self.assertEqual(codes(evaluate(fx)), ["checks"])
        fx["check_runs"] = [
            {"id": 1, "name": "j", "status": "completed", "conclusion": "cancelled"}
        ]
        self.assertIn("j (cancelled)", evaluate(fx)["reasons"][0][1])

    def test_skipped_and_neutral_are_green(self):
        fx = self.base()
        fx["check_runs"].append(
            {"id": 1, "name": "a", "status": "completed", "conclusion": "skipped"}
        )
        fx["check_runs"].append(
            {"id": 2, "name": "b", "status": "completed", "conclusion": "neutral"}
        )
        self.assertEqual(codes(evaluate(fx)), [])

    def test_draft_closed_base_conflict_holds(self):
        fx = self.base()
        fx["pr"]["draft"] = True
        self.assertEqual(codes(evaluate(fx)), ["draft"])
        fx = self.base()
        fx["pr"]["state"] = "closed"
        fx["pr"]["base"]["ref"] = "other"
        fx["pr"]["mergeable_state"] = "dirty"
        res = evaluate(fx)
        self.assertEqual(codes(res), ["closed"])
        self.assertEqual(len(res["reasons"]), 3)
        fx = self.base()
        fx["pr"]["labels"] = [{"name": "needs-human"}]
        fx["pr"]["title"] = "T [needs owner] x"
        res = evaluate(fx)
        self.assertEqual([c for c, _ in res["reasons"]], ["hold", "hold"])

    def test_held_list(self):
        fx = self.base()
        fx["pr"]["number"] = 1161
        res = evaluate(fx)
        self.assertEqual(codes(res), ["held"])
        fx["pr"]["number"] = 1205  # in the same bullet, but in the second sentence: not held
        self.assertEqual(codes(evaluate(fx)), [])
        fx["pr"]["number"] = 1093  # a `row #N` issue, not a PR
        self.assertEqual(codes(evaluate(fx)), [])

    def test_held_numbers_parser(self):
        self.assertEqual(hm.held_numbers(STATE), {1161, 889, 1072, 1225})
        self.assertIsNone(hm.held_numbers("## Open PRs\n- nothing here\n"))
        one_line = "- Held: #5 (x), #6.\n- Other: #7\n"
        self.assertEqual(hm.held_numbers(one_line), {5, 6})

    def test_missing_held_list_fails_closed(self):
        fx = self.base()
        res = hm.Hub(FakeApi(fx), state_text="no list\n").evaluate(1197)
        self.assertEqual(codes(res), ["held"])

    def test_state_is_read_from_the_main_branch_through_the_api(self):
        fx = self.base()
        fx["pr"]["number"] = 1161
        api = FakeApi(fx)
        res = hm.Hub(api).evaluate(1161)
        self.assertEqual(codes(res), ["held"])
        self.assertTrue(any("contents/docs/STATE.md?ref=main" in c[1] for c in api.calls))

    def test_protected_globs(self):
        hit = [
            "output_apps/enterprise_hub/migrations/1-A.ts",
            "migrations/1.sql",
            "output_apps/enterprise_hub/modules/auth/jwt.service.ts",
            "src/auth_guard.py",
            "output_apps/enterprise_hub/modules/payments/x.ts",
            "output_apps/x/billing/y.ts",
            "output_apps/x/invoice-billing.service.ts",
            "Dockerfile.prod",
            "output_apps/enterprise_hub/Dockerfile.prod",
            "scripts/ops/deploy_prod.sh",
            "scripts/ops/deploy/x.sh",
            "scripts/dev/deploy_x.sh",
            ".github/workflows/ci.yml",
            "docker-compose.prod.yml",
            "docker-compose.prod.override.yml",
            "nginx/default.conf",
            "ops/nginx/site.conf",
            "ops/roxira-nginx.conf",
        ]
        miss = [
            "docs/STATE.md",
            "scripts/dev/hub_merge.py",
            "scripts/dev/tests/test_hub_merge.py",
            "output_apps/enterprise_hub/modules/accounting/money.ts",
        ]
        for p in hit:
            self.assertEqual(hm.mg.protected_hits([{"filename": p}], hm.PROTECTED_GLOBS), [p], p)
        for p in miss:
            self.assertEqual(hm.mg.protected_hits([{"filename": p}], hm.PROTECTED_GLOBS), [], p)
        renamed = [{"filename": "docs/x.md", "previous_filename": "migrations/old.sql"}]
        self.assertEqual(hm.mg.protected_hits(renamed, hm.PROTECTED_GLOBS), ["migrations/old.sql"])


class Cli(unittest.TestCase):
    def clean_docs_pr(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        fx["files"] = [{"filename": "docs/x.md"}]
        return fx

    def test_clean_non_protected_pr_merges_without_a_sentence_and_posts_nothing(self):
        fx = self.clean_docs_pr()
        rc, out, _, api = run_main(fx, ["1197", "--apply"])
        self.assertEqual(rc, 0, out)
        self.assertEqual([x[0] for x in api.writes()], ["PUT"])

    def test_sentence_validation(self):
        fx = self.clean_docs_pr()
        rc, _, err, api = run_main(
            fx, ["1197", "--apply", "--owner-sentence", "line one\nline two ok ok"]
        )
        self.assertEqual((rc, api.writes()), (2, []))
        self.assertIn("single line", err)
        rc, _, err, api = run_main(fx, ["1197", "--apply", "--owner-sentence", "go"])
        self.assertEqual((rc, api.writes()), (2, []))

    def test_github_refusing_the_merge_is_exit_2(self):
        fx = self.clean_docs_pr()
        rc, _, err, _ = run_main(fx, ["1197", "--apply"], merge_error=True)
        self.assertEqual(rc, 2)
        self.assertIn("405", err)

    def test_refusal_mentions_armed_auto_merge(self):
        fx = self.clean_docs_pr()
        fx["pr"]["draft"] = True
        fx["pr"]["auto_merge"] = {"merge_method": "squash"}
        rc, out, _, _ = run_main(fx, ["1197"])
        self.assertEqual(rc, 1)
        self.assertIn("auto-merge is armed", out)

    def test_pr_number_required(self):
        fx = self.clean_docs_pr()
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            hm.main([], api=FakeApi(fx), state_text=STATE)

    def test_disarm_held(self):
        fx = self.clean_docs_pr()
        armed = {"merge_method": "squash"}
        prs = [
            {"number": 1161, "title": "a", "labels": [], "auto_merge": armed},  # in the Held list
            {"number": 2001, "title": "b [needs owner]", "labels": [], "auto_merge": armed},
            {
                "number": 2002,
                "title": "c",
                "labels": [{"name": "needs-human"}],
                "auto_merge": armed,
            },
            {"number": 2003, "title": "fine", "labels": [], "auto_merge": armed},  # not held: keep
            {"number": 1072, "title": "held but not armed", "labels": [], "auto_merge": None},
        ]
        calls = []
        rc, out, _, api = run_main(fx, ["--disarm-held"], runner=calls.append, open_prs=prs)
        self.assertEqual(rc, 0)
        self.assertEqual(calls, [])  # dry run
        for n in (1161, 2001, 2002):
            self.assertIn(f"would disarm auto-merge on held #{n}", out)
        self.assertNotIn("2003", out)
        self.assertNotIn("1072", out)
        rc, out, _, api = run_main(
            fx, ["--disarm-held", "--apply"], runner=calls.append, open_prs=prs
        )
        self.assertEqual(rc, 0)
        self.assertEqual(
            calls,
            [
                ["pr", "merge", str(n), "-R", "Mahan-film/roxira-platform", "--disable-auto"]
                for n in (1161, 2001, 2002)
            ],
        )
        self.assertEqual(api.writes(), [])  # REST is never used to merge here

    def test_disarm_held_with_a_pr_number_restricts_to_it(self):
        fx = self.clean_docs_pr()
        armed = {"merge_method": "squash"}
        prs = [
            {"number": 1161, "title": "a", "labels": [], "auto_merge": armed},
            {"number": 2001, "title": "[needs owner]", "labels": [], "auto_merge": armed},
        ]
        calls = []
        rc, _, _, _ = run_main(
            fx, ["2001", "--disarm-held", "--apply"], runner=calls.append, open_prs=prs
        )
        self.assertEqual((rc, [c[2] for c in calls]), (0, ["2001"]))

    def test_disarm_held_fails_closed_without_a_held_list(self):
        fx = self.clean_docs_pr()
        api = FakeApi(fx)
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = hm.main(
                ["--disarm-held", "--apply"],
                api=api,
                runner=lambda a: self.fail("must not disarm"),
                state_text="x\n",
            )
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    setUpModule()
    unittest.main(verbosity=1)
