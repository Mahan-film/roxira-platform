"""Unit tests for the W9 "live-run readiness" gaps (docs/research/LIVE_RUN.md):

  * --report-lang (default fa) controls only the narrative language; query
    translation/sourcing (zh/ja/de/ko/ru) is untouched.
  * --max-usd budget guard: aborts before a paid call once OpenRouter usage
    would exceed the cap, and fails fast if usage can't be verified at all.
  * offline test mode (ROXIRA_OFFLINE_TEST / --offline-test / offline=True):
    the full search -> crawl -> rerank -> synthesize pipeline runs end to end
    with zero network calls and zero OpenRouter spend.
  * "fallback-only synthesis" (suggested_commands filled by the programmatic
    stand-in, not the model) is DEGRADED, not a silent SUCCESS.
  * BRAVE_API_KEY (the name actually set in production) is honored, not just
    the documented BRAVE_SEARCH_API_KEY.

No network, no LLM calls, no git operations at import time or in any test —
safe for pytest to collect and run in CI (see src/ci_quarantine.py). Every
test that touches call_llm goes through ROXIRA_OFFLINE_TEST=1, never a real
llm_router import.
"""

from __future__ import annotations

import json

import pytest

from src.automation import project_brief, tech_radar
from src.automation.budget_guard import BudgetExceeded, BudgetGuard, BudgetGuardError
from src.automation.llm_router_bridge import OFFLINE_ENV_VAR, call_llm
from src.automation.web_intelligence import BraveSearchClient, TavilySearchClient


# --------------------------------------------------------------------------- report-lang
def test_synthesis_system_prompt_defaults_to_persian():
    prompt = tech_radar._synthesis_system_prompt()
    assert "Persian" in prompt
    assert "fa-IR" in prompt


def test_synthesis_system_prompt_honors_report_lang():
    prompt_en = tech_radar._synthesis_system_prompt("en")
    assert "English" in prompt_en
    assert "Persian" not in prompt_en


def test_project_brief_layer_and_final_prompts_honor_report_lang():
    layer_prompt = project_brief._layer_system_prompt("en")
    final_prompt = project_brief._final_system_prompt("en")
    assert "English" in layer_prompt
    assert "Persian" not in layer_prompt
    assert "English" in final_prompt
    assert "Persian" not in final_prompt


def test_report_lang_does_not_affect_query_translation_languages():
    # Sourcing languages (zh/ja/de/ko/ru) are a fully separate code path from
    # --report-lang, per the owner's requirement (search stays multilingual,
    # only the final narrative language changes).
    from src.automation.translate import LANGUAGES

    assert set(LANGUAGES) == {"zh", "ja", "de", "ko", "ru"}


def test_agent_stores_report_lang(monkeypatch):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    agent = tech_radar.TechRadarAgent(offline=True, report_lang="en")
    assert agent.report_lang == "en"


# --------------------------------------------------------------------------- budget guard
def test_budget_guard_disabled_without_max_usd():
    guard = BudgetGuard(max_usd=None, snapshot_fn=lambda: 999.0)
    guard.start()
    guard.check("anywhere")  # must not raise, must not even call snapshot_fn
    assert guard.spent_so_far() is None


def test_budget_guard_allows_spend_within_cap():
    usage = iter([1.00, 1.20, 1.40, 1.40])
    guard = BudgetGuard(max_usd=1.0, snapshot_fn=lambda: next(usage))
    guard.start()  # baseline = 1.00
    guard.check("step 1")  # spent = 0.20, within cap
    guard.check("step 2")  # spent = 0.40, within cap
    assert guard.spent_so_far() is not None


def test_budget_guard_raises_past_cap():
    usage = iter([1.00, 2.60])
    guard = BudgetGuard(max_usd=1.0, snapshot_fn=lambda: next(usage))
    guard.start()  # baseline = 1.00
    with pytest.raises(BudgetExceeded) as excinfo:
        guard.check("before synthesis")
    assert excinfo.value.spent_usd == pytest.approx(1.60)
    assert excinfo.value.cap_usd == 1.0


def test_budget_guard_start_raises_when_usage_unverifiable():
    def _boom() -> float:
        raise BudgetGuardError("OPENROUTER_API_KEY is not set")

    guard = BudgetGuard(max_usd=1.5, snapshot_fn=_boom)
    with pytest.raises(BudgetGuardError):
        guard.start()


def test_cli_max_usd_aborts_when_usage_unverifiable(monkeypatch):
    def _boom() -> float:
        raise BudgetGuardError("OPENROUTER_API_KEY is not set")

    monkeypatch.setattr(tech_radar, "fetch_openrouter_usage", _boom)
    exit_code = tech_radar.main(["--topic", "some topic", "--max-usd", "1.5", "--no-save"])
    assert exit_code == 1


def test_cli_offline_test_and_max_usd_are_mutually_exclusive():
    with pytest.raises(SystemExit):
        tech_radar.main(["--topic", "x", "--offline-test", "--max-usd", "1.0", "--no-save"])


def test_tech_radar_research_aborts_before_synthesis_past_budget(monkeypatch):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    usage = iter([0.0, 5.0])  # baseline 0, then already $5 spent elsewhere
    guard = BudgetGuard(max_usd=1.0, snapshot_fn=lambda: next(usage))
    guard.start()
    agent = tech_radar.TechRadarAgent(offline=True, budget_guard=guard)

    report = agent.research("some topic", deep=False)

    assert report["status"] == "FAILED"
    assert any("max-usd" in r or "OpenRouter" in r for r in report["risks_and_caveats"])


def test_project_brief_aborts_remaining_layers_past_budget(monkeypatch, tmp_path):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    usage = iter([0.0] + [5.0] * 20)  # baseline 0, every subsequent check way over cap
    guard = BudgetGuard(max_usd=0.01, snapshot_fn=lambda: next(usage))
    guard.start()

    result = project_brief.run_project_brief(
        "a tiny test project",
        out_path=tmp_path / "brief.md",
        offline=True,
        budget_guard=guard,
    )

    assert result["status"] == "FAILED"
    assert all(layer["status"] == "FAILED" for layer in result["layers"])
    assert (tmp_path / "brief.md").exists()  # partial evidence still written


# --------------------------------------------------------------------------- offline mode
def test_offline_call_llm_returns_canned_success_with_zero_cost(monkeypatch):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    response = call_llm("cheap", "hello", "system", json_mode=True, feature="unit_test")
    assert response["status"] == "SUCCESS"
    assert response["cost_usd"] == 0.0
    payload = json.loads(response["content"])
    assert payload["emerging_technologies"]
    assert payload["suggested_commands"]


def test_offline_call_llm_plain_text_is_deterministic_and_nonempty(monkeypatch):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    response = call_llm("free", "Target language: German\nQuery: vector database", "system")
    assert response["status"] == "SUCCESS"
    assert response["content"]


def test_tech_radar_offline_pipeline_reaches_success(monkeypatch, tmp_path):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    agent = tech_radar.TechRadarAgent(
        offline=True,
        report_md=tmp_path / "report.md",
        report_json=tmp_path / "report.json",
        history_dir=tmp_path / "history",
    )

    report = agent.run("offline pipeline smoke test", deep=False, persist=True)

    assert report["status"] == "SUCCESS"
    assert report["cost_usd"] == 0.0
    assert report["source_count"] > 0
    assert "OfflineFixtureTech" in report["markdown"] or report["emerging_technologies"]
    assert (tmp_path / "report.md").exists()
    assert (tmp_path / "report.json").exists()


def test_project_brief_offline_pipeline_reaches_success(monkeypatch, tmp_path):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    result = project_brief.run_project_brief(
        "offline test project idea",
        out_path=tmp_path / "brief.md",
        offline=True,
    )

    assert result["status"] == "SUCCESS"
    assert all(layer["status"] == "SUCCESS" for layer in result["layers"])
    assert (tmp_path / "brief.md").exists()
    assert (tmp_path / "brief.json").exists()


def test_cli_offline_test_topic_mode_exits_zero(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")  # belt-and-suspenders; --offline-test also sets it
    exit_code = tech_radar.main(
        ["--topic", "offline cli smoke test", "--offline-test", "--no-save", "--json"]
    )
    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "SUCCESS"


def test_cli_offline_test_project_brief_mode_exits_zero(monkeypatch, tmp_path):
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    brief_out = tmp_path / "offline-brief.md"
    exit_code = tech_radar.main(
        [
            "--project-brief",
            "offline cli project brief smoke test",
            "--offline-test",
            "--brief-out",
            str(brief_out),
        ]
    )
    assert exit_code == 0
    assert brief_out.exists()
    assert brief_out.with_suffix(".json").exists()


# --------------------------------------------------------------------- fallback-only synthesis
def test_fallback_only_suggested_commands_marks_run_degraded(monkeypatch):
    """docs/research/LIVE_RUN.md gap: suggested_commands synthesized only by
    the programmatic _fallback_commands() stand-in (never by the model, even
    after repair attempts) must not read as a clean SUCCESS."""
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    agent = tech_radar.TechRadarAgent(offline=True)

    def _repair_call_returns_nothing_useful(*_args, **_kwargs):
        return {"status": "ERROR", "error": "simulated repair failure", "cost_usd": 0.0}

    monkeypatch.setattr(tech_radar, "call_llm", _repair_call_returns_nothing_useful)

    analysis = {
        "executive_summary": "خلاصه",
        "key_findings": ["finding"],
        "emerging_technologies": ["tech"],
        "top_github_repositories": [
            {"name": "owner/repo", "url": "https://github.com/owner/repo"}
        ],
        "pros_cons": ["pc"],
        "suggested_commands": [],  # missing -> triggers repair, then fallback
        "risks_and_caveats": [],
        "recommendations": [],
        "confidence": 0.5,
    }

    repaired = agent._repair_analysis(analysis, "some topic", "some context")

    assert repaired["suggested_commands"], "fallback should still populate commands"
    assert repaired["status"] == "DEGRADED"
    assert any("fallback" in r.lower() or "پشتیبان" in r for r in repaired["risks_and_caveats"])


def test_clean_repair_success_is_not_downgraded(monkeypatch):
    """Contrast case: when the model's own repair call fills every critical
    field (no fallback needed), the run stays SUCCESS."""
    monkeypatch.setenv(OFFLINE_ENV_VAR, "1")
    agent = tech_radar.TechRadarAgent(offline=True)

    analysis = {
        "status": "SUCCESS",
        "executive_summary": "خلاصه",
        "key_findings": ["finding"],
        "emerging_technologies": ["tech"],
        "top_github_repositories": [{"name": "owner/repo", "url": "https://github.com/owner/repo"}],
        "pros_cons": ["pc"],
        "suggested_commands": [{"purpose": "install", "command": "pip install fixture"}],
        "risks_and_caveats": [],
        "recommendations": [],
        "confidence": 0.5,
    }

    repaired = agent._repair_analysis(analysis, "some topic", "some context")

    assert repaired["status"] != "DEGRADED"
    assert repaired["synthesis_attempts"] == 1


# --------------------------------------------------------------------------- BRAVE_API_KEY fallback
@pytest.fixture(autouse=True)
def _hermetic_env_files(monkeypatch):
    """get_env_var falls back to a local .env; neutralise it so results never
    depend on a developer's machine (and no real key can reach an assertion)."""
    from src.automation import provider_base

    monkeypatch.setattr(provider_base, "_ENV_CACHE", {})
    monkeypatch.setattr(provider_base, "_ENV_LOADED", True)


def test_brave_client_honors_legacy_brave_api_key(monkeypatch):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    monkeypatch.setenv("BRAVE_API_KEY", "test-key-123")
    client = BraveSearchClient()
    assert client.configured is True
    assert client.api_key == "test-key-123"  # synthetic value set above


def test_brave_client_prefers_documented_env_var_when_both_set(monkeypatch):
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "documented-key")
    monkeypatch.setenv("BRAVE_API_KEY", "legacy-key")
    client = BraveSearchClient()
    assert client.api_key == "documented-key"


def test_brave_client_not_configured_without_either_key(monkeypatch):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    client = BraveSearchClient()
    assert client.configured is False


def test_tavily_client_honors_legacy_tavily_keys(monkeypatch):
    # Confirmed by a live W9 run against the production server (2026-09-24):
    # its .env sets TAVILY_KEYS, not the documented TAVILY_API_KEYS.
    monkeypatch.delenv("TAVILY_API_KEYS", raising=False)
    monkeypatch.setenv("TAVILY_KEYS", "tavily-test-key")
    client = TavilySearchClient()
    assert client.configured is True
