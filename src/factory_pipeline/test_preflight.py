from src.factory_pipeline.preflight import (
    REQUIRED_SECRETS,
    Finding,
    check,
    render_report_fa,
)

def _all_secrets() -> set[str]:
    return {name for names in REQUIRED_SECRETS.values() for name in names}

def test_ready_controls_have_no_findings_and_persian_ready_report() -> None:
    findings = check(
        _all_secrets(),
        {"FACTORY_ENABLED": "true", "AGENT_ENABLED": "true"},
    )

    assert findings == []
    assert render_report_fa(findings) == "همهٔ کنترل‌های لازم آماده است."

def test_missing_research_key_is_the_only_missing_secret_finding() -> None:
    secret_names = _all_secrets() - {"OPENROUTER_RESEARCH_KEY"}
    findings = check(
        secret_names,
        {"FACTORY_ENABLED": "true", "AGENT_ENABLED": "true"},
    )

    assert findings == [Finding("factory-research", "missing_secret", "OPENROUTER_RESEARCH_KEY")]
    assert "OPENROUTER_RESEARCH_KEY" in render_report_fa(findings)

def test_disabled_factory_variable_and_report_do_not_expose_values() -> None:
    findings = check(
        _all_secrets(),
        {
            "FACTORY_ENABLED": "false",
            "AGENT_ENABLED": "true",
            "UNRELATED_VALUE": "not-a-real-secret-value",
        },
    )
    report = render_report_fa(findings)

    assert findings == [Finding("factory-research", "var_not_true", "FACTORY_ENABLED")]
    assert "FACTORY_ENABLED" in report
    assert "not-a-real-secret-value" not in report
