"""Offline test of stop_useless_jobs.sh against a throwaway root (no real /etc, no crontab)."""
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "stop_useless_jobs.sh"


def _run(root, *args):
    env = {**os.environ, "JOBS_ROOT": str(root), "JOBS_NO_CRONTAB": "1"}
    return subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True, check=True)


def _setup(tmp_path):
    cron = tmp_path / "etc" / "cron.d"
    cron.mkdir(parents=True)
    (cron / "roxira_agent_mesh").write_text("*/10 * * * * root python3 /x/agent_mesh_daemon.py\n")
    (cron / "roxira_swarm_qa").write_text("*/15 * * * * root python3 /x/swarm_qa_worker.py\n")
    (cron / "roxira_legal_feeder").write_text("0 3 * * * root docker exec x feeder.py\n")
    (cron / "roxira_social_marketing").write_text("0 9 * * * root /x/something_else.sh\n")
    return cron


def test_dry_run_changes_nothing(tmp_path):
    cron = _setup(tmp_path)
    out = _run(tmp_path).stdout
    assert "would move" in out and "dry run" in out
    assert (cron / "roxira_agent_mesh").exists() and (cron / "roxira_swarm_qa").exists()


def test_apply_moves_only_audited_files_and_rollback_restores(tmp_path):
    cron = _setup(tmp_path)
    out = _run(tmp_path, "--apply").stdout
    assert not (cron / "roxira_agent_mesh").exists()
    assert not (cron / "roxira_swarm_qa").exists()
    assert (cron / "roxira_legal_feeder").exists()  # not on the list
    assert (cron / "roxira_social_marketing").exists()  # content changed, so it is left alone
    assert "CHANGED" in out
    backup = Path(out.split("--rollback ")[1].strip())
    assert (backup / "roxira_agent_mesh").exists()
    _run(tmp_path, "--rollback", str(backup))
    assert (cron / "roxira_agent_mesh").exists() and (cron / "roxira_swarm_qa").exists()


def test_crontab_rollback_reenables_only_disabled_lines(tmp_path):
    _setup(tmp_path)
    store = tmp_path / "crontab.txt"
    store.write_text("30 3 * * * a.sh\n30 4 * * * /x/daily_tech_scout.sh >> /l 2>&1\n")
    fake = tmp_path / "fakecron"
    fake.write_text(
        f'#!/bin/bash\nif [ "$1" = "-l" ]; then cat {store}; else cat > {store}; fi\n'
    )
    fake.chmod(0o755)
    env = {**os.environ, "JOBS_ROOT": str(tmp_path), "CRONTAB_CMD": str(fake)}

    def run(*a):
        return subprocess.run(["bash", str(SCRIPT), *a], env=env, capture_output=True, text=True, check=True)

    out = run("--apply").stdout
    assert store.read_text().splitlines()[1].startswith("#DISABLED-by-stop_useless_jobs# ")
    with store.open("a") as f:
        f.write("0 1 * * * added_later.sh\n")  # an edit made after the stop must survive the rollback
    run("--rollback", out.split("--rollback ")[1].strip())
    lines = store.read_text().splitlines()
    assert lines[1] == "30 4 * * * /x/daily_tech_scout.sh >> /l 2>&1"
    assert "0 1 * * * added_later.sh" in lines and lines[0] == "30 3 * * * a.sh"
