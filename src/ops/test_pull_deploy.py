from pathlib import Path
import shutil
import subprocess

import pytest


def test_pull_deploy_script_is_valid_bash():
    if shutil.which("bash") is None:
        pytest.skip("bash is not installed")

    root = Path(__file__).resolve().parents[2]
    subprocess.run(
        ["bash", "-n", root / "scripts/ops/pull-deploy.sh"],
        check=True,
    )


def test_pull_deploy_script_contains_required_guards():
    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts/ops/pull-deploy.sh").read_text()

    assert "ci-deploy.sh" in script
    assert ".deploy-freeze" in script
    assert "--dry-run" in script
    assert "PULL_DEPLOY_REQUIRE_GREEN" in script


def test_pull_deploy_systemd_units_have_required_settings():
    root = Path(__file__).resolve().parents[2]
    service = (root / "ops/systemd/roxira-pull-deploy.service").read_text()
    timer = (root / "ops/systemd/roxira-pull-deploy.timer").read_text()

    assert "Type=oneshot" in service
    assert "OnUnitActiveSec" in timer
