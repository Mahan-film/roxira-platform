"""Contract tests for the canonical Factory preview Compose template."""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest
import yaml


@pytest.fixture
def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.fixture
def compose_policy(project_root: Path):
    policy_path = project_root / "scripts/ci/compose_policy.py"
    spec = importlib.util.spec_from_file_location("compose_policy", policy_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_preview_template_passes_preview_and_compose_policy(
    project_root: Path, compose_policy
) -> None:
    template = project_root / "templates/preview/docker-compose.preview.yml"
    result = subprocess.run(
        [
            str(project_root / "scripts/ops/preview.sh"),
            "--dry-run",
            "up",
            "demo",
            str(template.relative_to(project_root)),
        ],
        cwd=project_root,
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "docker compose -p preview-demo" in result.stdout
    parsed = yaml.safe_load(template.read_text(encoding="utf-8"))
    assert compose_policy.check(parsed) == []
