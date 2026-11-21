"""Runs the offline bash test for the box lane runner (T275). No network, gateway or sudo."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / "scripts/ops/ci_box/lane_runner"


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash missing")
@pytest.mark.skipif(shutil.which("python3") is None, reason="python3 missing")
def test_lane_run_offline_suite_passes():
    r = subprocess.run(["bash", str(DIR / "test_lane_run.sh")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="shellcheck missing")
def test_lane_runner_scripts_shellcheck_clean():
    files = [str(DIR / n) for n in ("lane-run", "install_user.sh", "install_root.sh", "test_lane_run.sh", "taskq-runner.sh")]
    r = subprocess.run(["shellcheck", *files], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-2000:]
