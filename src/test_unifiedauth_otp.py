"""OTP hardening for the unifiedauth router (issue #366). Temp SQLite, fake SMS, no network."""

import importlib
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

MODULE = "output_apps.generated_modules.unifiedauth.unifiedauth_module"
CHAT_AUTH = "output_apps.generated_modules.smartjudge.chat_auth"
PHONE = "09120000088"


@pytest.fixture
def ua(monkeypatch, tmp_path):
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-not-real")
    monkeypatch.setenv("KAVENEGAR_API_KEY", "test-kavenegar-not-real")
    m = importlib.reload(importlib.import_module(MODULE))
    monkeypatch.setattr(m, "DB_PATH", tmp_path / "users.db")
    monkeypatch.setattr(m, "OTP_RESEND_COOLDOWN_SECONDS", 0)  # cooldown has its own tests
    m._init_db()
    sent = []

    def fake_dispatch(receptor, token, template):
        sent.append(token)
        return {"delivered": True, "receptor": receptor, "template": template, "http_status": 200}

    monkeypatch.setattr(m, "_dispatch_kavenegar", fake_dispatch)
    chat_auth = importlib.import_module(CHAT_AUTH)
    chat_auth.reset_for_tests()
    app = FastAPI()
    app.include_router(m.router)
    yield m, TestClient(app), sent
    chat_auth.reset_for_tests()


def _send(c, phone=PHONE, ip="198.51.100.1"):
    return c.post("/api/v1/auth/request-otp", json={"phone_number": phone},
                  headers={"x-real-ip": ip})


def _verify(c, code, phone=PHONE):
    return c.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "code": code})


def _wrong(code):
    return f"{(int(code) + 1) % 10**6:06d}"


def test_six_digit_code_not_in_response_and_stored_hashed(ua):
    m, c, sent = ua
    resp = _send(c)
    assert resp.status_code == 200
    code = sent[-1]
    assert len(code) == 6 and code.isdigit()
    assert code not in resp.text and "provider_response" not in resp.json()
    with sqlite3.connect(m.DB_PATH) as conn:
        stored = conn.execute("SELECT code FROM otps WHERE phone = ?", (PHONE,)).fetchone()[0]
    assert stored != code and len(stored) == 64


def test_correct_code_is_single_use(ua):
    _, c, sent = ua
    _send(c)
    assert _verify(c, sent[-1]).status_code == 200
    assert _verify(c, sent[-1]).status_code == 400


def test_fifth_wrong_attempt_invalidates_code(ua):
    _, c, sent = ua
    _send(c)
    code = sent[-1]
    for _ in range(5):
        assert _verify(c, _wrong(code)).status_code == 400
    assert _verify(c, code).status_code == 400


def test_four_wrong_attempts_still_allow_the_right_code(ua):
    _, c, sent = ua
    _send(c)
    code = sent[-1]
    for _ in range(4):
        _verify(c, _wrong(code))
    assert _verify(c, code).status_code == 200


def test_send_limit_per_phone(ua):
    _, c, sent = ua
    assert [_send(c).status_code for _ in range(4)] == [200, 200, 200, 429]
    assert len(sent) == 3


def test_send_limit_per_ip(ua):
    _, c, _sent = ua
    codes = [_send(c, phone=f"0912000{i:04d}", ip="198.51.100.7").status_code for i in range(11)]
    assert codes == [200] * 10 + [429]
    assert _send(c, phone="09129999999", ip="198.51.100.8").status_code == 200


def test_errors_are_generic(ua):
    _, c, sent = ua
    unknown = _verify(c, "123456", phone="09125555555")
    _send(c)
    wrong = _verify(c, _wrong(sent[-1]))
    assert unknown.status_code == wrong.status_code == 400
    assert unknown.json() == wrong.json()


def test_resend_cooldown_blocks_then_allows(ua, monkeypatch):
    m, c, sent = ua
    monkeypatch.setattr(m, "OTP_RESEND_COOLDOWN_SECONDS", 60)
    chat_auth = importlib.import_module(CHAT_AUTH)
    assert _send(c).status_code == 200
    assert _send(c).status_code == 429
    assert len(sent) == 1
    chat_auth.kv_delete(f"ua:otp:cd:phone:{PHONE}")  # what the 60 s TTL expiry does
    assert _send(c).status_code == 200


def test_failed_sms_and_blocked_attempts_do_not_count_against_phone(ua, monkeypatch):
    m, c, sent = ua
    chat_auth = importlib.import_module(CHAT_AUTH)
    monkeypatch.setattr(m, "OTP_RESEND_COOLDOWN_SECONDS", 60)
    monkeypatch.setattr(
        m, "_dispatch_kavenegar",
        lambda receptor, token, template: {"delivered": False, "http_status": 500},
    )
    for i in range(5):  # failed deliveries: no count, no cooldown held
        assert _send(c, ip=f"198.51.100.{i}").status_code == 200
    assert chat_auth.peek(f"ua:otp:sent:phone:{PHONE}") == 0
    monkeypatch.setattr(
        m, "_dispatch_kavenegar",
        lambda receptor, token, template: sent.append(token) or {"delivered": True, "http_status": 200},
    )
    assert _send(c, ip="198.51.100.50").status_code == 200
    for i in range(5):  # blocked by cooldown: must not bump the phone counter
        assert _send(c, ip=f"198.51.100.{60 + i}").status_code == 429
    assert chat_auth.peek(f"ua:otp:sent:phone:{PHONE}") == 1


def test_empty_jwt_secret_fails_closed_with_503(ua, monkeypatch):
    m, c, _sent = ua
    monkeypatch.setattr(m, "JWT_SECRET", "")
    assert _send(c).status_code == 503
    assert _verify(c, "123456").status_code == 503
    with pytest.raises(Exception):
        m._otp_digest(PHONE, "123456")


def test_client_ip_uses_nginx_x_real_ip_not_forgeable_cf_header(ua):
    m, c, _sent = ua
    for i in range(10):  # forged CF-Connecting-IP rotation must not dodge the per-IP cap
        r = c.post("/api/v1/auth/request-otp", json={"phone_number": f"0912000{i:04d}"},
                   headers={"x-real-ip": "198.51.100.77", "cf-connecting-ip": f"203.0.113.{i}"})
        assert r.status_code == 200
    r = c.post("/api/v1/auth/request-otp", json={"phone_number": "09129999990"},
               headers={"x-real-ip": "198.51.100.77", "cf-connecting-ip": "203.0.113.99"})
    assert r.status_code == 429


class _Req:
    def __init__(self, host, headers):
        self.client = type("C", (), {"host": host})()
        self.headers = headers


def test_client_ip_ignores_headers_from_public_peer(ua):
    m, _c, _sent = ua
    assert m._client_ip(_Req("8.8.8.8", {"x-real-ip": "1.2.3.4"})) == "8.8.8.8"
    assert m._client_ip(_Req("172.18.0.5", {"x-real-ip": "1.2.3.4"})) == "1.2.3.4"
    assert m._client_ip(_Req("172.18.0.5", {"x-forwarded-for": "9.9.9.9, 1.2.3.4"})) == "1.2.3.4"


def test_incr_counter_is_atomic_and_heals_missing_ttl(ua):
    chat_auth = importlib.import_module(CHAT_AUTH)

    class FakeRedis:
        def __init__(self):
            self.vals, self.ttls, self.calls = {}, {}, []

        def eval(self, script, n, key, window):
            self.calls.append("eval")
            self.vals[key] = self.vals.get(key, 0) + 1
            if self.vals[key] == 1 or self.ttls.get(key, -1) < 0:
                self.ttls[key] = int(window)
            return [self.vals[key], self.ttls[key]]

        def __getattr__(self, name):  # any non-atomic INCR/EXPIRE round trip is a bug
            raise AssertionError(f"unexpected redis call {name}")

    fake = FakeRedis()
    chat_auth.set_redis_client(fake)
    try:
        fake.vals["k"] = 41  # crash left INCR without EXPIRE
        assert chat_auth.incr("k", 600) == (42, 600)
        assert fake.ttls["k"] == 600
        assert fake.calls == ["eval"]
    finally:
        chat_auth.reset_for_tests()
