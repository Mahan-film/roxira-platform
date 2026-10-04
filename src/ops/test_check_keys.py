"""Offline tests for scripts/dev/check_keys.py (no network, no real keys)."""

from __future__ import annotations

import importlib.util
import io
import ssl
import urllib.error
import urllib.request
from pathlib import Path

import pytest

SECRET = "sk-SUPERSECRET-123456"
ALL_VARS = [
    "OPENROUTER_API_KEY",
    "MISTRAL_API_KEY",
    "GROQ_API_KEY",
    "SAMBANOVA_API_KEY",
    "TAVILY_API_KEYS",
    "BRAVE_SEARCH_API_KEY",
    "EXA_API_KEY",
    "JINA_API_KEY",
    "FIRECRAWL_API_KEY",
    "ASSEMBLYAI_API_KEYS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "KAVENEGAR_API_KEY",
    "OMNIROUTE_API_KEY",
    "OMNIROUTE_BASE_URL",
]
FAKE_URL = "http://127.0.0.1:29999/v1/"


@pytest.fixture
def ck(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "check_keys", Path(__file__).resolve().parents[2] / "scripts/dev/check_keys.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for var in ALL_VARS:
        monkeypatch.delenv(var, raising=False)
    return module


class _Resp:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _http_error(code):
    return urllib.error.HTTPError(
        "https://x", code, f"bad {SECRET}", {}, io.BytesIO(SECRET.encode())
    )


def test_all_skipped(ck, capsys):
    assert ck.main() == 0
    out = capsys.readouterr().out
    assert "OPENROUTER" in out and "SKIP(not set)" in out
    assert "0 OK, 0 FAIL" in out


def test_ok_and_never_leaks(ck, monkeypatch, capsys):
    monkeypatch.setenv("OPENROUTER_API_KEY", SECRET)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", SECRET)
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None, context=None: _Resp())
    assert ck.main() == 0
    out = capsys.readouterr().out
    assert "OPENROUTER" in out and "OK" in out
    assert f"len={len(SECRET)}" in out
    assert SECRET not in out


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (_http_error(401), "FAIL(401)"),
        (_http_error(403), "FAIL(403)"),
        (TimeoutError(SECRET), "FAIL(timeout)"),
        (TimeoutError(SECRET), "FAIL(timeout)"),
        (urllib.error.URLError(TimeoutError(SECRET)), "FAIL(timeout)"),
        (urllib.error.URLError(SECRET), "FAIL(network)"),
        (RuntimeError(SECRET), "FAIL(RuntimeError)"),
    ],
)
def test_errors_redacted(ck, monkeypatch, capsys, exc, expected):
    monkeypatch.setenv("MISTRAL_API_KEY", SECRET)

    def boom(req, timeout=None, context=None):
        raise exc

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    assert ck.main() == 0
    out = capsys.readouterr().out
    assert expected in out
    assert SECRET not in out


def test_comma_lists_by_index(ck, monkeypatch, capsys):
    monkeypatch.setenv("TAVILY_API_KEYS", f"{SECRET}a, {SECRET}b")
    seen = []

    def fake(req, timeout=None, context=None):
        seen.append(timeout)
        if req.get_header("Authorization", "").endswith("b"):
            raise _http_error(401)
        return _Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    ck.main()
    out = capsys.readouterr().out
    assert "TAVILY#1" in out and "TAVILY#2" in out and "FAIL(401)" in out
    assert seen == [10, 10]
    assert SECRET not in out


def test_ssl_cert_classified_with_single_hint(ck, monkeypatch, capsys):
    monkeypatch.setenv("MISTRAL_API_KEY", SECRET)
    monkeypatch.setenv("GROQ_API_KEY", SECRET)

    def boom(req, timeout=None, context=None):
        raise urllib.error.URLError(ssl.SSLCertVerificationError(1, f"bad {SECRET}"))

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    assert ck.main() == 0
    out = capsys.readouterr().out
    assert out.count("FAIL(ssl-cert)") == 2
    assert out.count("hint: pip install certifi") == 1
    assert "FAIL(network)" not in out
    assert SECRET not in out


class _ModelsResp(_Resp):
    def read(self):
        return b'{"data": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}'


def _set_omni(monkeypatch):
    monkeypatch.setenv("OMNIROUTE_API_KEY", SECRET)
    monkeypatch.setenv("OMNIROUTE_BASE_URL", FAKE_URL)


def test_omniroute_skipped_without_url(ck, monkeypatch, capsys):
    monkeypatch.setenv("OMNIROUTE_API_KEY", SECRET)
    ck.main()
    line = next(x for x in capsys.readouterr().out.splitlines() if x.startswith("OMNIROUTE"))
    assert "SKIP(not set)" in line


def test_omniroute_ok_counts_models(ck, monkeypatch, capsys):
    _set_omni(monkeypatch)
    seen = []

    def fake(req, timeout=None, context=None):
        seen.append((req.full_url, req.get_header("Authorization")))
        return _ModelsResp()

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    ck.main()
    out = capsys.readouterr().out
    assert seen == [("http://127.0.0.1:29999/v1/models", f"Bearer {SECRET}")]
    line = next(x for x in out.splitlines() if x.startswith("OMNIROUTE"))
    assert "OK" in line and "3 models" in line
    assert SECRET not in out and "127.0.0.1" not in out and "29999" not in out


def test_omniroute_401(ck, monkeypatch, capsys):
    _set_omni(monkeypatch)

    def boom(req, timeout=None, context=None):
        raise _http_error(401)

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    ck.main()
    out = capsys.readouterr().out
    assert "FAIL(401)" in out
    assert "OmniRoute container" not in out
    assert SECRET not in out and "29999" not in out


def test_omniroute_connection_refused(ck, monkeypatch, capsys):
    _set_omni(monkeypatch)

    def boom(req, timeout=None, context=None):
        raise urllib.error.URLError(ConnectionRefusedError(f"{FAKE_URL} {SECRET}"))

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    ck.main()
    out = capsys.readouterr().out
    assert "FAIL(network)" in out
    assert "is the OmniRoute container running?" in out
    assert SECRET not in out and "127.0.0.1" not in out and "29999" not in out


def test_context_passed_to_urlopen(ck, monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", SECRET)
    seen = []

    def fake(req, timeout=None, context=None):
        seen.append(context)
        return _Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    ck.main()
    assert len(seen) == 1 and isinstance(seen[0], ssl.SSLContext)
