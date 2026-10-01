"""Offline checks for scripts/ops/ci-deploy.sh: path-to-service mapping and request validation.

Only the `--map-stdin` helper and the request validation run: no git, no docker, no network.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "ci-deploy.sh"


def _bash():
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("bash not available")
    return bash


def test_maps_changed_paths_to_services():
    paths = "\n".join(
        [
            "docs/x.md",
            "output_apps/enterprise_hub/frontend/src/app/page.tsx",
            "output_apps/generated_modules/smartjudge/fast_path.py",
        ]
    )
    result = subprocess.run(
        [_bash(), str(SCRIPT), "--map-stdin"], input=paths, capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["enterprise_app", "roxira_enterprise_frontend"]


def test_docs_only_changes_map_to_no_service():
    result = subprocess.run(
        [_bash(), str(SCRIPT), "--map-stdin"], input="docs/a.md\nREADME.md\n", capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_backend_and_all_three_services_order():
    paths = "\n".join(
        [
            "output_apps/enterprise_hub/backend/src/main.ts",
            "output_apps/enterprise_hub/frontend/next.config.ts",
            "Dockerfile.prod",
        ]
    )
    result = subprocess.run(
        [_bash(), str(SCRIPT), "--map-stdin"], input=paths, capture_output=True, text=True, timeout=30
    )
    assert result.stdout.split() == [
        "enterprise_app",
        "roxira_enterprise_backend",
        "roxira_enterprise_frontend",
    ]


@pytest.mark.parametrize("request_text", ["", "deploy abc", "rm -rf /", "deploy " + "0" * 39, "deploy " + "g" * 40])
def test_invalid_requests_are_refused(request_text):
    result = subprocess.run(
        [_bash(), str(SCRIPT)],
        env={"SSH_ORIGINAL_COMMAND": request_text, "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 1
    assert "refusing request" in result.stdout + result.stderr
