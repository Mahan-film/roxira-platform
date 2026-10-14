"""Offline tests for the server-side auto-deploy timer and the auto-confirm gate.

No network and no docker: `ssh`/`bash`/`docker` are replaced by PATH stubs and git
runs only against throwaway repositories under tmp_path (same style as
test_deploy_local.py / test_deploy_migrate.py).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

MIG_NAME = "1789120000000-AddCrmTenantIsolation.ts"
MIG_PATH = "output_apps/enterprise_hub/migrations/" + MIG_NAME

ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = ROOT / "scripts/ops/deploy_local.sh"
AUTO_SCRIPT = ROOT / "scripts/ops/autodeploy/autodeploy.sh"
REAL_BASH = shutil.which("bash") or "/bin/bash"

# Stub for the inner `bash <tmp deploy script> ...` calls made by autodeploy.sh.
# Autodeploy must call /bin/bash (not this stub) itself; the test does that.
FAKE_BASH = f"""#!{REAL_BASH}
printf 'ssh=%s confirm=%s args=%s\\n' "${{DEPLOY_SSH_HOST:-}}" "${{DEPLOY_AUTO_CONFIRM:-}}" "$*" >> "$FAKE_BASH_LOG"
exit 0
"""

FAKE_SSH = f"""#!{REAL_BASH}
cmd="${{@: -1}}"
printf '%s\\n' "$cmd" >> "$FAKE_SSH_LOG"
case "$cmd" in
  *"rev-parse HEAD"*) cat "$FAKE_BASE_SHA_FILE" ;;
  *"SELECT name FROM migrations"*) printf '%s' "${{FAKE_APPLIED:-}}" ;;
  "test -e"*) exit 1 ;;
esac
exit 0
"""

FAKE_DOCKER = f"""#!{REAL_BASH}
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$*" in
  *"SELECT name FROM migrations"*) printf '%s' "${{FAKE_APPLIED:-}}" ;;
  *"information_schema.columns"*) printf 'contact_messages:NO\\ncrm_leads:NO\\n' ;;
esac
exit 0
"""


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


def _make_repo(tmp_path: Path, *, reset_to_base: bool) -> dict:
    origin = tmp_path / "origin.git"
    work = tmp_path / "work"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(work)], check=True)
    _git(work, "remote", "add", "origin", str(origin))
    dep = work / "scripts/ops"
    dep.mkdir(parents=True)
    shutil.copy(DEPLOY_SCRIPT, dep / "deploy_local.sh")
    (work / "README.md").write_text("base\n", encoding="utf-8")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "base")
    base = _git(work, "rev-parse", "HEAD")
    mig = work / MIG_PATH
    mig.parent.mkdir(parents=True)
    mig.write_text("export class X1789120000000 {}\n", encoding="utf-8")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "add migration")
    target = _git(work, "rev-parse", "HEAD")
    _git(work, "push", "-q", "origin", "main")
    if reset_to_base:
        _git(work, "reset", "-q", "--hard", base)
    return {"origin": origin, "work": work, "base": base, "target": target}


def _stub(bindir: Path, name: str, text: str) -> None:
    bindir.mkdir(parents=True, exist_ok=True)
    p = bindir / name
    p.write_text(text, encoding="utf-8")
    p.chmod(0o755)


# --------------------------------------------------------------- autodeploy.sh


@pytest.fixture
def auto_env(tmp_path: Path) -> dict:
    repo = _make_repo(tmp_path, reset_to_base=True)
    bindir = tmp_path / "bin"
    _stub(bindir, "bash", FAKE_BASH)
    marker = tmp_path / "enabled"
    marker.write_text("", encoding="utf-8")
    bash_log = tmp_path / "bash.log"
    bash_log.write_text("", encoding="utf-8")
    env = {
        **os.environ,
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "AUTODEPLOY_REPO": str(repo["work"]),
        "AUTODEPLOY_ENABLED_FILE": str(marker),
        "AUTODEPLOY_STATE_DIR": str(tmp_path / "state"),
        "AUTODEPLOY_LOG_DIR": str(tmp_path / "logs"),
        "AUTODEPLOY_LOCK": str(tmp_path / "autodeploy.lock"),
        "FAKE_BASH_LOG": str(bash_log),
    }
    return {**repo, "env": env, "marker": marker, "bash_log": bash_log, "tmp": tmp_path}


def _run_auto(a: dict, extra_env: dict | None = None):
    env = {**a["env"], **(extra_env or {})}
    return subprocess.run(
        [REAL_BASH, str(AUTO_SCRIPT)],
        cwd=a["work"],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_scripts_pass_bash_syntax_check() -> None:
    for path in (
        AUTO_SCRIPT,
        ROOT / "scripts/ops/autodeploy/install.sh",
        DEPLOY_SCRIPT,
    ):
        result = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True)
        assert result.returncode == 0, (path, result.stderr)


def test_autodeploy_runs_migrate_before_deploy_on_migration_diff(auto_env: dict) -> None:
    result = _run_auto(auto_env)
    assert result.returncode == 0, result.stderr
    lines = auto_env["bash_log"].read_text(encoding="utf-8").splitlines()
    calls = [ln for ln in lines if "args=" in ln]
    assert len(calls) == 2, lines
    assert " migrate --yes" in calls[0]
    assert " deploy --yes" in calls[1]
    short = _git(auto_env["work"], "rev-parse", "--short=8", "origin/main")
    assert "ssh=local" in calls[0]
    assert f"confirm={short}" in calls[0]
    assert f"confirm={short}" in calls[1]
    status = json.loads((auto_env["tmp"] / "state/autodeploy-last.json").read_text())
    assert status["result"] == "ok"
    assert status["migrated"] is True
    assert status["target"] == auto_env["target"]
    assert Path(status["log"]).is_file()


def test_autodeploy_exits_zero_on_freeze(auto_env: dict) -> None:
    (auto_env["work"] / ".deploy-freeze").write_text("", encoding="utf-8")
    result = _run_auto(auto_env)
    assert result.returncode == 0, result.stderr
    assert auto_env["bash_log"].read_text(encoding="utf-8") == ""
    status = json.loads((auto_env["tmp"] / "state/autodeploy-last.json").read_text())
    assert status["result"] == "skipped"


def test_autodeploy_exits_zero_on_same_sha(auto_env: dict) -> None:
    _git(auto_env["work"], "reset", "-q", "--hard", "origin/main")
    result = _run_auto(auto_env)
    assert result.returncode == 0, result.stderr
    assert auto_env["bash_log"].read_text(encoding="utf-8") == ""


def test_autodeploy_exits_zero_on_failed_sha(auto_env: dict) -> None:
    state = auto_env["tmp"] / "state"
    state.mkdir(parents=True, exist_ok=True)
    (state / "autodeploy-failed-shas").write_text(auto_env["target"] + "\n", encoding="utf-8")
    result = _run_auto(auto_env)
    assert result.returncode == 0, result.stderr
    assert auto_env["bash_log"].read_text(encoding="utf-8") == ""


def test_autodeploy_exits_zero_when_marker_missing(auto_env: dict) -> None:
    auto_env["marker"].unlink()
    result = _run_auto(auto_env)
    assert result.returncode == 0, result.stderr
    assert auto_env["bash_log"].read_text(encoding="utf-8") == ""


def test_autodeploy_records_failed_sha_on_migrate_failure(auto_env: dict) -> None:
    # make the inner `bash <tmp> migrate --yes` fail
    stub_dir = auto_env["tmp"] / "bin"
    _stub(
        stub_dir,
        "bash",
        f"#!{REAL_BASH}\nprintf '%s\\n' \"$*\" >> \"$FAKE_BASH_LOG\"\n[[ \"$*\" == *migrate* ]] && exit 9\nexit 0\n",
    )
    result = _run_auto(auto_env)
    assert result.returncode == 1
    failed = (auto_env["tmp"] / "state/autodeploy-failed-shas").read_text(encoding="utf-8")
    assert auto_env["target"] in failed
    status = json.loads((auto_env["tmp"] / "state/autodeploy-last.json").read_text())
    assert status["result"] == "failed"


# ------------------------------------------------- deploy_local.sh auto-confirm


def _local_migrate_env(tmp_path: Path, *, marker: bool) -> dict:
    repo = _make_repo(tmp_path, reset_to_base=False)
    bindir = tmp_path / "bin"
    _stub(bindir, "docker", FAKE_DOCKER)
    docker_log = tmp_path / "docker.log"
    docker_log.write_text("", encoding="utf-8")
    marker_path = tmp_path / "marker"
    if marker:
        marker_path.write_text("", encoding="utf-8")
    short = _git(repo["work"], "rev-parse", "--short=8", "origin/main")
    env = {
        **os.environ,
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "DEPLOY_SSH_HOST": "local",
        "DEPLOY_REMOTE_DIR": str(repo["work"]),
        "DEPLOY_STATE_DIR": str(tmp_path / "state"),
        "DEPLOY_AUTO_CONFIRM": short,
        "DEPLOY_AUTO_CONFIRM_MARKER": str(marker_path),
        "FAKE_DOCKER_LOG": str(docker_log),
    }
    return {
        **repo,
        "env": env,
        "short": short,
        "docker_log": docker_log,
        "marker_path": marker_path,
        "tmp": tmp_path,
    }


def test_auto_confirm_ignored_when_marker_missing(tmp_path: Path) -> None:
    c = _local_migrate_env(tmp_path, marker=False)
    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "migrate", "--yes"],
        cwd=c["work"],
        env=c["env"],
        input="",
        capture_output=True,
        text=True,
        timeout=60,
    )
    out = result.stdout + result.stderr
    assert result.returncode == 1, out
    assert "SHA mismatch" in out
    assert "auto-confirmed" not in out
    assert "pg_dump" not in c["docker_log"].read_text(encoding="utf-8")


@pytest.mark.skipif(os.geteuid() == 0, reason="the uid gate only applies to non-root")
def test_auto_confirm_ignored_when_not_root(tmp_path: Path) -> None:
    c = _local_migrate_env(tmp_path, marker=True)
    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "migrate", "--yes"],
        cwd=c["work"],
        env=c["env"],
        input="",
        capture_output=True,
        text=True,
        timeout=60,
    )
    out = result.stdout + result.stderr
    assert result.returncode == 1, out
    assert "SHA mismatch" in out
    assert "auto-confirmed" not in out


def test_auto_confirm_ignored_when_not_local(tmp_path: Path) -> None:
    repo = _make_repo(tmp_path, reset_to_base=False)
    bindir = tmp_path / "bin"
    _stub(bindir, "ssh", FAKE_SSH)
    marker = tmp_path / "marker"
    marker.write_text("", encoding="utf-8")
    ssh_log = tmp_path / "ssh.log"
    ssh_log.write_text("", encoding="utf-8")
    short = _git(repo["work"], "rev-parse", "--short=8", "origin/main")
    env = {
        **os.environ,
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "DEPLOY_SSH_HOST": "roxira-prod",
        "DEPLOY_AUTO_CONFIRM": short,
        "DEPLOY_AUTO_CONFIRM_MARKER": str(marker),
        "FAKE_SSH_LOG": str(ssh_log),
        "FAKE_BASE_SHA_FILE": str(tmp_path / "base_sha"),
    }
    (tmp_path / "base_sha").write_text(repo["base"], encoding="utf-8")
    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "migrate", "--yes"],
        cwd=repo["work"],
        env=env,
        input="",
        capture_output=True,
        text=True,
        timeout=60,
    )
    out = result.stdout + result.stderr
    assert result.returncode == 1, out
    assert "SHA mismatch" in out
    assert "auto-confirmed" not in out


# ------------------------------------------------------------------- units/docs


def test_units_have_required_settings() -> None:
    base = ROOT / "scripts/ops/autodeploy"
    service = (base / "roxira-autodeploy.service").read_text(encoding="utf-8")
    timer = (base / "roxira-autodeploy.timer").read_text(encoding="utf-8")
    assert "Type=oneshot" in service
    assert "ExecStart=/bin/bash /opt/roxira_platform/scripts/ops/autodeploy/autodeploy.sh" in service
    assert "Nice=10" in service
    assert "TimeoutStartSec=3600" in service
    assert "OnBootSec=5min" in timer
    assert "OnUnitActiveSec=5min" in timer
    assert "Persistent=true" in timer


def test_install_script_is_dry_run_by_default() -> None:
    text = (ROOT / "scripts/ops/autodeploy/install.sh").read_text(encoding="utf-8")
    assert "--yes" in text
    assert "--disable" in text
    assert "dry-run" in text
    assert "/etc/roxira/autodeploy.enabled" in text
