import pytest

NAME = "RX_TEST_INT_ENV"


def _load():
    from output_apps.generated_modules.unifiedauth.env_utils import _int_env

    return _int_env


def test_unset_returns_default(monkeypatch):
    monkeypatch.delenv(NAME, raising=False)
    assert _load()(NAME, 86400, 300, 2592000) == 86400


@pytest.mark.parametrize("raw", ["", "   ", "abc", "12x", "1.5"])
def test_empty_blank_or_non_numeric_returns_default(monkeypatch, raw):
    monkeypatch.setenv(NAME, raw)
    assert _load()(NAME, 86400, 300, 2592000) == 86400


def test_too_small_clamped(monkeypatch):
    monkeypatch.setenv(NAME, "10")
    assert _load()(NAME, 86400, 300, 2592000) == 300


def test_too_large_clamped(monkeypatch):
    monkeypatch.setenv(NAME, "99999999")
    assert _load()(NAME, 86400, 300, 2592000) == 2592000


def test_valid_value(monkeypatch):
    monkeypatch.setenv(NAME, " 3600 ")
    assert _load()(NAME, 86400, 300, 2592000) == 3600
