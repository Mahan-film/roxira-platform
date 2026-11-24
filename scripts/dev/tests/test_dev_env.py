"""Tests for scripts/dev/dev_env.sh (Issue #1320 / T347)."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEV_ENV_SCRIPT = ROOT / "scripts/dev/dev_env.sh"
UV_LOCK_FILE = ROOT / "uv.lock"


def test_dev_env_script_exists_and_executable():
    assert DEV_ENV_SCRIPT.is_file(), "scripts/dev/dev_env.sh must exist"
    assert (DEV_ENV_SCRIPT.stat().st_mode & 0o111) != 0, "scripts/dev/dev_env.sh must be executable"


def test_uv_lock_exists():
    assert UV_LOCK_FILE.is_file(), "uv.lock must exist at repository root"
    content = UV_LOCK_FILE.read_text(encoding="utf-8")
    assert 'version = 1' in content or 'version =' in content, "uv.lock must have valid lockfile version"
    assert 'project-foundry' in content or 'name =' in content, "uv.lock must declare project dependencies"


def test_dev_env_check_passes():
    res = subprocess.run(["/bin/bash", str(DEV_ENV_SCRIPT), "--check"], capture_output=True, text=True)
    assert res.returncode == 0, f"dev_env.sh --check failed: {res.stderr}\n{res.stdout}"
    assert "OK: lockfile and virtualenv" in res.stdout
