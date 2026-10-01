import importlib


def test_tech_radar_tier_defaults_and_final_override(monkeypatch):
    for variable in ("RADAR_DAILY_TIER", "RADAR_LAYER_TIER", "RADAR_FINAL_TIER"):
        monkeypatch.delenv(variable, raising=False)

    mod = importlib.import_module("src.automation.tech_radar")
    try:
        importlib.reload(mod)
        assert (
            mod.DAILY_RADAR_TIER,
            mod.PROJECT_BRIEF_LAYER_TIER,
            mod.PROJECT_BRIEF_FINAL_TIER,
        ) == ("free", "free", "cheap")

        monkeypatch.setenv("RADAR_FINAL_TIER", "strong")
        importlib.reload(mod)
        assert mod.PROJECT_BRIEF_FINAL_TIER == "strong"
    finally:
        monkeypatch.delenv("RADAR_FINAL_TIER", raising=False)
        importlib.reload(mod)
