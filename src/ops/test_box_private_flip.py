"""Tests for the prerequisite logic of scripts/ops/ci_box/private_flip.py. Stdlib unittest, fixtures only (no gh, no network)."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("private_flip", ROOT / "scripts/ops/ci_box/private_flip.py")
pf = importlib.util.module_from_spec(spec)
sys.modules["private_flip"] = pf
spec.loader.exec_module(pf)


def run(i, conclusion="success", status="completed"):
    return {"id": i, "status": status, "conclusion": conclusion}


HOSTED = {"runner_name": "GitHub Actions 7", "name": "Pick runner"}
JIT = {"runner_name": "jit-light-abc-123", "name": "Detect changes"}
SKIPPED = {"runner_name": "", "name": "Deploy"}


def good_jobs(ids):
    return {i: [HOSTED, JIT, SKIPPED] for i in ids}


class GateLive(unittest.TestCase):
    def test_false_passes(self):
        self.assertTrue(pf.check_gate_live("dry_run = false\n")[0])

    def test_true_missing_and_garbage_fail(self):
        self.assertFalse(pf.check_gate_live("dry_run = true\n")[0])
        self.assertFalse(pf.check_gate_live("label = 'x'\n")[0])
        self.assertFalse(pf.check_gate_live('dry_run = "false"\n')[0])
        self.assertFalse(pf.check_gate_live("dry_run = = =")[0])


class RunnerMode(unittest.TestCase):
    def test_modes(self):
        self.assertTrue(pf.check_runner_mode("auto")[0])
        self.assertTrue(pf.check_runner_mode("box\n")[0])
        for bad in (None, "", "  ", "hosted", "garbage"):
            self.assertFalse(pf.check_runner_mode(bad)[0], bad)


class MainRuns(unittest.TestCase):
    def test_three_green_jit(self):
        runs = [run(3), run(2), run(1)]
        self.assertTrue(pf.check_main_runs(runs, good_jobs([1, 2, 3]))[0])

    def test_in_flight_runs_are_ignored(self):
        runs = [run(5, "", "in_progress"), run(4, "", "queued"), run(3), run(2), run(1)]
        ok, ev = pf.check_main_runs(runs, good_jobs([1, 2, 3]))
        self.assertTrue(ok, ev)

    def test_fewer_than_three_completed_fails(self):
        self.assertFalse(pf.check_main_runs([run(2), run(1)], good_jobs([1, 2]))[0])

    def test_a_failure_among_the_last_three_fails(self):
        runs = [run(3), run(2, "failure"), run(1)]
        ok, ev = pf.check_main_runs(runs, good_jobs([1, 2, 3]))
        self.assertFalse(ok)
        self.assertIn("run 2", ev)

    def test_old_failure_outside_the_window_is_fine(self):
        runs = [run(4), run(3), run(2), run(1, "failure")]
        self.assertTrue(pf.check_main_runs(runs, good_jobs([2, 3, 4]))[0])

    def test_old_runner_job_fails(self):
        jobs = good_jobs([1, 2, 3])
        jobs[2] = [HOSTED, {"runner_name": "roxira-ci", "name": "x"}]
        ok, ev = pf.check_main_runs([run(3), run(2), run(1)], jobs)
        self.assertFalse(ok)
        self.assertIn("run 2", ev)

    def test_no_jit_job_fails(self):
        jobs = good_jobs([1, 2, 3])
        jobs[1] = [HOSTED, SKIPPED]
        self.assertFalse(pf.check_main_runs([run(3), run(2), run(1)], jobs)[0])

    def test_missing_jobs_fail(self):
        self.assertFalse(pf.check_main_runs([run(3), run(2), run(1)], {})[0])


class Evaluate(unittest.TestCase):
    def test_all_must_pass(self):
        ok, lines = pf.evaluate_prereqs([("a", (True, "x")), ("b", (False, "y"))])
        self.assertFalse(ok)
        self.assertIn("[FAIL] b", lines[1])
        self.assertTrue(pf.evaluate_prereqs([("a", (True, "x"))])[0])


class Label(unittest.TestCase):
    def test_states(self):
        self.assertTrue(pf.label_state(True, "merge-queue")[0])
        self.assertFalse(pf.label_state(False, "merge-queue")[0])
        self.assertFalse(pf.label_state(True, "other")[0])


class ApplyRefusal(unittest.TestCase):
    """--apply must not change anything when a prerequisite fails or the owner flag is missing."""

    def test_apply_without_owner_go_refused(self):
        with mock.patch.object(pf, "gather_prereqs") as g:
            self.assertEqual(pf.main(["--apply"]), 2)
            g.assert_not_called()

    def test_apply_with_failed_prereq_changes_nothing(self):
        with mock.patch.object(pf, "gather_prereqs", return_value=[("gate", (False, "dry_run = true"))]), \
                mock.patch.object(pf, "step_flip") as flip, mock.patch.object(pf, "step_disable_automerge") as dis:
            self.assertEqual(pf.main(["--apply", "--owner-go"]), 1)
            flip.assert_not_called()
            dis.assert_not_called()

    def test_dry_run_with_failed_prereq_exits_1(self):
        with mock.patch.object(pf, "gather_prereqs", return_value=[("gate", (False, "x"))]):
            self.assertEqual(pf.main([]), 1)

    def test_rollback_is_text_only(self):
        cmds = pf.rollback_commands()
        self.assertTrue(any("--visibility public" in c for c in cmds))
        self.assertTrue(any("agent-automerge.yml" in c for c in cmds))


if __name__ == "__main__":
    unittest.main()
