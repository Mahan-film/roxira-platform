"""Unit tests for output_apps/ecosystem_core/src/billing/router_payment.py (Issue #97).

No network, no DB: the /callback route now only redirects (no Zibal verify
call, no activate_user_subscription call), so a plain FastAPI TestClient with
redirects disabled is enough. Safe for `pytest -m "not integration"`.

The client is built inside a fixture (not at module import time) so this file
has no import-time side effects — see src/test_ci_quarantine_guard.py.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.ecosystem_core.src.billing.router_payment import router


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, follow_redirects=False)


def test_removed_checkout_route_is_gone(client: TestClient):
    """Issue #363: the unauthenticated /checkout route must no longer exist."""
    resp = client.post(
        "/api/v1/payment/zibal/checkout",
        json={"user_id": "usr_1001", "plan_type": "PERMANENT", "amount_rials": 0},
    )

    assert resp.status_code in (404, 405)


def test_removed_trial_route_is_gone(client: TestClient):
    """Issue #363: the unauthenticated /trial/start route must no longer exist."""
    resp = client.post("/api/v1/payment/zibal/trial/start", params={"user_id": "usr_1001"})

    assert resp.status_code in (404, 405)


def test_callback_redirects_to_frontend_page_on_success(client: TestClient):
    resp = client.get("/api/v1/payment/zibal/callback", params={"trackId": "12345", "success": 1})

    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith("/judge/payment/callback?")
    assert "trackId=12345" in location
    assert "success=1" in location


def test_callback_redirects_to_frontend_page_on_failure(client: TestClient):
    resp = client.get("/api/v1/payment/zibal/callback", params={"trackId": "12345", "success": 0})

    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith("/judge/payment/callback?")
    assert "success=0" in location


def test_callback_never_hardcodes_a_user_id():
    """Regression guard for the original bug: the old handler called
    activate_user_subscription("authenticated_user", ...) directly. The
    redirect-only handler must not call it at all for /callback (the
    docstring is allowed to mention the old bug for documentation)."""
    import ast
    import inspect

    from output_apps.ecosystem_core.src.billing import router_payment

    source = inspect.getsource(router_payment.payment_callback)
    tree = ast.parse(source)
    func = tree.body[0]
    body_without_docstring = func.body[1:] if ast.get_docstring(func) else func.body
    body_source = "\n".join(ast.unparse(node) for node in body_without_docstring)
    assert "authenticated_user" not in body_source
    assert "activate_user_subscription" not in body_source


def test_callback_url_encodes_track_id(client: TestClient):
    resp = client.get(
        "/api/v1/payment/zibal/callback",
        params={"trackId": "abc&evil=1", "success": 1},
    )

    assert resp.status_code == 302
    location = resp.headers["location"]
    # The raw trackId must never appear un-encoded (that would let a
    # malicious trackId inject extra query params into the redirect).
    assert "abc&evil=1" not in location
    assert "trackId=abc%26evil%3D1" in location
