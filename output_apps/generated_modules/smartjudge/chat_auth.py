"""Auth, identity and rate-limit helpers for the Smart Judge chat surface.

Framework-light and import-side-effect free (no network, no DB at import time) so it
can be unit tested offline and imported by both ``smartjudge_module`` and the
live-voice module without a circular import.

Identity contract
-----------------
The client sends ``Authorization: Bearer <token>`` (the token returned by
``POST /auth/verify-otp``). Phone and subscription tier are derived from that token
only. ``phone`` / ``tier`` / ``is_vip`` in request bodies are never trusted.
``smartjudge_module`` registers the real token resolver through ``configure``; until
then every presented token is treated as invalid (fail closed).

Counters and OTP records live in Redis when ``REDIS_URL`` or ``REDIS_HOST`` is set and
the ``redis`` package imports; any Redis failure silently falls back to an in-process
store. The in-process store is per worker: with several uvicorn workers the limits
are per worker, not global.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional

from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Limits (env-overridable)
# ---------------------------------------------------------------------------
HOUR_SECONDS = 3600
MAX_CHAT_CHARS = 6000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_SPEAK_CHARS = 2000


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip())
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


def chat_anon_hourly_limit() -> int:
    return _int_env("CHAT_ANON_HOURLY_LIMIT", 10)


DAY_SECONDS = 86400


def chat_anon_daily_limit() -> int:
    return _int_env("CHAT_ANON_DAILY_LIMIT", 5)


def chat_free_daily_limit() -> int:
    return _int_env("CHAT_FREE_DAILY_LIMIT", 20)


def chat_vip_daily_limit() -> int:
    """Legacy VIP without a plan level (e.g. allow-listed phones)."""
    return _int_env("CHAT_VIP_DAILY_LIMIT", 300)


def chat_basic_daily_limit() -> int:
    return _int_env("CHAT_BASIC_DAILY_LIMIT", 40)


def chat_pro_daily_limit() -> int:
    return _int_env("CHAT_PRO_DAILY_LIMIT", 60)


def chat_premium_daily_limit() -> int:
    return _int_env("CHAT_PREMIUM_DAILY_LIMIT", 120)


def chat_team_daily_limit() -> int:
    return _int_env("CHAT_TEAM_DAILY_LIMIT", 200)


def pro_top_daily() -> int:
    """Answers per day a PRO user gets on the strong group (vip-pro) before dropping to vip-product."""
    return _int_env("SJ_PRO_TOP_DAILY", 60)


def premium_top_daily() -> int:
    """Answers per day a PREMIUM user gets on the world-best group (vip-premium) before dropping to vip-pro."""
    # CHAT_PREMIUM_TOP_DAILY_LIMIT is the documented name; SJ_PREMIUM_TOP_DAILY stays as a legacy alias.
    return _int_env("CHAT_PREMIUM_TOP_DAILY_LIMIT", _int_env("SJ_PREMIUM_TOP_DAILY", 8))


def team_top_daily() -> int:
    """Answers per day a TEAM user gets on the world-best group (vip-team) before dropping to vip-pro."""
    return _int_env("CHAT_TEAM_TOP_DAILY_LIMIT", 20)


def voice_anon_hourly_limit() -> int:
    return _int_env("VOICE_ANON_HOURLY_LIMIT", 5)


def voice_auth_hourly_limit() -> int:
    return _int_env("VOICE_AUTH_HOURLY_LIMIT", 60)


# ---------------------------------------------------------------------------
# Persian messages
# ---------------------------------------------------------------------------
MSG_TOKEN_INVALID = "نشست شما منقضی شده یا نامعتبر است؛ لطفاً دوباره وارد شوید."
MSG_AUTH_REQUIRED = "برای دسترسی به این بخش ابتدا وارد حساب کاربری خود شوید."
MSG_NOT_FOUND = "گفتگوی مورد نظر یافت نشد."
MSG_CHAT_TOO_LONG = "متن پیام بیش از حد طولانی است (حداکثر ۶۰۰۰ نویسه)."
MSG_UPLOAD_TOO_LARGE = "حجم فایل صوتی بیش از حد مجاز است (حداکثر ۱۰ مگابایت)."
MSG_SPEAK_TOO_LONG = "متن بیش از حد طولانی است (حداکثر ۲۰۰۰ نویسه)."


def rate_limited_message(retry_after: int, *, anonymous: bool = False) -> str:
    minutes = max(1, (int(retry_after) + 59) // 60)
    hint = " یا برای ادامه وارد شوید" if anonymous else ""
    return f"تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً حدود {minutes} دقیقه دیگر دوباره تلاش کنید{hint}."


# ---------------------------------------------------------------------------
# Time (patchable in tests)
# ---------------------------------------------------------------------------
def _now() -> float:
    return time.time()


# ---------------------------------------------------------------------------
# Store: Redis when available, in-process otherwise
# ---------------------------------------------------------------------------
_mem: dict[str, list] = {}  # key -> [value, expires_at]
_mem_lock = threading.RLock()  # guards _mem and _idem_keys (touched from worker threads)
_redis_client: Any = None
_redis_checked = False
_redis_retry_at = 0.0


def reset_for_tests() -> None:
    global _redis_client, _redis_checked, _redis_retry_at
    with _mem_lock:
        _mem.clear()
        _idem_keys.clear()
    _redis_client = None
    _redis_checked = True  # tests never touch a real Redis
    _redis_retry_at = 0.0


def set_redis_client(client: Any) -> None:
    """Inject a sync redis-compatible client (tests / bootstrap)."""
    global _redis_client, _redis_checked
    _redis_client = client
    _redis_checked = True


def _redis_url() -> str:
    url = os.environ.get("REDIS_URL", "").strip()
    if url:
        return url
    host = os.environ.get("REDIS_HOST", "").strip()
    if host:
        return f"redis://{host}:{os.environ.get('REDIS_PORT', '6379').strip()}/0"
    return ""


def _get_redis() -> Any:
    global _redis_client, _redis_checked
    if _redis_client is not None:
        if _redis_retry_at > _now():
            return None
        return _redis_client
    if _redis_checked:
        return None
    _redis_checked = True
    url = _redis_url()
    if not url:
        return None
    try:
        import redis  # type: ignore

        client = redis.Redis.from_url(
            url, socket_timeout=0.5, socket_connect_timeout=0.5, decode_responses=True
        )
        client.ping()  # fail now (once) so the startup log tells the truth
        _redis_client = client
    except Exception as exc:  # package missing, bad URL or unreachable: in-process fallback
        _redis_client = None
        print(f"[CHAT-STORE] WARNING redis configured but unusable ({type(exc).__name__}); "
              "falling back to per-process memory", file=sys.stderr)
    _log_backend()
    return _redis_client


def store_backend() -> str:
    """Non-sensitive: ``redis`` while a client is active, else ``memory``."""
    _get_redis()
    return "redis" if _redis_client is not None else "memory"


_backend_logged = False


def _log_backend() -> None:
    global _backend_logged
    if _backend_logged:
        return
    _backend_logged = True
    backend = "redis" if _redis_client is not None else "memory"
    print(f"[CHAT-STORE] backend={backend}", file=sys.stderr)
    workers = _int_env("WEB_CONCURRENCY", 1)
    if backend == "memory" and workers > 1:
        print(f"[CHAT-STORE] WARNING {workers} workers share no state: rate limits, OTP and "
              "idempotent replay are per worker. Configure REDIS_URL or REDIS_HOST.", file=sys.stderr)


def _redis_failed() -> None:
    """Back off from Redis for 30s after an error so requests don't each pay the timeout."""
    global _redis_retry_at
    _redis_retry_at = _now() + 30


def _mem_get(key: str) -> Optional[list]:
    with _mem_lock:
        item = _mem.get(key)
        if item is None:
            return None
        if item[1] <= _now():
            _mem.pop(key, None)
            return None
        return item


def _mem_prune() -> None:
    with _mem_lock:
        if len(_mem) > 20000:
            now = _now()
            for key, v in list(_mem.items()):
                if v[1] <= now:
                    _mem.pop(key, None)


_INCR_LUA = """
local c = redis.call('INCR', KEYS[1])
local t = redis.call('TTL', KEYS[1])
if c == 1 or t < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}
"""


def incr(key: str, window_s: int) -> tuple[int, int]:
    """Atomically count one event in a fixed window. Returns (count, seconds_left)."""
    client = _get_redis()
    if client is not None:
        try:
            # one atomic script: a crash can never leave a counter without a TTL, and a
            # key that already lost its TTL (-1) is re-armed on the next hit (self-heal)
            count, ttl = client.eval(_INCR_LUA, 1, key, int(window_s))
            ttl = int(ttl) if int(ttl) > 0 else window_s
            return int(count), int(ttl)
        except Exception:
            _redis_failed()
    with _mem_lock:
        item = _mem_get(key)
        if item is None:
            _mem_prune()
            _mem[key] = [1, _now() + window_s]
            return 1, window_s
        item[0] += 1
        return int(item[0]), max(1, int(item[1] - _now()))


def decr(key: str) -> None:
    """Undo one ``incr`` (refund); never goes below zero."""
    client = _get_redis()
    if client is not None:
        try:
            if int(client.decr(key)) < 0:
                client.set(key, 0, keepttl=True)
            return
        except Exception:
            _redis_failed()
    with _mem_lock:
        item = _mem_get(key)
        if item is not None:
            item[0] = max(0, int(item[0]) - 1)


def peek(key: str) -> int:
    """Current ``incr`` counter value without counting (0 when absent)."""
    client = _get_redis()
    if client is not None:
        try:
            value = client.get(key)
            return int(value) if value else 0
        except Exception:
            _redis_failed()
    with _mem_lock:
        item = _mem_get(key)
        try:
            return int(item[0]) if item else 0
        except (TypeError, ValueError):
            return 0


def ttl(key: str) -> int:
    """Seconds left on ``key`` (0 when absent)."""
    client = _get_redis()
    if client is not None:
        try:
            value = client.ttl(key)
            return int(value) if value and value > 0 else 0
        except Exception:
            _redis_failed()
    with _mem_lock:
        item = _mem_get(key)
        return max(0, int(item[1] - _now())) if item else 0


def set_nx(key: str, ttl_s: int) -> bool:
    """Set ``key`` only if absent (atomic). True when this call created it."""
    client = _get_redis()
    if client is not None:
        try:
            return bool(client.set(key, "1", nx=True, ex=ttl_s))
        except Exception:
            _redis_failed()
    with _mem_lock:
        if _mem_get(key) is not None:
            return False
        _mem_prune()
        _mem[key] = ["1", _now() + ttl_s]
        return True


def kv_set(key: str, value: Any, ttl_s: int) -> None:
    raw = json.dumps(value)
    client = _get_redis()
    if client is not None:
        try:
            client.set(key, raw, ex=ttl_s)
            return
        except Exception:
            _redis_failed()
    with _mem_lock:
        _mem_prune()
        _mem[key] = [raw, _now() + ttl_s]


def kv_get(key: str) -> Any:
    client = _get_redis()
    if client is not None:
        try:
            raw = client.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            _redis_failed()
    with _mem_lock:
        item = _mem_get(key)
        raw_mem = item[0] if item else None
    return json.loads(raw_mem) if raw_mem is not None else None


def kv_delete(*keys: str) -> None:
    client = _get_redis()
    if client is not None:
        try:
            client.delete(*keys)
        except Exception:
            _redis_failed()
    with _mem_lock:
        for key in keys:
            _mem.pop(key, None)


# ---------------------------------------------------------------------------
# Client identity
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CurrentUser:
    phone: Optional[str] = None
    tier: str = "FREE"
    authenticated: bool = False
    token_invalid: bool = False
    # free | basic | pro | premium | team, derived from the active entitlement. tier stays "VIP" for any
    # paid level so VIP-gated features keep working; "free" + tier "VIP" = legacy VIP without a level.
    plan_level: str = "free"


ANONYMOUS = CurrentUser()
_INVALID = CurrentUser(token_invalid=True)

_resolve_token: Optional[Callable[[str], Optional[CurrentUser]]] = None


def configure(resolve_token: Callable[[str], Optional[CurrentUser]]) -> None:
    """Register the token verifier (called once by smartjudge_module)."""
    global _resolve_token
    _resolve_token = resolve_token


# Phone gateway (the LiveKit/SIP phone agent on the edge server): a service identity, not a person.
# The X-Phone-Gateway-Key header is compared (constant time) with SMARTJUDGE_PHONE_GATEWAY_KEY; the
# feature is off unless that key is at least 32 chars. It gets legacy-VIP routing (paid fallback when
# free models are busy) and its own daily cap (PHONE_GATEWAY_DAILY_LIMIT). Never log either value.
PHONE_GATEWAY_HEADER = "x-phone-gateway-key"
PHONE_GATEWAY_ID = "phone-gateway"
PHONE_GATEWAY_MIN_LEN = 32


def phone_gateway_daily_limit() -> int:
    return _int_env("PHONE_GATEWAY_DAILY_LIMIT", 400)


def phone_gateway_key(env_key: Optional[str] = None) -> str:
    key = os.environ.get("SMARTJUDGE_PHONE_GATEWAY_KEY", "") if env_key is None else env_key
    key = key.strip()
    return key if len(key) >= PHONE_GATEWAY_MIN_LEN else ""


def phone_gateway_user(headers: Optional[Mapping[str, str]], env_key: Optional[str] = None) -> Optional[CurrentUser]:
    """None when the header is absent or the feature is off (so deploy order cannot break the phone
    line); the gateway identity on a match; an invalid user (401) on a wrong key."""
    value = headers.get(PHONE_GATEWAY_HEADER) if headers is not None else None
    key = phone_gateway_key(env_key)
    if not value or not key:
        return None
    if not hmac.compare_digest(str(value).strip(), key):
        return _INVALID
    return CurrentUser(phone=PHONE_GATEWAY_ID, tier="VIP", authenticated=True, plan_level="free")


def is_phone_gateway(user: "CurrentUser") -> bool:
    return bool(user.authenticated and user.phone == PHONE_GATEWAY_ID)


def authenticate(headers: Mapping[str, str], query_params: Optional[Mapping[str, str]] = None) -> CurrentUser:
    """Header bearer token (and ``?token=`` only when ``query_params`` is given, i.e. WebSocket).

    No token -> anonymous. Bad/expired token -> ``token_invalid`` user (callers answer 401).
    The phone-gateway header, when present, wins over any bearer token.
    """
    gateway = phone_gateway_user(headers)
    if gateway is not None:
        return gateway
    token = None
    header = headers.get("authorization") if headers is not None else None
    if header and header[:7].lower() == "bearer ":
        token = header[7:].strip()
    elif query_params is not None:
        token = (query_params.get("token") or "").strip() or None
    if not token:
        return ANONYMOUS
    if _resolve_token is None:
        return _INVALID
    try:
        user = _resolve_token(token)
    except Exception:
        user = None
    return user if user is not None else _INVALID


def client_ip(headers: Mapping[str, str], client_host: Optional[str]) -> str:
    """Best-effort caller IP behind the nginx/Cloudflare proxies.

    TODO: these headers are only trustworthy if the edge proxy overwrites them; make
    sure nginx sets X-Real-IP and the container port is not directly reachable.
    """
    for name in ("cf-connecting-ip", "x-real-ip"):
        value = (headers.get(name) or "").strip()
        if value:
            return value[:64]
    forwarded = (headers.get("x-forwarded-for") or "").split(",")
    forwarded = [part.strip() for part in forwarded if part.strip()]
    if forwarded:
        return forwarded[-1][:64]  # last hop = what our own proxy saw
    return (client_host or "unknown")[:64]


def safe_request_ip(request: Any) -> str:
    """Client IP for security caps (OTP sends). Stricter than ``request_ip``.

    nginx (real_ip_header CF-Connecting-IP, Cloudflare ranges only) overwrites X-Real-IP
    with the resolved client address, so that header is trusted when the TCP peer is on a
    private network (our proxy). CF-Connecting-IP is never used: nginx does not overwrite
    it, so a client can forge it. A public TCP peer means the port is exposed directly, so
    all forwarding headers are ignored.
    """
    import ipaddress

    peer = getattr(getattr(request, "client", None), "host", None) or ""
    try:
        peer_ip = ipaddress.ip_address(peer)
        trusted = peer_ip.is_private or peer_ip.is_loopback or peer_ip.is_link_local
    except ValueError:
        trusted = True  # non-IP peer (e.g. the test client): no TCP evidence either way
    if trusted:
        headers = request.headers
        real = (headers.get("x-real-ip") or "").strip()
        if real:
            return real[:64]
        forwarded = [p.strip() for p in (headers.get("x-forwarded-for") or "").split(",") if p.strip()]
        if forwarded:
            return forwarded[-1][:64]  # nginx appends the address it saw as the last hop
    return (peer or "unknown")[:64]


def request_ip(request: Any) -> str:
    client = getattr(request, "client", None)
    return client_ip(request.headers, getattr(client, "host", None))


# ---------------------------------------------------------------------------
# Error responses (same JSON shape the frontend already parses: status + message)
# ---------------------------------------------------------------------------
def error_json(status_code: int, message: str, *, code: str, label: str = "error",
               headers: Optional[dict] = None, **extra: Any) -> JSONResponse:
    body = {"status": label, "message": message, "code": code}
    body.update(extra)
    return JSONResponse(status_code=status_code, content=body, headers=headers)


def unauthorized(user: CurrentUser, *, label: str = "error") -> JSONResponse:
    invalid = user.token_invalid
    return error_json(
        401,
        MSG_TOKEN_INVALID if invalid else MSG_AUTH_REQUIRED,
        code="TOKEN_INVALID" if invalid else "AUTH_REQUIRED",
        label=label,
        headers={"WWW-Authenticate": "Bearer"},
    )


def rate_limited(retry_after: int, *, label: str = "error", anonymous: bool = False) -> JSONResponse:
    retry_after = max(1, int(retry_after))
    return error_json(
        429,
        rate_limited_message(retry_after, anonymous=anonymous),
        code="RATE_LIMITED",
        label=label,
        headers={"Retry-After": str(retry_after)},
        retry_after=retry_after,
    )


PAID_LEVELS = ("basic", "pro", "premium", "team")
CONTRACT_REVIEW_LEVELS = ("premium", "team")


def user_level(user: "CurrentUser") -> str:
    """guest | free | basic | pro | premium | team | vip (legacy VIP without a plan level)."""
    if not user.authenticated:
        return "guest"
    if user.plan_level in PAID_LEVELS:
        return user.plan_level
    return "vip" if str(user.tier).upper() == "VIP" else "free"


def vip_drafts_allowed(user: "CurrentUser") -> bool:
    """Ruling / indictment drafts: pro, premium and legacy VIP. Basic gets the standard drafts only."""
    return user_level(user) in ("pro", "premium", "team", "vip")


def _daily_limit_for(level: str) -> int:
    return {
        "guest": chat_anon_daily_limit, "free": chat_free_daily_limit, "basic": chat_basic_daily_limit,
        "pro": chat_pro_daily_limit, "premium": chat_premium_daily_limit, "team": chat_team_daily_limit, "vip": chat_vip_daily_limit,
    }[level]()


# Synthetic monitor bypass: the X-Roxira-Monitor header matched against MONITOR_BYPASS_TOKEN
# (constant-time) skips ONLY the daily guest/free quota so monitoring probes never trip the
# guest cap. The feature is off unless the token is at least 32 chars. Never log either value.
MONITOR_BYPASS_HEADER = "x-roxira-monitor"
MONITOR_BYPASS_MIN_LEN = 32


def monitor_bypass_token(env_token: Optional[str] = None) -> str:
    """Configured MONITOR_BYPASS_TOKEN, or "" when the feature is off (unset or too short)."""
    token = os.environ.get("MONITOR_BYPASS_TOKEN", "") if env_token is None else env_token
    return token if len(token) >= MONITOR_BYPASS_MIN_LEN else ""


def monitor_token_ok(header_value: Optional[str], env_token: Optional[str] = None) -> bool:
    """Constant-time comparison of an ``X-Roxira-Monitor`` value against the bypass token."""
    token = monitor_bypass_token(env_token)
    if not token or not header_value:
        return False
    return hmac.compare_digest(str(header_value), token)


def monitor_request(request: Any) -> bool:
    """True when ``request`` carries a valid X-Roxira-Monitor bypass token."""
    headers = getattr(request, "headers", None) if request is not None else None
    if headers is None:
        return False
    return monitor_token_ok(headers.get(MONITOR_BYPASS_HEADER))


def daily_chat_key(user: "CurrentUser", ip: str) -> tuple[str, int, str]:
    """(redis key, limit, kind) for the 24 h answered-question counter.

    kind is guest / free / basic / pro / premium / team / vip (vip = legacy VIP without a level)."""
    if is_phone_gateway(user):
        # the phone line has its own budget, separate from every web user's VIP counter
        return f"rl:chat-day:phone:{PHONE_GATEWAY_ID}", phone_gateway_daily_limit(), "vip"
    level = user_level(user)
    if level == "guest":
        return f"rl:chat-day:guest:{ip}", chat_anon_daily_limit(), "guest"
    return f"rl:chat-day:{level}:{user.phone or ''}", _daily_limit_for(level), level


def gateway_plan_for(user: "CurrentUser") -> tuple[str, Optional[str]]:
    """Plan name for ``llm_gateway.model_for`` plus the top-model counter key to refund if no
    answer is produced (None when no top-model cap applies).

    team:    first CHAT_TEAM_TOP_DAILY_LIMIT (default 20) answers/day on vip-team, then vip-pro.
    premium: first CHAT_PREMIUM_TOP_DAILY_LIMIT (default 8) answers/day on vip-premium, then vip-pro.
    pro:     first SJ_PRO_TOP_DAILY answers/day on vip-pro, then vip-product (basic group).
    Other levels map straight to their own group; legacy VIP keeps "VIP"."""
    level = user_level(user)
    if level in ("team", "premium", "pro"):
        cap = {"team": team_top_daily, "premium": premium_top_daily, "pro": pro_top_daily}[level]()
        key = f"rl:top-day:{level}:{user.phone or ''}"
        count, _ = incr(key, DAY_SECONDS)
        if count <= cap:
            return level, key
        decr(key)
        return ("pro" if level in ("premium", "team") else "basic"), None
    if level in ("basic",):
        return "basic", None
    return ("VIP" if level == "vip" else "FREE"), None


MSG_PREMIUM_TOP_EXHAUSTED = "سهمیهٔ امروز مدل برتر تمام شد؛ پاسخ با مدل حرفه‌ای"


def top_quota_note(user: "CurrentUser", gateway_plan: str) -> Optional[str]:
    """Persian note for the response metadata when a premium user's answer was routed to the
    pro group because the daily top-model quota is used up (None otherwise)."""
    if user_level(user) in ("premium", "team") and gateway_plan == "pro":
        return MSG_PREMIUM_TOP_EXHAUSTED
    return None


def count_daily_chat(key: str, limit: int) -> tuple[bool, int]:
    """Count one answered question in a fixed 24 h window. Returns (allowed, retry_after_s)."""
    count, left = incr(key, DAY_SECONDS)
    return (count <= limit), left


MSG_UPGRADE_FREE = (
    "سقف پرسش‌های رایگان امروز شما تمام شد. برای ادامهٔ گفتگو و دسترسی به مدل‌های قوی‌تر، "
    "اشتراک ویژه تهیه کنید یا فردا دوباره تلاش کنید."
)
MSG_UPGRADE_GUEST = (
    "سقف پرسش‌های رایگان امروز شما به‌عنوان مهمان تمام شد. برای ادامه ابتدا وارد حساب کاربری شوید "
    "یا اشتراک ویژه تهیه کنید."
)
MSG_UPGRADE_BASIC = (
    "سقف پرسش‌های روزانهٔ اشتراک پایه شما تمام شد. برای پرسش‌های بیشتر و مدل‌های قوی‌تر "
    "به اشتراک حرفه‌ای ارتقا دهید یا فردا دوباره تلاش کنید."
)
MSG_UPGRADE_PRO = (
    "سقف پرسش‌های روزانهٔ اشتراک حرفه‌ای شما تمام شد. برای پرسش‌های بیشتر و بهترین مدل‌های دنیا "
    "به اشتراک ویژه ارتقا دهید یا فردا دوباره تلاش کنید."
)
MSG_DAILY_FAIR_USE = "سقف استفادهٔ منصفانهٔ روزانهٔ شما تمام شد. لطفاً فردا دوباره تلاش کنید."
NEXT_PLAN = {"basic": "SJ_PRO_MONTHLY", "pro": "SJ_PREMIUM_MONTHLY"}


def daily_limit_response(kind: str, retry_after: int, *, label: str = "ERROR") -> JSONResponse:
    retry_after = max(1, int(retry_after))
    if kind in ("vip", "premium", "team"):
        return error_json(429, MSG_DAILY_FAIR_USE, code="DAILY_LIMIT", label=label,
                          headers={"Retry-After": str(retry_after)}, retry_after=retry_after)
    guest = kind == "guest"
    message = {"guest": MSG_UPGRADE_GUEST, "basic": MSG_UPGRADE_BASIC, "pro": MSG_UPGRADE_PRO}.get(kind, MSG_UPGRADE_FREE)
    extra = {"next_plan": NEXT_PLAN[kind]} if kind in NEXT_PLAN else {}
    return error_json(
        429, message,
        code="LOGIN_OR_UPGRADE" if guest else "UPGRADE_REQUIRED", label=label,
        headers={"Retry-After": str(retry_after)}, retry_after=retry_after,
        plans_url="/plans", upsell=True, **extra,
    )


def deny_if_invalid(user: CurrentUser, *, label: str = "error") -> Optional[JSONResponse]:
    return unauthorized(user, label=label) if user.token_invalid else None


def require_auth(user: CurrentUser, *, label: str = "error") -> Optional[JSONResponse]:
    return None if user.authenticated else unauthorized(user, label=label)


def check_limit(scope: str, key: str, limit: int) -> tuple[bool, int]:
    """Count one event in an hourly window. Returns (allowed, retry_after_seconds)."""
    count, left = incr(f"rl:{scope}:{key}", HOUR_SECONDS)
    return (count <= limit), left


async def acheck_limit(scope: str, key: str, limit: int) -> tuple[bool, int]:
    return await asyncio.to_thread(check_limit, scope, key, limit)


# Payment status polling (/payments/verify, crypto status): callable by track id
# without a login, so it is capped per IP and per track id.
PAY_VERIFY_IP_PER_MIN = 30
PAY_VERIFY_IP_PER_HOUR = 300
PAY_VERIFY_TRACK_PER_MIN = 10
_PAY_RATE_MESSAGE = "تعداد درخواست‌های بررسی پرداخت زیاد است؛ لطفاً کمی بعد دوباره تلاش کنید."


def gate_payment_status(request: Any, track_id: Optional[str]) -> Optional[JSONResponse]:
    """429 (Persian message + Retry-After) when an IP or a track id polls too often."""
    checks = [
        (f"rl:payverify-ip-min:{request_ip(request)}", 60, PAY_VERIFY_IP_PER_MIN),
        (f"rl:payverify-ip-hour:{request_ip(request)}", HOUR_SECONDS, PAY_VERIFY_IP_PER_HOUR),
    ]
    if track_id:
        checks.append((f"rl:payverify-track:{str(track_id)[:80]}", 60, PAY_VERIFY_TRACK_PER_MIN))
    worst = 0
    for key, window, limit in checks:
        count, left = incr(key, window)
        if count > limit:
            worst = max(worst, left)
    if not worst:
        return None
    return JSONResponse(status_code=429, headers={"Retry-After": str(worst)},
                        content={"status": "RATE_LIMITED", "message": _PAY_RATE_MESSAGE,
                                 "retry_after": worst})


def gate_voice(request: Any, user: CurrentUser) -> Optional[JSONResponse]:
    """401 on a bad token; per-IP (anonymous) or per-user hourly cap on voice endpoints."""
    denied = deny_if_invalid(user)
    if denied is not None:
        return denied
    if user.authenticated:
        ok, left = check_limit("voice-user", user.phone or "", voice_auth_hourly_limit())
        return None if ok else rate_limited(left)
    ok, left = check_limit("voice-anon", request_ip(request), voice_anon_hourly_limit())
    return None if ok else rate_limited(left, anonymous=True)


async def gate_voice_ws(websocket: Any) -> bool:
    """Same policy for the live-voice WebSocket. Returns False after rejecting.

    The token comes from ``?token=`` (browsers cannot set WS headers). A rejection is
    sent as a JSON frame, then the socket is closed with 4401 / 4429.
    """
    # the tier lookup may touch Postgres: keep it off the event loop
    user = await asyncio.to_thread(authenticate, websocket.headers, websocket.query_params)
    reject: Optional[tuple[int, str, str]] = None
    if user.token_invalid:
        reject = (4401, MSG_TOKEN_INVALID, "TOKEN_INVALID")
    else:
        if user.authenticated:
            ok, left = await acheck_limit("voice-user", user.phone or "", voice_auth_hourly_limit())
        else:
            ok, left = await acheck_limit("voice-anon", client_ip(websocket.headers, getattr(websocket.client, "host", None)),
                                   voice_anon_hourly_limit())
        if not ok:
            reject = (4429, rate_limited_message(left, anonymous=not user.authenticated), "RATE_LIMITED")
    if reject is None:
        try:
            if hasattr(websocket, "state"):
                websocket.state.user = user
        except Exception:
            pass
        return True
    close_code, message, code = reject
    await websocket.accept()
    await websocket.send_text(json.dumps(
        {"type": "ERROR", "status": "error", "code": code, "message": message}, ensure_ascii=False))
    await websocket.close(code=close_code)
    return False


def voice_ws_user(headers: Mapping[str, str], query_params: Optional[Mapping[str, str]] = None) -> CurrentUser:
    """Resolve CurrentUser for WebSocket connections via headers or ?token= query parameter."""
    return authenticate(headers, query_params)



# ---------------------------------------------------------------------------
# Idempotent replay of chat answers (flaky mobile links)
# ---------------------------------------------------------------------------
# A client sends a UUID v4 ``request_id`` (body) or ``Idempotency-Key`` (header). The final
# successful body is cached for IDEM_TTL_SECONDS under sha256(request_id | identity | message);
# a retry after a dropped connection gets the cached body instead of a second LLM call.
IDEM_TTL_SECONDS = 600
IDEM_LOCK_SECONDS = 120
IDEM_WAIT_SECONDS = 90.0
IDEM_POLL_SECONDS = 0.5
IDEM_MAX_ENTRIES = 500
_UUID4_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_idem_keys: "OrderedDict[str, bool]" = OrderedDict()  # LRU of result keys we wrote (bounds memory)


def valid_request_id(value: Any) -> Optional[str]:
    """Lower-cased UUID v4 (max 64 chars) or None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value.lower() if len(value) <= 64 and _UUID4_RE.match(value) else None


def extract_request_id(payload: Any, headers: Optional[Mapping[str, str]]) -> Optional[str]:
    """Body ``request_id`` first, then ``Idempotency-Key``; invalid values are ignored."""
    rid = valid_request_id(payload.get("request_id")) if isinstance(payload, dict) else None
    if rid is None and headers is not None:
        rid = valid_request_id(headers.get("idempotency-key"))
    return rid


def idem_keys(request_id: str, identity: str, message: str) -> tuple[str, str]:
    """(result_key, lock_key). The identity is hashed in: phones never appear in key names."""
    digest = hashlib.sha256(f"{request_id}|{identity}|{message}".encode("utf-8")).hexdigest()[:40]
    return f"idem:res:{digest}", f"idem:lock:{digest}"


def idem_get(result_key: str) -> Any:
    return kv_get(result_key)


def idem_store(result_key: str, body: Any) -> None:
    kv_set(result_key, body, IDEM_TTL_SECONDS)
    evicted = []
    with _mem_lock:
        _idem_keys[result_key] = True
        _idem_keys.move_to_end(result_key)
        while len(_idem_keys) > IDEM_MAX_ENTRIES:
            old, _ = _idem_keys.popitem(last=False)
            evicted.append(old)
    for old in evicted:
        kv_delete(old)


def idem_claim(lock_key: str) -> bool:
    return set_nx(lock_key, IDEM_LOCK_SECONDS)


def idem_release(lock_key: str) -> None:
    kv_delete(lock_key)


# ---------------------------------------------------------------------------
# Async wrappers: run the (possibly blocking Redis) store calls off the event loop
# ---------------------------------------------------------------------------
async def agate_voice(request: Any, user: CurrentUser) -> Optional[JSONResponse]:
    return await asyncio.to_thread(gate_voice, request, user)


async def aincr(key: str, window_s: int) -> tuple[int, int]:
    return await asyncio.to_thread(incr, key, window_s)


async def attl(key: str) -> int:
    return await asyncio.to_thread(ttl, key)


async def aset_nx(key: str, ttl_s: int) -> bool:
    return await asyncio.to_thread(set_nx, key, ttl_s)


async def akv_set(key: str, value: Any, ttl_s: int) -> None:
    await asyncio.to_thread(kv_set, key, value, ttl_s)


async def akv_get(key: str) -> Any:
    return await asyncio.to_thread(kv_get, key)


async def akv_delete(*keys: str) -> None:
    await asyncio.to_thread(kv_delete, *keys)


async def aidem_get(result_key: str) -> Any:
    return await asyncio.to_thread(idem_get, result_key)


async def aidem_store(result_key: str, body: Any) -> None:
    await asyncio.to_thread(idem_store, result_key, body)


async def aidem_claim(lock_key: str) -> bool:
    return await asyncio.to_thread(idem_claim, lock_key)


async def aidem_release(lock_key: str) -> None:
    await asyncio.to_thread(idem_release, lock_key)
