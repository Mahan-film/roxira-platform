"""Endpoint gating tests for router_crypto.py: disabled flag => 404, nothing touches the DB."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.ecosystem_core.src.billing import router_crypto
from src.billing.test_crypto_payment_service import PLANS, FakeStore, OUR


@pytest.fixture
def parts():
    store = FakeStore()

    def no_db():
        raise AssertionError("DB must not be touched")

    def build(user="u1", factory=None):
        router, verify = router_crypto.build_router(
            resolve_user_ref=lambda request: user,
            get_plans=lambda: PLANS,
            activate_fn=lambda u, p: {"persisted": True},
            entitlement_fn=lambda u: None,
            store_factory=factory or no_db,
            fetch_fn=lambda *a, **k: [],
        )
        app = FastAPI()
        app.include_router(router)
        return TestClient(app), verify

    return store, build


TRACK = "USDT_" + "a" * 32


def test_disabled_everything_404_and_no_db(monkeypatch, parts):
    monkeypatch.delenv("CRYPTO_PAY_ENABLED", raising=False)
    monkeypatch.setenv("CRYPTO_USDT_TRC20_ADDRESS", OUR)
    _, build = parts
    client, _verify = build()
    assert client.get("/payments/crypto/config").json() == {"enabled": False}
    r = client.post("/payments/crypto/create-invoice", json={"plan_type": "SJ_PRO_MONTHLY"})
    assert r.status_code == 404
    assert client.get(f"/payments/crypto/status/{TRACK}").status_code == 404


def test_enabled_requires_login_and_validates_body(monkeypatch, parts):
    monkeypatch.setenv("CRYPTO_PAY_ENABLED", "1")
    monkeypatch.setenv("CRYPTO_USDT_TRC20_ADDRESS", OUR)
    store, build = parts
    anon, _ = build(user=None)
    assert anon.post("/payments/crypto/create-invoice",
                     json={"plan_type": "SJ_PRO_MONTHLY"}).status_code == 401
    client, _ = build(factory=lambda: (store, lambda: None))
    assert client.post("/payments/crypto/create-invoice", json={}).status_code == 422
    assert client.post("/payments/crypto/create-invoice",
                       json={"plan_type": "SJ_PRO_MONTHLY", "usd": 1}).status_code == 422
    assert client.post("/payments/crypto/create-invoice",
                       json={"plan_type": "SINGLE_DRAFT"}).status_code == 400
    ok = client.post("/payments/crypto/create-invoice", json={"plan_type": "SJ_PRO_MONTHLY"})
    assert ok.status_code == 200 and ok.json()["status"] == "PENDING"
    track = ok.json()["track_id"]
    st = client.get(f"/payments/crypto/status/{track}")
    assert st.status_code == 200 and st.json()["status"] == "PENDING"
    assert client.get("/payments/crypto/status/not-a-track").status_code == 422
    other, _ = build(user="someone-else", factory=lambda: (store, lambda: None))
    assert other.get(f"/payments/crypto/status/{track}").status_code == 404


def test_status_endpoint_is_rate_limited_when_gate_says_so(monkeypatch):
    from fastapi.responses import JSONResponse

    monkeypatch.setenv("CRYPTO_PAY_ENABLED", "1")
    monkeypatch.setenv("CRYPTO_USDT_TRC20_ADDRESS", OUR)
    router, _ = router_crypto.build_router(
        resolve_user_ref=lambda request: "u1",
        gate_status=lambda request, tid: JSONResponse(status_code=429, content={"status": "RATE_LIMITED"}),
    )
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get(f"/payments/crypto/status/{TRACK}").status_code == 429
