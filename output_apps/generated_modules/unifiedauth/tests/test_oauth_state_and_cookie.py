"""Google OAuth: `state` is required, single-use, short-lived; session cookie is HttpOnly+Secure+Lax."""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

MODULE = "output_apps.generated_modules.unifiedauth.unifiedauth_module"
CHAT_AUTH = "output_apps.generated_modules.smartjudge.chat_auth"


@pytest.fixture
def mod(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-not-real")
    monkeypatch.setenv("KAVENEGAR_API_KEY", "test-kavenegar-not-real")
    m = importlib.reload(importlib.import_module(MODULE))
    monkeypatch.setattr(m, "GOOGLE_CLIENT_ID", "id-for-test")
    monkeypatch.setattr(m, "GOOGLE_CLIENT_SECRET", "secret-for-test")
    monkeypatch.setattr(m, "_exchange_google_code", lambda code, uri: {"id_token": "t"})
    monkeypatch.setattr(m, "_verify_google_id_token", lambda t: {"email": "a@example.com"})
    monkeypatch.setattr(m, "get_user", lambda ident: {
        "id": 1, "username": "a", "email": "a@example.com", "phone": None, "role": "LEGAL_USER"})
    chat_auth = importlib.import_module(CHAT_AUTH)
    chat_auth.reset_for_tests()
    yield m
    chat_auth.reset_for_tests()


def _client(mod):
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app, follow_redirects=False)


def _issue(mod, c):
    return c.get("/api/v1/auth/google/url").json()["state"]


def test_missing_state_rejected(mod):
    assert _client(mod).get("/api/v1/auth/google/callback?code=x").status_code == 400


def test_unknown_state_rejected(mod):
    assert _client(mod).get("/api/v1/auth/google/callback?code=x&state=forged").status_code == 400


def test_state_is_single_use(mod):
    c = _client(mod)
    state = _issue(mod, c)
    assert c.get(f"/api/v1/auth/google/callback?code=x&state={state}").status_code == 302
    assert c.get(f"/api/v1/auth/google/callback?code=x&state={state}").status_code == 400


def test_state_expires(mod, monkeypatch):
    chat_auth = importlib.import_module(CHAT_AUTH)
    c = _client(mod)
    state = _issue(mod, c)
    real = chat_auth._now
    monkeypatch.setattr(chat_auth, "_now", lambda: real() + mod._OAUTH_STATE_TTL_SECONDS + 5)
    assert c.get(f"/api/v1/auth/google/callback?code=x&state={state}").status_code == 400


def test_state_ttl_is_short(mod):
    assert mod._OAUTH_STATE_TTL_SECONDS <= 600


def test_session_cookie_flags(mod):
    c = _client(mod)
    state = _issue(mod, c)
    r = c.get(f"/api/v1/auth/google/callback?code=x&state={state}")
    assert r.status_code == 302
    cookie = r.headers["set-cookie"].lower()
    assert "roxira_jwt=" in cookie
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
