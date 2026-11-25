"""Tests for .claude/hooks/guard_bash.sh (PreToolUse Bash guard) and scripts/dev/auto_handoff.sh.

The hook reads {"tool_input": {"command": "..."}} on stdin; exit 2 blocks, exit 0 allows.
No import-time side effects: paths only, subprocesses run inside the tests.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / ".claude" / "hooks" / "guard_bash.sh"
HANDOFF = ROOT / "scripts" / "dev" / "auto_handoff.sh"


def run_guard(stdin: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(GUARD)], input=stdin, capture_output=True, text=True, timeout=30
    )


def guard(command: str) -> subprocess.CompletedProcess:
    return run_guard(json.dumps({"tool_input": {"command": command}}))


@pytest.mark.parametrize("command", [
    "pytest",
    "pytest -q",
    "pytest .",
    "pytest ./",
    "pytest src",
    "pytest src/",
    "pytest src/automation/",
    "pytest --co",
    "pytest --co -q tests/",
    "python -m pytest src",
    "python3 -m pytest -m 'not integration' -q",
    ".venv/bin/python -m pytest -q",
    "cd /x && pytest src -q",
    "FOO=1 uv run pytest .",
    "rtk proxy pytest src",
    "bash -c 'pytest src'",
    "git commit --no-verify -m wip",
    "git push --no-verify origin HEAD",
    "git commit -n -m wip",
    "echo hi; git push --no-verify",
    "pytest -q 2>&1 | tail -5",
    "pytest > out.txt",
    "python -m pytest 2>/dev/null",
    "echo hi;(pytest src)",
])
def test_blocks(command):
    res = guard(command)
    assert res.returncode == 2, (command, res.stdout, res.stderr)
    assert "guard_bash" in res.stderr


@pytest.mark.parametrize("command", [
    ".venv/bin/python -m pytest -q scripts/dev/tests/test_guard_bash.py -p no:cacheprovider",
    "pytest tests/test_check_ci.py",
    "pytest -q src/automation/test_tech_radar_weekly_budget.py",
    "pytest --co -q tests/test_check_ci.py",
    "pytest 'scripts/dev/tests/test_fleet.py::test_x' -k foo -m 'not integration'",
    "grep -rn pytest docs",
    "git commit -m \"mentions --no-verify and pytest src\"",
    "cat > f.txt <<'EOF'\npytest src\ngit push --no-verify\nEOF",
    "ls -la",
    "git log -n 5",
    "echo pytest src",
    "pytest -q tests/test_check_ci.py 2>&1 | tail -5",
    "pytest --version",
    "python3 -m pytest --help",
])
def test_allows(command):
    res = guard(command)
    assert res.returncode == 0, (command, res.stdout, res.stderr)


@pytest.mark.parametrize("stdin", ["", "not json", "{}", json.dumps({"tool_input": {}}),
                                   json.dumps({"tool_input": {"command": "echo 'unterminated"}})])
def test_fails_open_on_bad_input(stdin):
    assert run_guard(stdin).returncode == 0


def test_auto_handoff_without_gh(tmp_path):
    # A PATH without gh: the script must still print the block and exit 0.
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for tool in ("git", "head", "wc", "tr", "perl", "bash", "cat"):
        found = subprocess.run(["/usr/bin/which", tool], capture_output=True, text=True)
        src = found.stdout.strip()
        if src:
            (bindir / tool).symlink_to(src)
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_PROJECT_DIR"}
    env["PATH"] = str(bindir)
    env["CLAUDE_PROJECT_DIR"] = str(ROOT)
    res = subprocess.run(
        ["bash", str(HANDOFF)], capture_output=True, text=True, env=env, timeout=30
    )
    assert res.returncode == 0, res.stderr
    out = res.stdout
    assert "branch:" in out and "uncommitted changes" in out
    assert "(gh not installed)" in out
    assert "docs/STATE.md (first 40 lines)" in out and "end auto handoff" in out
