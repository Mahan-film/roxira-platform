"""Offline tests for scripts/ops/disk_reclaim_plan.sh."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "disk_reclaim_plan.sh"


def test_disk_reclaim_plan_prints_candidates_and_never_deletes(tmp_path: Path) -> None:
    fake_docker = tmp_path / "docker"
    log_file = tmp_path / "docker_calls.log"
    fake_docker.write_text(
        f"""#!/usr/bin/env bash
echo "$*" >> "{log_file}"
case "$1" in
  images)
    if [[ "$*" == *"dangling=true"* ]]; then
      printf '<none>:<none>\\tsha256:dangling1\\t500MB\\n'
    else
      printf 'sha256:used1\\troxira/api:latest\\t1.2GB\\n'
      printf 'sha256:unused1\\troxira/old:v1\\t800MB\\n'
    fi
    ;;
  builder)
    echo "Total: 2.8GB"
    ;;
  ps)
    echo "c1"
    ;;
  inspect)
    echo "sha256:used1"
    ;;
esac
"""
    )
    fake_docker.chmod(0o755)

    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    (backup_dir / "old.bak").write_text("backup-data")

    env = os.environ.copy()
    env["DOCKER_BIN"] = str(fake_docker)
    env["BACKUP_DIRS"] = str(backup_dir)

    res = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    out = res.stdout

    assert "Dangling Docker Images" in out
    assert "sha256:dangling1" in out
    assert "sha256:unused1" in out
    assert "sha256:used1" not in out.split("Images Not Used by Running Containers")[1]
    assert "Backup Location Sizes" in out
    assert str(backup_dir) in out

    calls = log_file.read_text()
    assert "prune" not in calls
    assert "rmi" not in calls
    assert "rm " not in calls
