"""Offline tests for scripts/ops/deploy_local.sh (no ssh, no network)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

PROD_IP = "5.75.200.67"


def script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts/ops/deploy_local.sh"


def test_script_exists_with_bash_shebang() -> None:
    path = script_path()
    assert path.is_file()
    assert path.read_text(encoding="utf-8").startswith("#!/usr/bin/env bash")


def test_script_passes_bash_syntax_check() -> None:
    result = subprocess.run(["bash", "-n", str(script_path())], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_script_refuses_without_subcommand() -> None:
    result = subprocess.run(
        ["bash", str(script_path())], capture_output=True, text=True, timeout=20
    )
    assert result.returncode != 0
    assert "Usage" in result.stderr


def test_script_text_has_no_password_or_foreign_ip() -> None:
    text = script_path().read_text(encoding="utf-8")
    assert "password" not in text.lower()
    ips = set(re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text))
    assert ips <= {PROD_IP}
