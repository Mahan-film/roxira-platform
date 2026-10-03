"""
ROXIRA UNIFIED MULTI-METHOD AUTHENTICATION MODULE
احراز هویت جامع: Credentials + Kavenegar OTP + Google OAuth

ذخیره‌سازی: SQLite پایدار در /opt/roxira_platform/data/users.db
  - جدول users:  id, username (UNIQUE), email, phone, password_hash, created_at
  - جدول otps:   phone, code, expires_at

Endpoints استاندارد (بدون 404):
  POST /api/v1/auth/register      {username, password, email?, phone?}
  POST /api/v1/auth/login         {identifier | username, password}
  POST /api/v1/auth/request-otp   {phone_number, target_service}
  POST /api/v1/auth/verify-otp    {phone_number, code}
  GET  /api/v1/auth/google/url    -> آدرس رضایت گوگل
  GET  /api/v1/auth/google/callback -> تبادل code، ثبت/ورود، ریدایرکت به /app

سازگاری عقب‌گرد (Alias): login-password، phone_number
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import pathlib
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

# ─────────────────────────────────────────────────────────────────────────────
# سرویس ارسال OTP — Kavenegar (Verify Lookup)
# ─────────────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[3]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

try:
    from output_apps.ecosystem_core.src.notifications.kavenegar_service import (  # noqa: E402
        KavenegarError,
        KavenegarService,
        resolve_template,
    )
    _KAVENEGAR_PKG_AVAILABLE = True
except Exception as _exc:  # pragma: no cover — محیط بدون httpx
    _KAVENEGAR_PKG_AVAILABLE = False
    KavenegarError = Exception
    KavenegarService = None
    resolve_template = None

logger = logging.getLogger("roxira.unifiedauth")

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["احراز هویت چندروشی (Credentials + OTP + Google)"],
)

# ─────────────────────────────────────────────────────────────────────────────
# پیکربندی
# ─────────────────────────────────────────────────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is not set; refusing to sign tokens with a default secret")
from output_apps.generated_modules.unifiedauth.env_utils import _int_env  # noqa: E402

JWT_TTL_SECONDS = _int_env("JWT_TTL_SECONDS", 86400, 300, 2592000)   # ۲۴ ساعت
OTP_TTL_SECONDS = _int_env("OTP_TTL_SECONDS", 180, 30, 3600)         # ۳ دقیقه
PBKDF2_ITERATIONS = _int_env("PBKDF2_ITERATIONS", 120000, 10000, 5000000)

KAVENEGAR_API_KEY = os.environ.get("KAVENEGAR_API_KEY", "")
if not KAVENEGAR_API_KEY:
    raise RuntimeError("KAVENEGAR_API_KEY environment variable is not set")

# Google OAuth 2.0 (شامل مقادیر پیش‌فرض درخواستی)
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "").strip()

# ─────────────────────────────────────────────────────────────────────────────
# لایه ذخیره‌سازی پایدار — SQLite
# ─────────────────────────────────────────────────────────────────────────────
# مسیر به‌صورت پویا: هم روی هاست (/opt/roxira_platform) و هم داخل کانتینر (/app)
_DATA_DIR_CANDIDATES = [
    pathlib.Path("/opt/roxira_platform/data"),
    pathlib.Path("/app/data"),
    pathlib.Path(_PROJECT_ROOT / "data"),
]
DATA_DIR: Optional[pathlib.Path] = None
for _cand in _DATA_DIR_CANDIDATES:
    try:
        _cand.mkdir(parents=True, exist_ok=True)
        DATA_DIR = _cand
        break
    except OSError:
        continue
if DATA_DIR is None:  # pragma: no cover - آخرین راهکار
    DATA_DIR = pathlib.Path(tempfile.gettempdir()) / "roxira_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "users.db"
_db_lock = threading.RLock()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def _init_db() -> None:
    """ایجاد خودکار دایرکتوری و جدول‌ها در صورت نبود."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                email TEXT,
                phone TEXT,
                password_hash TEXT,
                full_name TEXT,
                role TEXT DEFAULT 'LEGAL_USER',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS otps (
                phone TEXT,
                code TEXT,
                expires_at TIMESTAMP
            )
            """
        )
        conn.commit()
    logger.info("[AUTH] SQLite storage ready at %s", DB_PATH)


# ─────────────────────────────────────────────────────────────────────────────
# ابزارهای رمزنگاری
# ─────────────────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """پشتیبانی از pbkdf2_sha256 و فرمت‌های legacy (sha256$salt / sha256 ساده)."""
    if not stored:
        return False
    try:
        if stored.startswith("pbkdf2_sha256$"):
            _, iters, salt, hash_hex = stored.split("$", 3)
            dk = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iters)
            )
            return hmac.compare_digest(dk.hex(), hash_hex)
        if "$" in stored:
            hash_hex, salt = stored.split("$", 1)
            guess = hashlib.sha256((password + salt).encode("utf-8")).hexdigest()
            return hmac.compare_digest(guess, hash_hex)
        return hmac.compare_digest(
            hashlib.sha256(password.encode("utf-8")).hexdigest(), stored
        )
    except Exception:
        return False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def issue_jwt(user: Dict[str, Any]) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user.get("id", "")),
        "username": user.get("username"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "role": user.get("role") or "LEGAL_USER",
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
    }
    header_b64 = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload_b64 = _b64url(json.dumps(payload, ensure_ascii=False).encode())
    sig = hmac.new(
        JWT_SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def _user_profile(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "full_name": user.get("full_name"),
        "role": user.get("role") or "LEGAL_USER",
    }


# ─────────────────────────────────────────────────────────────────────────────
# CRUD کاربران (SQLite پایدار)
# ─────────────────────────────────────────────────────────────────────────────
def _normalize_iran_phone(raw: str) -> str:
    clean = re.sub(r"[^\d+]", "", raw or "")
    if clean.startswith("+98"):
        clean = "0" + clean[3:]
    elif clean.startswith("0098"):
        clean = "0" + clean[4:]
    elif clean.startswith("98") and len(clean) >= 11:
        clean = "0" + clean[2:]
    return clean


def get_user(identifier: str) -> Optional[Dict[str, Any]]:
    """یافتن کاربر بر اساس username | email | phone."""
    ident = (identifier or "").strip()
    phone = _normalize_iran_phone(ident)
    email_key = ident.lower()
    try:
        with _db_lock, _get_conn() as conn:
            row = conn.execute(
                """
                SELECT * FROM users
                WHERE username = ?
                   OR (email IS NOT NULL AND lower(email) = ?)
                   OR (phone IS NOT NULL AND phone = ?)
                LIMIT 1
                """,
                (ident, email_key, phone or ident),
            ).fetchone()
        return dict(row) if row else None
    except Exception as exc:
        logger.error("[AUTH] get_user failed: %s", exc)
        return None


def create_user(
    username: str,
    password: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    full_name: Optional[str] = None,
    role: str = "LEGAL_USER",
) -> Dict[str, Any]:
    pwd_hash = hash_password(password) if password else hash_password(secrets.token_urlsafe(24))
    with _db_lock, _get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO users (username, email, phone, password_hash, full_name, role)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (username, email, phone, pwd_hash, full_name, role),
        )
        conn.commit()
        new_id = cur.lastrowid
    return {
        "id": new_id,
        "username": username,
        "email": email,
        "phone": phone,
        "full_name": full_name,
        "role": role,
    }


def _user_exists(identifier: str) -> bool:
    return get_user(identifier) is not None


def _normalize_phone_for_storage(raw: str) -> Optional[str]:
    if not raw:
        return None
    p = _normalize_iran_phone(raw)
    return p if (len(p) == 11 and p.startswith("09")) else None
# ─────────────────────────────────────────────────────────────────────────────
# مدل‌های درخواست
# ─────────────────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    phone: Optional[str] = None
    phone_number: Optional[str] = None  # سازگاری عقب‌گرد
    full_name: Optional[str] = None


class LoginRequest(BaseModel):
    identifier: Optional[str] = None   # username | email | phone
    username: Optional[str] = None     # سازگاری با ghazi_index
    password: str


class OTPRequest(BaseModel):
    phone_number: str
    target_service: Optional[str] = None


class OTPVerify(BaseModel):
    phone_number: str
    code: str


class GoogleCallbackQuery(BaseModel):
    code: Optional[str] = None
    state: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# ابزار ارسال OTP — Kavenegar Verify Lookup
# ─────────────────────────────────────────────────────────────────────────────
def _detect_service(request: Request, explicit: Optional[str]) -> str:
    if explicit:
        return explicit.strip().lower()
    host = (request.headers.get("host") or "").lower()
    if "ghazi" in host or "smartjudge" in host:
        return "ghazi"
    return "roxira"


def _template_for(service: str, host: Optional[str] = None) -> str:
    """مسیریابی قالب: ghazi->ghazi-verify | roxira->roxira-verify."""
    svc = (service or "").lower()
    if svc in ("ghazi", "ghazihoushmand", "smartjudge"):
        return "ghazi-verify"
    if svc in ("roxira", "roxira-net", "enterprise"):
        return "roxira-verify"
    if resolve_template is not None:
        return resolve_template(service=service, host=host)
    h = (host or "").lower()
    return "ghazi-verify" if ("ghazi" in h or "smartjudge" in h) else "roxira-verify"


def _dispatch_kavenegar(receptor: str, token: str, template: str) -> Dict[str, Any]:
    """ارسال از طریق Kavenegar Verify Lookup (بدون وابستگی خارجی به httpx)."""
    url = f"https://api.kavenegar.com/v1/{KAVENEGAR_API_KEY}/verify/lookup.json"
    qs = urllib.parse.urlencode(
        {"receptor": receptor, "token": token, "template": template}
    )
    req = urllib.request.Request(f"{url}?{qs}", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
        ret = body.get("return") if isinstance(body, dict) else {}
        status = ret.get("status") if isinstance(ret, dict) else None
        if status == 200:
            return {"delivered": True, "receptor": receptor, "template": template,
                    "http_status": 200, "provider_response": body}
        return {"delivered": False, "receptor": receptor, "template": template,
                "http_status": 200, "provider_response": body,
                "error": str(ret.get("message", "return status != 200"))}
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")[:300]
        except Exception:
            detail = ""
        return {"delivered": False, "receptor": receptor, "template": template,
                "http_status": exc.code, "error": f"HTTP {exc.code}: {detail}"}
    except Exception as exc:
        return {"delivered": False, "receptor": receptor, "template": template,
                "http_status": None, "error": str(exc)}
def _store_otp(phone: str, code: str) -> None:
    expires = time.time() + OTP_TTL_SECONDS
    with _db_lock, _get_conn() as conn:
        conn.execute("DELETE FROM otps WHERE phone = ?", (phone,))
        conn.execute(
            "INSERT INTO otps (phone, code, expires_at) VALUES (?, ?, ?)",
            (phone, code, expires),
        )
        conn.commit()


def _read_otp(phone: str) -> Optional[Dict[str, Any]]:
    with _db_lock, _get_conn() as conn:
        row = conn.execute(
            "SELECT phone, code, expires_at FROM otps WHERE phone = ? ORDER BY rowid DESC LIMIT 1",
            (phone,),
        ).fetchone()
    return dict(row) if row else None


def _delete_otp(phone: str) -> None:
    with _db_lock, _get_conn() as conn:
        conn.execute("DELETE FROM otps WHERE phone = ?", (phone,))
        conn.commit()


# ─────────────────────────────────────────────────────────────────────────────
# ۱) درخواست کد تأیید (Kavenegar OTP)
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/request-otp")
async def request_otp(req: OTPRequest, request: Request):
    phone = _normalize_iran_phone(req.phone_number)
    if len(phone) != 11 or not phone.startswith("09"):
        raise HTTPException(status_code=400, detail="شماره تلفن همراه معتبر نیست.")

    service = _detect_service(request, req.target_service)
    template = _template_for(service, request.headers.get("host"))

    code = f"{secrets.randbelow(1_000_000):06d}"  # کد ۶ رقمی
    _store_otp(phone, code)

    result = _dispatch_kavenegar(receptor=phone, token=code, template=template)
    delivered = bool(result.get("delivered"))

    return {
        "status": "OTP_DISPATCHED" if delivered else "OTP_STORED_SMS_DEGRADED",
        "phone_number": phone,
        "service": service,
        "sms_template": template,
        "sms_delivered": delivered,
        "sms_channel": "kavenegar",
        "provider_response": result.get("provider_response"),
        "expires_in_seconds": OTP_TTL_SECONDS,
        "message": (
            f"کد تأیید ۶ رقمی از طریق کاوه‌نگار (قالب {template}) به شماره {phone} ارسال شد."
            if delivered
            else "کد تأیید تولید شد؛ اما ارسال پیامک با خطا مواجه شد. با پشتیبانی تماس بگیرید."
        ),
        **( {"dispatch_error": result.get("error")} if not delivered else {} ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# ۲) تأیید کد پیامکی — ساخت خودکار حساب + صدور JWT
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/verify-otp")
async def verify_otp(req: OTPVerify):
    phone = _normalize_iran_phone(req.phone_number)
    entry = _read_otp(phone)
    if not entry or time.time() > float(entry.get("expires_at", 0) or 0):
        _delete_otp(phone)
        raise HTTPException(status_code=400, detail="کد تأیید منقضی شده است؛ مجدداً درخواست کنید.")
    if not hmac.compare_digest(str(entry["code"]), (req.code or "").strip()):
        raise HTTPException(status_code=400, detail="کد تأیید وارد شده نامعتبر است.")

    _delete_otp(phone)

    user = get_user(phone) or create_user(username=phone, phone=phone, full_name=None, role="LEGAL_USER")

    token = issue_jwt(user)
    return {
        "status": "AUTHENTICATED",
        "message": "ورود با موفقیت انجام شد.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "user": _user_profile(user),
    }
# ─────────────────────────────────────────────────────────────────────────────
# ۳) ثبت‌نام — هش رمز عبور و ذخیره پایدار در SQLite
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/register")
async def register(req: RegisterRequest):
    username = (req.username or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.\-]{3,64}", username):
        raise HTTPException(
            status_code=400,
            detail="نام کاربری باید ۳ تا ۶۴ کاراکتر و شامل حروف لاتین، رقم، نقطه، خط تیره یا زیرخط باشد.",
        )
    if len(req.password or "") < 6:
        raise HTTPException(status_code=400, detail="رمز عبور باید حداقل ۶ کاراکتر باشد.")

    email = (req.email or "").strip().lower() or None
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="قالب ایمیل معتبر نیست.")

    raw_phone = req.phone or req.phone_number  # هر دو کلید
    phone = _normalize_phone_for_storage(raw_phone or "")
    if raw_phone and not phone:
        raise HTTPException(status_code=400, detail="شماره موبایل معتبر نیست.")

    if _user_exists(username):
        raise HTTPException(status_code=409, detail="این نام کاربری قبلاً ثبت شده است.")
    if email and _user_exists(email):
        raise HTTPException(status_code=409, detail="این ایمیل قبلاً ثبت شده است.")
    if phone and _user_exists(phone):
        raise HTTPException(status_code=409, detail="این شماره موبایل قبلاً ثبت شده است.")

    try:
        user = create_user(
            username=username,
            password=req.password,
            email=email,
            phone=phone,
            full_name=(req.full_name or "").strip() or None,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="این نام کاربری یا ایمیل قبلاً ثبت شده است.")

    token = issue_jwt(user)
    return {
        "status": "USER_REGISTERED",
        "message": "ثبت‌نام با موفقیت انجام شد.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "user": _user_profile(user),
    }
# ─────────────────────────────────────────────────────────────────────────────
# ۴) ورود با نام کاربری / ایمیل / موبایل + رمز عبور
# ─────────────────────────────────────────────────────────────────────────────
def _do_login(identifier: str, password: str) -> Dict[str, Any]:
    ident = (identifier or "").strip()
    if not ident or not password:
        raise HTTPException(status_code=400, detail="شناسه و رمز عبور الزامی است.")
    user = get_user(ident)
    if not user:
        raise HTTPException(status_code=401, detail="کاربری با این شناسه یافت نشد.")
    if not verify_password(password, user.get("password_hash") or ""):
        raise HTTPException(status_code=401, detail="رمز عبور نادرست است.")
    token = issue_jwt(user)
    return {
        "status": "AUTHENTICATED",
        "message": "ورود با موفقیت انجام شد.",
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "user": _user_profile(user),
    }


@router.post("/login")
async def login(req: LoginRequest):
    identifier = req.identifier or req.username  # پشتیبانی از هر دو کلید
    return _do_login(identifier, req.password)


@router.post("/login-password")
async def login_password(req: LoginRequest):
    """Alias عقب‌گرد — همان رفتار /login."""
    return _do_login(req.identifier or req.username, req.password)
# ─────────────────────────────────────────────────────────────────────────────
# فراموشی رمز عبور (بازیابی با ایمیل) — بدون 404
# ─────────────────────────────────────────────────────────────────────────────
class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, request: Request):
    email = (req.email or "").strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="قالب ایمیل معتبر نیست.")

    generic = {
        "status": "RESET_EMAIL_SENT",
        "message": "اگر این ایمیل در سامانه ثبت شده باشد، لینک بازیابی رمز عبور برای شما ارسال شد.",
    }
    user = get_user(email)
    if not user:
        logger.info("[AUTH] forgot-password for unknown email: %s", email)
        return generic

    reset_token = secrets.token_urlsafe(32)
    base = str(request.base_url).rstrip("/")
    reset_link = f"{base}/app?reset_token={reset_token}"
    logger.warning("[AUTH] RESET LINK (no SMTP configured) -> %s", reset_link)
    return {**generic, "debug_note": "SMTP تنظیم نشده است؛ لینک بازیابی در لاگ سرور ثبت شد."}
# ─────────────────────────────────────────────────────────────────────────────
# ۵) ورود با گوگل — Google OAuth 2.0
# ─────────────────────────────────────────────────────────────────────────────
_GOOGLE_STATES: Dict[str, float] = {}


def _require_google_config() -> None:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="google login not configured")


@router.get("/google/url")
async def google_auth_url(request: Request):
    _require_google_config()
    redirect_uri = GOOGLE_REDIRECT_URI or (
        f"{str(request.base_url).rstrip('/')}/api/v1/auth/google/callback"
    )
    state = secrets.token_urlsafe(24)
    _GOOGLE_STATES[state] = time.time() + 600

    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    })
    return {
        "status": "GOOGLE_AUTH_URL_READY",
        "url": url,
        "state": state,
        "redirect_uri": redirect_uri,
    }


def _exchange_google_code(code: str, redirect_uri: str) -> Dict[str, Any]:
    data = urllib.parse.urlencode({
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token", data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")[:400]
        except Exception:
            body = ""
        raise HTTPException(status_code=401, detail=f"تبادل کد گوگل ناموفق بود: {body}")


def _verify_google_id_token(id_token: str) -> Dict[str, Any]:
    qs = urllib.parse.urlencode({"id_token": id_token})
    try:
        with urllib.request.urlopen(
            f"https://oauth2.googleapis.com/tokeninfo?{qs}", timeout=15
        ) as resp:
            info = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError:
        raise HTTPException(status_code=401, detail="توکن گوگل نامعتبر است.")
    if GOOGLE_CLIENT_ID and info.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="توکن گوگل متعلق به این سامانه نیست.")
    if int(info.get("exp", 0)) < time.time():
        raise HTTPException(status_code=401, detail="توکن گوگل منقضی شده است.")
    return info


@router.get("/google/callback")
async def google_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None):
    """
    هندلر بازگشت گوگل (GET):
      ۱) تبادل authorization_code با توکن‌ها
      ۲) اعتبارسنجی id_token
      ۳) ثبت/ورود خودکار کاربر
      ۴) ریدایرکت به /app با توکن JWT در کوکی + هش window.postMessage
    """
    _require_google_config()

    if state and state in _GOOGLE_STATES:
        _GOOGLE_STATES.pop(state, None)

    if not code:
        raise HTTPException(status_code=400, detail="کد authorization از گوگل دریافت نشد.")

    redirect_uri = GOOGLE_REDIRECT_URI or (
        f"{str(request.base_url).rstrip('/')}/api/v1/auth/google/callback"
    )
    tokens = _exchange_google_code(code, redirect_uri)
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="id_token از پاسخ گوگل یافت نشد.")

    info = _verify_google_id_token(id_token)
    g_email = (info.get("email") or "").strip().lower()
    if not g_email:
        raise HTTPException(status_code=400, detail="ایمیل حساب گوگل در دسترس نیست.")

    user = get_user(g_email)
    if not user:
        user = create_user(
            username=g_email.split("@")[0] + "_" + secrets.token_hex(3),
            email=g_email,
            full_name=info.get("name"),
            role="LEGAL_USER",
        )

    jwt_token = issue_jwt(user)
    app_url = f"{str(request.base_url).rstrip('/')}/app"
    resp = RedirectResponse(url=app_url, status_code=302)
    resp.set_cookie(
        key="roxira_jwt", value=jwt_token, httponly=False, samesite="lax", max_age=JWT_TTL_SECONDS
    )
    # برای اینکه SPA بتواند توکن را بخواند
    resp.headers["X-Auth-Token"] = jwt_token
    return resp


# ─────────────────────────────────────────────────────────────────────────────
# سلف‌تست (اجرای مستقیم ماژول)
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    h = hash_password("Test@123")
    assert verify_password("Test@123", h) and not verify_password("wrong", h)
    u = {"id": 1, "username": "t", "email": "t@x.ir", "phone": "09120000000", "role": "LEGAL_USER"}
    tk = issue_jwt(u)
    assert tk.count(".") == 2
    print("unifiedauth self-test PASS | db=", DB_PATH)
_init_db()