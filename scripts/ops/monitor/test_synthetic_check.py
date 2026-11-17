"""evaluate_chat_reply: a 429 is a quota warning unless the bypass token is configured. Offline."""

import functools
import importlib.util
import pathlib
import sys

_DIR = pathlib.Path(__file__).resolve().parent


@functools.cache
def _sc():
    if str(_DIR) not in sys.path:
        sys.path.insert(0, str(_DIR))
    spec = importlib.util.spec_from_file_location("_mon_synthetic_check", _DIR / "synthetic_check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_429_without_bypass_is_quota_warning():
    ok, detail = _sc().evaluate_chat_reply(429, b"", 1.0, 45)
    assert ok is True
    assert "quota" in detail and "429" in detail


def test_429_with_bypass_configured_is_failure():
    ok, detail = _sc().evaluate_chat_reply(429, b"", 1.0, 45, bypass_configured=True)
    assert ok is False and "429" in detail


def test_other_non_200_still_fails():
    ok, detail = _sc().evaluate_chat_reply(500, b"", 1.0, 45)
    assert ok is False and "500" in detail


def test_200_reply_still_ok():
    assert _sc().evaluate_chat_reply(200, '{"reply": "20 روز"}'.encode(), 1.0, 45)[0]


def test_parse_meminfo_uses_available():
    text = "MemTotal:        8000000 kB\nMemFree: 100 kB\nMemAvailable:    2000000 kB\n"
    assert round(_sc().parse_meminfo(text)) == 75


def test_parse_meminfo_missing_field_raises():
    import pytest
    with pytest.raises(ValueError):
        _sc().parse_meminfo("MemTotal: 10 kB\n")


def test_restarted_containers_window_and_recreate():
    now = 1_800_000_000.0
    from datetime import datetime, timezone
    recent = datetime.fromtimestamp(now - 600, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.123456789Z")
    old = datetime.fromtimestamp(now - 7200, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.0Z")
    lines = [f"/a 2 {recent} false", f"/b 0 {recent} false", f"/c 3 {old} false", f"/d 0 {recent} true", "garbage"]
    assert _sc().restarted_containers(lines, now, 3600) == ["a", "d"]
