"""Unit tests for output_apps/ecosystem_core/src/billing/zibal_service.py (W17).

All HTTP is mocked via urllib.request.urlopen patches (no network call to
gateway.zibal.ir is ever made here) and the Postgres write in
activate_user_subscription is exercised through a monkeypatched
_persist_entitlement (no real DB connection). Safe for
`pytest -m "not integration"`.
"""

from __future__ import annotations

import json

from output_apps.ecosystem_core.src.billing import zibal_service


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_create_payment_request_success(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout=10):
        captured["url"] = req.full_url
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return _FakeResponse(json.dumps({"result": 100, "trackId": 777}).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    res = zibal_service.create_payment_request(
        amount_rials=6_250_000, order_id="ORD-1", description="test", mobile="09123456789",
    )

    assert res["success"] is True
    assert res["track_id"] == 777
    assert res["payment_url"] == "https://gateway.zibal.ir/start/777"
    assert captured["url"] == zibal_service.ZIBAL_REQUEST_URL
    assert captured["payload"]["amount"] == 6_250_000
    assert captured["payload"]["mobile"] == "09123456789"


def test_create_payment_request_gateway_failure(monkeypatch):
    def fake_urlopen(req, timeout=10):
        return _FakeResponse(
            json.dumps({"result": 102, "message": "merchant نامعتبر"}).encode("utf-8")
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    res = zibal_service.create_payment_request(amount_rials=1000, order_id="ORD-2", description="x")
    assert res["success"] is False


def test_verify_payment_success(monkeypatch):
    def fake_urlopen(req, timeout=10):
        return _FakeResponse(
            json.dumps({"result": 100, "amount": 6_250_000, "refNumber": "REF-9"}).encode("utf-8")
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    res = zibal_service.verify_payment("777")
    assert res["success"] is True
    assert res["paid"] is True
    assert res["definitive"] is True
    assert res["amount"] == 6_250_000
    assert res["ref_number"] == "REF-9"


def test_verify_payment_already_confirmed_result_201_is_still_success(monkeypatch):
    # result=201 ("already confirmed") must be treated the same as 100 so a
    # repeat verify call stays idempotent at the Zibal-client layer too.
    def fake_urlopen(req, timeout=10):
        return _FakeResponse(json.dumps({"result": 201, "amount": 6_250_000}).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    res = zibal_service.verify_payment("777")
    assert res["success"] is True
    assert res["paid"] is True
    assert res["definitive"] is True


def test_verify_payment_definitive_gateway_rejection(monkeypatch):
    # result=202 is Zibal's definitive "not paid/cancelled" answer -> ok to
    # mark_failed on this one.
    def fake_urlopen(req, timeout=10):
        return _FakeResponse(json.dumps({"result": 202, "message": "canceled"}).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    res = zibal_service.verify_payment("777")
    assert res["paid"] is False
    assert res["definitive"] is True


def test_verify_payment_network_error_is_not_definitive(monkeypatch):
    # A transient/transport error must NEVER be treated as a final "not
    # paid" answer -- otherwise a genuinely paid order could be lost.
    def fake_urlopen(req, timeout=10):
        raise OSError("network unreachable")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    res = zibal_service.verify_payment("777")
    assert res["success"] is False
    assert res["paid"] is False
    assert res["definitive"] is False


def test_verify_payment_unknown_result_code_is_not_definitive(monkeypatch):
    def fake_urlopen(req, timeout=10):
        return _FakeResponse(json.dumps({"result": 999, "message": "??"}).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    res = zibal_service.verify_payment("777")
    assert res["definitive"] is False


def test_activate_user_subscription_writes_entitlement(monkeypatch):
    calls = []
    monkeypatch.setattr(
        zibal_service,
        "_persist_entitlement",
        lambda **kwargs: calls.append(kwargs) or True,
    )

    result = zibal_service.activate_user_subscription("usr_42", "PERMANENT")

    assert result["is_active"] is True
    assert result["persisted"] is True
    assert calls[0]["user_id"] == "usr_42"
    assert calls[0]["plan_type"] == "PERMANENT"


def test_activate_user_subscription_without_user_id_does_not_persist(monkeypatch):
    called = []
    monkeypatch.setattr(zibal_service, "_persist_entitlement", lambda **kw: called.append(kw))

    result = zibal_service.activate_user_subscription("", "PERMANENT")

    assert result["persisted"] is False
    assert called == []


def test_activate_user_subscription_persist_error_does_not_raise(monkeypatch):
    def boom(**kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(zibal_service, "_persist_entitlement", boom)

    result = zibal_service.activate_user_subscription("usr_1", "MONTHLY")
    assert result["persisted"] is False
    assert "persist_error" in result
