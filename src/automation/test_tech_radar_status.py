"""Unit tests for the W9 Phase B "never report a degraded run as success"
hard rule (docs/research/bakeoff.md §1 finding 5).

No network, no LLM calls, no git operations at import time or in any test —
safe for pytest to collect and run in CI (see src/ci_quarantine.py).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from src.automation import tech_radar
from src.automation.project_brief import _slugify


def _agent_with_no_providers() -> tech_radar.TechRadarAgent:
    web = MagicMock()
    web.providers.return_value = {
        "tavily": False,
        "exa": False,
        "brave": False,
        "firecrawl": False,
        "jina_reader": False,
        "jina_reranker": False,
    }
    web.search.return_value = {"status": "EMPTY", "results": [], "providers": {}}
    agent = tech_radar.TechRadarAgent(web=web, multilingual=False)
    # Structured/site adapters are network calls too; stub them out so this
    # test exercises only the "no evidence at all" short-circuit.
    agent.structured_adapters = []
    agent.site_adapters = []
    return agent


def test_no_search_provider_keys_fails_fast_without_calling_the_llm():
    agent = _agent_with_no_providers()
    report = agent.research("some topic", deep=False)

    assert report["status"] == "FAILED"
    assert report["source_count"] == 0
    assert any("کلید API" in r for r in report["risks_and_caveats"])


def test_main_exits_nonzero_when_status_is_failed(monkeypatch, tmp_path):
    agent = _agent_with_no_providers()
    monkeypatch.setattr(tech_radar, "TechRadarAgent", lambda *a, **k: agent)

    exit_code = tech_radar.main(
        ["--topic", "some topic", "--no-save", "--json"]
    )
    assert exit_code == 1


def test_main_exits_nonzero_when_status_is_degraded(monkeypatch):
    agent = _agent_with_no_providers()
    monkeypatch.setattr(tech_radar, "TechRadarAgent", lambda *a, **k: agent)
    monkeypatch.setattr(
        agent,
        "research",
        lambda *a, **k: {"status": "DEGRADED", "markdown": ""},
    )

    exit_code = tech_radar.main(["--topic", "some topic", "--no-save", "--json"])
    assert exit_code == 1


def test_main_exits_zero_only_on_success(monkeypatch):
    agent = _agent_with_no_providers()
    monkeypatch.setattr(tech_radar, "TechRadarAgent", lambda *a, **k: agent)
    monkeypatch.setattr(
        agent,
        "research",
        lambda *a, **k: {"status": "SUCCESS", "markdown": ""},
    )

    exit_code = tech_radar.main(["--topic", "some topic", "--no-save", "--json"])
    assert exit_code == 0


def test_slugify_is_filesystem_safe():
    assert _slugify("Persian real-time voice legal assistant!") == "persian-real-time-voice-legal-assistant"
    assert _slugify("") == "project-brief"
