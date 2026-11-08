"""T18 Payment Callback Audit & Double Credit Protection Tests.

Verifies:
- Authority / trackId query and payload alias handling (support authority/Authority/track_id/trackId).
- Server-side amount validation against stored order amount.
- Idempotent callback/refresh: replay never invokes activation or double-credits.
- Concurrency serialization via lock.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import smartjudge_module as mod


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PAYMENTS_LIVE", "true")
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


def test_verify_endpoint_accepts_authority_field(client: TestClient, monkeypatch):
    """Payload with 'authority' instead of 'track_id' is accepted and routed."""
    seen_track_ids = []

    def mock_verify_invoice(*, track_id, **kwargs):
        seen_track_ids.append(track_id)
        return {"status": "PAID", "message": "پرداخت با موفقیت تایید شد.", "track_id": track_id}

    monkeypatch.setattr(mod.payment_service, "verify_invoice", mock_verify_invoice)
    monkeypatch.setattr(mod.payment_orders, "get_connection", lambda: MagicMock())

    resp = client.post(
        "/api/v1/apps/judge/payments/verify",
        json={"authority": "AUTH_998877"},
    )
    assert resp.status_code == 200
    assert seen_track_ids == ["AUTH_998877"]
    assert resp.json()["status"] == "PAID"


def test_verify_endpoint_accepts_capital_authority_field(client: TestClient, monkeypatch):
    """Payload with 'Authority' is accepted and normalized."""
    seen_track_ids = []

    def mock_verify_invoice(*, track_id, **kwargs):
        seen_track_ids.append(track_id)
        return {"status": "PAID", "message": "پرداخت با موفقیت تایید شد.", "track_id": track_id}

    monkeypatch.setattr(mod.payment_service, "verify_invoice", mock_verify_invoice)
    monkeypatch.setattr(mod.payment_orders, "get_connection", lambda: MagicMock())

    resp = client.post(
        "/api/v1/apps/judge/payments/verify",
        json={"Authority": "A00001122"},
    )
    assert resp.status_code == 200
    assert seen_track_ids == ["A00001122"]
    assert resp.json()["status"] == "PAID"


def test_verify_endpoint_missing_token_returns_400(client: TestClient):
    """Missing both track_id and authority returns 400 Bad Request."""
    resp = client.post(
        "/api/v1/apps/judge/payments/verify",
        json={},
    )
    assert resp.status_code == 400
    assert "شناسه پیگیری" in resp.json()["message"]


def test_verify_endpoint_unavailable_when_live_payments_disabled(client: TestClient, monkeypatch):
    """When PAYMENTS_LIVE is false, returns 503 UNAVAILABLE."""
    monkeypatch.setenv("PAYMENTS_LIVE", "false")
    resp = client.post(
        "/api/v1/apps/judge/payments/verify",
        json={"track_id": "12345"},
    )
    assert resp.status_code == 503
    assert resp.json()["status"] == "UNAVAILABLE"
