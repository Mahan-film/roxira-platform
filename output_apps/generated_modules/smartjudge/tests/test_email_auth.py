"""E-mail + password accounts: hashing, signed tokens, register -> verify -> login, no enumeration. Offline."""
import asyncio
import time
from types import SimpleNamespace

import pytest

from output_apps.generated_modules.smartjudge import chat_auth, email_auth, email_sender

SECRET = b"unit-test-secret-not-a-real-key"


@pytest.fixture(autouse=True)
def _fast_and_clean(monkeypatch):
    monkeypatch.setattr(email_auth, "_SCRYPT_N", 2 ** 10)  # fast hashes in tests
    monkeypatch.setattr(email_auth, "_DUMMY_HASH", None)
    chat_auth.reset_for_tests()
    yield
    chat_auth.reset_for_tests()


def make_service(configured=True, store=None):
    sent = []

    async def sender(to, subject, text, html):
        sent.append({"to": to, "subject": subject, "text": text, "html": html})
        return True

    def issue(acc, tier, level):
        return f"jwt-for-{acc.user_ref}-{tier}-{level}"

    svc = email_auth.EmailAuthService(
        store=store or email_auth.MemoryAccountStore(), secret=SECRET, sender=sender,
        issue_token=issue, plan_info=lambda ref: ("FREE", "free"), jwt_ttl=3600,
        configured=lambda: configured,
        normalize_phone=lambda p: p.strip(),
    )
    return svc, sent


def req(ip="1.2.3.4"):
    return SimpleNamespace(headers={"x-real-ip": ip}, client=SimpleNamespace(host=ip))


def token_from(mail, path):
    return mail["text"].split(f"/{path}?token=", 1)[1].split()[0]


def run(coro):
    return asyncio.run(coro)


# --- hashing ----------------------------------------------------------------
def test_password_hash_roundtrip_and_salt():
    h1, h2 = email_auth.hash_password("correct horse"), email_auth.hash_password("correct horse")
    assert h1 != h2 and h1.startswith("scrypt$")
    assert email_auth.verify_password("correct horse", h1)
    assert not email_auth.verify_password("correct horsf", h1)
    assert not email_auth.verify_password("x", "garbage")
    assert not email_auth.verify_password("x", "bcrypt$1$2$3$4$5")


def test_min_password_length_and_bad_input_rejected():
    svc, sent = make_service()

    async def go():
        assert (await svc.register(req(), "a@example.com", "short", None)).status_code == 400
        assert (await svc.register(req(), "a@example.com", "x" * 129, None)).status_code == 400
        assert (await svc.register(req(), "not-an-email", "longenough1", None)).status_code == 400
        await svc.drain()
    run(go())
    assert sent == []


def test_normalize_email():
    assert email_auth.normalize_email("  Foo@Example.COM ") == "foo@example.com"
    assert email_auth.normalize_email("a@b") == ""
    assert email_auth.normalize_email("a b@c.com") == ""


# --- tokens -------------------------------------------------------------------
def test_token_signature_expiry_purpose():
    ref = "em_0123456789abcdef"
    tok = email_auth.make_token(SECRET, "verify", ref, "unverified", 100, now=1000)
    assert email_auth.read_token(SECRET, tok, "verify", now=1050) == {"u": ref, "f": "unverified"}
    assert email_auth.read_token(SECRET, tok, "verify", now=1101) is None           # expired
    assert email_auth.read_token(SECRET, tok, "reset", now=1050) is None            # wrong purpose
    assert email_auth.read_token(b"other-secret", tok, "verify", now=1050) is None  # wrong key
    payload, sig = tok.split(".")
    assert email_auth.read_token(SECRET, payload + "." + sig[:-2] + "AA", "verify", now=1050) is None
    assert email_auth.read_token(SECRET, "junk", "verify") is None
    assert email_auth.read_token(SECRET, "", "verify") is None


def test_ttls():
    assert email_auth.VERIFY_TTL_SECONDS == 24 * 3600
    assert email_auth.RESET_TTL_SECONDS == 3600


# --- flows ------------------------------------------------------------------
def test_register_verify_login_flow_and_single_use():
    svc, sent = make_service()

    async def go():
        r = await svc.register(req(), "User@Example.com", "password123", "09121234567")
        assert r["status"] == "success"
        await svc.drain()
        assert len(sent) == 1 and sent[0]["to"] == "user@example.com"
        assert "https://ghazihoushmand.ir/verify-email?token=" in sent[0]["text"]
        token = token_from(sent[0], "verify-email")

        # unverified: right password -> 403, wrong password -> plain 401 (no hint)
        assert (await svc.login(req(), "user@example.com", "password123")).status_code == 403
        assert (await svc.login(req(), "user@example.com", "wrongpass12")).status_code == 401

        assert (await svc.verify_email(req(), token))["status"] == "success"
        assert (await svc.verify_email(req(), token)).status_code == 400  # single use

        r = await svc.login(req(), "USER@example.com", "password123")
        assert r["status"] == "success" and r["token_type"] == "Bearer"
        assert r["token"].startswith("jwt-for-em_")
        assert r["user"]["email"] == "user@example.com"
        assert r["user"]["plan_level"] == "free" and r["user"]["subscription_tier"] == "FREE"
        assert r["user"]["phone"] == "09121234567" and len(r["user"]["id"]) == 19
    run(go())


def test_bad_contact_phone_rejected():
    svc, _ = make_service()
    assert run(svc.register(req(), "a@example.com", "password123", "12345")).status_code == 400


def test_forgot_and_reset_password_single_use_and_login():
    svc, sent = make_service()

    async def go():
        await svc.register(req(), "u@example.com", "password123")
        await svc.drain()
        await svc.verify_email(req(), token_from(sent[0], "verify-email"))

        await svc.forgot_password(req(), "u@example.com")
        await svc.drain()
        reset = [m for m in sent if "reset-password?token=" in m["text"]]
        assert len(reset) == 1
        token = token_from(reset[0], "reset-password")

        assert (await svc.reset_password(req(), token, "short")).status_code == 400
        assert (await svc.reset_password(req(), "bad.token", "newpassword1")).status_code == 400
        assert (await svc.reset_password(req(), token, "newpassword1"))["status"] == "success"
        # the token is dead once the password changed
        assert (await svc.reset_password(req(), token, "another-pass1")).status_code == 400

        assert (await svc.login(req(), "u@example.com", "password123")).status_code == 401
        assert (await svc.login(req(), "u@example.com", "newpassword1"))["status"] == "success"
    run(go())


def test_reset_verifies_account_and_beats_planted_password():
    svc, sent = make_service()

    async def go():
        await svc.register(req("1.1.1.1"), "victim@example.com", "attacker-pass1")  # planted
        await svc.drain()
        await svc.forgot_password(req("2.2.2.2"), "victim@example.com")
        await svc.drain()
        token = token_from([m for m in sent if "reset-password?token=" in m["text"]][0], "reset-password")
        await svc.reset_password(req("2.2.2.2"), token, "owner-password1")
        assert (await svc.login(req("2.2.2.2"), "victim@example.com", "attacker-pass1")).status_code == 401
        assert (await svc.login(req("2.2.2.2"), "victim@example.com", "owner-password1"))["status"] == "success"
    run(go())


def test_register_existing_email_does_not_change_account():
    svc, sent = make_service()

    async def go():
        await svc.register(req(), "u@example.com", "first-password1")
        await svc.drain()
        await svc.verify_email(req(), token_from(sent[0], "verify-email"))
        chat_auth.reset_for_tests()  # clear the per-address cooldown
        assert (await svc.register(req(), "u@example.com", "second-password1"))["status"] == "success"
        await svc.drain()
        assert (await svc.login(req(), "u@example.com", "first-password1"))["status"] == "success"
        assert (await svc.login(req(), "u@example.com", "second-password1")).status_code == 401
    run(go())


def test_no_user_enumeration():
    svc, sent = make_service()

    async def go():
        await svc.register(req(), "real@example.com", "password123")
        await svc.drain()

        known = await svc.forgot_password(req(), "real@example.com")
        unknown = await svc.forgot_password(req(), "ghost@example.com")
        assert known == unknown
        assert await svc.resend_verification(req(), "real@example.com") == known
        assert await svc.resend_verification(req(), "ghost@example.com") == known

        again = await svc.register(req(), "real@example.com", "password123")
        fresh = await svc.register(req(), "fresh@example.com", "password123")
        assert again == fresh == known

        a = await svc.login(req(), "ghost@example.com", "password123")
        b = await svc.login(req(), "real@example.com", "nope-nope-1")
        assert a.status_code == b.status_code == 401 and a.body == b.body
        await svc.drain()
        assert all(m["to"] != "ghost@example.com" for m in sent)
    run(go())


def test_login_rate_limited_per_address_and_register_per_ip():
    svc, _ = make_service()

    async def go():
        codes = [(await svc.login(req(f"9.9.9.{i}"), "t@example.com", "badbadbad1")).status_code
                 for i in range(12)]
        assert codes[:10] == [401] * 10 and codes[10] == 429
        out = [await svc.register(req("5.5.5.5"), f"u{i}@example.com", "password123") for i in range(25)]
        assert any(getattr(r, "status_code", 200) == 429 for r in out)
        await svc.drain()
    run(go())


def test_send_cooldown_limits_mail_volume():
    svc, sent = make_service()

    async def go():
        await svc.register(req(), "u@example.com", "password123")
        for _ in range(3):
            await svc.resend_verification(req(), "u@example.com")
        await svc.drain()
    run(go())
    assert len(sent) == 1  # 60 s cooldown per address


def test_unconfigured_smtp_gives_503():
    svc, sent = make_service(configured=False)
    for call in (svc.register(req(), "a@example.com", "password123"),
                 svc.login(req(), "a@example.com", "password123"),
                 svc.forgot_password(req(), "a@example.com"),
                 svc.resend_verification(req(), "a@example.com")):
        assert run(call).status_code == 503
    assert sent == []


def test_http_layer_methods_and_validation():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    svc, sent = make_service()
    app = FastAPI()
    app.include_router(email_auth.build_router(svc), prefix="/api/v1/apps/judge")
    c = TestClient(app)
    base = "/api/v1/apps/judge/auth"
    assert c.get(f"{base}/methods").json() == {"phone": True, "email": True}
    assert c.post(f"{base}/email/register", json={"email": "a@example.com"}).status_code == 422
    r = c.post(f"{base}/email/register", json={"email": "a@example.com", "password": "password123"})
    assert r.status_code == 200 and r.json()["status"] == "success"
    r = c.post(f"{base}/email/login", json={"email": "a@example.com", "password": "password123"})
    assert r.status_code == 403 and r.json()["code"] == "EMAIL_NOT_VERIFIED"
    deadline = time.time() + 3
    while not sent and time.time() < deadline:
        time.sleep(0.05)
    assert sent
    tok = token_from(sent[0], "verify-email")
    assert c.post(f"{base}/email/verify-email", json={"token": tok}).status_code == 200
    r = c.post(f"{base}/email/login", json={"email": "a@example.com", "password": "password123"})
    assert r.status_code == 200 and r.json()["token"]

    svc.configured = lambda: False
    assert c.get(f"{base}/methods").json()["email"] is False


def test_email_sender_unconfigured(monkeypatch):
    for k in ("SMTP_HOST", "SMTP_FROM"):
        monkeypatch.delenv(k, raising=False)
    assert email_sender.is_configured() is False
    assert email_sender.send_email("a@example.com", "s", "t", "<p>h</p>") is False
    _subject, text, page = email_sender.verification_email("tok")
    assert "https://ghazihoushmand.ir/verify-email?token=tok" in text and "tok" in page


def test_jwt_roundtrip_resolves_email_user(monkeypatch):
    """smartjudge_module: email token -> CurrentUser keyed on user_ref (one entitlement key)."""
    from output_apps.generated_modules.smartjudge import smartjudge_module as mod

    monkeypatch.setattr(mod, "_entitlement_info", lambda ref: ("VIP", "pro"))
    acc = email_auth.Account("em_0123456789abcdef", "u@example.com", "x", True)
    user = mod._user_from_token(mod._issue_email_access_token(acc, "VIP", "pro"))
    assert user.authenticated and user.phone == "em_0123456789abcdef" and user.plan_level == "pro"
    forged = mod._sign_jwt({"auth": "email", "sub": "09121234567", "exp": int(time.time()) + 60})
    assert mod._user_from_token(forged) is None
    assert mod._hashed_user_ref("em_0123456789abcdef") == mod._hashed_user_ref(user.phone)
