"""Persistent account, subscription and token-wallet models for the Roxira platform.

This module is the single source of truth for:

* ``User``         - a platform account (phone identity + hashed password + role).
* ``Subscription`` - the plan tier of a user and when it expires.
* ``TokenWallet``  - the pre-paid Toman balance and the remaining token quota.

It also ships the quota primitives consumed by the unified server middleware:

* :func:`estimate_token_cost` - a dynamic, per-request token cost estimate.
* :class:`AuthQuotaService`   - tier resolution, token-bucket rate limiting and
  quota deduction, backed by the database with a safe in-memory fallback.

The database layer is optional at runtime: if the engine cannot be created or the
schema cannot be created, the service transparently degrades to an in-memory store
so that the middleware never takes the HTTP server down.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional, Tuple

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

__all__ = [
    "AUTH_DB_URL",
    "AUTH_ENABLED",
    "ANONYMOUS_IDENTITY",
    "Base",
    "CURRENCY_HEDGING_AVAILABLE",
    "DEFAULT_PLAN_TIER",
    "PLAN_LIMITS",
    "PATH_COST_PROFILES",
    "Subscription",
    "TokenWallet",
    "User",
    "AuthQuotaService",
    "auth_quota_service",
    "build_currency_pricer",
    "calculate_token_toman_price",
    "TOPUP_PACKAGES",
    "amount_for_tokens",
    "close_auth_db",
    "estimate_token_cost",
    "package_offer",
    "resolve_topup_package",
    "tokens_for_amount",
    "wallet_router",
    "hash_password",
    "init_auth_db",
    "is_subscription_active",
    "normalize_tier",
    "path_cost_multiplier",
    "tier_limits",
    "verify_password",
]

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# sqlite+aiosqlite keeps the module usable in dev/CI without a Postgres server;
# production sets ROXIRA_AUTH_DB_URL to the async Postgres DSN.
AUTH_DB_URL = (
    os.environ.get("ROXIRA_AUTH_DB_URL")
    or os.environ.get("AUTH_DATABASE_URL")
    or "sqlite+aiosqlite:///./roxira_auth.db"
)
AUTH_ENABLED = os.environ.get("ROXIRA_AUTH_ENFORCE", "1") != "0"

ANONYMOUS_IDENTITY = "anonymous"
DEFAULT_PLAN_TIER = os.environ.get("ROXIRA_DEFAULT_PLAN_TIER", "FREE")

# Dynamic limits per plan tier: higher tiers get a bigger token bucket plus a
# larger token quota. Overridable per-tier with env vars, e.g.
# ROXIRA_RPM_VIP=900 / ROXIRA_QUOTA_VIP=2000000
PLAN_LIMITS: Dict[str, Dict[str, Any]] = {
    "ANONYMOUS": {"rpm": 120, "burst": 40, "token_quota": 100_000, "cost_multiplier": 1.0},
    "FREE": {"rpm": 60, "burst": 20, "token_quota": 50_000, "cost_multiplier": 1.0},
    "PRO": {"rpm": 240, "burst": 60, "token_quota": 500_000, "cost_multiplier": 1.1},
    "VIP": {"rpm": 600, "burst": 150, "token_quota": 2_000_000, "cost_multiplier": 1.25},
    "ENTERPRISE": {"rpm": 1_200, "burst": 300, "token_quota": 10_000_000, "cost_multiplier": 1.5},
}

# Long-form subscriptions seen in the SmartJudge JWT map onto the buckets above.
TIER_ALIASES: Dict[str, str] = {
    "VIP_MONTHLY": "VIP",
    "VIP_MONTHLY_PRO": "VIP",
    "VIP_UNLIMITED": "VIP",
    "PREMIUM": "VIP",
    "TIER2": "PRO",
    "TIER3": "ENTERPRISE",
    "PLUS": "PRO",
}

# LLM routes reserve completion tokens; static assets, marketing pages and health
# checks are free (0.0 -> the middleware skips quota deduction entirely).
PATH_COST_PROFILES: Tuple[Tuple[str, float], ...] = (
    (r"^/(static|assets|favicon)", 0.0),
    (r"^/(health|robots\.txt|sitemap\.xml|docs|openapi\.json|redoc)", 0.0),
    (r"^/api/v1/apps/judge/(chat|chat-stream|consult|live-voice|speak|transcribe-audio)", 2.5),
    (r"^/api/v1/apps/judge/", 1.5),
    (r"^/(mcp|api/v1/factory|api/v1/enterprise)/", 1.25),
    (r"^/api/", 1.0),
    (r"^/", 0.0),  # landing pages / portal HTML: rate limited but never billed
)

_BASE_PROMPT_OVERHEAD_TOKENS = int(os.environ.get("ROXIRA_TOKEN_OVERHEAD", "64"))
_CHARS_PER_TOKEN = 4.0


def _apply_env_limit_overrides() -> None:
    """Allow operators to override the per-tier bucket/quota from the environment."""
    for tier, limits in PLAN_LIMITS.items():
        rpm = os.environ.get(f"ROXIRA_RPM_{tier}")
        burst = os.environ.get(f"ROXIRA_BURST_{tier}")
        quota = os.environ.get(f"ROXIRA_QUOTA_{tier}")
        if rpm and rpm.isdigit():
            limits["rpm"] = int(rpm)
        if burst and burst.isdigit():
            limits["burst"] = int(burst)
        if quota and quota.isdigit():
            limits["token_quota"] = int(quota)


_apply_env_limit_overrides()


# ---------------------------------------------------------------------------
# Currency hedging (USD/Tether cost -> Toman price)
# ---------------------------------------------------------------------------
# Optional at runtime: if the hedging module cannot be imported the platform keeps
# enforcing token quotas, it just cannot convert them into a Toman amount.
try:  # normal package import
    from .currency_hedging import (
        DynamicCurrencyPricer as _DynamicCurrencyPricer,
        calculate_token_toman_price as _calculate_token_toman_price,
        currency_pricer as _currency_pricer,
    )

    CURRENCY_HEDGING_AVAILABLE = True
except Exception:  # noqa: BLE001 - fall back to a path-based import (script mode)
    try:
        import os as _os
        import sys as _sys

        _here = _os.path.dirname(_os.path.abspath(__file__))
        if _here not in _sys.path:
            _sys.path.insert(0, _here)
        from currency_hedging import (  # type: ignore[no-redef]
            DynamicCurrencyPricer as _DynamicCurrencyPricer,
            calculate_token_toman_price as _calculate_token_toman_price,
            currency_pricer as _currency_pricer,
        )

        CURRENCY_HEDGING_AVAILABLE = True
    except Exception as _hedging_exc:  # noqa: BLE001 - pricing is an enhancement
        print(f"[ROXIRA][FX-WARN] currency hedging disabled: {_hedging_exc}", flush=True)
        _DynamicCurrencyPricer = None  # type: ignore[assignment]
        _currency_pricer = None  # type: ignore[assignment]

        def _calculate_token_toman_price(tokens: int, tier: Optional[str] = None) -> int:  # type: ignore[misc]
            """Degraded mode: no FX source -> no Toman conversion available."""
            return 0

        CURRENCY_HEDGING_AVAILABLE = False


def calculate_token_toman_price(tokens: int, tier: Optional[str] = None) -> int:
    """Public re-export: hedged Toman price of ``tokens`` at ``tier`` (0 if no FX)."""
    return _calculate_token_toman_price(tokens, tier)


def build_currency_pricer(**kwargs: Any) -> Any:
    """Build an isolated pricer (tests/tools); ``None`` when hedging is unavailable."""
    if _DynamicCurrencyPricer is None:
        return None
    return _DynamicCurrencyPricer(**kwargs)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    """Declarative base for the Roxira account schema."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """A platform account identified by its phone number."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    phone: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    # Only ever the derived digest - never a plaintext password.
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="user", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    subscription: Mapped[Optional["Subscription"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )
    wallet: Mapped[Optional["TokenWallet"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User id={self.id} phone={self.phone!r} role={self.role!r} active={self.is_active}>"


class Subscription(Base):
    """The plan tier of a user and its expiry."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    plan_tier: Mapped[str] = mapped_column(String(32), nullable=False, default=DEFAULT_PLAN_TIER, index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    user: Mapped["User"] = relationship(back_populates="subscription")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Subscription user_id={self.user_id} tier={self.plan_tier!r} expires_at={self.expires_at}>"


class TokenWallet(Base):
    """Pre-paid Toman balance plus the remaining token quota of a user."""

    __tablename__ = "token_wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    balance_toman: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    token_quota_remaining: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    user: Mapped["User"] = relationship(back_populates="wallet")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"<TokenWallet user_id={self.user_id} balance_toman={self.balance_toman} "
            f"token_quota_remaining={self.token_quota_remaining}>"
        )


# ---------------------------------------------------------------------------
# Password hashing (PBKDF2-HMAC-SHA256, no third-party dependency)
# ---------------------------------------------------------------------------
_PBKDF2_ITERATIONS = int(os.environ.get("ROXIRA_PBKDF2_ITERATIONS", "120000"))


def hash_password(raw_password: str, *, salt: Optional[bytes] = None) -> str:
    """Return ``pbkdf2_sha256$<iterations>$<salt_hex>$<digest_hex>``."""
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", str(raw_password).encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(raw_password: str, hashed_password: str) -> bool:
    """Constant-time verification of a password against a stored digest."""
    try:
        algorithm, iterations, salt_hex, digest_hex = str(hashed_password).split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", str(raw_password).encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Dynamic token-cost estimation
# ---------------------------------------------------------------------------
def normalize_tier(tier: Optional[str]) -> str:
    """Map an arbitrary tier string onto a known plan bucket."""
    key = str(tier or "").strip().upper()
    if not key:
        return DEFAULT_PLAN_TIER if DEFAULT_PLAN_TIER in PLAN_LIMITS else "FREE"
    if key in PLAN_LIMITS:
        return key
    if key in TIER_ALIASES:
        return TIER_ALIASES[key]
    return "FREE"


def path_cost_multiplier(path: str) -> float:
    """Cost profile for a request path (LLM routes reserve more than static assets)."""
    for pattern, multiplier in PATH_COST_PROFILES:
        if re.match(pattern, path or ""):
            return multiplier
    return 1.0


def estimate_token_cost(payload_bytes: int, tier: str = "FREE", path: str = "") -> int:
    """Estimate the token cost of a request before it runs.

    The estimate is dynamic: it scales with the request body size (~4 chars per
    token), the tier's cost multiplier and the path profile (chat/voice routes
    reserve completion tokens so a long answer cannot overshoot the quota).
    Requests whose profile is ``0.0`` (static assets, health checks) are free.
    """
    multiplier = path_cost_multiplier(path)
    if multiplier <= 0.0:
        return 0
    plan = PLAN_LIMITS.get(normalize_tier(tier), PLAN_LIMITS["FREE"])
    prompt_tokens = _BASE_PROMPT_OVERHEAD_TOKENS + math.ceil(
        max(0, int(payload_bytes or 0)) / _CHARS_PER_TOKEN
    )
    cost = math.ceil(prompt_tokens * float(plan.get("cost_multiplier", 1.0)) * multiplier)
    return max(1, int(cost))


def tier_limits(tier: str) -> Dict[str, Any]:
    """Bucket/quota configuration for a tier."""
    return PLAN_LIMITS.get(normalize_tier(tier), PLAN_LIMITS["FREE"])


def is_subscription_active(subscription: Optional[Subscription]) -> bool:
    """An active subscription is one with no expiry or an expiry in the future."""
    if subscription is None:
        return False
    expires_at = subscription.expires_at
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > _utcnow()


# ---------------------------------------------------------------------------
# Database bootstrap
# ---------------------------------------------------------------------------
_engine = None
_sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None
_db_failed = False
_db_lock = threading.Lock()


def _mark_db_failed() -> None:
    """Flip the process-wide flag so later requests skip the database entirely."""
    global _db_failed
    _db_failed = True


def get_engine():
    """Lazily build the async engine (``None`` when the driver is unavailable)."""
    global _engine, _sessionmaker
    if _engine is not None:
        return _engine
    with _db_lock:
        if _engine is None:
            _engine = create_async_engine(AUTH_DB_URL, echo=False, future=True, pool_pre_ping=True)
            _sessionmaker = async_sessionmaker(bind=_engine, class_=AsyncSession, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def init_auth_db() -> bool:
    """Create the account schema; ``False`` when the database is unreachable."""
    global _db_failed
    try:
        engine = get_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        _db_failed = False
        return True
    except Exception as exc:  # noqa: BLE001 - degrade instead of crashing the server
        _db_failed = True
        print(f"[ROXIRA][AUTH-DB-WARN] schema init failed, memory fallback active: {exc}", flush=True)
        return False


async def close_auth_db() -> bool:
    """Dispose the async engine and drop the pooled connections (shutdown/tests)."""
    global _engine, _sessionmaker
    engine = _engine
    if engine is None:
        return False
    try:
        await engine.dispose()
        return True
    except Exception as exc:  # noqa: BLE001 - shutdown must not raise
        print(f"[ROXIRA][AUTH-DB-WARN] engine dispose failed: {exc}", flush=True)
        return False
    finally:
        with _db_lock:
            _engine = None
            _sessionmaker = None


# ---------------------------------------------------------------------------
# Quota + rate-limit service
# ---------------------------------------------------------------------------
class _TokenBucket:
    """Token bucket: ``burst`` capacity refilled at ``rpm / 60`` tokens/second."""

    __slots__ = ("tokens", "updated_at", "capacity", "refill_per_second")

    def __init__(self, capacity: int, refill_per_second: float) -> None:
        self.capacity = float(capacity)
        self.refill_per_second = float(refill_per_second)
        self.tokens = float(capacity)
        self.updated_at = time.monotonic()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = max(0.0, now - self.updated_at)
        if elapsed:
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_second)
            self.updated_at = now

    def consume(self, amount: float = 1.0) -> Optional[float]:
        """Consume one unit; returns seconds-to-wait when the bucket is empty."""
        self._refill()
        if self.tokens >= amount:
            self.tokens -= amount
            return None
        deficit = amount - self.tokens
        if self.refill_per_second <= 0:
            return 60.0
        return round(deficit / self.refill_per_second, 3)


class AuthQuotaService:
    """Resolve a caller's tier/quota and enforce rate limits + token deduction.

    Quota decisions are served from an in-process cache (fast, and safe for
    real-time voice routes); persistence to :class:`TokenWallet` is best-effort
    and silently skipped when the database is unavailable.
    """

    def __init__(self, db_url: Optional[str] = None, *, cache_ttl: float = 15.0) -> None:
        self._db_url = db_url or AUTH_DB_URL
        self._cache_ttl = float(os.environ.get("ROXIRA_QUOTA_CACHE_TTL", cache_ttl))
        self._buckets: Dict[str, _TokenBucket] = {}
        self._quota: Dict[str, int] = {}
        self._tier: Dict[str, str] = {}
        self._loaded_at: Dict[str, float] = {}
        self._hits: Deque[float] = deque(maxlen=10000)  # rolling global request log
        self._lock = threading.Lock()
        self.stats: Dict[str, int] = {
            "allowed": 0,
            "rate_limited": 0,
            "quota_rejected": 0,
            "deducted_tokens": 0,
            "toman_charged": 0,
            "tokens_topped_up": 0,
            "toman_topped_up": 0,
        }

    # ---- currency hedging (USD/Tether cost -> Toman price) ----------------
    def price_tokens(self, tokens: int, tier: Optional[str] = None) -> int:
        """Toman price of ``tokens`` at ``tier`` (0 when FX is unavailable)."""
        if _currency_pricer is None:
            return 0
        try:
            return int(
                _currency_pricer.calculate_token_toman_price(
                    tokens, normalize_tier(tier or DEFAULT_PLAN_TIER)
                )
            )
        except Exception as exc:  # noqa: BLE001 - pricing must never break enforcement
            print(f"[ROXIRA][FX-WARN] token pricing failed: {exc}", flush=True)
            return 0

    def price_quote(self, tokens: int, tier: Optional[str] = None, *, refresh: bool = False) -> Dict[str, Any]:
        """Full hedged pricing breakdown (rate, margin, buffer, Toman amount)."""
        if _currency_pricer is None:
            return {
                "tokens": max(0, int(tokens or 0)),
                "tier": normalize_tier(tier or DEFAULT_PLAN_TIER),
                "toman_amount": 0,
                "currency_hedging_available": False,
            }
        try:
            quote = dict(
                _currency_pricer.quote(int(tokens or 0), normalize_tier(tier or DEFAULT_PLAN_TIER), refresh=refresh)
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[ROXIRA][FX-WARN] quote failed: {exc}", flush=True)
            return {"tokens": max(0, int(tokens or 0)), "toman_amount": 0, "error": str(exc)}
        quote["currency_hedging_available"] = True
        return quote

    def pricing_table(self, tiers: Optional[Tuple[str, ...]] = None) -> Dict[str, Dict[str, Any]]:
        """Toman price of 1k tokens per tier (pricing pages, invoices, ops)."""
        if _currency_pricer is None:
            return {}
        try:
            return _currency_pricer.pricing_table(list(tiers) if tiers else list(PLAN_LIMITS))
        except Exception as exc:  # noqa: BLE001
            print(f"[ROXIRA][FX-WARN] pricing table failed: {exc}", flush=True)
            return {}

    def fx_snapshot(self) -> Dict[str, Any]:
        """Live Tether -> Toman rate block (safe to publish on a health route)."""
        if _currency_pricer is None:
            return {"available": False}
        try:
            payload = dict(_currency_pricer.snapshot())
            payload["available"] = True
            return payload
        except Exception as exc:  # noqa: BLE001
            return {"available": False, "error": str(exc)}

    def refresh_fx_rate(self, force: bool = False) -> Dict[str, Any]:
        """Refresh the hedged rate on demand (network call, use off the hot path)."""
        if _currency_pricer is None:
            return {"available": False}
        try:
            return dict(_currency_pricer.refresh(force=force))
        except Exception as exc:  # noqa: BLE001
            return {"available": False, "error": str(exc)}

    async def _debit_wallet(self, identity: str, toman: int) -> bool:
        """Best-effort debit of the pre-paid Toman balance; never raises."""
        if _db_failed or toman <= 0 or not str(identity).isdigit():
            return False
        try:
            session_factory = get_sessionmaker()
            async with session_factory() as session:
                result = await session.execute(
                    select(TokenWallet).where(TokenWallet.user_id == int(identity)).limit(1)
                )
                wallet = result.scalar_one_or_none()
                if wallet is None:
                    return False
                wallet.balance_toman = max(0, int(wallet.balance_toman or 0) - int(toman))
                wallet.updated_at = _utcnow()
                await session.commit()
            return True
        except Exception as exc:  # noqa: BLE001 - accounting must never break a response
            _mark_db_failed()
            print(f"[ROXIRA][AUTH-DB-WARN] wallet debit failed: {exc}", flush=True)
            return False

    async def charge_tokens(
        self, identity: str, cost: int, tier: Optional[str] = None
    ) -> Dict[str, Any]:
        """Deduct tokens *and* return the hedged Toman value of the request.

        This is the money-facing counterpart of :meth:`consume`: the token quota
        is enforced in-process (immediately) while the Toman accounting is
        best-effort, so a slow database can never stall an LLM response.
        """
        key = str(identity or ANONYMOUS_IDENTITY)
        resolved_tier = normalize_tier(tier) if tier else (self._tier.get(key) or self.internal_tier(key))
        tokens = max(0, int(cost or 0))
        remaining = self.consume(key, tokens)
        toman = self.price_tokens(tokens, resolved_tier)
        if toman:
            with self._lock:
                self.stats["toman_charged"] += int(toman)
        debited = await self._debit_wallet(key, toman)
        return {
            "identity": key,
            "tier": resolved_tier,
            "tokens": tokens,
            "remaining_tokens": remaining,
            "toman_charged": toman,
            "wallet_debited": debited,
            "exchange_rate_toman": (
                _currency_pricer.effective_rate_toman if _currency_pricer is not None else None
            ),
        }

    # ---- identity helpers -------------------------------------------------
    @staticmethod
    def bucket_for(tier: str) -> _TokenBucket:
        limits = tier_limits(tier)
        rpm = max(1, int(limits["rpm"]))
        return _TokenBucket(capacity=int(limits["burst"]), refill_per_second=rpm / 60.0)

    def internal_tier(self, identity: str) -> str:
        """Tier used for anonymous callers (no account attached)."""
        key = str(identity or "")
        if key == ANONYMOUS_IDENTITY or key.startswith("anon:"):
            return "ANONYMOUS"
        return DEFAULT_PLAN_TIER

    # ---- rate limiting ----------------------------------------------------
    def check_rate(self, identity: str, tier: str) -> Optional[float]:
        """Return ``retry_after`` seconds when the caller is over its bucket."""
        limits = tier_limits(tier)
        with self._lock:
            bucket = self._buckets.get(identity)
            if bucket is None or bucket.capacity != float(limits["burst"]):
                bucket = self.bucket_for(tier)
                self._buckets[identity] = bucket
            self._hits.append(time.monotonic())
            return bucket.consume(1.0)

    def global_rpm(self) -> int:
        """Requests observed in the last 60 seconds (operational visibility)."""
        cutoff = time.monotonic() - 60.0
        with self._lock:
            while self._hits and self._hits[0] < cutoff:
                self._hits.popleft()
            return len(self._hits)

    # ---- quota ------------------------------------------------------------
    async def _load_from_db(self, identity: str) -> Optional[Tuple[str, int]]:
        """Read (tier, remaining quota) from the database; ``None`` on failure."""
        if _db_failed or not str(identity).isdigit():
            return None
        try:
            session_factory = get_sessionmaker()
            async with session_factory() as session:
                result = await session.execute(select(User).where(User.id == int(identity)).limit(1))
                user = result.scalar_one_or_none()
                if user is None:
                    return None
                tier = (
                    user.subscription.plan_tier
                    if is_subscription_active(user.subscription)
                    else DEFAULT_PLAN_TIER
                )
                if user.wallet is None:
                    return (normalize_tier(tier), int(tier_limits(tier)["token_quota"]))
                return (normalize_tier(tier), int(user.wallet.token_quota_remaining))
        except Exception as exc:  # noqa: BLE001 - memory fallback
            _mark_db_failed()
            print(f"[ROXIRA][AUTH-DB-WARN] quota lookup failed: {exc}", flush=True)
            return None

    async def resolve(self, identity: str, tier_hint: Optional[str] = None) -> Tuple[str, int]:
        """Return ``(tier, token_quota_remaining)`` for an identity (cached)."""
        identity = str(identity or ANONYMOUS_IDENTITY)
        now = time.monotonic()
        with self._lock:
            cached_tier = self._tier.get(identity)
            cached_quota = self._quota.get(identity)
            fresh = (now - self._loaded_at.get(identity, 0.0)) < self._cache_ttl
        if cached_tier is not None and cached_quota is not None and fresh:
            return cached_tier, cached_quota

        tier = normalize_tier(tier_hint) if tier_hint else None
        remaining = None
        from_db = await self._load_from_db(identity)
        if from_db is not None:
            db_tier, db_remaining = from_db
            tier = tier or db_tier
            remaining = db_remaining
        if tier is None:
            tier = self.internal_tier(identity)
        if remaining is None:
            remaining = int(tier_limits(tier)["token_quota"])

        with self._lock:
            self._tier[identity] = tier
            self._quota[identity] = int(remaining)
            self._loaded_at[identity] = now
        return tier, int(remaining)

    def remaining(self, identity: str) -> Optional[int]:
        with self._lock:
            return self._quota.get(str(identity or ANONYMOUS_IDENTITY))

    def consume(self, identity: str, cost: int) -> int:
        """Deduct ``cost`` tokens; returns the remaining quota (never below 0)."""
        key = str(identity or ANONYMOUS_IDENTITY)
        cost = max(0, int(cost))
        with self._lock:
            if key not in self._quota:
                tier = self._tier.get(key) or self.internal_tier(key)
                self._quota[key] = int(tier_limits(tier)["token_quota"])
            self._quota[key] = max(0, self._quota[key] - cost)
            self.stats["deducted_tokens"] += cost
            return self._quota[key]

    def seed(self, identity: str, quota: int, tier: Optional[str] = None) -> None:
        """Prime the in-memory cache (used by provisioning and tests)."""
        key = str(identity)
        with self._lock:
            if tier:
                self._tier[key] = normalize_tier(tier)
            self._quota[key] = max(0, int(quota))
            self._loaded_at[key] = time.monotonic()

    async def persist(self, identity: str, remaining: int) -> bool:
        """Best-effort write-through of the remaining quota to ``token_wallets``."""
        if _db_failed or not str(identity).isdigit():
            return False
        try:
            session_factory = get_sessionmaker()
            async with session_factory() as session:
                result = await session.execute(
                    select(TokenWallet).where(TokenWallet.user_id == int(identity)).limit(1)
                )
                wallet = result.scalar_one_or_none()
                if wallet is None:
                    wallet = TokenWallet(
                        user_id=int(identity), token_quota_remaining=int(remaining)
                    )
                    session.add(wallet)
                else:
                    wallet.token_quota_remaining = int(remaining)
                    wallet.updated_at = _utcnow()
                await session.commit()
            return True
        except Exception as exc:  # noqa: BLE001 - persistence must never break a response
            print(f"[ROXIRA][AUTH-DB-WARN] quota persist failed: {exc}", flush=True)
            return False

    # ---- wallet credit (top-up) -------------------------------------------
    async def wallet_state(self, identity: str) -> Dict[str, Any]:
        """Live wallet view for an identity (DB first, in-memory fallback)."""
        key = str(identity or ANONYMOUS_IDENTITY)
        tier, remaining = await self.resolve(key)
        balance = 0
        has_row = False
        if not _db_failed and key.isdigit():
            try:
                session_factory = get_sessionmaker()
                async with session_factory() as session:
                    result = await session.execute(
                        select(TokenWallet).where(TokenWallet.user_id == int(key)).limit(1)
                    )
                    wallet = result.scalar_one_or_none()
                    if wallet is not None:
                        balance = int(wallet.balance_toman or 0)
                        remaining = int(wallet.token_quota_remaining)
                        has_row = True
                        with self._lock:
                            self._quota[key] = remaining
                            self._loaded_at[key] = time.monotonic()
            except Exception as exc:  # noqa: BLE001 - read-only view, degrade to memory
                _mark_db_failed()
                print(f"[ROXIRA][AUTH-DB-WARN] wallet read failed: {exc}", flush=True)
        return {
            "identity": key,
            "tier": tier,
            "balance_toman": balance,
            "token_quota_remaining": int(remaining),
            "tokens_per_1k_toman": self.price_tokens(1_000, tier),
            "db_backed": has_row,
        }

    async def credit_wallet(
        self, identity: str, tokens: int, amount_toman: int = 0, tier: Optional[str] = None
    ) -> Dict[str, Any]:
        """Top up a wallet and reflect it in the live quota **immediately**.

        The in-process quota cache is the enforcement source of truth, so a
        successful top-up primes it right away - no restart and no cache TTL wait.
        """
        key = str(identity or ANONYMOUS_IDENTITY)
        tokens = max(0, int(tokens or 0))
        amount_toman = max(0, int(amount_toman or 0))
        resolved_tier = normalize_tier(tier) if tier else (self._tier.get(key) or self.internal_tier(key))
        current = self.remaining(key)
        if current is None:
            _, current = await self.resolve(key, resolved_tier)
        new_remaining = int(current) + tokens
        new_balance = amount_toman
        persisted = False

        if not _db_failed and key.isdigit():
            try:
                session_factory = get_sessionmaker()
                async with session_factory() as session:
                    result = await session.execute(
                        select(TokenWallet).where(TokenWallet.user_id == int(key)).limit(1)
                    )
                    wallet = result.scalar_one_or_none()
                    if wallet is None:
                        wallet = TokenWallet(
                            user_id=int(key),
                            balance_toman=amount_toman,
                            token_quota_remaining=tokens,
                        )
                        session.add(wallet)
                        new_balance = amount_toman
                        new_remaining = tokens
                    else:
                        wallet.balance_toman = int(wallet.balance_toman or 0) + amount_toman
                        wallet.token_quota_remaining = int(wallet.token_quota_remaining or 0) + tokens
                        wallet.updated_at = _utcnow()
                        new_balance = int(wallet.balance_toman)
                        new_remaining = int(wallet.token_quota_remaining)
                    await session.commit()
                    persisted = True
            except Exception as exc:  # noqa: BLE001 - credit the in-memory ledger at least
                _mark_db_failed()
                print(f"[ROXIRA][AUTH-DB-WARN] wallet top-up failed: {exc}", flush=True)

        # Instant reflection: prime tier + quota in the live cache.
        self.seed(key, new_remaining, tier=resolved_tier)
        with self._lock:
            if amount_toman:
                self.stats["toman_topped_up"] = self.stats.get("toman_topped_up", 0) + amount_toman
            self.stats["tokens_topped_up"] = self.stats.get("tokens_topped_up", 0) + tokens
        return {
            "identity": key,
            "tier": resolved_tier,
            "tokens_credited": tokens,
            "amount_toman": amount_toman,
            "balance_toman": new_balance,
            "token_quota_remaining": new_remaining,
            "persisted": persisted,
            "effective_immediately": True,
        }

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "db_url": self._db_url,
                "db_failed": _db_failed,
                "tracked_identities": len(self._quota),
                "global_rpm": len(self._hits),
                **self.stats,
                "currency_hedging": CURRENCY_HEDGING_AVAILABLE,
                "fx": self.fx_snapshot(),
            }


# Process-wide instance shared by the middleware and the health endpoint.
auth_quota_service = AuthQuotaService()


# ---------------------------------------------------------------------------
# Wallet top-up catalogue + token/amount conversion
# ---------------------------------------------------------------------------
# Pre-paid packages sold on the pricing page (tokens per package).
TOPUP_PACKAGES: Dict[str, Dict[str, Any]] = {
    "100k": {"package_id": "100k", "tokens": 100_000, "label": "بسته پایه ۱۰۰ هزار توکن"},
    "500k": {"package_id": "500k", "tokens": 500_000, "label": "بسته حرفه‌ای ۵۰۰ هزار توکن"},
    "2M": {"package_id": "2M", "tokens": 2_000_000, "label": "بسته VIP دو میلیون توکن"},
}

TOPUP_PACKAGE_ALIASES: Dict[str, str] = {
    "100000": "100k",
    "100K": "100k",
    "TOKENS_100K": "100k",
    "BASIC": "100k",
    "500000": "500k",
    "500K": "500k",
    "TOKENS_500K": "500k",
    "PRO": "500k",
    "2000000": "2M",
    "2000K": "2M",
    "2M_TOKENS": "2M",
    "2MIL": "2M",
    "TOKENS_2M": "2M",
    "VIP": "2M",
}


def resolve_topup_package(package_id: Any) -> Optional[Dict[str, Any]]:
    """Resolve a package id/alias to its catalogue entry (``None`` if unknown)."""
    key = str(package_id or "").strip()
    if not key:
        return None
    resolved = TOPUP_PACKAGE_ALIASES.get(key) or TOPUP_PACKAGE_ALIASES.get(key.upper())
    if resolved is None:
        resolved = key if key in TOPUP_PACKAGES else key.upper()
    return TOPUP_PACKAGES.get(resolved)


def tokens_for_amount(amount_toman: int, tier: Optional[str] = None) -> int:
    """How many tokens a Toman amount buys at the current hedged rate."""
    if _currency_pricer is None:
        return 0
    try:
        amount = max(0, int(amount_toman or 0))
        if amount <= 0:
            return 0
        usd = _currency_pricer.toman_to_usd(amount)
        per_1k = _currency_pricer.base_cost_usd_per_1k(tier)
        if per_1k <= 0:
            return 0
        return int((usd / per_1k) * 1000.0)
    except Exception as exc:  # noqa: BLE001
        print(f"[ROXIRA][FX-WARN] token conversion failed: {exc}", flush=True)
        return 0


def amount_for_tokens(tokens: int, tier: Optional[str] = None) -> int:
    """Hedged Toman price of a token amount (inverse of :func:`tokens_for_amount`)."""
    return calculate_token_toman_price(tokens, tier)


def package_offer(package_id: Any, tier: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Price a package at the current hedged rate."""
    package = resolve_topup_package(package_id)
    if package is None:
        return None
    tokens = int(package["tokens"])
    return {
        **package,
        "amount_toman": amount_for_tokens(tokens, tier),
        "tokens": tokens,
        "tier": normalize_tier(tier or DEFAULT_PLAN_TIER),
    }


# ---------------------------------------------------------------------------
# Wallet HTTP endpoints (mounted by the unified server)
# ---------------------------------------------------------------------------
try:  # FastAPI is optional: the models/service stay importable without it.
    from fastapi import APIRouter, Body, Request
    from fastapi.responses import JSONResponse

    _FASTAPI_AVAILABLE = True
except Exception:  # noqa: BLE001
    _FASTAPI_AVAILABLE = False


def _decode_bearer_subject(authorization: Optional[str]) -> Optional[str]:
    """Extract the subject from a Bearer JWT **without** verifying the signature.

    Verification stays in the SmartJudge auth layer; here the claim is only used
    to pick the wallet owner, and a numeric id is still required by the caller.
    """
    import base64
    import json as _json

    token = str(authorization or "")
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if token.count(".") < 2:
        return None
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = _json.loads(base64.urlsafe_b64decode(payload).decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return None
    for field in ("sub", "user_id", "phone", "id"):
        value = claims.get(field)
        if value not in (None, ""):
            return str(value)
    return None


def resolve_wallet_identity(request: Any = None, authorization: Optional[str] = None,
                            x_user_id: Optional[str] = None) -> Optional[str]:
    """Wallet owner: Bearer subject -> X-User-Id header. ``None`` when absent."""
    candidate = _decode_bearer_subject(authorization) or (str(x_user_id) if x_user_id else None)
    if candidate is None and request is not None:
        candidate = request.headers.get("x-user-id") or None
    if candidate is None:
        return None
    candidate = candidate.strip()
    return candidate if candidate.isdigit() else None


if _FASTAPI_AVAILABLE:
    wallet_router = APIRouter(prefix="/api/v1/auth/wallet", tags=["wallet"])

    def _wallet_unauthenticated() -> JSONResponse:
        return JSONResponse(
            {
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "برای دسترسی به کیف پول باید با حساب کاربری خود وارد شوید.",
            },
            status_code=401,
        )

    @wallet_router.get("/balance")
    async def wallet_balance(request: Request):
        """Return ``balance_toman`` and ``token_quota_remaining`` of the caller."""
        identity = resolve_wallet_identity(
            request, request.headers.get("authorization"), request.headers.get("x-user-id")
        )
        if identity is None:
            return _wallet_unauthenticated()
        state = await auth_quota_service.wallet_state(identity)
        return {
            "status": "ok",
            "user_id": int(identity),
            "balance_toman": state["balance_toman"],
            "token_quota_remaining": state["token_quota_remaining"],
            "tier": state["tier"],
            "tokens_per_1k_toman": state["tokens_per_1k_toman"],
            "db_backed": state["db_backed"],
            "currency_hedging": CURRENCY_HEDGING_AVAILABLE,
            "packages": {pid: package_offer(pid, state["tier"]) for pid in TOPUP_PACKAGES},
        }

    @wallet_router.post("/top-up")
    async def wallet_top_up(request: Request, payload: Dict[str, Any] = Body(...)):
        """Credit a wallet from either ``amount_toman`` or a ``package_id``."""
        body = payload if isinstance(payload, dict) else {}
        identity = resolve_wallet_identity(
            request,
            (request.headers.get("authorization") if request is not None else None),
            (request.headers.get("x-user-id") if request is not None else None),
        ) or (str(body.get("user_id")).strip() if str(body.get("user_id") or "").strip().isdigit() else None)
        if identity is None:
            return _wallet_unauthenticated()

        tier = body.get("tier")
        package_id = body.get("package_id") or body.get("package")
        amount_toman = body.get("amount_toman") or body.get("amount")
        tokens = body.get("tokens")

        resolved_package = None
        if package_id not in (None, ""):
            resolved_package = resolve_topup_package(package_id)
            if resolved_package is None:
                return JSONResponse(
                    {
                        "status": "error",
                        "code": "UNKNOWN_PACKAGE",
                        "message": "بسته انتخابی نامعتبر است.",
                        "supported_packages": list(TOPUP_PACKAGES),
                    },
                    status_code=400,
                )
            tokens = int(resolved_package["tokens"])

        if tokens in (None, "") and amount_toman not in (None, ""):
            if not CURRENCY_HEDGING_AVAILABLE:
                return JSONResponse(
                    {
                        "status": "error",
                        "code": "PRICING_UNAVAILABLE",
                        "message": "سرویس نرخ ارز در دسترس نیست؛ از بسته‌های آماده استفاده کنید.",
                    },
                    status_code=503,
                )
            tokens = tokens_for_amount(int(amount_toman), tier)
            if tokens <= 0:
                return JSONResponse(
                    {
                        "status": "error",
                        "code": "INVALID_AMOUNT",
                        "message": "مبلغ وارد‌شده برای شارژ کیف پول کافی نیست.",
                    },
                    status_code=400,
                )

        if tokens in (None, ""):
            return JSONResponse(
                {
                    "status": "error",
                    "code": "MISSING_TOPUP_INPUT",
                    "message": "یکی از پارامترهای amount_toman یا package_id الزامی است.",
                    "supported_packages": list(TOPUP_PACKAGES),
                },
                status_code=400,
            )
        tokens = int(tokens)
        if tokens <= 0:
            return JSONResponse(
                {"status": "error", "code": "INVALID_TOKENS", "message": "تعداد توکن باید مثبت باشد."},
                status_code=400,
            )

        if amount_toman in (None, ""):
            amount_toman = amount_for_tokens(tokens, tier)
        amount_toman = max(0, int(amount_toman))

        result = await auth_quota_service.credit_wallet(identity, tokens, amount_toman, tier)
        # Prove the credit is live for the very next request (no restart / no TTL wait).
        live_tier, live_remaining = await auth_quota_service.resolve(identity)
        return {
            "status": "ok",
            "user_id": int(identity),
            "package_id": resolved_package["package_id"] if resolved_package else None,
            "tokens_credited": result["tokens_credited"],
            "amount_toman": result["amount_toman"],
            "balance_toman": result["balance_toman"],
            "token_quota_remaining": result["token_quota_remaining"],
            "live_quota_remaining": int(live_remaining),
            "tier": result["tier"],
            "effective_immediately": True,
            "persisted": result["persisted"],
            "currency_hedging": CURRENCY_HEDGING_AVAILABLE,
            "exchange_rate_toman": (
                _currency_pricer.effective_rate_toman if _currency_pricer is not None else None
            ),
            "packages": list(TOPUP_PACKAGES),
        }

