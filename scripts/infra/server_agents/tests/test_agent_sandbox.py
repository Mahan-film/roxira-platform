"""agent_sandbox.sh: the properties that keep agents away from production, and safe env file quoting."""
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "agent_sandbox.sh"


def props() -> list[str]:
    out = subprocess.run(["bash", str(SCRIPT), "props", "/w/t", "60"], check=True, capture_output=True, text=True)
    return out.stdout.splitlines()


def test_props_hide_production_paths():
    lines = props()
    for path in ("/opt/roxira_platform", "/root", "/etc/roxira", "/var/run/docker.sock"):
        assert f"InaccessiblePaths=-{path}" in lines


def test_props_limit_privileges_and_writes():
    lines = props()
    assert "User=roxira-agent" in lines
    assert "NoNewPrivileges=yes" in lines
    assert "PrivatePIDs=yes" in lines  # uid 999 is shared with the Redis containers
    assert "CapabilityBoundingSet=" in lines
    assert "ProtectSystem=strict" in lines
    assert any(line.startswith("ReadWritePaths=/w/t ") for line in lines)


def test_egress_rules_only_touch_packets_with_an_agent_socket():
    rules = (SCRIPT.parent / "agent_egress.nft").read_text()
    assert 'meta skuid "roxira-agent" jump agent' in rules
    assert "skuid !=" not in rules.replace('"meta skuid != x return"', "")


def test_env_file_quotes_values_and_is_private(tmp_path):
    target = tmp_path / "agent.env"
    code = f'source "{SCRIPT}"; sandbox_env_file "{target}" A_VALUE MISSING_VALUE'
    env = dict(os.environ, A_VALUE="it's \\ {\"x\":1}")
    subprocess.run(["bash", "-c", code], check=True, env=env)
    assert target.read_text() == "A_VALUE='it\\'s \\\\ {\"x\":1}'\n"
    assert target.stat().st_mode & 0o777 == 0o600


def test_props_hide_orchestrator_state_and_other_worktrees():
    lines = subprocess.run(["bash", str(SCRIPT), "props", "/var/lib/roxira-agents/worktrees/t1", "60"], check=True,
                           capture_output=True, text=True).stdout.splitlines()
    for name in ("logs", "taskq", "taskq.db", "patches", "reviews"):
        assert f"InaccessiblePaths=-/var/lib/roxira-agents/{name}" in lines
    assert "TemporaryFileSystem=/var/lib/roxira-agents/worktrees:ro" in lines
    assert "BindPaths=/var/lib/roxira-agents/worktrees/t1" in lines
    assert any(line.startswith("ReadWritePaths=/var/lib/roxira-agents/worktrees/t1 ") for line in lines)


def test_run_task_passes_only_the_routes_key_to_the_sandbox():
    text = (SCRIPT.parent / "run_task.sh").read_text()
    call = text[text.index("sandbox_env_file \"$envf\""):]
    call = call[: call.index("timeout --kill-after")]
    assert '"$KEYVAR"' in call
    for key in ("OPENROUTER_API_KEY_AGENTS", "KEYPOOL_MASTER_KEY", "GROQ_API_KEY"):
        assert key not in call
