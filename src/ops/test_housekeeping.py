"""Focused subprocess tests for the safe operations scripts."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess

import pytest


@pytest.fixture
def script_paths() -> tuple[Path, Path]:
    """Locate the scripts only when a test needs to execute them."""
    root = Path(__file__).resolve().parents[2]
    return root / "scripts/ops/housekeeping.sh", root / "scripts/dev/branch_backup.sh"


def run_git(path: Path, *arguments: str) -> None:
    subprocess.run(
        ["git", *arguments], cwd=path, check=True, capture_output=True, text=True
    )


def test_housekeeping_dry_run_never_calls_docker(
    tmp_path: Path, script_paths: tuple[Path, Path]
) -> None:
    housekeeping, _ = script_paths
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    marker = tmp_path / "docker-was-called"
    docker = bin_dir / "docker"
    docker.write_text(f"#!/usr/bin/env bash\ntouch {marker}\n", encoding="utf-8")
    docker.chmod(0o755)

    environment = os.environ | {"PATH": f"{bin_dir}:{os.environ['PATH']}"}
    result = subprocess.run(
        ["bash", str(housekeeping), "--dry-run"],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert result.returncode == 0
    assert "docker builder prune -f" in result.stdout
    assert "docker image prune -f" in result.stdout
    assert "volume" not in result.stdout.lower()
    assert "rm" not in result.stdout.lower()
    assert not marker.exists()


def test_housekeeping_apply_requires_yes(script_paths: tuple[Path, Path]) -> None:
    housekeeping, _ = script_paths
    result = subprocess.run(
        ["bash", str(housekeeping), "--apply"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "--yes" in result.stderr


def test_branch_backup_only_bundles_unpushed_branch(
    tmp_path: Path, script_paths: tuple[Path, Path]
) -> None:
    _, branch_backup = script_paths
    repository = tmp_path / "repository"
    remote = tmp_path / "remote.git"
    backup_dir = tmp_path / "backups"
    repository.mkdir()

    run_git(repository, "init", "--initial-branch=main")
    run_git(repository, "config", "user.name", "Test User")
    run_git(repository, "config", "user.email", "test@example.invalid")
    (repository / "tracked.txt").write_text("initial\n", encoding="utf-8")
    run_git(repository, "add", "tracked.txt")
    run_git(repository, "commit", "-m", "initial")
    run_git(tmp_path, "init", "--bare", str(remote))
    run_git(repository, "remote", "add", "origin", str(remote))
    run_git(repository, "push", "-u", "origin", "main")

    run_git(repository, "switch", "-c", "unpushed")
    (repository / "tracked.txt").write_text("unpushed\n", encoding="utf-8")
    run_git(repository, "commit", "-am", "unpushed")

    result = subprocess.run(
        ["bash", str(branch_backup), "--dir", str(backup_dir)],
        cwd=repository,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert list(backup_dir.glob("unpushed-*.bundle"))
    assert not list(backup_dir.glob("main-*.bundle"))
