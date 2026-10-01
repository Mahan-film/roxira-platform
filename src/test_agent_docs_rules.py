from pathlib import Path


def test_agent_documentation_rules_are_present():
    root = Path(__file__).resolve().parents[1]
    agents = (root / "AGENTS.md").read_text()
    skill = (root / ".agents/skills/agent-issue-handoff/SKILL.md").read_text()
    strategy = (root / "docs/STRATEGY.md").read_text()

    assert "Context selection" in agents
    assert "name: agent-issue-handoff" in skill
    assert "description: Write a small, self-contained GitHub issue for the rx worker lane" in skill
    assert "pack_agent_context" in strategy
