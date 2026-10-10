"""Offline tests for chat auth: bearer identity, anonymous limits, IDOR, OTP limits. No network."""

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

PHONE = "09120000011"
OTHER = "09120000022"
BASE = "/api/v1/apps/judge"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    chat_auth.reset_for_tests()
    mod._ENTITLEMENT_CACHE.clear()
    for name in ("CHAT_ANON_HOURLY_LIMIT", "VOICE_ANON_HOURLY_LIMIT", "OTP_DEV_ECHO", "ROXIRA_ENV"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(mod, "VIP_PHONE_ALLOWLIST", set())
    monkeypatch.setattr(mod, "_entitlement_tier", lambda phone: None)  # no Postgres offline
    clock = {"t": 1_000_000.0}
    monkeypatch.setattr(chat_auth, "_now", lambda: clock["t"])
    monkeypatch.setattr(mod.time, "time", lambda: clock["t"])
    return clock


@pytest.fixture
def clock(_clean):
    return _clean


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


def _auth(phone=PHONE):
    token = mod._issue_access_token(phone, "FREE", {})
    return {"Authorization": f"Bearer {token}"}


# ---------------- identity / tier ----------------
def test_body_tier_is_ignored_for_anonymous(client):
    resp = client.post(f"{BASE}/chat", json={
        "message": "سلام", "tier": "VIP", "is_vip": True, "phone": OTHER, "subscription_tier": "VIP"})
    assert resp.status_code == 200
    assert resp.json()["tier"] == "FREE"


def test_authenticated_free_user_stays_free_despite_body(client):
    resp = client.post(f"{BASE}/chat", json={"message": "سلام", "tier": "VIP", "is_vip": True}, headers=_auth())
    assert resp.status_code == 200 and resp.json()["tier"] == "FREE"


def test_vip_comes_from_server_side_source_not_body(client, monkeypatch):
    monkeypatch.setattr(mod, "VIP_PHONE_ALLOWLIST", {PHONE})
    resp = client.post(f"{BASE}/chat", json={"message": "سلام", "tier": "FREE"}, headers=_auth())
    assert resp.json()["tier"] == "VIP"


def test_entitlement_lookup_unavailable_defaults_to_free():
    assert mod._tier_for_phone(PHONE) == "FREE"


def test_resolve_subscription_tier_ignores_body():
    assert mod._resolve_subscription_tier(payload={"tier": "VIP", "is_vip": True}, request=None) == "FREE"


def test_invalid_token_is_401_persian_json(client):
    resp = client.post(f"{BASE}/chat", json={"message": "سلام"}, headers={"Authorization": "Bearer abc.def.ghi"})
    assert resp.status_code == 401
    body = resp.json()
    assert body["status"] == "ERROR" and body["code"] == "TOKEN_INVALID" and "وارد" in body["message"]


def test_alg_none_token_rejected(client):
    header = mod._b64url_encode(b'{"alg":"none","typ":"JWT"}')
    payload = mod._b64url_encode(json.dumps({"phone": PHONE, "exp": 9e12}).encode())
    resp = client.get(f"{BASE}/conversations", headers={"Authorization": f"Bearer {header}.{payload}."})
    assert resp.status_code == 401


# ---------------- anonymous chat limit ----------------
def test_anonymous_chat_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setenv("CHAT_ANON_HOURLY_LIMIT", "2")
    codes = [client.post(f"{BASE}/chat", json={"message": "سلام"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    last = client.post(f"{BASE}/chat", json={"message": "سلام"})
    assert last.json()["status"] == "ERROR" and last.headers["retry-after"]


def test_authenticated_users_skip_anonymous_limit(client, monkeypatch):
    monkeypatch.setenv("CHAT_ANON_HOURLY_LIMIT", "1")
    assert all(client.post(f"{BASE}/chat", json={"message": "سلام"}, headers=_auth()).status_code == 200
               for _ in range(3))


def test_message_length_capped(client):
    resp = client.post(f"{BASE}/chat", json={"message": "الف" * 3001})
    assert resp.status_code == 400 and "۶۰۰۰" in resp.json()["message"]


# ---------------- conversations IDOR ----------------
def test_conversations_require_token(client):
    assert client.get(f"{BASE}/conversations?phone={OTHER}").status_code == 401
    assert client.get(f"{BASE}/conversations/{'0' * 8}-0000-0000-0000-{'0' * 12}/messages").status_code == 401
    assert client.post(f"{BASE}/conversations", json={"phone": OTHER}).status_code == 401


def test_other_users_conversation_is_404(client, monkeypatch):
    seen = {}

    def owned(conv_id, phone):
        seen["phone"] = phone
        return False

    monkeypatch.setattr(mod, "_conversation_owned_by", owned)
    resp = client.get(f"{BASE}/conversations/11111111-1111-1111-1111-111111111111/messages",
                      headers=_auth(PHONE))
    assert resp.status_code == 404
    assert seen["phone"] == PHONE  # phone came from the token


def test_conversation_id_in_chat_must_be_owned(client, monkeypatch):
    monkeypatch.setattr(mod, "_conversation_owned_by", lambda c, p: False)
    resp = client.post(f"{BASE}/chat", json={
        "message": "سلام", "conversation_id": "11111111-1111-1111-1111-111111111111"}, headers=_auth())
    assert resp.status_code == 404


def test_malformed_conversation_id_is_404(client):
    assert client.get(f"{BASE}/conversations/not-a-uuid/messages", headers=_auth()).status_code == 404


def test_no_default_phone_left():
    assert not hasattr(mod, "_DEFAULT_CONTACT_PHONE")


# ---------------- voice ----------------
def test_speak_anonymous_limit_and_text_cap(client):
    long_text = "الف" * 700  # > 2000 chars: rejected after the limiter counted the call
    codes = [client.post(f"{BASE}/speak", json={"text": long_text}).status_code for _ in range(6)]
    assert codes == [413] * 5 + [429]


def test_upload_size_cap(client):
    big = b"\0" * (10 * 1024 * 1024 + 1)
    resp = client.post(f"{BASE}/transcribe-audio", files={"file": ("a.webm", big, "audio/webm")})
    assert resp.status_code == 413 and resp.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_voice_bad_token_401(client):
    resp = client.post(f"{BASE}/speak", json={"text": "x"}, headers={"Authorization": "Bearer x.y.z"})
    assert resp.status_code == 401


class _FakeWS:
    def __init__(self, query=None, headers=None):
        self.headers = headers or {}
        self.query_params = query or {}
        self.client = type("C", (), {"host": "1.2.3.4"})()
        self.sent, self.closed, self.accepted = [], None, False

    async def accept(self):
        self.accepted = True

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000):
        self.closed = code


def test_websocket_token_query_param():
    bad = _FakeWS({"token": "a.b.c"})
    assert asyncio.run(chat_auth.gate_voice_ws(bad)) is False
    assert bad.closed == 4401 and bad.sent[0]["code"] == "TOKEN_INVALID"
    good = _FakeWS({"token": _auth()["Authorization"][7:]})
    assert asyncio.run(chat_auth.gate_voice_ws(good)) is True and not good.accepted


def test_websocket_anonymous_limited():
    results = [asyncio.run(chat_auth.gate_voice_ws(_FakeWS())) for _ in range(6)]
    assert results == [True] * 5 + [False]


# ---------------- OTP ----------------
class _Req:
    headers = {"host": "x"}
    client = type("C", (), {"host": "9.9.9.9"})()


@pytest.fixture
def otp(monkeypatch):
    async def fake_deliver(phone, code, template=None):
        return True

    monkeypatch.setattr(mod, "_deliver_verification_code", fake_deliver)
    monkeypatch.setattr(mod.secrets, "randbelow", lambda n: 4321)  # code 14321

    def send(phone=PHONE):
        resp = asyncio.run(mod.send_auth_otp(_Req(), {"phone": phone}))
        return resp.status_code if hasattr(resp, "status_code") else 200, (
            json.loads(resp.body) if hasattr(resp, "body") else resp)

    def verify(code, phone=PHONE):
        resp = asyncio.run(mod.verify_auth_otp({"phone": phone, "code": code}, _Req()))
        return resp.status_code if hasattr(resp, "status_code") else 200, (
            json.loads(resp.body) if hasattr(resp, "body") else resp)

    return send, verify


def test_otp_resend_cooldown(otp, clock):
    send, _ = otp
    assert send()[0] == 200
    status, body = send()
    assert status == 429 and body["retry_after"] > 0 and "ثانیه" in body["message"]
    clock["t"] += 61
    assert send()[0] == 200


def test_otp_max_five_sends_per_hour(otp, clock):
    send, _ = otp
    statuses = []
    for _ in range(6):
        statuses.append(send()[0])
        clock["t"] += 61
    assert statuses == [200] * 5 + [429]


def test_otp_per_ip_send_limit(otp, monkeypatch):
    send, _ = otp
    monkeypatch.setenv("OTP_IP_SEND_LIMIT_PER_HOUR", "2")
    statuses = [send(f"0912000010{i}")[0] for i in range(3)]
    assert statuses == [200, 200, 429]


def test_otp_five_wrong_attempts_invalidate_code(otp):
    send, verify = otp
    send()
    assert [verify("00000")[0] for _ in range(4)] == [400] * 4
    assert verify("00000")[0] == 429  # fifth wrong guess burns the code
    status, body = verify("14321")  # even the right code no longer works
    assert status == 400 and "منقضی" in body["message"]


def test_otp_correct_code_issues_token_and_is_single_use(otp):
    send, verify = otp
    send()
    status, body = verify("14321")
    assert status == 200 and body["token"] and body["user"]["phone"] == PHONE
    assert verify("14321")[0] == 400


def test_otp_master_code_rejected(otp):
    send, verify = otp
    send()
    assert verify("12345")[0] == 400


def test_otp_code_never_in_responses(otp, monkeypatch):
    send, verify = otp
    monkeypatch.setenv("OTP_DEV_ECHO", "1")
    monkeypatch.setenv("ROXIRA_ENV", "development")

    async def undelivered(phone, code, template=None):
        return False

    monkeypatch.setattr(mod, "_deliver_verification_code", undelivered)
    _, body = send()
    assert "14321" not in json.dumps(body) and "dev_code" not in body


def test_otp_stored_hashed_not_plain(otp):
    send, _ = otp
    send()
    stored = json.dumps(chat_auth.kv_get(f"otp:code:{PHONE}"))
    assert "14321" not in stored


def test_single_otp_handler_pair():
    paths = [getattr(r, "path", "") for r in mod.router.routes]
    assert paths.count(f"{BASE}/auth/send-otp") == 1
    assert paths.count(f"{BASE}/auth/verify-otp") == 1
    assert not hasattr(mod, "_OTP_CACHE")
