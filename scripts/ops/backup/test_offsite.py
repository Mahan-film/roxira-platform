"""Offline tests for the off-site backup helpers. No docker, no network, no real secrets.
Run: cd scripts/ops/backup && python3 -m unittest test_offsite -v"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import offsite_tools as t  # noqa: E402

FAKE_URL = "postgresql://neondb_owner:Sup3rS3cretPw@ep-cool-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"
FAKE_TOKEN = "fake_offsite_token_123"


def bash(script: str, env=None):
    e = {**os.environ, **(env or {})}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=e, cwd=HERE)


class Redact(unittest.TestCase):
    def setUp(self):
        os.environ["NEON_BACKUP_URL"] = FAKE_URL
        os.environ["CODEBERG_TOKEN"] = FAKE_TOKEN

    def test_url_password_and_token_masked(self):
        text = f"connection failed: {FAKE_URL}\nremote: auth {FAKE_TOKEN} bad\nhost=x password=Sup3rS3cretPw"
        out = t.redact(text)
        for secret in ("Sup3rS3cretPw", FAKE_TOKEN, "neondb_owner"):
            self.assertNotIn(secret, out)
        self.assertNotIn("neondb_owner", out)

    def test_userinfo_masked_even_for_unknown_urls(self):
        out = t.redact("fatal: unable to access 'https://user:ghp_unknownvalue@github.com/x/y.git/'")
        self.assertNotIn("ghp_unknownvalue", out)
        self.assertNotIn("user:", out)

    def test_basic_header_and_query_params(self):
        out = t.redact("Authorization: Basic dXNlcjpwYXNzd29yZA== and ?password=abc123&x=1")
        self.assertNotIn("dXNlcjpwYXNzd29yZA", out)
        self.assertNotIn("abc123", out)

    def test_shell_log_function_redacts(self):
        r = bash(
            f'. ./offsite_lib.sh; log "pg said: {FAKE_URL} and {FAKE_TOKEN}"',
            {"NEON_BACKUP_URL": FAKE_URL, "CODEBERG_TOKEN": FAKE_TOKEN},
        )
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("Sup3rS3cretPw", r.stderr)
        self.assertNotIn(FAKE_TOKEN, r.stderr)


class UrlHelpers(unittest.TestCase):
    def test_url_with_db_keeps_credentials_and_query(self):
        u = t.url_with_db(FAKE_URL, "bk_umami")
        self.assertTrue(u.endswith("/bk_umami?sslmode=require"))
        self.assertIn("Sup3rS3cretPw@ep-cool-123", u)

    def test_bad_db_name_rejected(self):
        with self.assertRaises(ValueError):
            t.url_with_db(FAKE_URL, "x; DROP DATABASE y")

    def test_pooler_and_garbage_rejected(self):
        self.assertEqual(t.check_url(FAKE_URL), 0)
        self.assertEqual(t.check_url(FAKE_URL.replace("ep-cool-123", "ep-cool-123-pooler")), 3)
        self.assertEqual(t.check_url("mysql://a:b@h/db"), 4)
        self.assertEqual(t.check_url(""), 4)


class Counts(unittest.TestCase):
    def test_count_sql_quotes_identifiers(self):
        sql = t.count_sql(['public|users\n', 'public|we"ird\n', 'bad-line\n'])
        self.assertIn('FROM "public"."users"', sql)
        self.assertIn('"we""ird"', sql)
        self.assertEqual(sql.count("UNION ALL"), 1)
        self.assertTrue(sql.endswith("ORDER BY 1;"))

    def test_compare(self):
        src = {"public.a": 1000, "public.b": 5, "public.c": 0}
        self.assertEqual(t.compare(src, {"public.a": 1015, "public.b": 5, "public.c": 0}), [])
        self.assertTrue(t.compare(src, {"public.a": 800, "public.b": 5, "public.c": 0}))
        self.assertTrue(t.compare(src, {"public.a": 1000, "public.c": 0}))  # missing table
        self.assertTrue(t.compare(src, {"public.a": 0, "public.b": 5, "public.c": 0}))  # empty target
        self.assertTrue(t.compare({}, {}))


class ShellBuilders(unittest.TestCase):
    def test_client_run_has_no_url_in_argv(self):
        r = bash(
            ". ./offsite_lib.sh; build_pg_restore_run | xargs -0 printf '%s\\n'",
            {"NEON_TARGET_URL": FAKE_URL},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Sup3rS3cretPw", r.stdout)
        self.assertIn("--network", r.stdout)
        self.assertIn("host", r.stdout)
        self.assertIn("NEON_TARGET_URL", r.stdout)
        self.assertIn("postgres:17-alpine", r.stdout)
        self.assertIn("--clean --if-exists --no-owner --no-acl", r.stdout)

    def test_dump_exec_args(self):
        r = bash(". ./offsite_lib.sh; build_pg_dump_exec roxira_postgres_prod enterprise_db | xargs -0 printf '%s\\n'")
        lines = r.stdout.split("\n")
        self.assertEqual(lines[:3], ["docker", "exec", "roxira_postgres_prod"])
        self.assertIn("-Fc", r.stdout)
        self.assertEqual(lines[-2], "enterprise_db")

    def test_retention_keeps_newest_seven(self):
        d = tempfile.mkdtemp()
        try:
            for i in range(1, 11):
                Path(d, f"umami_202610{i:02d}T024000Z.dump.age").write_text("x")
            Path(d, "notes.txt").write_text("x")
            r = bash(f". ./offsite_lib.sh; retention_victims '{d}' 7")
            victims = sorted(Path(p).name for p in r.stdout.split())
            self.assertEqual(
                victims,
                [f"umami_202610{i:02d}T024000Z.dump.age" for i in (1, 2, 3)],
            )
        finally:
            shutil.rmtree(d)

    def test_dry_runs_need_no_secrets(self):
        env = {"BACKUP_ENV_FILE": "/nonexistent", "ROXIRA_SERVER_ENV_FILE": "/nonexistent"}
        for script, args in (("neon_offsite.sh", []), ("codeberg_mirror.sh", []), ("restore_drill.sh", ["neon"]), ("install_offsite.sh", [])):
            flag = [] if script == "install_offsite.sh" else ["--dry-run"]
            r = subprocess.run(["bash", script, *flag, *args], capture_output=True, text=True, cwd=HERE, env={**os.environ, **env})
            self.assertEqual(r.returncode, 0, f"{script}: {r.stderr}")
        r = subprocess.run(["bash", "codeberg_mirror.sh", "--dry-run"], capture_output=True, text=True, cwd=HERE, env={**os.environ, **env})
        self.assertIn("refs/heads/*:refs/heads/*", r.stdout)
        self.assertNotIn("refs/pull", r.stdout.replace("refs/pull/* (GitHub", ""))


class Askpass(unittest.TestCase):
    def ask(self, prompt):
        return subprocess.run(
            ["bash", "codeberg_askpass.sh", prompt],
            capture_output=True, text=True, cwd=HERE,
            env={**os.environ, "CODEBERG_TOKEN": FAKE_TOKEN},
        )

    def test_answers_codeberg_only(self):
        self.assertEqual(self.ask("Username for 'https://codeberg.org': ").stdout.strip(), "mahanofficial")
        self.assertEqual(self.ask("Password for 'https://mahanofficial@codeberg.org': ").stdout.strip(), FAKE_TOKEN)
        r = self.ask("Password for 'https://github.com': ")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")

    def test_push_args_do_not_contain_token(self):
        r = bash(
            'set -u; . ./offsite_lib.sh; MIRROR_SOURCE_URL=x; '
            'sed -n "/^build_push_args/,/^}/p" codeberg_mirror.sh > "$TMPDIR/f.sh"; '
            'BARE=/b; DEST_URL=https://codeberg.org/mahanofficial/roxira-platform.git; '
            "PUSH_SPECS=('+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'); . \"$TMPDIR/f.sh\"; build_push_args",
            {"CODEBERG_TOKEN": FAKE_TOKEN, "TMPDIR": tempfile.gettempdir()},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(FAKE_TOKEN, r.stdout)
        self.assertIn("--prune", r.stdout)
        self.assertNotIn("--mirror", r.stdout)


class NeonMultiAccount(unittest.TestCase):
    """neon_offsite.sh with 0, 1 and 3 spare Neon accounts (URL_2..4)."""

    NONE = {"ROXIRA_SERVER_ENV_FILE": "/nonexistent", "BACKUP_ENV_FILE": "/nonexistent"}
    ALL = ("NEON_BACKUP_URL", "NEON_BACKUP_URL_2", "NEON_BACKUP_URL_3", "NEON_BACKUP_URL_4")

    def _dry_run(self, env):
        return bash("bash neon_offsite.sh --dry-run", {**self.NONE, **env})

    def test_zero_targets_prints_none(self):
        env = {n: "" for n in self.ALL}
        r = self._dry_run(env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("targets  : none configured", r.stdout)

    def test_zero_one_and_three_extra_targets(self):
        for extra in (0, 1, 3):
            names = ["NEON_BACKUP_URL"] + [f"NEON_BACKUP_URL_{i}" for i in range(2, 2 + extra)]
            env = {n: FAKE_URL.replace("ep-cool-123", f"ep-cool-{i}") for i, n in enumerate(names)}
            for n in self.ALL:  # clear the rest so a leaked env var cannot add a target
                env.setdefault(n, "")
            r = self._dry_run(env)
            self.assertEqual(r.returncode, 0, r.stderr)
            for n in names:
                self.assertIn(n, r.stdout)
            self.assertNotIn("Sup3rS3cretPw", r.stdout + r.stderr)
            self.assertEqual(r.stdout.count("[dry-run] restore"), 2 * len(names))  # 2 default DBs

    def test_no_target_is_fatal_when_not_dry_run(self):
        r = bash("bash neon_offsite.sh", {**self.NONE, **{n: "" for n in self.ALL}})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no Neon backup URL set", r.stderr)

    def test_spare_pooler_target_refused(self):
        pooler = FAKE_URL.replace("ep-cool-123", "ep-cool-123-pooler")
        r = bash("bash neon_offsite.sh", {**self.NONE, "NEON_BACKUP_URL": "", "NEON_BACKUP_URL_2": pooler})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("pooler", r.stderr)
        self.assertNotIn("Sup3rS3cretPw", r.stderr)


if __name__ == "__main__":
    unittest.main()
