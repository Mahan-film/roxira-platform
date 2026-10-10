"""Offline tests: chat idempotent replay, client-error telemetry, payment auth. No network."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

BASE = "/api/v1/apps/judge"
PHONE = "09120000011"
OTHER = "09120000022"
RID = "3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23"
RID2 = "7a1c9d2e-0b3f-4c5d-8e6f-1a2b3c4d5e6f"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    chat_auth.reset_for_tests()
    mod._ENTITLEMENT_CACHE.clear()
    for name in ("CHAT_ANON_HOURLY_LIMIT", "ROXIRA_ENV"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(mod, "VIP_PHONE_ALLOWLIST", set())
    monkeypatch.setattr(mod, "_entitlement_tier", lambda phone: None)
    monkeypatch.setattr(chat_auth, "IDEM_POLL_SECONDS", 0.01)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


def _auth(phone=PHONE):
    return {"Authorization": f"Bearer {mod._issue_access_token(phone, 'FREE', {})}"}


@pytest.fixture
def counted(monkeypatch):
    """Replace the consult core with a counting fake that returns a unique answer per call."""
    calls = {"n": 0}

    async def fake(payload, request, user):
        calls["n"] += 1
        return {"status": "SUCCESS", "reply": f"answer-{calls['n']}", "tier": user.tier}

    monkeypatch.setattr(mod, "_consult_core", fake)
    return calls


def test_replay_returns_cached_body_and_header(client, counted):
    first = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers=_auth())
    assert first.status_code == 200 and "x-idempotent-replay" not in first.headers
    second = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers=_auth())
    assert second.status_code == 200
    assert second.headers["x-idempotent-replay"] == "1"
    assert second.json() == first.json()
    assert counted["n"] == 1


def test_idempotency_key_header_works_on_consult(client, counted):
    h = {**_auth(), "Idempotency-Key": RID}
    a = client.post(f"{BASE}/consult", json={"message": "q"}, headers=h)
    b = client.post(f"{BASE}/consult", json={"message": "q"}, headers=h)
    assert b.headers["x-idempotent-replay"] == "1" and a.json() == b.json() and counted["n"] == 1


def test_replay_does_not_charge_rate_limit(client, monkeypatch):
    monkeypatch.setenv("CHAT_ANON_HOURLY_LIMIT", "2")
    body = {"message": "سلام", "request_id": RID}
    for _ in range(5):
        assert client.post(f"{BASE}/chat", json=body).status_code == 200  # 1 charge, 4 replays
    assert client.post(f"{BASE}/chat", json={"message": "سلام", "request_id": RID2}).status_code == 200
    assert client.post(f"{BASE}/chat", json={"message": "سلام"}).status_code == 429


def test_different_identity_does_not_get_cached_answer(client, counted):
    a = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers=_auth(PHONE))
    b = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers=_auth(OTHER))
    anon = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID})
    assert "x-idempotent-replay" not in b.headers and "x-idempotent-replay" not in anon.headers
    assert len({a.json()["reply"], b.json()["reply"], anon.json()["reply"]}) == 3
    assert counted["n"] == 3


def test_different_message_same_request_id_recomputes(client, counted):
    client.post(f"{BASE}/chat", json={"message": "one", "request_id": RID})
    r = client.post(f"{BASE}/chat", json={"message": "two", "request_id": RID})
    assert "x-idempotent-replay" not in r.headers and counted["n"] == 2


@pytest.mark.parametrize("bad", ["not-a-uuid", "x" * 80, 123, "3f2b8c1e-5d4a-1b7e-9a10-2c6d8e0f1a23", ""])
def test_invalid_request_id_is_ignored(client, counted, bad):
    client.post(f"{BASE}/chat", json={"message": "q", "request_id": bad})
    r = client.post(f"{BASE}/chat", json={"message": "q", "request_id": bad})
    assert r.status_code == 200 and "x-idempotent-replay" not in r.headers
    assert counted["n"] == 2


def test_errors_are_not_cached(client, monkeypatch):
    calls = {"n": 0}

    async def fake(payload, request, user):
        calls["n"] += 1
        if calls["n"] == 1:
            return chat_auth.error_json(500, "boom", code="INTERNAL_ERROR", label="ERROR")
        return {"status": "SUCCESS", "reply": "ok"}

    monkeypatch.setattr(mod, "_consult_core", fake)
    assert client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}).status_code == 500
    ok = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID})
    assert ok.status_code == 200 and ok.json()["reply"] == "ok" and "x-idempotent-replay" not in ok.headers


def test_in_progress_request_is_awaited_not_recomputed(monkeypatch):
    calls = {"n": 0}

    async def slow(payload, request, user):
        calls["n"] += 1
        await asyncio.sleep(0.2)
        return {"status": "SUCCESS", "reply": "slow-answer"}

    monkeypatch.setattr(mod, "_consult_core", slow)
    req = SimpleNamespace(headers={}, client=SimpleNamespace(host="203.0.113.7"))

    async def run():
        payload = {"message": "q", "request_id": RID}
        return await asyncio.gather(
            mod.interactive_consult(dict(payload), req, chat_auth.ANONYMOUS),
            mod.interactive_consult(dict(payload), req, chat_auth.ANONYMOUS),
        )

    results = asyncio.run(run())
    assert calls["n"] == 1
    replays = [r for r in results if not isinstance(r, dict)]
    assert len(replays) == 1 and replays[0].headers["x-idempotent-replay"] == "1"
    assert [r for r in results if isinstance(r, dict)] == [{"status": "SUCCESS", "reply": "slow-answer"}]


def test_lru_is_bounded(monkeypatch):
    monkeypatch.setattr(chat_auth, "IDEM_MAX_ENTRIES", 3)
    for i in range(6):
        chat_auth.idem_store(f"idem:res:{i}", {"status": "SUCCESS", "i": i})
    assert chat_auth.idem_get("idem:res:0") is None and chat_auth.idem_get("idem:res:5")["i"] == 5


# ---------------- telemetry ----------------
def test_client_error_returns_204_truncates_and_drops_pii(client, capsys):
    resp = client.post(f"{BASE}/client-errors", json={
        "kind": "network", "message": "m" * 1000, "request_id": RID, "elapsed_ms": 24000,
        "online": "true", "visibility": "visible", "ua_hint": "iOS Safari",
        "phone": "09129999999", "token": "SECRET-TOKEN"})
    assert resp.status_code == 204 and resp.content == b""
    err = capsys.readouterr().err
    line = next(l for l in err.splitlines() if l.startswith("[CLIENT-ERROR]"))
    assert "m" * 300 in line and "m" * 301 not in line
    assert "09129999999" not in err and "SECRET-TOKEN" not in err
    assert "elapsed_ms=24000" in line


def test_client_error_is_rate_limited_per_ip(client):
    for _ in range(30):
        assert client.post(f"{BASE}/client-errors", json={"kind": "x"}).status_code == 204
    assert client.post(f"{BASE}/client-errors", json={"kind": "x"}).status_code == 429


# ---------------- timing + payment ----------------
def test_chat_timing_line_has_no_text_or_phone(client, capsys):
    client.post(f"{BASE}/chat", json={"message": "سلام", "request_id": RID}, headers=_auth())
    err = capsys.readouterr().err
    line = next(l for l in err.splitlines() if l.startswith("[CHAT-TIMING]"))
    assert f"request_id={RID}" in line and "total_ms=" in line and "tier=FREE" in line
    assert "سلام" not in line and PHONE not in line


def test_payment_requires_auth(client):
    assert client.post(f"{BASE}/payment/initiate", json={"plan": "monthly_vip"}).status_code == 401
    ok = client.post(f"{BASE}/payment/initiate", json={"plan": "monthly_vip"}, headers=_auth())
    assert ok.status_code == 200 and ok.json()["amount_toman"] == 490000


def test_anonymous_replay_survives_client_ip_change(client, counted):
    a = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers={"X-Real-IP": "1.2.3.4"})
    b = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers={"X-Real-IP": "2a01:db8::1"})
    assert b.headers["x-idempotent-replay"] == "1" and a.json() == b.json() and counted["n"] == 1
    c = client.post(f"{BASE}/chat", json={"message": "other", "request_id": RID}, headers={"X-Real-IP": "5.6.7.8"})
    assert "x-idempotent-replay" not in c.headers and counted["n"] == 2


def test_authenticated_replay_isolated_by_phone_not_ip(client, counted):
    client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers={**_auth(PHONE), "X-Real-IP": "1.1.1.1"})
    same = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers={**_auth(PHONE), "X-Real-IP": "9.9.9.9"})
    other = client.post(f"{BASE}/chat", json={"message": "q", "request_id": RID}, headers={**_auth(OTHER), "X-Real-IP": "1.1.1.1"})
    assert same.headers["x-idempotent-replay"] == "1" and "x-idempotent-replay" not in other.headers
    assert counted["n"] == 2
