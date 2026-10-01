"""Subprocess-only contract tests for scripts/ops/preview.sh."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ops/preview.sh"
SAFE_COMPOSE = """services:
  web:
    image: example/web
    labels:
      roxira.preview: \"${PREVIEW_LABEL}\"
      roxira.preview.created: \"${PREVIEW_CREATED_EPOCH}\"
"""


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(SCRIPT), "--dry-run", *args],
        cwd=ROOT,
        check=False,
        text=True,
        capture_output=True,
    )


def test_up_dry_run_prints_isolated_limited_compose_command(tmp_path: Path) -> None:
    compose = tmp_path / "preview.yml"
    compose.write_text(SAFE_COMPOSE)

    result = run("up", "feature-275", str(compose))

    assert result.returncode == 0
    assert "PREVIEW_MEM=1g PREVIEW_CPUS=1.0" in result.stdout
    assert "PREVIEW_LABEL=1 PREVIEW_CREATED_EPOCH=" in result.stdout
    assert f"docker compose -p preview-feature-275 -f {compose} up -d --build" in result.stdout
    assert "docker ps" not in result.stdout


def test_down_and_gc_dry_run_only_print_docker_commands() -> None:
    down = run("down", "feature-275")
    gc = run("gc")

    assert down.returncode == gc.returncode == 0
    assert down.stdout.strip() == "docker compose -p preview-feature-275 down -v"
    assert gc.stdout.strip().startswith("docker ps -a --filter label=roxira.preview=1")


def test_up_refuses_unsafe_compose_and_invalid_slug(tmp_path: Path) -> None:
    unsafe = tmp_path / "unsafe.yml"
    for unsafe_body in (
        "services:\n  web:\n    privileged: true\n",
        "services:\n  web:\n    network_mode: host\n",
        "services:\n  web:\n    volumes:\n      - /var/run/docker.sock:/sock\n",
    ):
        unsafe.write_text(unsafe_body)
        rejected_compose = run("up", "feature-275", str(unsafe))
        assert rejected_compose.returncode == 2
        assert "forbidden host, external, or secret attachment" in rejected_compose.stderr

    rejected_slug = run("up", "ROXIRA", str(unsafe))

    assert rejected_slug.returncode == 2
    assert "invalid preview slug" in rejected_slug.stderr
