"""Tests for the box lane policy (scripts/infra/server_agents/lane_policy.py, config/box_lane_policy.json).

Covers: the box ladder against the box key's gateway groups, ladder env/config precedence with the default
unchanged, the per-lane scope table, and the refusal of any scope that touches a denied path. Stdlib unittest, no
network, no model call. Modules load lazily (setUpModule) so importing this file has no side effects.
"""
import contextlib
import importlib.util
import io
import json
import os
import re
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "config" / "box_lane_policy.json"
lp = orch = taskq = to = None


def setUpModule():
    global lp, orch, taskq, to
    sys.path.insert(0, str(ROOT / "scripts/infra/server_agents"))
    import lane_policy as _lp
    import orch as _orch
    import taskq as _taskq

    lp, orch, taskq = _lp, _orch, _taskq
    spec = importlib.util.spec_from_file_location("test_orch_fixtures", ROOT / "src/ops/test_orch.py")
    to = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(to)


def box_key_models() -> list[str]:
    """models of the virtual key `box-lanes`, read from config/key_pool.yaml without a YAML library."""
    lines = (ROOT / "config/key_pool.yaml").read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if re.match(r"^\s{4}box-lanes:\s*$", ln))
    for ln in lines[start + 1:start + 8]:
        m = re.match(r"^\s+models:\s*\[(.*)\]", ln)
        if m:
            return [x.strip() for x in m.group(1).split(",") if x.strip()]
    raise AssertionError("box-lanes models not found in config/key_pool.yaml")


class LadderTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {}, clear=False)
        p.start()
        self.addCleanup(p.stop)
        for k in ("TASKQ_LADDER", lp.POLICY_ENV):
            os.environ.pop(k, None)

    def test_default_ladder_is_unchanged_without_env_or_policy(self):
        self.assertEqual(taskq.default_ladder(), "best,free,ds-flash,strong")
        self.assertEqual(taskq.default_ladder(), taskq.DEFAULT_LADDER)

    def test_policy_ladder_is_used_only_when_the_policy_is_active(self):
        os.environ[lp.POLICY_ENV] = str(POLICY)
        self.assertEqual(taskq.default_ladder(), "light,free,paid")

    def test_env_ladder_wins_over_policy(self):
        os.environ[lp.POLICY_ENV] = str(POLICY)
        os.environ["TASKQ_LADDER"] = "light"
        self.assertEqual(taskq.default_ladder(), "light")

    def test_box_policy_ladder_only_calls_groups_the_box_key_allows(self):
        pol = lp.load(POLICY)
        steps = lp.ladder(pol)
        groups = lp.ladder_groups(steps)
        allowed = box_key_models()
        self.assertEqual(sorted(allowed), sorted(["agent-free", "agent-strong-free", "agent-light-free", "agent-free-paid"]))
        for step, group in groups.items():
            self.assertIsNotNone(group, f"step {step} is a direct provider call; the box holds no provider keys")
            self.assertIn(group, allowed, f"step {step} calls {group}, which the box key does not allow")

    def test_default_ladder_does_call_groups_the_box_key_denies(self):
        """Documents why the box needs its own ladder: the global default reaches best-all and direct providers."""
        groups = lp.ladder_groups(taskq.DEFAULT_LADDER.split(","))
        self.assertEqual(groups["best"], "best-all")
        self.assertIsNone(groups["ds-flash"])
        self.assertNotIn("best-all", box_key_models())

    def test_step_args_for_light_and_paid_use_the_gateway_and_need_public(self):
        self.assertEqual(taskq.step_args("light", True), ["--gateway", "--public", "--tier", "light"])
        self.assertEqual(taskq.step_args("paid", True), ["--gateway", "--public", "--tier", "paid"])
        self.assertIsNone(taskq.step_args("light", False))
        self.assertIsNone(taskq.step_args("paid", False))

    def test_every_ladder_step_has_a_group_entry_and_is_accepted_by_add(self):
        self.assertEqual(set(lp.STEP_GROUP), set(taskq.LADDER_STEPS))
        self.assertEqual(set(lp.LADDER_STEPS), set(taskq.LADDER_STEPS))

    def test_bad_policy_ladder_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "p.json"
            f.write_text(json.dumps({"ladder": ["light", "gpt-9"]}))
            with self.assertRaises(lp.PolicyError):
                lp.load(f)
            f.write_text("{not json")
            with self.assertRaises(lp.PolicyError):
                lp.load(f)


class ScopeTest(unittest.TestCase):
    def setUp(self):
        self.pol = lp.load(POLICY)

    def test_shipped_default_scopes_pass_their_own_policy_against_the_real_tree(self):
        for lane in ("L5", "L6", "L7"):
            scopes = lp.lane_scopes(lane, self.pol, {})
            self.assertTrue(scopes, f"{lane} has no default scope")
            self.assertEqual(lp.check_scopes(scopes, self.pol, ROOT), [], lane)
            for s in scopes:
                self.assertTrue((ROOT / s).exists(), f"{lane} scope {s} does not exist in the repo")

    def test_every_deny_entry_exists_or_is_a_known_future_path(self):
        missing = [d for d in self.pol["deny"] if not (ROOT / d).exists()]
        self.assertLessEqual(len(missing), 8, f"stale deny paths: {missing}")  # a typo would silently protect nothing

    def test_scope_inside_a_denied_path_is_refused(self):
        for bad in ("output_apps/enterprise_hub/migrations/", "output_apps/enterprise_hub/migrations/1789000000000-LegacyBaseline.ts",
                    "output_apps/generated_modules/smartjudge/prompt_library.py", "output_apps/enterprise_hub/modules/tax_compliance/",
                    "src/billing/", "output_apps/enterprise_hub/frontend/src/components/auth/", "Dockerfile.prod", "deploy/systemd/",
                    "output_apps/enterprise_hub/modules/country_packs/payment_rails/", "data/", ".github/workflows/deploy-prod.yml"):
            problems = lp.check_scopes(["docs/eval/", bad], self.pol, ROOT)
            self.assertTrue(problems, f"{bad} must be refused")
            self.assertTrue(any("denied" in p for p in problems), problems)

    def test_scope_that_is_a_parent_of_a_denied_path_is_refused(self):
        for parent in ("output_apps/", "output_apps/enterprise_hub/", "output_apps/enterprise_hub/modules/", "docs/", "docs/ops/", "docs/infra/", "config/", "src/", "scripts/"):
            problems = lp.check_scopes([parent], self.pol, ROOT)
            self.assertTrue(problems, f"{parent} contains denied paths and must be refused")

    def test_scope_containing_a_denied_name_below_it_is_refused_by_the_tree_walk(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "pkg" / "migrations").mkdir(parents=True)
            (Path(d) / "pkg" / "ok").mkdir()
            self.assertEqual(lp.check_scopes(["pkg/ok/"], self.pol, d), [])
            problems = lp.check_scopes(["pkg/"], self.pol, d)
            self.assertTrue(any("pkg/migrations" in p for p in problems), problems)

    def test_empty_whole_repo_glob_and_escape_scopes_are_refused(self):
        self.assertTrue(lp.check_scopes([], self.pol))
        for bad in (".", "./", "/", "", "docs/*", "../x", "docs/../deploy", "/etc"):
            self.assertTrue(lp.check_scopes([bad], self.pol), bad)

    def test_no_policy_means_no_restriction(self):
        self.assertEqual(lp.check_scopes([], {}), [])
        self.assertEqual(lp.check_scopes(["data/"], {}), [])

    def test_operator_env_overrides_the_table_but_is_still_checked(self):
        env = {"ORCH_SCOPE_L7": "docs/eval/,output_apps/enterprise_hub/migrations/"}
        scopes = lp.lane_scopes("L7", self.pol, env)
        self.assertEqual(scopes, ["docs/eval/", "output_apps/enterprise_hub/migrations/"])
        self.assertTrue(lp.check_scopes(scopes, self.pol, ROOT))
        self.assertEqual(lp.lane_scopes("L7", self.pol, {}), self.pol["lanes"]["L7"]["scopes"])

    def test_scopes_are_accepted_by_the_runner_scope_matcher_syntax(self):
        """run_task.sh matches by prefix: a plain dir with a trailing slash, no globs, no leading slash."""
        for lane in ("L5", "L6", "L7"):
            for s in lp.lane_scopes(lane, self.pol, {}):
                self.assertFalse(s.startswith("/") or ".." in s or re.search(r"[*?\[\]]", s), s)


class OrchPolicyTest(unittest.TestCase):
    """orch.py tick with the policy active: a lane whose scope touches a denied path is refused before any claim."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for name, src in (("gh", to.GH), ("git", to.GIT), ("runner", to.RUNNER)):
            p = self.tmp / name
            p.write_text(src.format(py=sys.executable))
            p.chmod(p.stat().st_mode | stat.S_IXUSR)
        (self.tmp / "budgets.json").write_text(json.dumps({"cost_log": str(self.tmp / "none.jsonl"), "default": {"attempts_per_day": 20}}))
        env = {"ROXIRA_AGENTS_HOME": str(self.tmp), "ORCH_HOME": str(self.tmp / "orch"), "TASKQ_DB": str(self.tmp / "taskq.db"),
               "TASKQ_RUNNER": str(self.tmp / "runner"), "TASKQ_NOTIFY": "0", "TASKQ_REVIEW": "0",
               "TASKQ_BUDGETS": str(self.tmp / "budgets.json"), "ORCH_GH": str(self.tmp / "gh"), "ORCH_GIT": str(self.tmp / "git"),
               "FAKE_WORLD": str(self.tmp / "world.json"), "FAKE_GH_LOG": str(self.tmp / "gh.log"), "FAKE_OK_STEPS": "best",  # the fake runner reports any --tier call as "best"
               "ORCH_REPO": "o/r", lp.POLICY_ENV: str(POLICY)}
        p = mock.patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)
        for k in ("TASKQ_STRONG_ALIAS", "TASKQ_LADDER", "ORCH_KILL_FILE", "FAKE_429", "ORCH_SCOPE_L5", "ORCH_SCOPE_L6", "ORCH_SCOPE_L7"):
            os.environ.pop(k, None)
        w = {"main": "aaaa1111", "wave_comments": [], "pulls": [],
             "issues": [to.issue(11, "L5"), to.issue(21, "L6"), to.issue(31, "L7")]}
        (self.tmp / "world.json").write_text(json.dumps(w))

    def writes(self):
        p = self.tmp / "gh.log"
        calls = [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
        return [c for c in calls if c["m"] != "GET"]

    def tick(self, *args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = orch.main(["tick", *args])
        return rc, buf.getvalue()

    def test_default_scopes_allow_every_lane_and_show_the_box_ladder(self):
        rc, out = self.tick()
        self.assertEqual(rc, 0)
        self.assertNotIn("scope policy refuses", out)
        self.assertIn("WOULD CLAIM #11 lane L5", out)
        self.assertIn("ladder: light,free,paid", out)
        self.assertEqual(self.writes(), [])

    def test_task_whose_scope_includes_a_denied_path_is_refused(self):
        os.environ["ORCH_SCOPE_L5"] = "output_apps/enterprise_hub/migrations/"
        os.environ["ORCH_SCOPE_L6"] = "output_apps/enterprise_hub/modules/country_packs/de/,src/billing/"
        os.environ["ORCH_SCOPE_L7"] = "output_apps/"  # a parent of denied paths
        rc, out = self.tick("--apply")
        self.assertEqual(rc, 0)
        self.assertNotIn("WOULD CLAIM", out)
        self.assertIn("lane L5: scope policy refuses", out)
        self.assertIn("lane L6: scope policy refuses", out)
        self.assertIn("lane L7: scope policy refuses", out)
        self.assertEqual(self.writes(), [], "no claim, label or comment may be written for a refused scope")
        self.assertFalse((self.tmp / "calls.log").exists(), "the runner must not be called")

    def test_empty_scope_is_refused_when_the_policy_requires_one(self):
        pol = json.loads(POLICY.read_text())
        pol["lanes"]["L5"]["scopes"] = []
        f = self.tmp / "p.json"
        f.write_text(json.dumps(pol))
        os.environ[lp.POLICY_ENV] = str(f)
        _, out = self.tick()
        self.assertIn("lane L5: scope policy refuses: no scope", out)
        self.assertIn("WOULD CLAIM #21 lane L6", out)

    def test_broken_policy_file_fails_closed(self):
        f = self.tmp / "bad.json"
        f.write_text("{nope")
        os.environ[lp.POLICY_ENV] = str(f)
        _, out = self.tick("--apply")
        self.assertNotIn("WOULD CLAIM", out)
        self.assertEqual(out.count("scope policy refuses"), 3)
        self.assertEqual(self.writes(), [])

    def test_apply_runs_the_light_step_through_the_gateway_tier(self):
        rc, out = self.tick("--apply")
        self.assertEqual(rc, 0)
        calls = (self.tmp / "calls.log").read_text()
        self.assertIn("--tier light", calls)
        self.assertNotIn("--model", calls)
        db = taskq.connect()
        scopes = [json.loads(r["scopes"]) for r in db.execute("SELECT scopes FROM tasks ORDER BY id")]
        self.assertIn(["output_apps/enterprise_hub/modules/accounting/acceptance/",
                       "output_apps/enterprise_hub/modules/accounting/__fixtures__/", "docs/accounting/"], scopes)

    def test_bad_ladder_or_missing_runner_is_refused_before_any_claim(self):
        os.environ["TASKQ_LADDER"] = "light,gpt-9"
        _, out = self.tick("--apply")
        self.assertIn("ladder step 'gpt-9' is unknown", out)
        self.assertEqual(self.writes(), [])
        os.environ["TASKQ_LADDER"] = "ds-flash,light"
        _, out = self.tick("--apply")
        self.assertIn("direct provider call", out)
        self.assertEqual(self.writes(), [])
        os.environ.pop("TASKQ_LADDER")
        os.environ.pop("TASKQ_RUNNER")
        _, out = self.tick("--apply")
        self.assertIn("TASKQ_RUNNER is not set", out)
        self.assertEqual(self.writes(), [])
        self.assertFalse((self.tmp / "calls.log").exists())

    def test_default_ladder_without_policy_still_validates_but_allows_direct_steps(self):
        os.environ.pop(lp.POLICY_ENV)
        os.environ.pop("TASKQ_RUNNER")
        self.assertEqual(orch.scope_problems("L5"), [])  # unchanged behaviour outside the box
        os.environ["TASKQ_LADDER"] = "nonsense"
        self.assertTrue(orch.scope_problems("L5"))

    def test_taskq_add_refuses_a_denied_or_missing_scope(self):
        task = self.tmp / "t.md"
        task.write_text("x")
        for scope in (["--scope", "output_apps/enterprise_hub/migrations/"], []):
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                rc = taskq.main(["add", "--slug", "s", "--task-file", str(task), "--public", "--lane", "l5", *scope])
            self.assertEqual(rc, 2)
            self.assertIn("refused by the box lane policy", err.getvalue())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = taskq.main(["add", "--slug", "s", "--task-file", str(task), "--public", "--lane", "l7", "--scope", "docs/eval/"])
        self.assertEqual(rc, 0)
        row = taskq.connect().execute("SELECT ladder FROM tasks WHERE id=?", (int(out.getvalue().strip()),)).fetchone()
        self.assertEqual(json.loads(row["ladder"]), ["light", "free", "paid"])


if __name__ == "__main__":
    unittest.main()
