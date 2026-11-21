"""CI guard for T232: server jobs must not write into the repo checkout, and
autodeploy must alert once per target on dirty tree or failed migration."""
from __future__ import annotations

import importlib.util
import os
import pathlib
import re
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
RADAR_PY = REPO_ROOT / "scripts" / "ops" / "radar" / "radar.py"
AUTODEPLOY_SH = REPO_ROOT / "scripts" / "ops" / "autodeploy" / "autodeploy.sh"
CLEAR_FAILED_SH = REPO_ROOT / "scripts" / "ops" / "autodeploy" / "clear_failed.sh"
SYSTEMD_DIR = REPO_ROOT / "deploy" / "systemd"


def _load_radar(env_overrides=None):
    old = {}
    if env_overrides:
        for k, v in env_overrides.items():
            old[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    try:
        spec = importlib.util.spec_from_file_location("radar_t232_test", str(RADAR_PY))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_radar_decisions_defaults_outside_repo():
    """radar.py must never default DECISIONS_MD inside the git repo checkout."""
    mod = _load_radar({"RADAR_DECISIONS_FILE": None, "RADAR_STATE_DIR": None})
    decisions = pathlib.Path(mod.DECISIONS_MD).resolve()
    repo = pathlib.Path(mod.REPO).resolve()
    assert not str(decisions).startswith(str(repo) + os.sep), (
        f"radar DECISIONS_MD defaults inside repo: {decisions} (repo={repo})"
    )
    assert mod.DECISIONS_MD == "/var/lib/roxira-radar/DECISIONS.md"


def test_systemd_units_do_not_point_state_or_decisions_into_repo():
    """Every systemd server unit must keep state/report/decisions paths outside /opt/roxira_platform."""
    path_env_re = re.compile(r"^Environment=([A-Z0-9_]*(?:STATE|REPORT|DECISIONS|LOG|BACKUP)[A-Z0-9_]*)=(.+)$")
    for unit in sorted(SYSTEMD_DIR.glob("*.service")):
        for lineno, line in enumerate(unit.read_text(encoding="utf-8").splitlines(), 1):
            m = path_env_re.match(line.strip())
            if not m:
                continue
            key, val = m.group(1), m.group(2).strip().strip('"').strip("'")
            assert not val.startswith("/opt/roxira_platform"), (
                f"{unit.name}:{lineno} sets {key}={val} inside the server repo checkout"
            )


def _init_git_fixture(tmp_path: pathlib.Path, deploy_script_body: str, extra_commit_file: tuple[str, str] | None = None):
    origin = tmp_path / "origin.git"
    work = tmp_path / "repo"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(origin)], check=True, capture_output=True)
    subprocess.run(["git", "init", "-b", "main", str(work)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "config", "user.email", "ci@roxira.local"], check=True)
    subprocess.run(["git", "-C", str(work), "config", "user.name", "CI"], check=True)
    subprocess.run(["git", "-C", str(work), "remote", "add", "origin", str(origin)], check=True)

    # Stub notify.py to record every call
    notify_dir = work / "scripts" / "ops" / "notify"
    notify_dir.mkdir(parents=True, exist_ok=True)
    notify_log = tmp_path / "notify.log"
    (notify_dir / "notify.py").write_text(
        f"import sys, json\nwith open({str(notify_log)!r}, 'a', encoding='utf-8') as f:\n    f.write(json.dumps(sys.argv[1:]) + '\\n')\n",
        encoding="utf-8",
    )

    deploy_path = work / "scripts" / "ops" / "deploy_local.sh"
    deploy_path.parent.mkdir(parents=True, exist_ok=True)
    deploy_path.write_text(deploy_script_body, encoding="utf-8")
    subprocess.run(["git", "-C", str(work), "add", "."], check=True)
    subprocess.run(["git", "-C", str(work), "commit", "-m", "init"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "push", "-u", "origin", "main"], check=True, capture_output=True)
    base_sha = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"], text=True).strip()

    # Push a second commit to origin/main, then reset local HEAD back to base_sha
    rel, content = extra_commit_file or ("README.md", "update\n")
    target_file = work / rel
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(content, encoding="utf-8")
    subprocess.run(["git", "-C", str(work), "add", "."], check=True)
    subprocess.run(["git", "-C", str(work), "commit", "-m", "next"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "push", "origin", "main"], check=True, capture_output=True)
    target_sha = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"], text=True).strip()
    subprocess.run(["git", "-C", str(work), "reset", "--hard", base_sha], check=True, capture_output=True)

    enabled = tmp_path / "autodeploy.enabled"
    enabled.write_text("1\n", encoding="utf-8")
    state_dir = tmp_path / "state"
    log_dir = tmp_path / "logs"
    lock_file = tmp_path / "autodeploy.lock"
    env = {
        **os.environ,
        "AUTODEPLOY_REPO": str(work),
        "AUTODEPLOY_ENABLED_FILE": str(enabled),
        "AUTODEPLOY_STATE_DIR": str(state_dir),
        "AUTODEPLOY_LOG_DIR": str(log_dir),
        "AUTODEPLOY_LOCK": str(lock_file),
    }
    return work, state_dir, notify_log, target_sha, env


def test_autodeploy_refuses_dirty_tree_alerts_once_and_never_leaks_contents(tmp_path):
    work, state_dir, notify_log, target_sha, env = _init_git_fixture(tmp_path, "#!/usr/bin/env bash\nexit 0\n")
    dirty_file = work / "docs" / "radar" / "DECISIONS.md"
    dirty_file.parent.mkdir(parents=True, exist_ok=True)
    dirty_file.write_text("SECRET_SENTINEL_DO_NOT_LEAK\n", encoding="utf-8")

    r1 = subprocess.run(["bash", str(AUTODEPLOY_SH)], env=env, capture_output=True, text=True)
    assert r1.returncode != 0
    failed_shas = (state_dir / "autodeploy-failed-shas").read_text(encoding="utf-8").splitlines()
    assert target_sha in failed_shas

    calls = notify_log.read_text(encoding="utf-8").splitlines()
    assert len(calls) == 1
    assert "--urgent" in calls[0]
    assert "docs/radar/DECISIONS.md" in calls[0]
    assert "SECRET_SENTINEL_DO_NOT_LEAK" not in calls[0]

    # Second run for same target skips and does NOT alert again
    r2 = subprocess.run(["bash", str(AUTODEPLOY_SH)], env=env, capture_output=True, text=True)
    assert r2.returncode == 0
    assert len(notify_log.read_text(encoding="utf-8").splitlines()) == 1

    # clear_failed.sh clears the marker cleanly
    rc = subprocess.run(["bash", str(CLEAR_FAILED_SH), target_sha[:8]], env=env, capture_output=True, text=True)
    assert rc.returncode == 0
    assert target_sha not in (state_dir / "autodeploy-failed-shas").read_text(encoding="utf-8").splitlines()


def test_autodeploy_failed_migration_alerts_once_per_target(tmp_path):
    work, state_dir, notify_log, target_sha, env = _init_git_fixture(
        tmp_path,
        "#!/usr/bin/env bash\n[ \"$1\" = \"migrate\" ] && exit 1\nexit 0\n",
        extra_commit_file=("output_apps/enterprise_hub/migrations/9999999999999-test.ts", "// mig\n"),
    )
    r1 = subprocess.run(["bash", str(AUTODEPLOY_SH)], env=env, capture_output=True, text=True)
    assert r1.returncode != 0
    calls = notify_log.read_text(encoding="utf-8").splitlines()
    assert len(calls) == 1
    assert "--urgent" in calls[0]
    assert "migration failed" in calls[0]

    r2 = subprocess.run(["bash", str(AUTODEPLOY_SH)], env=env, capture_output=True, text=True)
    assert r2.returncode == 0
    assert len(notify_log.read_text(encoding="utf-8").splitlines()) == 1
