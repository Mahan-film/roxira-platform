"""Tests for scripts/dev/bootstrap_worktree.sh and claim.sh disk guard (#1318)."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BOOTSTRAP_SCRIPT = ROOT / "scripts" / "dev" / "bootstrap_worktree.sh"
CLAIM_SCRIPT = ROOT / "scripts" / "dev" / "claim.sh"


class TestBootstrapWorktree(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="test_bootstrap_py_"))
        self.mock_bin = self.tmp / "mock_bin"
        self.mock_bin.mkdir(parents=True, exist_ok=True)
        self.mock_log = self.tmp / "npm.log"

        # Mock npm
        npm = self.mock_bin / "npm"
        npm.write_text(
            f"#!/usr/bin/env bash\n"
            f'echo "npm $*" >> "{self.mock_log}"\n'
            f"mkdir -p node_modules\n"
            f'echo "installed" > node_modules/installed.txt\n'
        )
        npm.chmod(0o755)

        # Mock gh
        gh = self.mock_bin / "gh"
        gh.write_text(
            "#!/usr/bin/env bash\n"
            'case "$*" in\n'
            '  *"-q .title"*) echo "Mock Title"; exit 0 ;;\n'
            '  *"-q .login"*) echo "mock-user"; exit 0 ;;\n'
            '  *".labels[].name"*) echo ""; exit 0 ;;\n'
            "  *) exit 0 ;;\n"
            "esac\n"
        )
        gh.chmod(0o755)

        self.env = os.environ.copy()
        self.env["PATH"] = f"{self.mock_bin}:{self.env.get('PATH', '')}"
        self.env["NPM_CMD"] = str(npm)
        self.env["MOCK_NPM_LOG"] = str(self.mock_log)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_same_lock_uses_cow(self):
        base = self.tmp / "base"
        wt = self.tmp / "wt"
        (base / "mod" / "node_modules" / "pkg").mkdir(parents=True, exist_ok=True)
        (wt / "mod").mkdir(parents=True, exist_ok=True)

        lock_data = '{"name": "test", "version": "1.0.0"}'
        (base / "mod" / "package-lock.json").write_text(lock_data)
        (wt / "mod" / "package-lock.json").write_text(lock_data)
        (base / "mod" / "node_modules" / "pkg" / "data.txt").write_text("marker_base")

        res = subprocess.run(
            ["bash", str(BOOTSTRAP_SCRIPT), str(wt), str(base), "mod"],
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(res.returncode, 0)
        self.assertTrue((wt / "mod" / "node_modules" / "pkg" / "data.txt").exists())
        self.assertEqual(
            (wt / "mod" / "node_modules" / "pkg" / "data.txt").read_text(),
            "marker_base",
        )
        # npm ci should NOT have been invoked
        self.assertFalse(self.mock_log.exists())

    def test_different_lock_falls_back_to_npm(self):
        base = self.tmp / "base"
        wt = self.tmp / "wt"
        (base / "mod" / "node_modules" / "pkg").mkdir(parents=True, exist_ok=True)
        (wt / "mod").mkdir(parents=True, exist_ok=True)

        (base / "mod" / "package-lock.json").write_text('{"version": "1.0.0"}')
        (wt / "mod" / "package-lock.json").write_text('{"version": "2.0.0"}')

        res = subprocess.run(
            ["bash", str(BOOTSTRAP_SCRIPT), str(wt), str(base), "mod"],
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(res.returncode, 0)
        self.assertTrue(self.mock_log.exists())
        self.assertIn("npm ci", self.mock_log.read_text())
        self.assertTrue((wt / "mod" / "node_modules" / "installed.txt").exists())

    def test_no_cow_falls_back_to_npm(self):
        base = self.tmp / "base"
        wt = self.tmp / "wt"
        (base / "mod" / "node_modules" / "pkg").mkdir(parents=True, exist_ok=True)
        (wt / "mod").mkdir(parents=True, exist_ok=True)

        lock_data = '{"name": "test", "version": "1.0.0"}'
        (base / "mod" / "package-lock.json").write_text(lock_data)
        (wt / "mod" / "package-lock.json").write_text(lock_data)

        env = self.env.copy()
        env["COW_DISABLE"] = "1"

        res = subprocess.run(
            ["bash", str(BOOTSTRAP_SCRIPT), str(wt), str(base), "mod"],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(res.returncode, 0)
        self.assertTrue(self.mock_log.exists())
        self.assertIn("npm ci", self.mock_log.read_text())

    def test_non_destructive_guarantee(self):
        base = self.tmp / "base"
        wt = self.tmp / "wt"
        (base / "mod" / "node_modules" / "base_pkg").mkdir(parents=True, exist_ok=True)
        (wt / "mod" / "node_modules" / "existing_pkg").mkdir(parents=True, exist_ok=True)

        lock_data = '{"name": "test", "version": "1.0.0"}'
        (base / "mod" / "package-lock.json").write_text(lock_data)
        (wt / "mod" / "package-lock.json").write_text(lock_data)
        (wt / "mod" / "node_modules" / "existing_pkg" / "keep.txt").write_text("safe")

        res = subprocess.run(
            ["bash", str(BOOTSTRAP_SCRIPT), str(wt), str(base), "mod"],
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(res.returncode, 0)
        self.assertTrue(
            (wt / "mod" / "node_modules" / "existing_pkg" / "keep.txt").exists()
        )
        self.assertEqual(
            (wt / "mod" / "node_modules" / "existing_pkg" / "keep.txt").read_text(),
            "safe",
        )
        self.assertFalse(self.mock_log.exists())

    def test_claim_disk_guard(self):
        wt_dummy = self.tmp / "wt_dummy"
        wt_dummy.mkdir(parents=True, exist_ok=True)

        env = self.env.copy()
        env["ROXIRA_MIN_FREE_GIB"] = "999999999"
        env["ROXIRA_WT_ROOT"] = str(wt_dummy)

        res = subprocess.run(
            ["bash", str(CLAIM_SCRIPT), "123", "test-slug"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
            env=env,
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("claim.sh: ERROR: disk space too low", res.stderr)
        self.assertIn("worktree prune --dry-run", res.stderr)


if __name__ == "__main__":
    unittest.main()
