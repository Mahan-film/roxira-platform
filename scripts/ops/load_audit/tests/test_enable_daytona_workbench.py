"""Offline test of enable_daytona_workbench.sh with temp env files (no systemd, no network)."""
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "enable_daytona_workbench.sh"
SECRET = "dtn_test_value_123"


def _run(tmp, *args):
    env = {
        **os.environ,
        "ROXIRA_ENV_FILE": str(tmp / "app.env"),
        "TASKQ_ENV_FILE": str(tmp / "taskq.env"),
        "NO_RESTART": "1",
    }
    return subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True)


def _setup(tmp):
    (tmp / "app.env").write_text(f"OTHER=1\nDAYTONA_API_KEY={SECRET}\n")
    (tmp / "taskq.env").write_text("TASKQ_MAX_ATTEMPTS_PER_DAY=5\n")


def test_dry_run_writes_nothing_and_hides_key(tmp_path):
    _setup(tmp_path)
    r = _run(tmp_path)
    assert r.returncode == 0 and SECRET not in r.stdout + r.stderr
    assert (tmp_path / "taskq.env").read_text() == "TASKQ_MAX_ATTEMPTS_PER_DAY=5\n"


def test_apply_then_rollback(tmp_path):
    _setup(tmp_path)
    r = _run(tmp_path, "--apply")
    assert r.returncode == 0 and SECRET not in r.stdout + r.stderr
    text = (tmp_path / "taskq.env").read_text()
    assert "WORKBENCH_BACKEND=daytona" in text and f"DAYTONA_API_KEY={SECRET}" in text
    assert "TASKQ_MAX_ATTEMPTS_PER_DAY=5" in text
    assert oct((tmp_path / "taskq.env").stat().st_mode & 0o777) == "0o600"
    assert _run(tmp_path, "--rollback").returncode == 0
    assert (tmp_path / "taskq.env").read_text() == "TASKQ_MAX_ATTEMPTS_PER_DAY=5\n"


def test_missing_key_refuses(tmp_path):
    (tmp_path / "app.env").write_text("OTHER=1\n")
    assert _run(tmp_path, "--apply").returncode == 2


def test_second_apply_keeps_first_backup_and_rollback_touches_only_daytona_lines(tmp_path):
    (tmp_path / "app.env").write_text(f"DAYTONA_API_KEY={SECRET}\n")
    (tmp_path / "taskq.env").write_text("TASKQ_MAX_ATTEMPTS_PER_DAY=5\nWORKBENCH_BACKEND=local\n")
    assert _run(tmp_path, "--apply").returncode == 0
    assert _run(tmp_path, "--apply").returncode == 0  # must not overwrite the pre-Daytona backup
    with (tmp_path / "taskq.env").open("a") as f:
        f.write("ADDED_LATER=1\n")
    assert _run(tmp_path, "--rollback").returncode == 0
    text = (tmp_path / "taskq.env").read_text().splitlines()
    assert "WORKBENCH_BACKEND=local" in text and "ADDED_LATER=1" in text and "TASKQ_MAX_ATTEMPTS_PER_DAY=5" in text
    assert not any(l.startswith("DAYTONA_API_KEY=") or l.startswith("WORKBENCH_DAYTONA_MAX=") for l in text)
