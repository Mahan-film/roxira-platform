"""Tests for scripts/ops/ci_box/box_backup (restic backup of the box's own data, user level).

Stdlib unittest. Everything runs against a fixture HOME in a temp dir with a throwaway restic repository and
password; nothing touches real data. Tests that need the restic binary skip when it is not installed.
"""
import importlib.util
import os
import shutil
import stat
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / "scripts/ops/ci_box/box_backup"
scan = None


def linux():
    return sys.platform.startswith("linux")  # the scripts use GNU stat/sha256sum/shuf/flock


def e2e_enabled():
    """Real restic round trips take about 40 s: opt in with BOX_BACKUP_E2E=1 (and restic installed)."""
    return os.environ.get("BOX_BACKUP_E2E") == "1" and shutil.which("restic") is not None
FAKE_SECRET = "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2"  # assembled so this file itself never matches a scanner


def setUpModule():
    global scan
    spec = importlib.util.spec_from_file_location("box_backup_secret_scan", DIR / "secret_scan.py")
    scan = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scan)


class Fixture(unittest.TestCase):
    def setUp(self):
        if not linux():
            self.skipTest("Linux only")
        self.tmp = Path(tempfile.mkdtemp(prefix="boxbk."))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        h = self.home
        (h / ".config/roxira-lane").mkdir(parents=True)
        (h / ".config/roxira-lane/lane-run.conf").write_text("TIER=light\n")
        (h / ".config/roxira-lane/gateway.env").write_text("GATEWAY_KEY=hunter2hunter2hunter2hunter2\n")
        (h / ".config/roxira-lane/tunnel.env").write_text("X=1\n")
        (h / ".config/roxira-merge-gate").mkdir(parents=True)
        (h / ".config/roxira-merge-gate/merge_gate.toml").write_text('repo = "o/r"\n')
        (h / ".config/roxira-merge-gate/notify.env").write_text("NOTIFY_BOT_TOKEN=1\n")
        (h / ".config/systemd/user").mkdir(parents=True)
        (h / ".config/systemd/user/a.service").write_text("[Unit]\n")
        (h / ".config/systemd/user/leaky.service").write_text(f"Environment=API={FAKE_SECRET}\n")
        (h / ".local/state/roxira-box").mkdir(parents=True)
        (h / ".local/state/roxira-box/mirror.last").write_text("OK 2026-01-01T00:00:00Z\n")
        (h / ".local/state/roxira-lane/logs").mkdir(parents=True)
        (h / ".local/state/roxira-lane/logs/run.log").write_text("log\n")
        (h / ".local/state/roxira-lane/repo.git").mkdir(parents=True)
        (h / ".local/state/roxira-lane/repo.git/HEAD").write_text("ref\n")
        (h / ".roxira-agents").mkdir()
        import sqlite3
        con = sqlite3.connect(h / ".roxira-agents/taskq.db")
        con.execute("create table t(x)")
        con.execute("insert into t values (1)")
        con.commit()
        con.close()
        (self.tmp / "phone").mkdir()
        (self.tmp / "phone/phone-stack.conf").write_text("COMPOSE=/x\n")
        (self.tmp / "export/2026-01-01").mkdir(parents=True)
        (self.tmp / "export/2026-01-01/MANIFEST.txt").write_text("repo=x\n")
        self.repo = self.tmp / "repo"
        self.pw = self.tmp / "restic.pass"
        self.pw.write_text("throwaway-test-password\n")
        self.pw.chmod(0o600)
        self.conf = self.tmp / "backup.conf"
        self.write_conf()
        self.env = {
            "PATH": os.environ["PATH"], "HOME": str(h), "TMPDIR": str(self.tmp),
            "BOX_BACKUP_CONFIG": str(self.conf), "BOX_BACKUP_STATE_DIR": str(self.tmp / "state"),
            "BOX_BACKUP_WORK_DIR": str(self.tmp / "work"), "BOX_BACKUP_PHONE_DIR": str(self.tmp / "phone"),
            "BOX_BACKUP_EXPORT_DIR": str(self.tmp / "export"),
        }

    def write_conf(self, extra=""):
        self.conf.write_text(f"REPOSITORY={self.repo}\nPASSWORD_FILE={self.pw}\n{extra}")

    def sh(self, script, *args, env=None):
        e = dict(self.env)
        e.update(env or {})
        return subprocess.run(["bash", str(DIR / script), *args], env=e, capture_output=True, text=True, timeout=120)

    def marker(self):
        p = self.tmp / "state/backup.last"
        return p.read_text() if p.exists() else ""


class SecretScan(unittest.TestCase):
    def test_flags_keys_and_ignores_env_references(self):
        with tempfile.TemporaryDirectory() as d:
            bad, good = Path(d, "bad"), Path(d, "good")
            bad.write_text(f"token = {FAKE_SECRET}\n")
            good.write_text("api_key: os.environ/OPENROUTER_API_KEY_FOR_X_Y_Z\nname = value\n")
            self.assertEqual(scan.scan(str(good)), "")
            self.assertTrue(scan.scan(str(bad)))
            pem = Path(d, "pem")
            pem.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n")
            self.assertEqual(scan.scan(str(pem)), "private-key-block")


class DryRunAndSkip(Fixture):
    def test_dry_run_lists_without_secrets_and_writes_nothing(self):
        r = self.sh("box_backup.sh")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn("dry-run", out)
        for wanted in ("lane-run.conf", "merge_gate.toml", "mirror.last", "phone-stack.conf", "export/2026-01-01", "a.service"):
            self.assertIn(wanted, out)
        for secret in ("gateway.env", "tunnel.env", "notify.env", "repo.git"):
            self.assertNotIn(secret, out)
        self.assertIn("leaky.service", out, "dropped file is reported by name")
        self.assertNotIn(FAKE_SECRET, out + r.stderr)
        self.assertFalse((self.tmp / "state").exists() and any((self.tmp / "state").iterdir()))
        self.assertFalse(self.repo.exists())

    def test_apply_without_password_is_a_noop_with_skip_marker(self):
        self.pw.unlink()
        r = self.sh("box_backup.sh", "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("SKIP", r.stdout)
        self.assertTrue(self.marker().startswith("SKIP "))
        self.assertFalse(self.repo.exists())

    def test_password_file_must_be_mode_600(self):
        self.pw.chmod(0o644)
        r = self.sh("box_backup.sh", "--apply")
        self.assertIn("SKIP", r.stdout)
        self.assertIn("mode 600", r.stdout)

    def stub_restic(self):
        """A restic that does nothing, so precondition handling can be tested without the real binary."""
        bindir = self.tmp / "bin"
        bindir.mkdir()
        (bindir / "restic").write_text("#!/bin/sh\nexit 0\n")
        (bindir / "restic").chmod(0o755)
        return {"PATH": f"{bindir}:{os.environ['PATH']}"}

    def test_configured_but_unusable_repository_is_a_fail_not_a_skip(self):
        self.repo = Path("/proc/nope/repo")  # cannot be created
        self.write_conf()
        r = self.sh("box_backup.sh", "--apply", env=self.stub_restic())
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertTrue(self.marker().startswith("FAIL "), self.marker())
        self.assertIn("sudo install -d", r.stdout + r.stderr)

    def test_notify_hook_is_noop_without_env_file(self):
        r = subprocess.run(["bash", str(DIR / "notify_failure.sh")], env={**self.env, "BOX_BACKUP_NOTIFY_ENV": str(self.tmp / "none.env")},
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("skipped", r.stdout)

    def test_notify_hook_is_noop_with_empty_token(self):
        f = self.tmp / "n.env"
        f.write_text("NOTIFY_BOT_TOKEN=\nNOTIFY_CHAT_ID=\n")
        f.chmod(0o600)
        r = subprocess.run(["bash", str(DIR / "notify_failure.sh")], env={**self.env, "BOX_BACKUP_NOTIFY_ENV": str(f)},
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("skipped", r.stdout)


class BackupAndDrill(Fixture):
    def setUp(self):
        if not e2e_enabled():
            self.skipTest("set BOX_BACKUP_E2E=1 (and have restic installed) for the real round trips")
        super().setUp()

    def test_backup_is_idempotent_secret_free_and_restorable(self):
        r = self.sh("box_backup.sh", "--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(self.marker().startswith("OK "), self.marker())
        r2 = self.sh("box_backup.sh", "--apply")
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
        ls = subprocess.run(["restic", "-r", str(self.repo), "--password-file", str(self.pw), "ls", "latest"],
                            capture_output=True, text=True).stdout
        self.assertIn("lane-run.conf", ls)
        self.assertIn("taskq.db", ls)
        self.assertIn("MANIFEST.sha256", ls)
        for secret in ("gateway.env", "tunnel.env", "notify.env", "leaky.service", "repo.git"):
            self.assertNotIn(secret, ls)
        d = self.sh("restore_drill.sh", "--sample", "5")
        self.assertEqual(d.returncode, 0, d.stdout + d.stderr)
        self.assertIn("DRILL OK", d.stdout)
        self.assertTrue((self.tmp / "state/backup-drill.last").read_text().startswith("OK "))
        self.assertFalse(any((self.tmp / "work/drill").iterdir()), "scratch dir removed")

    def test_drill_refuses_a_non_empty_target_and_unsafe_targets(self):
        self.sh("box_backup.sh", "--apply")
        busy = self.tmp / "busy"
        busy.mkdir()
        (busy / "x").write_text("1")
        self.assertNotEqual(self.sh("restore_drill.sh", "--target", str(busy)).returncode, 0)
        self.assertEqual((busy / "x").read_text(), "1")
        self.assertNotEqual(self.sh("restore_drill.sh", "--target", "/etc").returncode, 0)

    def test_manifest_covers_every_backed_up_file(self):
        self.sh("box_backup.sh", "--apply")
        r = self.sh("restore_drill.sh", "--keep", "--sample", "1000")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        kept = next((self.tmp / "work/drill").iterdir())
        lines = next(kept.rglob("MANIFEST.sha256")).read_text().splitlines()
        self.assertTrue(all(len(ln.split()[0]) == 64 for ln in lines))
        names = " ".join(lines)
        for wanted in ("lane-run.conf", "taskq.db", "mirror.last", "phone-stack.conf"):
            self.assertIn(wanted, names)
        self.assertIn(f"of {len(lines)} manifest files", r.stdout)

    def test_offbox_on_the_same_filesystem_is_refused(self):
        self.write_conf(f"OFFBOX_REPOSITORY={self.tmp / 'second'}\n")
        (self.tmp / "second").mkdir()
        r = self.sh("box_backup.sh", "--apply")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("same filesystem", r.stdout + r.stderr)
        self.assertTrue(self.marker().startswith("OK "), "primary backup still succeeded")

    def test_offbox_copy_to_another_filesystem(self):
        shm = Path("/dev/shm")
        if not shm.is_dir() or not os.access(shm, os.W_OK) or shm.stat().st_dev == self.tmp.stat().st_dev:
            self.skipTest("no second filesystem available")
        second = Path(tempfile.mkdtemp(prefix="boxbk-off.", dir=shm))
        self.addCleanup(shutil.rmtree, second, ignore_errors=True)
        self.write_conf(f"OFFBOX_REPOSITORY={second}\n")
        r = self.sh("box_backup.sh", "--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue((self.tmp / "state/backup.offbox.last").read_text().startswith("OK "))
        d = self.sh("restore_drill.sh", "--repo", "offbox", "--sample", "3")
        self.assertEqual(d.returncode, 0, d.stdout + d.stderr)


class Units(unittest.TestCase):
    def test_timer_is_staggered_and_persistent(self):
        t = (DIR / "roxira-box-backup.timer").read_text()
        self.assertRegex(t, r"OnCalendar=\*-\*-\* \d\d:(?!00)\d\d:\d\d")
        self.assertIn("Persistent=true", t)
        self.assertIn("RandomizedDelaySec", t)

    def test_service_runs_apply_and_notifies_on_failure(self):
        s = (DIR / "roxira-box-backup.service").read_text()
        self.assertIn("--apply", s)
        self.assertIn("OnFailure=roxira-box-backup-notify.service", s)

    def test_scripts_are_executable(self):
        for f in ("box_backup.sh", "restore_drill.sh", "notify_failure.sh", "install_user.sh", "secret_scan.py"):
            self.assertTrue((DIR / f).stat().st_mode & stat.S_IXUSR, f)


if __name__ == "__main__":
    unittest.main()
