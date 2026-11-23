"""orch.gh_list works without `gh api --slurp` (gh < 2.48) and orch.trusted honours a numeric-id allowlist.

Stdlib unittest, collected by CI's pytest job (testpaths = src). No network. Modules are loaded lazily so importing
this file has no side effects (src/test_ci_quarantine_guard.py).
"""
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
orch = None


def setUpModule():
    global orch
    sys.path.insert(0, str(ROOT / "scripts/infra/server_agents"))
    import orch as _orch

    orch = _orch


def fake_run(stdout, rc=0, stderr=""):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, rc, stdout, stderr)

    return run, seen


class GhListTest(unittest.TestCase):
    def test_concatenated_pages_are_flattened(self):
        run, seen = fake_run('[{"number": 1}, {"number": 2}]\n[{"number": 3}]\n')
        with mock.patch.object(orch.subprocess, "run", run):
            self.assertEqual([x["number"] for x in orch.gh_list("repos/o/r/issues")], [1, 2, 3])
        self.assertNotIn("--slurp", seen["cmd"])
        self.assertIn("--paginate", seen["cmd"])

    def test_single_object_and_empty(self):
        run, _ = fake_run('{"a": 1}')
        with mock.patch.object(orch.subprocess, "run", run):
            self.assertEqual(orch.gh_list("x"), [{"a": 1}])
        run, _ = fake_run("")
        with mock.patch.object(orch.subprocess, "run", run):
            self.assertEqual(orch.gh_list("x"), [])

    def test_failure_raises(self):
        run, _ = fake_run("", rc=1, stderr="boom")
        with mock.patch.object(orch.subprocess, "run", run):
            with self.assertRaises(orch.GhError):
                orch.gh_list("x")


class TrustedIdsTest(unittest.TestCase):
    ITEM = {"user": {"login": "x", "id": 42, "type": "User"}, "author_association": "CONTRIBUTOR", "body": "t"}

    def test_contributor_not_trusted_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ORCH_TRUSTED_USER_IDS", None)
            self.assertFalse(orch.trusted(self.ITEM))

    def test_allowlisted_id_is_trusted_others_are_not(self):
        with mock.patch.dict(os.environ, {"ORCH_TRUSTED_USER_IDS": "7, 42,abc"}):
            self.assertTrue(orch.trusted(self.ITEM))
            self.assertFalse(orch.trusted(dict(self.ITEM, user={"login": "y", "id": 43, "type": "User"})))
            self.assertFalse(orch.trusted(dict(self.ITEM, user={"login": "z[bot]", "id": 42, "type": "Bot"})))


if __name__ == "__main__":
    unittest.main()
