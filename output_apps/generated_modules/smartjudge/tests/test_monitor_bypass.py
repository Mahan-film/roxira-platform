"""Synthetic monitor bypass token (X-Roxira-Monitor vs MONITOR_BYPASS_TOKEN). Offline."""

from output_apps.generated_modules.smartjudge import chat_auth

TOKEN = "testtokentesttokentesttokentestt"  # exactly 32 chars


def test_valid_token_matches():
    assert chat_auth.monitor_token_ok(TOKEN, TOKEN)


def test_wrong_token_rejected():
    assert not chat_auth.monitor_token_ok("x" * 32, TOKEN)


def test_empty_token_is_feature_off():
    assert not chat_auth.monitor_token_ok(TOKEN, "")


def test_short_token_is_feature_off():
    assert not chat_auth.monitor_token_ok("short", "short")


def test_missing_header_rejected():
    assert not chat_auth.monitor_token_ok(None, TOKEN)


def test_token_read_from_env(monkeypatch):
    monkeypatch.setenv("MONITOR_BYPASS_TOKEN", TOKEN)
    assert chat_auth.monitor_token_ok(TOKEN)
    monkeypatch.delenv("MONITOR_BYPASS_TOKEN", raising=False)
    assert not chat_auth.monitor_token_ok(TOKEN)


def test_monitor_request_reads_header(monkeypatch):
    monkeypatch.setenv("MONITOR_BYPASS_TOKEN", TOKEN)

    class Req:
        headers = {"x-roxira-monitor": TOKEN}

    assert chat_auth.monitor_request(Req())
    Req.headers = {"x-roxira-monitor": "nope"}
    assert not chat_auth.monitor_request(Req())
    assert not chat_auth.monitor_request(None)
