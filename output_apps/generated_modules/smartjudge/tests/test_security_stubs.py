"""Formerly unauthenticated stub/legacy routes: 401 without a token, 403 for non-admins, 410 when removed."""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

BASE = "/api/v1/apps/judge"
ADMIN = "09120000009"


@pytest.fixture(autouse=True)
def _clean():
    chat_auth.reset_for_tests()
    yield
    chat_auth.reset_for_tests()


def _client(user=None):
    app = FastAPI()
    app.include_router(mod.router)

    async def current():
        return user or chat_auth.ANONYMOUS

    app.dependency_overrides[mod.get_current_user] = current
    return TestClient(app)


def _user(phone="09120000001"):
    return chat_auth.CurrentUser(phone=phone, tier="FREE", authenticated=True)


ADMIN_ROUTES = [
    ("post", "/legal-graph/ingest", {"json": {"texts": ["x"]}}),
    ("get", "/admin/export-dataset", {}),
]


@pytest.mark.parametrize("method,path,kw", ADMIN_ROUTES)
def test_admin_routes_401_without_token(method, path, kw):
    r = getattr(_client(), method)(BASE + path, **kw)
    assert r.status_code == 401


@pytest.mark.parametrize("method,path,kw", ADMIN_ROUTES)
def test_admin_key_query_param_no_longer_grants_access(method, path, kw):
    r = getattr(_client(), method)(BASE + path + "?admin_key=anything", **kw)
    assert r.status_code == 401


@pytest.mark.parametrize("method,path,kw", ADMIN_ROUTES)
def test_admin_routes_403_for_non_admin(monkeypatch, method, path, kw):
    monkeypatch.setenv("SMARTJUDGE_ADMIN_PHONES", ADMIN)
    r = getattr(_client(_user()), method)(BASE + path, **kw)
    assert r.status_code == 403


def test_admin_routes_empty_allowlist_denies_everyone(monkeypatch):
    monkeypatch.delenv("SMARTJUDGE_ADMIN_PHONES", raising=False)
    assert _client(_user(ADMIN)).get(BASE + "/admin/export-dataset").status_code == 403


def test_export_dataset_works_for_admin_and_is_rate_limited(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ADMIN_PHONES", ADMIN)
    monkeypatch.setattr(mod, "_ADMIN_HOURLY_LIMIT", 2)
    c = _client(_user(ADMIN))
    assert c.get(BASE + "/admin/export-dataset").status_code == 200
    assert c.get(BASE + "/admin/export-dataset").status_code == 200
    assert c.get(BASE + "/admin/export-dataset").status_code == 429


def test_telephony_session_401_without_token_and_rate_limited(monkeypatch):
    assert _client().post(BASE + "/telephony-session").status_code == 401
    monkeypatch.setattr(mod, "_TELEPHONY_HOURLY_LIMIT", 1)
    c = _client(_user())
    assert c.post(BASE + "/telephony-session").status_code == 200
    assert c.post(BASE + "/telephony-session").status_code == 429


@pytest.mark.parametrize("path", ["/crm/sync-case", "/documents/convert", "/documents/analyze-ocr"])
def test_removed_routes_return_410(path):
    assert _client().post(BASE + path).status_code == 410


def test_health_stays_public():
    assert _client().get(BASE + "/health").status_code == 200


def test_dead_open_web_fallbacks_are_gone():
    assert not hasattr(mod, "_fetch_live_legal_web_fallback")
    assert not hasattr(mod, "_execute_parallel_legal_discovery")


def test_source_disclosure_constant():
    assert mod.LEGAL_SOURCE_DISCLOSURE == {"source": "ekhtebar.ir", "tier": "unofficial"}
