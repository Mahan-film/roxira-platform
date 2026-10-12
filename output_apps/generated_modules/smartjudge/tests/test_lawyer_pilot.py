"""Lawyer pilot sign-up never grants anything automatically. Offline (in-memory KV)."""

import importlib

import pytest

URL = "/api/v1/apps/judge/lawyers/pilot-onboarding"


@pytest.fixture
def client(monkeypatch):
    mod = importlib.import_module("output_apps.generated_modules.smartjudge.smartjudge_module")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    store = {}
    monkeypatch.setattr(mod.chat_auth, "kv_set", lambda k, v, ttl: store.__setitem__(k, v))
    counts = {}

    def fake_incr(key, window):
        counts[key] = counts.get(key, 0) + 1
        return counts[key], window

    monkeypatch.setattr(mod.chat_auth, "incr", fake_incr)
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app), store


def test_request_is_stored_pending_and_not_verified(client):
    c, store = client
    r = c.post(URL, json={"full_name": "علی", "license_no": "12345", "phone": "09120000000"})
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "PENDING_REVIEW" and body["license_verified"] is False
    assert "gift_plan" not in body
    assert len(store) == 1 and next(iter(store.values()))["status"] == "PENDING_REVIEW"


def test_missing_fields_rejected(client):
    c, store = client
    r = c.post(URL, json={"full_name": "علی"})
    assert r.status_code == 400 and not store


def test_rate_limited_after_five(client):
    c, _ = client
    payload = {"full_name": "علی", "license_no": "1", "phone": "0912"}
    codes = [c.post(URL, json=payload).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429
