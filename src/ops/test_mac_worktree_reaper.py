"""Offline tests for scripts/dev/mac_worktree_reaper.py safety predicates (fake git repos only)."""

import importlib.util
import os
import subprocess
import tempfile
import unittest

reaper = None


def _script_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "..", "..", "scripts", "dev", "mac_worktree_reaper.py")


def setUpModule():
    global reaper
    spec = importlib.util.spec_from_file_location("mac_worktree_reaper", _script_path())
    reaper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reaper)


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


class ReaperSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        git(t, "init", "-q", "--bare", "remote.git")
        git(t, "clone", "-q", "remote.git", "repo")
        self.repo = os.path.join(t, "repo")
        for cfg in (("user.email", "t@example.com"), ("user.name", "t")):
            git(self.repo, "config", *cfg)
        open(os.path.join(self.repo, "f"), "w").write("1")
        git(self.repo, "add", "f")
        git(self.repo, "commit", "-qm", "init")
        git(self.repo, "branch", "-M", "main")
        git(self.repo, "push", "-q", "origin", "main")
        reaper.REPO = self.repo

    def tearDown(self):
        self.tmp.cleanup()

    def wt(self, name):
        path = os.path.join(self.tmp.name, "wt-" + name)
        git(self.repo, "worktree", "add", "-q", "-b", name, path, "main")
        return {"worktree": path}

    def test_clean_pushed_worktree_is_safe(self):
        wt = self.wt("pushed")
        git(self.repo, "push", "-q", "origin", "pushed")
        git(self.repo, "fetch", "-q", "origin")
        ok, why = reaper.is_safe(wt, 0, [], [])
        self.assertTrue(ok, why)

    def test_dirty_worktree_is_kept(self):
        wt = self.wt("dirty")
        git(self.repo, "push", "-q", "origin", "dirty")
        git(self.repo, "fetch", "-q", "origin")
        open(os.path.join(wt["worktree"], "new"), "w").write("x")
        ok, why = reaper.is_safe(wt, 0, [], [])
        self.assertFalse(ok)
        self.assertEqual(why, "dirty-or-unknown")

    def test_unpushed_commit_is_kept(self):
        wt = self.wt("unpushed")
        open(os.path.join(wt["worktree"], "u"), "w").write("u")
        git(wt["worktree"], "add", "u")
        git(wt["worktree"], "commit", "-qm", "u")
        ok, why = reaper.is_safe(wt, 0, [], [])
        self.assertFalse(ok)
        self.assertEqual(why, "not-on-remote")

    def test_failed_git_status_is_not_clean(self):
        broken = os.path.join(self.tmp.name, "not-a-repo")
        os.mkdir(broken)
        ok, _ = reaper.run_checked(["git", "status", "--porcelain"], broken)
        self.assertFalse(ok)

    def test_in_use_prefix_does_not_false_positive(self):
        wt = self.wt("issue-1")
        git(self.repo, "push", "-q", "origin", "issue-1")
        git(self.repo, "fetch", "-q", "origin")
        sibling = wt["worktree"] + "2"
        ok, why = reaper.is_safe(wt, 0, [sibling], [])
        self.assertTrue(ok, why)
        ok, why = reaper.is_safe(wt, 0, [wt["worktree"] + "/sub"], [])
        self.assertEqual(why, "in-use")

    def test_recent_activity_is_kept(self):
        wt = self.wt("recent")
        git(self.repo, "push", "-q", "origin", "recent")
        git(self.repo, "fetch", "-q", "origin")
        ok, why = reaper.is_safe(wt, 24, [], [])
        self.assertFalse(ok)
        self.assertEqual(why, "recent")

    def test_inside_is_component_wise(self):
        self.assertTrue(reaper.inside("/wt/a/b", "/wt/a"))
        self.assertFalse(reaper.inside("/wt/ab", "/wt/a"))


if __name__ == "__main__":
    unittest.main()
