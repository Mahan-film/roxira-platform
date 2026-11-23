"""Tests for .github/workflows/pr-agent.yml (Issue #1344)."""

import yaml
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_FILE = ROOT / ".github/workflows/pr-agent.yml"


def test_pr_agent_workflow_exists():
    assert WORKFLOW_FILE.is_file(), "pr-agent.yml must exist"


def test_pr_agent_workflow_structure_and_safety():
    content = WORKFLOW_FILE.read_text(encoding="utf-8")
    data = yaml.safe_load(content)

    # 1. Trigger pull_request (never pull_request_target)
    triggers = data.get("on") or data.get(True)  # YAML 'on' parses as True in some versions
    assert "pull_request" in triggers, "Must trigger on pull_request"
    assert "pull_request_target" not in triggers, "Must NEVER trigger on pull_request_target"

    # 2. Check jobs
    jobs = data.get("jobs", {})
    assert "pr-agent" in jobs

    job = jobs["pr-agent"]
    assert job.get("continue-on-error") is True, "Must never block merge"

    # 3. Fork PR protection in job condition
    job_if = job.get("if", "")
    assert "head.repo.full_name == github.repository" in job_if, "Must skip fork PRs"

    # 4. Action pinned to SHA
    steps = job.get("steps", [])
    action_steps = [s for s in steps if "uses" in s]
    assert len(action_steps) >= 1
    pr_agent_step = action_steps[0]
    assert pr_agent_step["uses"].startswith("qodo-ai/pr-agent@")
    sha_part = pr_agent_step["uses"].split("@")[1].split()[0]
    assert len(sha_part) == 40, "Action must be pinned to 40-character commit SHA"

    # 5. OpenRouter secret & model configuration
    env = pr_agent_step.get("env", {})
    assert env.get("OPENROUTER_KEY") == "${{ secrets.OPENROUTER_AGENT_KEY }}"
    assert "openrouter/" in env.get("CONFIG.MODEL", "")
    assert ":free" in env.get("CONFIG.MODEL", "")

    # 6. Prohibit Verdict line in extra instructions
    extra = env.get("PR_REVIEWER.EXTRA_INSTRUCTIONS", "")
    assert "Verdict" in extra and "Do NOT output any 'Verdict:' line" in extra
