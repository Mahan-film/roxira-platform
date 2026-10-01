import importlib

import pytest


@pytest.fixture
def preflight_module():
    return importlib.import_module("src.factory_pipeline.preflight")


def _all_secrets(preflight_module) -> set[str]:
    return {
        name for names in preflight_module.REQUIRED_SECRETS.values() for name in names
    }


def _factory_secrets(preflight_module) -> set[str]:
    return set(preflight_module.REQUIRED_SECRETS["factory-research"])


def test_all_present_controls_set_ok_and_print_persian_ready_report(
    preflight_module,
    capsys,
    monkeypatch,
    tmp_path,
) -> None:
    output_path = tmp_path / "github-output"
    monkeypatch.setenv(
        "SECRETS_PRESENT", ",".join(sorted(_factory_secrets(preflight_module)))
    )
    monkeypatch.setenv("VARS_JSON", '{"FACTORY_ENABLED": "true"}')
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_path))

    assert preflight_module.main() == 0

    assert output_path.read_text(encoding="utf-8") == "ok=true\n"
    assert capsys.readouterr().out == "همهٔ کنترل‌های لازم آماده است.\n"


def test_missing_research_key_is_the_only_missing_secret_finding(preflight_module) -> None:
    secret_names = _all_secrets(preflight_module) - {"OPENROUTER_RESEARCH_KEY"}
    findings = preflight_module.check(
        secret_names,
        {"FACTORY_ENABLED": "true", "AGENT_ENABLED": "true"},
    )

    assert findings == [
        preflight_module.Finding(
            "factory-research", "missing_secret", "OPENROUTER_RESEARCH_KEY"
        )
    ]
    assert "OPENROUTER_RESEARCH_KEY" in preflight_module.render_report_fa(findings)


def test_missing_secret_and_disabled_factory_are_reported_in_persian(
    preflight_module,
    capsys,
    monkeypatch,
    tmp_path,
) -> None:
    output_path = tmp_path / "github-output"
    monkeypatch.setenv(
        "SECRETS_PRESENT",
        ",".join(
            sorted(_factory_secrets(preflight_module) - {"OPENROUTER_RESEARCH_KEY"})
        ),
    )
    monkeypatch.setenv("VARS_JSON", '{"FACTORY_ENABLED": "false"}')
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_path))

    assert preflight_module.main() == 0

    report = capsys.readouterr().out
    assert output_path.read_text(encoding="utf-8") == "ok=false\n"
    assert "کلید OPENROUTER_RESEARCH_KEY تنظیم نشده" in report
    assert "متغیر FACTORY_ENABLED باید true باشد" in report


def test_disabled_factory_variable_and_report_do_not_expose_values(preflight_module) -> None:
    findings = preflight_module.check(
        _all_secrets(preflight_module),
        {
            "FACTORY_ENABLED": "false",
            "AGENT_ENABLED": "true",
            "UNRELATED_VALUE": "not-a-real-secret-value",
        },
    )
    report = preflight_module.render_report_fa(findings)

    assert findings == [
        preflight_module.Finding("factory-research", "var_not_true", "FACTORY_ENABLED")
    ]
    assert "FACTORY_ENABLED" in report
    assert "not-a-real-secret-value" not in report
