"""E-mail + password accounts for Smart Judge (for users without an Iranian SIM).

Design (kept consistent with the phone-OTP accounts, which have NO user table: identity is
the phone string inside the JWT and everything - conversations, case files, entitlements -
is keyed on it):

* An e-mail account gets a stable opaque ``user_ref`` = ``em_`` + 16 hex (19 chars, because
  ``chat_conversations.user_phone`` is VARCHAR(20)).  The JWT carries it as ``sub`` and
  ``smartjudge_module._user_from_token`` hands it to the rest of the app in the slot where a
  phone normally goes.  ``_hashed_user_ref(user_ref)`` is therefore the ``user_entitlements``
  key, exactly like ``_hashed_user_ref(phone)`` is for phone users: one entitlement row per
  account, plans/payments work unchanged.
* The optional phone given at registration is stored as an UNVERIFIED contact detail only.  It
  never becomes the account key, so adding a phone later cannot create a second entitlement
  row.  (Merging a phone-OTP account with an e-mail account is a deliberate non-goal; see
  docs/ops/EMAIL_SETUP.md.)
* Table ``email_accounts`` is created with ``CREATE TABLE IF NOT EXISTS`` on first use, the
  same convention as payment_orders / user_entitlements.  ``user_ref`` is the owner key and
  ``tenant`` the tenant column (AGENTS.md section 4); every read/write goes through
  ``AccountStore``, never from a controller.
* Verification / reset links are stateless signed tokens (HMAC-SHA256 over purpose, user_ref,
  expiry and a state fingerprint).  Single use comes from the fingerprint: a verification token
  only works while ``email_verified_at`` is NULL; a reset token embeds a fingerprint of the
  current password hash, so it dies the moment the password changes.  No token table needed.
* Nothing here reveals whether an e-mail exists: register/forgot/resend always answer the same
  generic success, wrong password and unknown e-mail give the same 401, mail is sent from a
  background task so response time does not depend on the account existing.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Protocol

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from output_apps.generated_modules.smartjudge import chat_auth, email_sender

VERIFY_TTL_SECONDS = 24 * 3600
RESET_TTL_SECONDS = 3600
MIN_PASSWORD = 8
MAX_PASSWORD = 128
SEND_COOLDOWN_SECONDS = 60
MAX_SENDS_PER_HOUR = 5          # per e-mail address, per kind
USER_REF_RE = re.compile(r"^em_[0-9a-f]{16}$")
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+$")

MSG_GENERIC_SENT = "اگر این ایمیل قابل استفاده باشد، پیامی برای شما ارسال شد. صندوق ورودی و پوشهٔ اسپم را بررسی کنید."
MSG_BAD_CREDENTIALS = "ایمیل یا رمز عبور صحیح نیست."
MSG_NOT_VERIFIED = "ایمیل شما هنوز تأیید نشده است. پیوند تأیید را از صندوق ایمیل باز کنید یا ارسال مجدد را بزنید."
MSG_BAD_EMAIL = "نشانی ایمیل نامعتبر است."
MSG_SHORT_PASSWORD = f"رمز عبور باید حداقل {MIN_PASSWORD} نویسه باشد."
MSG_LONG_PASSWORD = f"رمز عبور نباید بیش از {MAX_PASSWORD} نویسه باشد."
MSG_BAD_TOKEN = "پیوند نامعتبر یا منقضی شده است. دوباره درخواست دهید."
MSG_BAD_PHONE = "شماره همراه نامعتبر است."
MSG_UNAVAILABLE = "ورود با ایمیل در حال حاضر فعال نیست. لطفاً با شمارهٔ همراه وارد شوید."
MSG_TEMP_FAIL = "سرویس موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید."


# ---------------------------------------------------------------------------
# Normalisation + password hashing (stdlib scrypt; argon2/bcrypt are not installed)
# ---------------------------------------------------------------------------
def normalize_email(raw: Any) -> str:
    """Lower-cased, trimmed address, or '' when it is not a plausible e-mail."""
    value = unicodedata.normalize("NFKC", str(raw or "")).strip().lower()
    if len(value) > 254 or not _EMAIL_RE.match(value):
        return ""
    return value


def email_key(email: str) -> str:
    """Pseudonymous key for rate-limit / cooldown entries (no address in Redis)."""
    return hashlib.sha256(f"smartjudge-email:{email}".encode("utf-8")).hexdigest()[:24]


_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 15, 8, 1
_SCRYPT_MAXMEM = 128 * 1024 * 1024


def hash_password(password: str, *, n: Optional[int] = None) -> str:
    n = n or _SCRYPT_N
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=_SCRYPT_R, p=_SCRYPT_P,
                            maxmem=_SCRYPT_MAXMEM, dklen=32)
    b64 = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return f"scrypt${n}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check; any malformed hash is simply False."""
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p),
                                maxmem=_SCRYPT_MAXMEM, dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except Exception:  # noqa: BLE001
        return False


# computed lazily; lets login spend the same time for unknown e-mails
_DUMMY_HASH: Optional[str] = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_hex(8))
    return _DUMMY_HASH


# ---------------------------------------------------------------------------
# Signed single-use tokens
# ---------------------------------------------------------------------------
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def password_fingerprint(password_hash: str) -> str:
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()[:16]


def _token_key(secret: bytes) -> bytes:
    return hmac.new(secret, b"smartjudge-email-auth-v1", hashlib.sha256).digest()


def make_token(secret: bytes, purpose: str, user_ref: str, fingerprint: str, ttl: int,
               now: Optional[float] = None) -> str:
    body = {"p": purpose, "u": user_ref, "f": fingerprint, "e": int((now if now is not None else time.time()) + ttl)}
    payload = _b64(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_token_key(secret), payload.encode("ascii"), hashlib.sha256).digest()
    return f"{payload}.{_b64(sig)}"


def read_token(secret: bytes, token: str, purpose: str, now: Optional[float] = None) -> Optional[dict]:
    """Return {'u','f'} when signature, purpose and expiry are valid, else None."""
    try:
        payload, sig = str(token).split(".")
        expected = hmac.new(_token_key(secret), payload.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _unb64(sig)):
            return None
        body = json.loads(_unb64(payload).decode("utf-8"))
        if body.get("p") != purpose or float(body.get("e", 0)) < (now if now is not None else time.time()):
            return None
        if not USER_REF_RE.match(str(body.get("u", ""))):
            return None
        return {"u": body["u"], "f": str(body.get("f", ""))}
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------
@dataclass
class Account:
    user_ref: str
    email: str
    password_hash: str
    verified: bool
    contact_phone: Optional[str] = None


class AccountStore(Protocol):
    def create(self, email: str, password_hash: str, contact_phone: Optional[str]) -> Optional[Account]: ...
    def get_by_email(self, email: str) -> Optional[Account]: ...
    def get_by_ref(self, user_ref: str) -> Optional[Account]: ...
    def mark_verified(self, user_ref: str) -> None: ...
    def set_password(self, user_ref: str, password_hash: str) -> None: ...


def new_user_ref() -> str:
    return "em_" + secrets.token_hex(8)


class MemoryAccountStore:
    """In-process store for unit tests."""

    def __init__(self) -> None:
        self.by_ref: dict[str, Account] = {}

    def create(self, email, password_hash, contact_phone):
        if self.get_by_email(email):
            return None
        acc = Account(new_user_ref(), email, password_hash, False, contact_phone)
        self.by_ref[acc.user_ref] = acc
        return acc

    def get_by_email(self, email):
        return next((a for a in self.by_ref.values() if a.email == email), None)

    def get_by_ref(self, user_ref):
        return self.by_ref.get(user_ref)

    def mark_verified(self, user_ref):
        if user_ref in self.by_ref:
            self.by_ref[user_ref].verified = True

    def set_password(self, user_ref, password_hash):
        if user_ref in self.by_ref:
            self.by_ref[user_ref].password_hash = password_hash


class PgAccountStore:
    """Postgres persistence; schema is created idempotently on first use."""

    def __init__(self, dsn_fn: Callable[[], str]) -> None:
        self._dsn_fn = dsn_fn
        self._ready = False

    def _conn(self):
        import psycopg

        conn = psycopg.connect(self._dsn_fn(), connect_timeout=5, autocommit=True)
        if not self._ready:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS email_accounts (
                        user_ref VARCHAR(20) PRIMARY KEY,
                        tenant VARCHAR(32) NOT NULL DEFAULT 'smartjudge',
                        email VARCHAR(254) NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        email_verified_at TIMESTAMPTZ,
                        contact_phone VARCHAR(32),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                    """
                )
            self._ready = True
        return conn

    @staticmethod
    def _row(row) -> Optional[Account]:
        if not row:
            return None
        return Account(row[0], row[1], row[2], row[3] is not None, row[4])

    _COLS = "user_ref, email, password_hash, email_verified_at, contact_phone"

    def create(self, email, password_hash, contact_phone):
        ref = new_user_ref()
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO email_accounts (user_ref, email, password_hash, contact_phone) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (email) DO NOTHING "
                f"RETURNING {self._COLS};",
                (ref, email, password_hash, contact_phone),
            )
            return self._row(cur.fetchone())

    def get_by_email(self, email):
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {self._COLS} FROM email_accounts WHERE email = %s;", (email,))
            return self._row(cur.fetchone())

    def get_by_ref(self, user_ref):
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {self._COLS} FROM email_accounts WHERE user_ref = %s;", (user_ref,))
            return self._row(cur.fetchone())

    def mark_verified(self, user_ref):
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE email_accounts SET email_verified_at = COALESCE(email_verified_at, now()), "
                "updated_at = now() WHERE user_ref = %s;", (user_ref,))

    def set_password(self, user_ref, password_hash):
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE email_accounts SET password_hash = %s, updated_at = now() WHERE user_ref = %s;",
                (password_hash, user_ref))


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
Sender = Callable[[str, str, str, str], Awaitable[bool]]
IssueToken = Callable[[Account, str, str], str]          # (account, tier, plan_level) -> JWT
PlanInfo = Callable[[str], tuple]                        # user_ref -> (tier, plan_level)


def _ip_limit() -> int:
    return chat_auth._int_env("EMAIL_AUTH_IP_LIMIT_PER_HOUR", 20)


def _login_limit() -> int:
    return chat_auth._int_env("EMAIL_LOGIN_LIMIT_PER_HOUR", 10)


def _normalize_phone(raw: Any, normalize: Optional[Callable[[str], str]]) -> Optional[str]:
    if raw in (None, ""):
        return None
    phone = normalize(str(raw)) if normalize else str(raw)
    return phone if (len(phone) == 11 and phone.startswith("09") and phone.isdigit()) else ""


class EmailAuthService:
    def __init__(self, *, store: AccountStore, secret: bytes, sender: Sender, issue_token: IssueToken,
                 plan_info: PlanInfo, jwt_ttl: int, configured: Callable[[], bool] = email_sender.is_configured,
                 normalize_phone: Optional[Callable[[str], str]] = None) -> None:
        self.store, self.secret, self.sender = store, secret, sender
        self.issue_token, self.plan_info, self.jwt_ttl = issue_token, plan_info, jwt_ttl
        self.configured, self._normalize_phone = configured, normalize_phone
        self._tasks: set = set()

    # --- helpers ---------------------------------------------------------
    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def drain(self) -> None:
        """Wait for background mail sends (tests, graceful shutdown)."""
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    @staticmethod
    def _err(status: int, message: str, code: str, **extra) -> JSONResponse:
        return chat_auth.error_json(status, message, code=code, **extra)

    def _limited(self, left: int) -> JSONResponse:
        left = max(1, int(left))
        return chat_auth.error_json(429, chat_auth.rate_limited_message(left), code="RATE_LIMITED",
                                    headers={"Retry-After": str(left)}, retry_after=left)

    async def _ip_gate(self, request: Request, scope: str, limit: Optional[int] = None):
        ok, left = await chat_auth.acheck_limit(f"email-{scope}-ip", chat_auth.request_ip(request), limit or _ip_limit())
        return None if ok else self._limited(left)

    def _generic(self) -> dict:
        return {"status": "success", "message": MSG_GENERIC_SENT}

    async def _may_send(self, kind: str, email: str) -> bool:
        """60 s cooldown + hourly cap per address and kind. False = skip silently."""
        key = email_key(email)
        if not await chat_auth.aset_nx(f"em:cd:{kind}:{key}", SEND_COOLDOWN_SECONDS):
            return False
        ok, _ = await chat_auth.acheck_limit(f"email-{kind}-addr", key, MAX_SENDS_PER_HOUR)
        return ok

    def _queue_mail(self, to: str, template: tuple) -> None:
        subject, text, page = template
        self._spawn(self.sender(to, subject, text, page))

    def _verification_mail(self, acc: Account) -> tuple:
        token = make_token(self.secret, "verify", acc.user_ref, "unverified", VERIFY_TTL_SECONDS)
        return email_sender.verification_email(token)

    def _reset_mail(self, acc: Account) -> tuple:
        token = make_token(self.secret, "reset", acc.user_ref, password_fingerprint(acc.password_hash), RESET_TTL_SECONDS)
        return email_sender.reset_email(token)

    def _unavailable(self) -> Optional[JSONResponse]:
        return None if self.configured() else self._err(503, MSG_UNAVAILABLE, "EMAIL_UNAVAILABLE")

    @staticmethod
    def _check_password(password: Any) -> Optional[JSONResponse]:
        password = password if isinstance(password, str) else ""
        if len(password) < MIN_PASSWORD:
            return EmailAuthService._err(400, MSG_SHORT_PASSWORD, "WEAK_PASSWORD")
        if len(password) > MAX_PASSWORD:
            return EmailAuthService._err(400, MSG_LONG_PASSWORD, "WEAK_PASSWORD")
        return None

    # --- operations --------------------------------------------------------
    async def register(self, request: Request, email_raw, password, phone_raw=None):
        if (off := self._unavailable()) is not None:
            return off
        if (limited := await self._ip_gate(request, "register")) is not None:
            return limited
        email = normalize_email(email_raw)
        if not email:
            return self._err(400, MSG_BAD_EMAIL, "BAD_EMAIL")
        if (bad := self._check_password(password)) is not None:
            return bad
        phone = _normalize_phone(phone_raw, self._normalize_phone)
        if phone == "":
            return self._err(400, MSG_BAD_PHONE, "BAD_PHONE")

        # always hash (also when the address is taken) so timing is identical
        pw_hash = await asyncio.to_thread(hash_password, password)
        acc = await asyncio.to_thread(self.store.create, email, pw_hash, phone)
        if acc is not None:
            if await self._may_send("verify", email):
                self._queue_mail(email, self._verification_mail(acc))
        else:
            # Address already registered. Never touch the existing account (a stranger could
            # otherwise plant a password on an unverified one); tell its owner instead.
            existing = await asyncio.to_thread(self.store.get_by_email, email)
            if existing is not None and await self._may_send("verify", email):
                self._queue_mail(email, self._verification_mail(existing) if not existing.verified
                                 else email_sender.already_registered_email())
        return self._generic()

    async def resend_verification(self, request: Request, email_raw):
        if (off := self._unavailable()) is not None:
            return off
        if (limited := await self._ip_gate(request, "resend")) is not None:
            return limited
        email = normalize_email(email_raw)
        if not email:
            return self._err(400, MSG_BAD_EMAIL, "BAD_EMAIL")
        acc = await asyncio.to_thread(self.store.get_by_email, email)
        if acc is not None and not acc.verified and await self._may_send("verify", email):
            self._queue_mail(email, self._verification_mail(acc))
        return self._generic()

    async def verify_email(self, request: Request, token):
        if (limited := await self._ip_gate(request, "verify")) is not None:
            return limited
        claims = read_token(self.secret, token, "verify")
        acc = await asyncio.to_thread(self.store.get_by_ref, claims["u"]) if claims else None
        if claims is None or acc is None or acc.verified or claims["f"] != "unverified":
            return self._err(400, MSG_BAD_TOKEN, "BAD_TOKEN")
        await asyncio.to_thread(self.store.mark_verified, acc.user_ref)
        return {"status": "success", "message": "ایمیل شما تأیید شد. اکنون می‌توانید وارد شوید."}

    async def login(self, request: Request, email_raw, password):
        if (off := self._unavailable()) is not None:
            return off
        if (limited := await self._ip_gate(request, "login", chat_auth._int_env("EMAIL_LOGIN_IP_LIMIT_PER_HOUR", 30))) is not None:
            return limited
        email = normalize_email(email_raw)
        password = password if isinstance(password, str) and len(password) <= MAX_PASSWORD else ""
        if email:
            ok, left = await chat_auth.acheck_limit("email-login-addr", email_key(email), _login_limit())
            if not ok:
                return self._limited(left)
        acc = await asyncio.to_thread(self.store.get_by_email, email) if email else None
        stored = acc.password_hash if acc else _dummy_hash()
        matches = await asyncio.to_thread(verify_password, password, stored)
        if acc is None or not matches or not password:
            return self._err(401, MSG_BAD_CREDENTIALS, "BAD_CREDENTIALS")
        if not acc.verified:  # only reachable with the right password: reveals nothing to a stranger
            return self._err(403, MSG_NOT_VERIFIED, "EMAIL_NOT_VERIFIED")
        tier, level = await asyncio.to_thread(self.plan_info, acc.user_ref)
        token = self.issue_token(acc, tier, level)
        return {
            "status": "success",
            "token": token,
            "token_type": "Bearer",
            "expires_in": self.jwt_ttl,
            "user": {
                "id": acc.user_ref,
                "phone": acc.contact_phone or "",
                "email": acc.email,
                "first_name": "",
                "last_name": "",
                "username": acc.email,
                "subscription_tier": tier,
                "plan_level": level,
            },
        }

    async def forgot_password(self, request: Request, email_raw):
        if (off := self._unavailable()) is not None:
            return off
        if (limited := await self._ip_gate(request, "forgot")) is not None:
            return limited
        email = normalize_email(email_raw)
        if not email:
            return self._err(400, MSG_BAD_EMAIL, "BAD_EMAIL")
        acc = await asyncio.to_thread(self.store.get_by_email, email)
        if acc is not None and await self._may_send("reset", email):
            self._queue_mail(email, self._reset_mail(acc))
        return self._generic()

    async def reset_password(self, request: Request, token, new_password):
        if (limited := await self._ip_gate(request, "reset")) is not None:
            return limited
        if (bad := self._check_password(new_password)) is not None:
            return bad
        claims = read_token(self.secret, token, "reset")
        acc = await asyncio.to_thread(self.store.get_by_ref, claims["u"]) if claims else None
        if claims is None or acc is None or claims["f"] != password_fingerprint(acc.password_hash):
            return self._err(400, MSG_BAD_TOKEN, "BAD_TOKEN")
        new_hash = await asyncio.to_thread(hash_password, new_password)
        await asyncio.to_thread(self.store.set_password, acc.user_ref, new_hash)
        # the mailbox owner proved control of the address: this also verifies it, and any
        # password an impostor planted on an unverified account is gone
        await asyncio.to_thread(self.store.mark_verified, acc.user_ref)
        return {"status": "success", "message": "رمز عبور تغییر کرد. با رمز جدید وارد شوید."}


# ---------------------------------------------------------------------------
# HTTP layer (DTOs; no storage logic here)
# ---------------------------------------------------------------------------
class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=False)


class RegisterBody(_Body):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)
    phone: Optional[str] = Field(default=None, max_length=32)


class EmailOnlyBody(_Body):
    email: str = Field(max_length=320)


class LoginBody(_Body):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class TokenBody(_Body):
    token: str = Field(max_length=2048)


class ResetBody(_Body):
    token: str = Field(max_length=2048)
    password: str = Field(max_length=1024)


def build_router(service: EmailAuthService) -> APIRouter:
    """Routes relative to the judge router prefix (included from smartjudge_module)."""
    r = APIRouter()

    def _safe(handler):
        async def run(*args):
            try:
                return await handler(*args)
            except Exception as exc:  # noqa: BLE001 - DB down etc.: generic 503, no details
                print(f"[AUTH][EMAIL-FAILED] {type(exc).__name__}", file=sys.stderr)
                return chat_auth.error_json(503, MSG_TEMP_FAIL, code="TEMP_UNAVAILABLE")
        return run

    @r.get("/auth/methods")
    async def auth_methods():
        return {"phone": True, "email": bool(service.configured())}

    @r.post("/auth/email/register")
    async def email_register(request: Request, body: RegisterBody):
        return await _safe(service.register)(request, body.email, body.password, body.phone)

    @r.post("/auth/email/verify-email")
    async def email_verify(request: Request, body: TokenBody):
        return await _safe(service.verify_email)(request, body.token)

    @r.post("/auth/email/resend-verification")
    async def email_resend(request: Request, body: EmailOnlyBody):
        return await _safe(service.resend_verification)(request, body.email)

    @r.post("/auth/email/login")
    async def email_login(request: Request, body: LoginBody):
        return await _safe(service.login)(request, body.email, body.password)

    @r.post("/auth/email/forgot-password")
    async def email_forgot(request: Request, body: EmailOnlyBody):
        return await _safe(service.forgot_password)(request, body.email)

    @r.post("/auth/email/reset-password")
    async def email_reset(request: Request, body: ResetBody):
        return await _safe(service.reset_password)(request, body.token, body.password)

    return r
