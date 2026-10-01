from output_apps.generated_modules.smartjudge import llm_router
def test_default_tier_models_are_capped(monkeypatch):
    monkeypatch.delenv("LLM_TIER_CHEAP", raising=False)
    _, models = llm_router._resolve_models("cheap", False)
    assert len(models) <= 3
    assert models[0] == llm_router.tier_models("cheap")[0]
def test_env_tier_models_are_capped(monkeypatch):
    monkeypatch.setenv("LLM_TIER_STRONG", "a/x,b/y,c/z,d/w,e/v")
    assert llm_router._resolve_models("strong", False)[1] == ["a/x", "b/y", "c/z"]
def test_sensitive_filter_applies_before_cap(monkeypatch):
    monkeypatch.setenv("LLM_TIER_CHEAP", "a/x:free,b/y,c/z,d/w,e/v")
    _, models = llm_router._resolve_models("cheap", True)
    assert "a/x:free" not in models
    assert len(models) == 3
