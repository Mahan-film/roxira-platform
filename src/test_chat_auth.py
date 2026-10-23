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
    monkeypatch.setattr(mod.secrets, "randbelow", lambda n: 432178)  # code 432178

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
        clock["t"] += 601  # past the 10-minute window, still inside the hour
    assert statuses == [200] * 5 + [429]


def test_otp_max_three_sends_per_ten_minutes(otp, clock):
    send, _ = otp
    statuses = []
    for _ in range(4):
        statuses.append(send()[0])
        clock["t"] += 61  # past the resend cooldown
    assert statuses == [200] * 3 + [429]
    clock["t"] += 600
    assert send()[0] == 200


def test_otp_code_is_six_digits(otp, monkeypatch):
    send, _ = otp
    monkeypatch.setattr(mod.secrets, "randbelow", lambda n: 42)  # leading zeros kept
    sent = []

    async def capture(phone, code, template=None):
        sent.append(code)
        return True

    monkeypatch.setattr(mod, "_deliver_verification_code", capture)
    send()
    assert sent == ["000042"]


def test_otp_unknown_and_wrong_code_get_the_same_error(otp):
    send, verify = otp
    unknown = verify("432178", phone="09120000999")
    send()
    wrong = verify("000000")
    assert unknown == wrong and unknown[0] == 400


def test_otp_per_ip_send_limit(otp, monkeypatch):
    send, _ = otp
    monkeypatch.setenv("OTP_IP_SEND_LIMIT_PER_HOUR", "2")
    statuses = [send(f"0912000010{i}")[0] for i in range(3)]
    assert statuses == [200, 200, 429]


def test_otp_five_wrong_attempts_invalidate_code(otp):
    send, verify = otp
    send()
    assert [verify("000000")[0] for _ in range(4)] == [400] * 4
    assert verify("000000")[0] == 429  # fifth wrong guess burns the code
    status, body = verify("432178")  # even the right code no longer works
    assert status == 400 and "منقضی" in body["message"]


def test_otp_correct_code_issues_token_and_is_single_use(otp):
    send, verify = otp
    send()
    status, body = verify("432178")
    assert status == 200 and body["token"] and body["user"]["phone"] == PHONE
    assert verify("432178")[0] == 400


def test_otp_master_code_rejected(otp):
    send, verify = otp
    send()
    assert verify("123456")[0] == 400


def test_otp_code_never_in_responses(otp, monkeypatch):
    send, verify = otp
    monkeypatch.setenv("OTP_DEV_ECHO", "1")
    monkeypatch.setenv("ROXIRA_ENV", "development")

    async def undelivered(phone, code, template=None):
        return False

    monkeypatch.setattr(mod, "_deliver_verification_code", undelivered)
    _, body = send()
    assert "432178" not in json.dumps(body) and "dev_code" not in body


def test_otp_stored_hashed_not_plain(otp):
    send, _ = otp
    send()
    stored = json.dumps(chat_auth.kv_get(f"otp:code:{PHONE}"))
    assert "432178" not in stored


def test_single_otp_handler_pair():
    paths = [getattr(r, "path", "") for r in mod.router.routes]
    assert paths.count(f"{BASE}/auth/send-otp") == 1
    assert paths.count(f"{BASE}/auth/verify-otp") == 1
    assert not hasattr(mod, "_OTP_CACHE")


# ---------------- payment status rate limits ----------------
def test_payments_verify_rate_limited_per_track_id(client, monkeypatch):
    monkeypatch.setenv("PAYMENTS_LIVE", "0")  # 503 UNAVAILABLE once past the gate, no DB/network
    codes = [client.post(f"{BASE}/payments/verify", json={"track_id": "T-1"}).status_code for _ in range(12)]
    assert codes[:10] == [503] * 10
    assert codes[10:] == [429, 429]
    resp = client.post(f"{BASE}/payments/verify", json={"track_id": "T-1"})
    assert resp.status_code == 429 and "Retry-After" in resp.headers
    assert "پرداخت" in resp.json()["message"]


def test_payments_verify_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setenv("PAYMENTS_LIVE", "0")
    codes = [client.post(f"{BASE}/payments/verify", json={"track_id": f"T-{i}"}).status_code for i in range(32)]
    assert codes[:30] == [503] * 30
    assert codes[30:] == [429, 429]


def test_one_off_entitlement_does_not_grant_subscription_level():
    # SINGLE_DRAFT / VOICE_PACK rows in user_entitlements must stay level "free"
    assert mod._plan_level_from_plan_types(["SINGLE_DRAFT"]) == "free"
    assert mod._plan_level_from_plan_types(["SINGLE_DRAFT", "VOICE_PACK_10MIN"]) == "free"
    assert not mod._is_vip_tier("SINGLE_DRAFT")
    assert mod._plan_level_from_plan_types(["SINGLE_DRAFT", "SJ_PRO_MONTHLY"]) == "pro"


# ---------------- OTP send hardening (issue #366 review) ----------------
def test_otp_failed_sms_costs_nothing(otp, clock, monkeypatch):
    send, _ = otp

    async def failing(phone, code, template=None):
        return False

    real = mod._deliver_verification_code
    monkeypatch.setattr(mod, "_deliver_verification_code", failing)
    for _ in range(6):  # no cooldown held, no cap consumed by undelivered sends
        assert send()[0] == 200
    assert chat_auth.peek(f"otp:sent10m:{PHONE}") == 0
    monkeypatch.setattr(mod, "_deliver_verification_code", real)
    assert send()[0] == 200


def test_otp_blocked_attempts_do_not_extend_lock(otp, clock):
    send, _ = otp
    assert send()[0] == 200
    for _ in range(5):  # all blocked by the cooldown
        assert send()[0] == 429
    assert chat_auth.peek(f"otp:sent10m:{PHONE}") == 1
    clock["t"] += 61
    assert send()[0] == 200


def test_otp_empty_jwt_secret_fails_closed(otp, monkeypatch):
    send, verify = otp
    monkeypatch.setattr(mod, "JWT_SECRET", b"")
    status, body = send()
    assert status == 503 and body["code"] == "AUTH_UNAVAILABLE"
    assert verify("432178")[0] == 503
    assert chat_auth.peek(f"otp:sent10m:{PHONE}") == 0


def test_otp_ip_ignores_forged_cf_header_and_public_peer_headers():
    class R:
        def __init__(self, host, headers):
            self.client = type("C", (), {"host": host})()
            self.headers = headers

    assert chat_auth.safe_request_ip(R("172.18.0.2", {"x-real-ip": "1.1.1.1", "cf-connecting-ip": "6.6.6.6"})) == "1.1.1.1"
    assert chat_auth.safe_request_ip(R("172.18.0.2", {"cf-connecting-ip": "6.6.6.6"})) == "172.18.0.2"
    assert chat_auth.safe_request_ip(R("8.8.8.8", {"x-real-ip": "1.1.1.1"})) == "8.8.8.8"


def test_otp_per_ip_cap_survives_cf_header_rotation(otp, monkeypatch):
    monkeypatch.setenv("OTP_IP_SEND_LIMIT_PER_HOUR", "2")

    class Req:
        def __init__(self, i):
            self.headers = {"host": "x", "x-real-ip": "5.5.5.5", "cf-connecting-ip": f"6.6.6.{i}"}
            self.client = type("C", (), {"host": "172.18.0.2"})()

    codes = []
    for i in range(3):
        resp = asyncio.run(mod.send_auth_otp(Req(i), {"phone": f"0912000020{i}"}))
        codes.append(getattr(resp, "status_code", 200))
    assert codes == [200, 200, 429]
