"""Focused tests for the tracked-secret hygiene checker."""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def hygiene():
    """Load the checker without importing it at collection time."""
    spec = importlib.util.spec_from_file_location(
        "check_secret_hygiene",
        Path(__file__).resolve().parents[2] / "scripts/ci/check_secret_hygiene.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _init_repo(path: Path) -> Path:
    path.mkdir()
    subprocess.run(
        ["git", "init", "--initial-branch=main"], cwd=path, check=True, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"], cwd=path, check=True, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.email", "test@example.invalid"],
        cwd=path,
        check=True,
        capture_output=True,
    )
    return path


def _commit_all(path: Path) -> None:
    subprocess.run(["git", "add", "-f", "-A"], cwd=path, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "test"], cwd=path, check=True, capture_output=True)


def test_detects_forbidden_paths_and_partial_sops(hygiene, tmp_path):
    repo = _init_repo(tmp_path / "repo")
    (repo / ".env").write_text("TOKEN=changeme\n", encoding="utf-8")
    (repo / ".env.production").write_text("TOKEN=changeme\n", encoding="utf-8")
    (repo / ".env.example").write_text("TOKEN=changeme\n", encoding="utf-8")
    (repo / "server.pem").write_text("placeholder\n", encoding="utf-8")
    (repo / "private.key").write_text("placeholder\n", encoding="utf-8")
    (repo / "id_rsa").write_text("placeholder\n", encoding="utf-8")
    (repo / "keystore.p12").write_text("placeholder\n", encoding="utf-8")
    (repo / "notes.md").write_text("hello\n", encoding="utf-8")
    (repo / "secrets.enc.yaml").write_text("token: placeholder\n", encoding="utf-8")
    (repo / "ok.enc.yaml").write_text("sops:\n  age: []\n", encoding="utf-8")
    _commit_all(repo)

    assert hygiene.check_repo(repo) == [
        ".env",
        ".env.production",
        "id_rsa",
        "keystore.p12",
        "private.key",
        "secrets.enc.yaml",
        "server.pem",
    ]


def test_clean_repo_has_no_offenders(hygiene, tmp_path):
    repo = _init_repo(tmp_path / "repo")
    (repo / ".env.example").write_text("TOKEN=changeme\n", encoding="utf-8")
    (repo / "ok.enc.yaml").write_text("sops:\n  age: []\n", encoding="utf-8")
    _commit_all(repo)

    assert hygiene.check_repo(repo) == []


def test_report_only_always_exits_zero(hygiene, tmp_path):
    repo = _init_repo(tmp_path / "repo")
    (repo / ".env").write_text("TOKEN=changeme\n", encoding="utf-8")
    _commit_all(repo)

    assert hygiene.main([str(repo)]) == 1
    assert hygiene.main(["--report-only", str(repo)]) == 0
