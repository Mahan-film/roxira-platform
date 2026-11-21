"""Tests for the LiveKit dev key pair guard (#1036): repo scan and the installer rotation script."""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECK = ROOT / "scripts/ci/check_livekit_default_keys.py"
KEYS = ROOT / "services/voice_phone_agent/deploy/livekit_keys.sh"
DEV_K = "dev" + "key"
DEV_S = "sec" + "ret"


def run_check(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["python3", str(CHECK), "--root", str(root)], capture_output=True, text=True)


def test_repo_has_no_default_pair_in_tracked_files():
    r = run_check(ROOT)
    assert r.returncode == 0, r.stdout


def test_scan_flags_default_pair_without_printing_values(tmp_path):
    (tmp_path / "livekit.yaml").write_text(f"keys:\n  {DEV_K}: {DEV_S}\n")
    (tmp_path / ".env").write_text(f"LIVEKIT_API_SECRET={DEV_S}\n")
    r = run_check(tmp_path)
    assert r.returncode == 1
    assert "livekit.yaml:2" in r.stdout and ".env:1" in r.stdout
    assert DEV_K not in r.stdout and DEV_S not in r.stdout


def keys(stack: Path, env: Path, mode: str) -> subprocess.CompletedProcess:
    e = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "TMPDIR": str(stack.parent), "STACK": str(stack), "AGENT_ENV": str(env)}
    return subprocess.run(["bash", str(KEYS), mode], env=e, capture_output=True, text=True)


def make_stack(tmp_path: Path, key: str, secret: str):
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / "livekit.yaml").write_text(f"port: 7880\nkeys:\n  {key}: {secret}\n")
    (stack / "sip.yaml").write_text(f"api_key: {key}\napi_secret: {secret}\nlog_level: info\n")
    env = tmp_path / "agent.env"
    env.write_text(f"LIVEKIT_API_KEY={key}\nLIVEKIT_API_SECRET={secret}\nOTHER=1\n")
    return stack, env


def test_check_fails_on_default_and_prints_only_lengths(tmp_path):
    stack, env = make_stack(tmp_path, DEV_K, DEV_S)
    r = keys(stack, env, "check")
    assert r.returncode == 1
    assert "key length 6, secret length 6" in r.stdout
    assert DEV_K not in r.stdout and f"={DEV_S}" not in r.stdout


def test_rotate_replaces_pair_everywhere_and_never_echoes_it(tmp_path):
    stack, env = make_stack(tmp_path, DEV_K, DEV_S)
    r = keys(stack, env, "rotate")
    assert r.returncode == 0, r.stdout + r.stderr
    new_key = [ln for ln in env.read_text().splitlines() if ln.startswith("LIVEKIT_API_KEY=")][0].split("=", 1)[1]
    new_secret = [ln for ln in env.read_text().splitlines() if ln.startswith("LIVEKIT_API_SECRET=")][0].split("=", 1)[1]
    assert new_key != DEV_K and len(new_secret) >= 32
    for out in (r.stdout, r.stderr):
        assert new_key not in out and new_secret not in out and DEV_K not in out
    assert f"{new_key}: {new_secret}" in (stack / "livekit.yaml").read_text()
    sip = (stack / "sip.yaml").read_text()
    assert f"api_key: {new_key}" in sip and f"api_secret: {new_secret}" in sip and "log_level: info" in sip
    assert "OTHER=1" in env.read_text()
    assert oct(env.stat().st_mode & 0o777) == "0o600"
    assert keys(stack, env, "check").returncode == 0
    assert run_check(stack).returncode == 0


def test_rotate_leaves_a_custom_pair_alone(tmp_path):
    stack, env = make_stack(tmp_path, "APIcustom1", "x" * 40)
    before = env.read_text()
    r = keys(stack, env, "rotate")
    assert r.returncode == 0 and "nothing to do" in r.stdout
    assert env.read_text() == before
