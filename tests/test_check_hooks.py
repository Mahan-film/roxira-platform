import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "dev" / "check_hooks.sh"


class CheckHooksTest(unittest.TestCase):
    def test_detects_missing_and_present_gitleaks_hook(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = pathlib.Path(tmp) / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)

            res_missing = subprocess.run(
                ["bash", str(SCRIPT), str(repo)],
                capture_output=True,
                text=True,
                env={**os.environ, "ROXIRA_WT_ROOT": ""},
            )
            self.assertNotEqual(res_missing.returncode, 0)
            self.assertIn("NO_GITLEAKS", res_missing.stdout)

            hook = repo / ".git" / "hooks" / "pre-push"
            hook.write_text("#!/usr/bin/env bash\ngitleaks protect\n", encoding="utf-8")
            hook.chmod(0o755)

            res_ok = subprocess.run(
                ["bash", str(SCRIPT), str(repo)],
                capture_output=True,
                text=True,
                env={**os.environ, "ROXIRA_WT_ROOT": ""},
            )
            self.assertEqual(res_ok.returncode, 0, res_ok.stdout + res_ok.stderr)
            self.assertIn("OK", res_ok.stdout)


if __name__ == "__main__":
    unittest.main()
