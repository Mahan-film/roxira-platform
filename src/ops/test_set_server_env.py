"""Offline tests for scripts/ops/set_server_env.sh (no ssh, no network, no import-time code)."""

import subprocess
from pathlib import Path


def _script():
    return Path(__file__).parents[2] / "scripts/ops/set_server_env.sh"


def test_script_exists_and_has_bash_shebang():
    text = _script().read_text(encoding="utf-8")
    assert text.startswith("#!/usr/bin/env bash")


def test_script_passes_bash_syntax_check():
    result = subprocess.run(["bash", "-n", str(_script())], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_script_requires_a_name():
    result = subprocess.run(["bash", str(_script())], capture_output=True, text=True)
    assert result.returncode == 2


def test_script_rejects_a_bad_name_before_any_ssh():
    result = subprocess.run(
        ["bash", str(_script()), "bad-name"], capture_output=True, text=True, timeout=20
    )
    assert result.returncode == 1
    assert "NAME must look like" in result.stderr


def test_script_never_echoes_the_value():
    text = _script().read_text(encoding="utf-8")
    assert 'echo "$value"' not in text
    assert "printf '%s\\n' \"$value\"" not in text
    assert "set -x" not in text
