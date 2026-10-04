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


# ---- generate-mode behaviour with a fake ssh on PATH (runs the "remote" command locally) ----


def _run_generate(tmp_path, local_text, server_text, extra_args=(), fail_append=False):
    import os

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "ssh"
    # args: -o X -o Y HOST CMD ; run CMD locally, keep stdin
    fake.write_text(
        "#!/usr/bin/env bash\n"
        "shift 5\n"
        'if [ -n "${FAKE_SSH_FAIL_APPEND:-}" ] && [[ "$1" == *"cat >>"* ]]; then exit 1; fi\n'
        'exec bash -c "$1"\n',
        encoding="utf-8",
    )
    fake.chmod(0o755)
    remote = tmp_path / "remote"
    remote.mkdir()
    (remote / ".env").write_text(server_text, encoding="utf-8")
    local = tmp_path / "local" / "roxira.env"
    local.parent.mkdir()
    if local_text is not None:
        local.write_text(local_text, encoding="utf-8")
    env = dict(os.environ)
    env.update(
        PATH=f"{bin_dir}:{env['PATH']}",
        DEPLOY_REMOTE_DIR=str(remote),
        ROXIRA_LOCAL_ENV=str(local),
    )
    if fail_append:
        env["FAKE_SSH_FAIL_APPEND"] = "1"
    result = subprocess.run(
        ["bash", str(_script()), "MY_TOKEN", "--generate", *extra_args],
        capture_output=True,
        text=True,
        timeout=60,
        env=env,
    )
    return result, local, remote / ".env"


def test_generate_refusal_without_replace_leaves_local_untouched(tmp_path):
    local_text = "OTHER=1\nMY_TOKEN=oldlocal\n"
    result, local, server = _run_generate(tmp_path, local_text, "MY_TOKEN=serverval\n")
    assert result.returncode == 1
    assert "--replace" in result.stderr
    assert local.read_bytes() == local_text.encode()
    assert server.read_text(encoding="utf-8") == "MY_TOKEN=serverval\n"
    assert list(local.parent.glob("*.bak-*")) == []


def test_generate_success_updates_local_after_server(tmp_path):
    local_text = "OTHER=1\nMY_TOKEN=oldlocal\n"
    result, local, server = _run_generate(
        tmp_path, local_text, "A=b\nMY_TOKEN=serverval\n", extra_args=("--replace",)
    )
    assert result.returncode == 0, result.stderr
    server_line = [x for x in server.read_text().splitlines() if x.startswith("MY_TOKEN=")]
    assert len(server_line) == 1
    new_value = server_line[0].split("=", 1)[1]
    assert len(new_value) == 64
    assert local.read_text() == f"OTHER=1\nMY_TOKEN={new_value}\n"
    assert (local.stat().st_mode & 0o777) == 0o600
    backups = list(local.parent.glob("roxira.env.bak-*"))
    assert len(backups) == 1
    assert backups[0].read_bytes() == local_text.encode()
    assert (backups[0].stat().st_mode & 0o777) == 0o600
    assert new_value not in result.stdout + result.stderr


def test_generate_failure_after_generation_leaves_local_unchanged(tmp_path):
    local_text = "OTHER=1\n"
    result, local, _server = _run_generate(tmp_path, local_text, "A=b\n", fail_append=True)
    assert result.returncode == 1
    assert local.read_bytes() == local_text.encode()
    assert list(local.parent.glob("*.bak-*")) == []
