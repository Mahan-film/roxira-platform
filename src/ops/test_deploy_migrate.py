"""Offline tests for the migrate / migrate-rollback subcommands of deploy_local.sh.

No code runs at import time. ssh is replaced by a fake `ssh` on PATH; git runs
only against throwaway repositories under tmp_path.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

MIG_NAME = "1789120000000-AddCrmTenantIsolation.ts"
MIG_PATH = "output_apps/enterprise_hub/migrations/" + MIG_NAME

FAKE_SSH = """#!/usr/bin/env bash
cmd="${@: -1}"
printf '%s\\n' "$cmd" >> "$FAKE_SSH_LOG"
case "$cmd" in
  *"rev-parse HEAD"*) cat "$FAKE_BASE_SHA_FILE" ;;
  *"SELECT name FROM migrations"*) printf '%s' "${FAKE_APPLIED:-}" ;;
  *"information_schema.columns"*) printf 'contact_messages:NO\\ncrm_leads:NO\\n' ;;
  *"docker run --rm"*) exit "${FAKE_RUN_RC:-0}" ;;
  "test -e"*) exit 1 ;;
  "test -s"*) exit "${FAKE_DUMP_RC:-0}" ;;
esac
exit 0
"""


def script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts/ops/deploy_local.sh"


def _git(cwd: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
    }
    out = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True, env=env
    )
    return out.stdout.strip()


@pytest.fixture
def sandbox(tmp_path: Path) -> dict:
    origin = tmp_path / "origin.git"
    work = tmp_path / "work"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(work)], check=True)
    _git(work, "remote", "add", "origin", str(origin))
    (work / "README.md").write_text("base\n", encoding="utf-8")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "base")
    base = _git(work, "rev-parse", "HEAD")
    mig = work / MIG_PATH
    mig.parent.mkdir(parents=True)
    mig.write_text("export class X1789120000000 {}\n", encoding="utf-8")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "add migration")
    _git(work, "push", "-q", "origin", "main")

    bindir = tmp_path / "bin"
    bindir.mkdir()
    ssh = bindir / "ssh"
    ssh.write_text(FAKE_SSH, encoding="utf-8")
    ssh.chmod(0o755)
    (tmp_path / "base_sha").write_text(base, encoding="utf-8")
    log = tmp_path / "ssh.log"
    log.write_text("", encoding="utf-8")
    env = {
        **os.environ,
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "FAKE_SSH_LOG": str(log),
        "FAKE_BASE_SHA_FILE": str(tmp_path / "base_sha"),
    }
    return {"work": work, "env": env, "log": log}


def _run(sb: dict, *args: str, extra_env: dict | None = None, stdin: str = ""):
    env = {**sb["env"], **(extra_env or {})}
    return subprocess.run(
        ["bash", str(script_path()), *args],
        cwd=sb["work"],
        env=env,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_migrate_dry_run_lists_pending_and_changes_nothing(sandbox: dict) -> None:
    result = _run(sandbox, "migrate")
    assert result.returncode == 0, result.stderr
    assert MIG_NAME in result.stdout
    assert "dry-run only" in result.stdout
    log = sandbox["log"].read_text(encoding="utf-8")
    assert "pg_dump" not in log
    assert "migration:run" not in log
    assert "pg_restore" not in log


def test_migrate_skips_already_applied(sandbox: dict) -> None:
    result = _run(
        sandbox, "migrate", extra_env={"FAKE_APPLIED": "AddCrmTenantIsolation1789120000000\n"}
    )
    assert result.returncode == 0, result.stderr
    assert MIG_NAME not in result.stdout
    assert "(none)" in result.stdout


def test_migrate_yes_aborts_on_wrong_sha_before_any_change(sandbox: dict) -> None:
    result = _run(sandbox, "migrate", "--yes", stdin="wrong\n")
    assert result.returncode == 1
    assert "SHA mismatch" in result.stderr
    log = sandbox["log"].read_text(encoding="utf-8")
    assert "pg_dump" not in log
    assert "migration:run" not in log


def test_migrate_yes_runs_one_off_container_not_backend_exec(sandbox: dict) -> None:
    short = _git(sandbox["work"], "rev-parse", "--short=8", "origin/main")
    result = _run(sandbox, "migrate", "--yes", stdin=short + "\n")
    assert result.returncode == 0, result.stderr
    log = sandbox["log"].read_text(encoding="utf-8")
    assert f"docker build -q --target deps -t 'roxira-migrate:{short}'" in log
    assert "docker run --rm --network" in log
    assert "--env-file" in log
    assert "npm run migration:run" in log
    assert "docker exec roxira_enterprise_backend" not in log
    assert "docker cp" not in log
    assert "docker image rm -f 'roxira-migrate:" in log
    assert log.index("pg_dump") < log.index("docker run --rm")
    # credential values are read on the server only and never pass through this host
    assert "db.env" in log
    assert "DATABASE_HOST=roxira_postgres_prod" in log


def test_migrate_failure_prints_restore_and_never_restores(sandbox: dict) -> None:
    short = _git(sandbox["work"], "rev-parse", "--short=8", "origin/main")
    # make the one-off run fail: fake ssh exits 7 for the docker run command
    result = _run(sandbox, "migrate", "--yes", stdin=short + "\n", extra_env={"FAKE_RUN_RC": "7"})
    assert result.returncode == 1
    assert "NOT restoring automatically" in result.stdout + result.stderr
    log = sandbox["log"].read_text(encoding="utf-8")
    assert "pg_restore -U" not in log
    assert "docker image rm -f 'roxira-migrate:" in log


def test_deploy_refuses_migrations_and_points_to_migrate(sandbox: dict) -> None:
    result = _run(sandbox, "deploy")
    assert result.returncode == 1
    assert "migrate" in result.stderr
    assert MIG_PATH in result.stdout


def test_deploy_continues_when_migrations_already_applied(sandbox: dict) -> None:
    result = _run(
        sandbox, "deploy", extra_env={"FAKE_APPLIED": "AddCrmTenantIsolation1789120000000\n"}
    )
    out = result.stdout + result.stderr
    assert "recorded as applied" in out
    assert "not all applied" not in out


def test_migrate_rollback_dry_run_prints_restore_command(sandbox: dict) -> None:
    dump = "/root/deploy-state/db-backups/20261004-120000.dump"
    result = _run(sandbox, "migrate-rollback", dump)
    assert result.returncode == 0, result.stderr
    assert "pg_restore" in result.stdout
    assert dump in result.stdout
    assert "dry-run" in result.stdout
    log = sandbox["log"].read_text(encoding="utf-8")
    assert "pg_restore" not in log


@pytest.mark.parametrize(
    "bad",
    [
        "/etc/passwd",
        "/root/deploy-state/db-backups/../x.dump",
        "/root/deploy-state/db-backups/1;rm.dump",
    ],
)
def test_migrate_rollback_rejects_bad_paths(sandbox: dict, bad: str) -> None:
    result = _run(sandbox, "migrate-rollback", bad)
    assert result.returncode == 1


def test_script_has_no_auto_restore_in_migrate_failure_path() -> None:
    text = script_path().read_text(encoding="utf-8")
    start = text.index("cmd_migrate() {")
    end = text.index("cmd_migrate_rollback() {")
    body = text[start:end]
    assert "cmd_migrate_rollback" not in body
    assert "pg_restore -U" not in body
    assert "NOT restoring automatically" in body
