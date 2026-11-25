"""Offline tests for scripts/dev/hub_merge.py (issue #1282).

Recorded fixtures (scripts/dev/tests/fixtures/hub_merge/pr<N>.json) replay #1197, #1199 and #1074
as they
stood before they were merged. gh is replaced by a fake api callable: no network, no git, no
subprocess
(the one exception, test_every_tracked_prod_path_is_protected, runs a read-only `git ls-files` and
skips when git is unavailable).
The module under test is loaded in setUpModule (lesson 33: no work at import time).
Run: python3 scripts/dev/tests/test_hub_merge.py   (or python3 -m unittest by path)
"""

import base64
import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
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
    def __init__(self, fx, open_prs=None, state_doc=None):
        self.fx = fx
        self.calls = []
        self.open_prs = open_prs or []
        self.state_doc = state_doc

    def __call__(self, method, path, fields=None, paginate=False):
        self.calls.append((method, path, fields))
        fx = self.fx
        n = fx["pr"]["number"]
        if method == "PUT" or path.endswith("/merge"):
            # main has a merge queue: a direct REST merge would bypass it and the merge-group CI.
            raise AssertionError(f"direct merge call must never be made: {method} {path}")
        if method == "POST" and path.endswith(f"issues/{n}/comments"):
            return {"id": 1}
        if "/contents/docs/STATE.md" in path:
            return {"content": base64.b64encode((self.state_doc or STATE).encode()).decode()}
        if "/commits/" in path and "/status" in path:
            return fx.get("status", {"state": "pending", "total_count": 0, "statuses": []})
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


class FakeGh:
    """Stands in for `gh` (the runner): answers the two GraphQL documents hub_merge sends and
    records every call, so a test can prove which mutation was (not) sent."""

    def __init__(self, fx, head=None, in_queue=False, state="OPEN", draft=False, error=None):
        self.calls = []
        self.fx = fx
        self.head = head or fx["pr"]["head"]["sha"]
        self.in_queue, self.state, self.draft, self.error = in_queue, state, draft, error

    def __call__(self, args):
        self.calls.append(args)
        if args[:3] != ["api", "graphql", "-f"]:
            return ""  # disarm calls (gh pr merge --disable-auto) are not GraphQL here
        query = args[3]
        if "enqueuePullRequest" in query:
            if self.error:
                raise hm.GhError(self.error)
            return json.dumps(
                {
                    "data": {
                        "enqueuePullRequest": {
                            "mergeQueueEntry": {"state": "QUEUED", "position": 3}
                        }
                    }
                }
            )
        pr = {
            "id": "PR_node1",
            "state": self.state,
            "isDraft": self.draft,
            "headRefOid": self.head,
            "isInMergeQueue": self.in_queue,
            "mergeQueueEntry": {"state": "QUEUED", "position": 2} if self.in_queue else None,
        }
        return json.dumps({"data": {"repository": {"pullRequest": pr}}})

    def mutations(self):
        return [c for c in self.calls if len(c) > 3 and "mutation" in c[3]]


def codes(res):
    return sorted({c for c, _ in res["reasons"]})


def evaluate(fx, **kw):
    return hm.Hub(FakeApi(fx, **kw), state_text=STATE).evaluate(fx["pr"]["number"])


def run_main(fx, argv, runner=None, **kw):
    api = FakeApi(fx, **kw)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = hm.main(argv, api=api, runner=runner or FakeGh(fx), state_text=STATE)
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

    def test_1197_apply_posts_sentence_then_enqueues_at_exact_head(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        gh = FakeGh(fx)
        rc, out, _, api = run_main(fx, ["1197", "--apply", "--owner-sentence", SENTENCE], runner=gh)
        self.assertEqual(rc, 0, out)
        w = api.writes()
        self.assertEqual([x[0] for x in w], ["POST"])  # only the sentence goes through REST
        self.assertIn(SENTENCE, w[0][2]["body"])
        self.assertTrue(w[0][2]["body"].startswith("Owner approval"))
        (mut,) = gh.mutations()
        self.assertIn("enqueuePullRequest", mut[3])
        self.assertIn(f"expectedHeadOid={fx['pr']['head']['sha']}", mut)
        self.assertIn("pullRequestId=PR_node1", mut)
        self.assertIn("#1197", out)
        self.assertIn("enqueued", out)
        self.assertNotIn("merged #", out)

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
            "output_apps/docker-compose.prod.yml",
            "output_apps/nginx_config/.factory_htpasswd",
            "deploy/systemd/roxira-backup.service",
            "deploy/systemd/roxira-backup.timer",
            "deploy/launchd/ir.roxira.lawwatch.plist",
            ".github/actions/x/action.yml",
            ".github/CODEOWNERS",
            "scripts/dev/hub_merge.py",
            "scripts/ops/ci_box/merge_gate/merge_gate.py",
        ]
        miss = [
            "docs/STATE.md",
            "scripts/dev/tests/test_hub_merge.py",
            "output_apps/enterprise_hub/modules/accounting/money.ts",
        ]
        for p in hit:
            self.assertEqual(hm.mg.protected_hits([{"filename": p}], hm.PROTECTED_GLOBS), [p], p)
        for p in miss:
            self.assertEqual(hm.mg.protected_hits([{"filename": p}], hm.PROTECTED_GLOBS), [], p)
        renamed = [{"filename": "docs/x.md", "previous_filename": "migrations/old.sql"}]
        self.assertEqual(hm.mg.protected_hits(renamed, hm.PROTECTED_GLOBS), ["migrations/old.sql"])


class Findings(unittest.TestCase):
    """Review findings of PR #1295 (each test fails on the previous behaviour)."""

    def base(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        return fx

    # 1. blocker scan recognises prefixed verdict lines
    def test_prefixed_blocker_forms_all_refuse(self):
        forms = [
            "- Verdict: blocker",
            "## Verdict: blocker",
            "1. Verdict: blocker",
            "> Verdict: blocker",
            "`Verdict: blocker`",
            "Hub verdict: blocker",
            "Hub re-review verdict: blocker",
            "Verdict (re-review): blocker",
            "Verdict - blocker",
            "VERDICT: BLOCKER",
            "**Verdict:** blocker",
            "Re-review done.\n\n> - Verdict: Blocker (see above)",
            "Verdict: blocker (no blockers in tests)",
        ]
        for body in forms:
            fx = self.base()
            fx["comments"].append(comment(10, body, "2026-11-21T23:30:00Z"))
            self.assertEqual(codes(evaluate(fx)), ["blocker"], body)

    def test_negated_or_unrelated_verdict_lines_do_not_refuse(self):
        forms = [
            "Verdict: no blocker",
            "Verdict: no-blocker",
            "- Verdict: No Blocker (0 blockers)",
            "Verdict: non-blocker",
            "verdict: not a blocker",
            "Verdict: approved",
            'Owner approval, relayed by hub_merge.py: "Verdict: blocker is resolved, go"',
        ]
        for body in forms:
            fx = self.base()
            fx["comments"].append(comment(10, body, "2026-11-21T23:30:00Z"))
            self.assertEqual(codes(evaluate(fx)), [], body)

    def test_loose_blocker_lines_unit(self):
        self.assertEqual(
            hm.loose_blocker_lines("a\n  * Verdict: blocker\nb"), ["* Verdict: blocker"]
        )
        self.assertEqual(
            hm.loose_blocker_lines("Verdict: no blocker, but a blocker remains"),
            ["Verdict: no blocker, but a blocker remains"],
        )
        self.assertEqual(hm.loose_blocker_lines(""), [])

    # 2. protected globs cover the files that exist in this repo
    def test_every_tracked_prod_path_is_protected(self):
        root = HERE.parents[2]
        try:
            out = subprocess.run(
                ["git", "ls-files"], cwd=root, capture_output=True, text=True, timeout=60
            )
        except (OSError, subprocess.TimeoutExpired):
            self.skipTest("git unavailable")
        files = out.stdout.splitlines()
        if out.returncode != 0 or not files:
            self.skipTest("not a git checkout")
        known = []
        for f in files:
            base = f.rsplit("/", 1)[-1]
            if (
                (base.startswith("docker-compose") and "prod" in base and base.endswith(".yml"))
                or "htpasswd" in base
                or f.startswith(("deploy/systemd/", "deploy/launchd/", ".github/actions/"))
                or f == ".github/CODEOWNERS"
                or f.startswith("scripts/ops/ci_box/")
                or f == "scripts/dev/hub_merge.py"
            ):
                known.append(f)
        self.assertTrue(any("docker-compose" in f for f in known), "fixture sanity")
        unprotected = [
            f for f in known if not hm.mg.protected_hits([{"filename": f}], hm.PROTECTED_GLOBS)
        ]
        self.assertEqual(unprotected, [])

    # 3. latest run is per (suite, name)
    def test_same_name_failure_in_another_suite_is_not_hidden(self):
        fx = self.base()
        fx["check_runs"] += [
            {
                "id": 10,
                "name": "build",
                "status": "completed",
                "conclusion": "failure",
                "check_suite": {"id": 1},
            },
            {
                "id": 11,
                "name": "build",
                "status": "completed",
                "conclusion": "success",
                "check_suite": {"id": 2},
            },
        ]
        res = evaluate(fx)
        self.assertEqual(codes(res), ["checks"])
        self.assertIn("build (failure)", res["reasons"][0][1])

    def test_rerun_in_the_same_suite_still_supersedes(self):
        fx = self.base()
        fx["check_runs"] += [
            {
                "id": 10,
                "name": "build",
                "status": "completed",
                "conclusion": "failure",
                "check_suite": {"id": 1},
            },
            {
                "id": 12,
                "name": "build",
                "status": "completed",
                "conclusion": "success",
                "check_suite": {"id": 1},
            },
        ]
        self.assertEqual(codes(evaluate(fx)), [])

    # 4. required checks must exist; legacy statuses count
    def test_missing_required_check_refuses_even_when_something_else_is_green(self):
        fx = self.base()
        fx["check_runs"] = [r for r in fx["check_runs"] if r["name"] != "Pytest (unit)"]
        fx["check_runs"].append(
            {"id": 1, "name": "Cross-family review", "status": "completed", "conclusion": "success"}
        )
        res = evaluate(fx)
        self.assertEqual(codes(res), ["checks"])
        self.assertIn("Pytest (unit)", res["reasons"][0][1])
        self.assertIn("missing", res["reasons"][0][1])

    def test_only_the_desk_check_is_not_enough(self):
        fx = self.base()
        fx["check_runs"] = [
            {"id": 1, "name": "review-desk", "status": "completed", "conclusion": "success"}
        ]
        res = evaluate(fx)
        self.assertEqual(codes(res), ["checks"])
        self.assertIn("required checks missing", res["reasons"][0][1])

    def test_legacy_commit_status_failure_and_pending_refuse(self):
        fx = self.base()
        fx["status"] = {
            "state": "failure",
            "total_count": 2,
            "statuses": [
                {"context": "ci/x", "state": "failure"},
                {"context": "ci/y", "state": "success"},
            ],
        }
        res = evaluate(fx)
        self.assertEqual(codes(res), ["checks"])
        self.assertIn("ci/x (failure)", res["reasons"][0][1])
        fx["status"] = {
            "state": "pending",
            "total_count": 1,
            "statuses": [{"context": "ci/z", "state": "pending"}],
        }
        self.assertIn("ci/z (pending)", evaluate(fx)["reasons"][0][1])
        fx["status"] = {
            "state": "success",
            "total_count": 1,
            "statuses": [{"context": "ci/z", "state": "success"}],
        }
        self.assertEqual(codes(evaluate(fx)), [])

    # 5. cutoff is the push, not a future-dated commit
    def test_future_dated_commit_does_not_hide_a_later_blocker(self):
        fx = self.base()
        fx["head_commit_date"] = "2026-11-22T12:00:00Z"  # clock ahead / GIT_COMMITTER_DATE
        fx["check_runs"][0]["started_at"] = "2026-11-21T22:53:00Z"  # the real push
        fx["comments"].append(comment(10, "Verdict: blocker", "2026-11-22T11:00:00Z"))
        self.assertEqual(codes(evaluate(fx)), ["blocker"])

    def test_future_dated_commit_without_check_runs_timestamps_is_unchanged(self):
        fx = self.base()
        fx["head_commit_date"] = "2026-11-22T12:00:00Z"
        fx["comments"].append(comment(10, "Verdict: blocker", "2026-11-22T11:00:00Z"))
        self.assertEqual(codes(evaluate(fx)), [])  # documents the fallback: no better cutoff known

    def test_blocker_citing_the_head_sha_counts_at_any_time(self):
        fx = self.base()
        head = fx["pr"]["head"]["sha"]
        fx["comments"].append(
            comment(10, f"Re-review of {head[:7]}\nVerdict: blocker", "2026-11-21T10:00:00Z")
        )
        self.assertEqual(codes(evaluate(fx)), ["blocker"])
        fx = self.base()
        fx["comments"].append(
            comment(10, "Re-review of 1234567\nVerdict: blocker", "2026-11-21T10:00:00Z")
        )
        self.assertEqual(codes(evaluate(fx)), [])  # another sha, older than the push

    def test_push_cutoff_unit(self):
        runs = [{"started_at": "2026-11-21T01:00:00Z"}, {"created_at": "2026-11-21T02:00:00Z"}, {}]
        self.assertEqual(hm.push_cutoff("2026-11-21T05:00:00Z", runs), "2026-11-21T01:00:00Z")
        self.assertEqual(hm.push_cutoff("2026-11-20T05:00:00Z", runs), "2026-11-20T05:00:00Z")

    # 6. human BLOCKER:/UNBLOCK: hold and CHANGES_REQUESTED reviews
    def test_human_blocker_comment_refuses_and_unblock_clears_it(self):
        fx = self.base()
        owner = comment(10, "BLOCKER: do not merge yet", "2026-11-21T10:00:00Z", login="owner")
        owner["author_association"] = "OWNER"
        fx["comments"].append(owner)
        res = evaluate(fx)
        self.assertEqual(codes(res), ["blocker"])
        self.assertIn("BLOCKER:", res["reasons"][0][1])
        unblock = comment(11, "unblock: ok now", "2026-11-21T11:00:00Z", login="owner")
        unblock["author_association"] = "OWNER"
        fx["comments"].append(unblock)
        self.assertEqual(codes(evaluate(fx)), [])

    def test_unblock_from_a_stranger_does_not_clear_and_stranger_blocker_is_ignored(self):
        fx = self.base()
        owner = comment(10, "BLOCKER: hold", "2026-11-21T10:00:00Z", login="owner")
        owner["author_association"] = "COLLABORATOR"
        stranger = comment(11, "UNBLOCK: fine", "2026-11-21T11:00:00Z", login="rando")
        stranger["author_association"] = "NONE"
        fx["comments"] += [owner, stranger]
        self.assertEqual(codes(evaluate(fx)), ["blocker"])
        fx = self.base()
        spam = comment(10, "BLOCKER: haha", "2026-11-21T10:00:00Z", login="rando")
        spam["author_association"] = "NONE"
        fx["comments"].append(spam)
        self.assertEqual(codes(evaluate(fx)), [])
        # a missing association fails closed
        fx = self.base()
        fx["comments"].append(comment(10, "BLOCKER: hold", "2026-11-21T10:00:00Z"))
        self.assertEqual(codes(evaluate(fx)), ["blocker"])

    def test_changes_requested_review_without_a_verdict_line_refuses(self):
        fx = self.base()
        fx["reviews"] = [
            {
                "id": 5,
                "user": {"login": "someone"},
                "state": "CHANGES_REQUESTED",
                "submitted_at": "2026-11-21T23:30:00Z",
                "body": "Please fix the naming.",
            }
        ]
        res = evaluate(fx)
        self.assertEqual(codes(res), ["blocker"])
        self.assertIn("CHANGES_REQUESTED", res["reasons"][0][1])

    def test_changes_requested_on_an_older_head_is_ignored_but_not_on_this_head(self):
        fx = self.base()
        review = {
            "id": 5,
            "user": {"login": "someone"},
            "state": "CHANGES_REQUESTED",
            "submitted_at": "2026-11-21T10:00:00Z",
            "body": "",
            "commit_id": "f" * 40,
        }
        fx["reviews"] = [review]
        self.assertEqual(codes(evaluate(fx)), [])
        review["commit_id"] = fx["pr"]["head"]["sha"]
        self.assertEqual(codes(evaluate(fx)), ["blocker"])
        review["state"] = "DISMISSED"
        self.assertEqual(codes(evaluate(fx)), [])


class Cli(unittest.TestCase):
    def clean_docs_pr(self):
        fx = load(1197)
        drop_comment(fx, 7070667182)
        fx["files"] = [{"filename": "docs/x.md"}]
        return fx

    def test_clean_non_protected_pr_merges_without_a_sentence_and_posts_nothing(self):
        fx = self.clean_docs_pr()
        gh = FakeGh(fx)
        rc, out, _, api = run_main(fx, ["1197", "--apply"], runner=gh)
        self.assertEqual(rc, 0, out)
        self.assertEqual(api.writes(), [])
        self.assertEqual(len(gh.mutations()), 1)

    def test_sentence_validation(self):
        fx = self.clean_docs_pr()
        rc, _, err, api = run_main(
            fx, ["1197", "--apply", "--owner-sentence", "line one\nline two ok ok"]
        )
        self.assertEqual((rc, api.writes()), (2, []))
        self.assertIn("single line", err)
        rc, _, err, api = run_main(fx, ["1197", "--apply", "--owner-sentence", "go"])
        self.assertEqual((rc, api.writes()), (2, []))

    def test_github_refusing_the_enqueue_is_exit_2(self):
        fx = self.clean_docs_pr()
        gh = FakeGh(fx, error="Pull request is not mergeable: required checks have not passed")
        rc, _, err, _ = run_main(fx, ["1197", "--apply"], runner=gh)
        self.assertEqual(rc, 2)
        self.assertIn("not mergeable", err)

    def test_apply_never_makes_a_direct_merge_call(self):
        # FakeApi raises AssertionError on any PUT or `/merge` path, so reaching rc 0 proves the
        # REST merge endpoint (which skips the merge queue and the merge-group CI) is never used.
        fx = self.clean_docs_pr()
        gh = FakeGh(fx)
        rc, out, _, api = run_main(fx, ["1197", "--apply"], runner=gh)
        self.assertEqual(rc, 0, out)
        self.assertFalse([c for c in api.calls if c[0] == "PUT" or c[1].endswith("/merge")])
        self.assertFalse(any("--admin" in c or "--auto" in c for c in gh.calls))
        self.assertFalse(any(c[:2] == ["pr", "merge"] for c in gh.calls))
        src = (HERE.parent / "hub_merge.py").read_text()
        self.assertNotIn('"PUT"', src)
        self.assertNotIn('/merge"', src)

    def test_moved_head_refuses_and_sends_no_mutation(self):
        fx = self.clean_docs_pr()
        gh = FakeGh(fx, head="c" * 40)  # someone pushed after the evaluation
        rc, out, _, api = run_main(fx, ["1197", "--apply"], runner=gh)
        self.assertEqual(rc, 1)
        self.assertIn("head moved", out)
        self.assertEqual(gh.mutations(), [])
        self.assertEqual(api.writes(), [])

    def test_pr_closed_or_draft_after_evaluation_refuses(self):
        fx = self.clean_docs_pr()
        for kw in ({"state": "CLOSED"}, {"draft": True}):
            gh = FakeGh(fx, **kw)
            rc, out, _, _ = run_main(fx, ["1197", "--apply"], runner=gh)
            self.assertEqual(rc, 1, out)
            self.assertEqual(gh.mutations(), [])

    def test_already_in_the_queue_says_so_and_exits_0_without_a_mutation(self):
        fx = self.clean_docs_pr()
        gh = FakeGh(fx, in_queue=True)
        rc, out, _, api = run_main(fx, ["1197", "--apply"], runner=gh)
        self.assertEqual(rc, 0, out)
        self.assertIn("already in the merge queue", out)
        self.assertNotIn("merged", out.replace("merge queue", ""))
        self.assertEqual(gh.mutations(), [])
        self.assertEqual(api.writes(), [])

    def test_dry_run_sends_no_graphql_at_all(self):
        fx = self.clean_docs_pr()
        gh = FakeGh(fx)
        rc, out, _, _ = run_main(fx, ["1197"], runner=gh)
        self.assertEqual(rc, 0, out)
        self.assertIn("would enqueue", out)
        self.assertEqual(gh.calls, [])

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
