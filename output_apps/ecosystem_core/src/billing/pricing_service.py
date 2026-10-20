#!/usr/bin/env python3
"""Pricing for Smart Judge plans (W22 + the 4-tier subscription model).

Deliberately framework- and database-free (like payment_service.py) so it can
be unit tested offline: reads ``os.environ`` and returns a plain dict. The only
network call is the live USD/Toman rate, made lazily at most once per 7 days and
injectable in tests (``_fetch_live_rate``). output_apps/generated_modules/
smartjudge/smartjudge_module.py wires ``get_calculated_pricing()`` into the
``/payments/pricing-matrix`` endpoint and into ``create_payment_invoice``
(via output_apps.ecosystem_core.src.billing.payment_service.create_invoice),
which is the only place an amount is ever charged.

Legacy / one-off plans (``BASE_PLANS_TOMAN``) have a fixed Toman price, each
overridable via ``PRICE_TOMAN_<PLAN_KEY>`` (a positive integer), e.g.::

    PRICE_TOMAN_SINGLE_DRAFT=120000

The SJ_* subscription plans are priced in USD (``PRICE_USD_<KEY>`` overrides)
and converted to Toman with a snapshotted rate (see ``get_usd_toman_rate``).
``PRICE_TOMAN_<KEY>`` also pins a fixed Toman price for them.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time

logger = logging.getLogger(__name__)

# Code defaults, used whenever the matching PRICE_TOMAN_<KEY> environment
# variable is unset, blank or invalid.
BASE_PLANS_TOMAN: dict[str, dict[str, object]] = {
    "SINGLE_DRAFT": {
        "name": "خرید لایحه تکی تخصصی دادگاه",
        "default_toman": 100_000,
        # USD base for USDT checkout only (= 350,000 toman at 280k); the toman
        # price shown/charged stays default_toman / PRICE_TOMAN_SINGLE_DRAFT.
        "default_usd": 1.25,
    },
    "VOICE_PACK_10MIN": {
        "name": "بسته ۱۰ دقیقه مشاوره صوتی زنده",
        "default_toman": 63_000,
    },
    "VIP_MONTHLY_PRO": {
        "name": "اشتراک ماهانه VIP",
        "default_toman": 490_000,
    },
    "DIASPORA_SPECIAL": {
        "name": "بسته تخصصی امور حقوقی خارج از کشور (املاک/ارث)",
        "default_toman": 1_015_000,
    },
}

# ---------------------------------------------------------------------------
# 4-tier Smart Judge subscriptions (owner-approved 2026-10-16).
# ---------------------------------------------------------------------------
USD_MONTHLY: dict[str, float] = {"basic": 4.0, "pro": 10.0, "premium": 29.0}
_LEVEL_NAMES_FA = {"basic": "پایه", "pro": "حرفه‌ای", "premium": "ویژه"}
YEARLY_MULTIPLIER = 10  # 12 months for the price of 10 (2 months free)

USD_PLANS: dict[str, dict[str, object]] = {}
for _level, _usd in USD_MONTHLY.items():
    USD_PLANS[f"SJ_{_level.upper()}_MONTHLY"] = {
        "name": f"اشتراک {_LEVEL_NAMES_FA[_level]} قاضی هوشمند (ماهانه)",
        "default_usd": _usd, "period_days": 30, "level": _level,
    }
    USD_PLANS[f"SJ_{_level.upper()}_YEARLY"] = {
        "name": f"اشتراک {_LEVEL_NAMES_FA[_level]} قاضی هوشمند (سالانه، ۲ ماه رایگان)",
        "default_usd": _usd * YEARLY_MULTIPLIER, "period_days": 365, "level": _level,
    }

# plan key -> subscription level / entitlement length (entitlement + activation code use these)
PLAN_LEVELS: dict[str, str] = {k: str(v["level"]) for k, v in USD_PLANS.items()}
PLAN_PERIOD_DAYS: dict[str, int] = {k: int(v["period_days"]) for k, v in USD_PLANS.items()}
LEVEL_ORDER = ("free", "basic", "pro", "premium")
# Plans sold before the 4-tier model keep working and are grandfathered to PRO.
LEGACY_VIP_PLAN_TYPES = frozenset({
    "VIP", "VIP_MONTHLY", "VIP_MONTHLY_PRO", "VIP_UNLIMITED", "PRO",
    "PREMIUM", "ENTERPRISE", "TIER2", "TIER3",
})


def plan_level(plan_type: str | None) -> str:
    """Level granted by an entitlement ``plan_type``: free | basic | pro | premium.
    SJ_* keys map to their level; legacy VIP types (VIP_MONTHLY_PRO, ...) map to
    ``pro``; anything else (SINGLE_DRAFT, VOICE_PACK_10MIN, ...) is ``free``."""
    key = str(plan_type or "").strip().upper()
    if key in PLAN_LEVELS:
        return PLAN_LEVELS[key]
    return "pro" if key in LEGACY_VIP_PLAN_TYPES else "free"


def is_subscription(plan_type: str | None) -> bool:
    """True for plans that grant a subscription level (SJ_*, legacy VIP types);
    one-off purchases (SINGLE_DRAFT, VOICE_PACK_*) are not subscriptions."""
    return plan_level(plan_type) != "free"


def highest_level(levels) -> str:
    best = "free"
    for lv in levels:
        if lv in LEVEL_ORDER and LEVEL_ORDER.index(lv) > LEVEL_ORDER.index(best):
            best = lv
    return best


def plan_period_days(plan_type: str | None, default: int = 30) -> int:
    return PLAN_PERIOD_DAYS.get(str(plan_type or "").strip().upper(), default)


# ---------------------------------------------------------------------------
# USD -> Toman rate snapshot
# ---------------------------------------------------------------------------
RATE_MIN_TOMAN = 100_000
RATE_MAX_TOMAN = 1_000_000
RATE_FALLBACK_TOMAN = 280_000
RATE_SNAPSHOT_TTL_S = 7 * 86400
_RATE_FAIL_RETRY_S = 300  # after a failed live fetch do not hammer the sources for 5 min
_RATE_REDIS_KEY = "smartjudge:usd_toman_rate"
_rate_lock = threading.Lock()
_mem_snapshot: dict | None = None  # {"rate": int, "source": str, "ts": float}
_fail_until = 0.0


def _rate_ok(value) -> int | None:
    try:
        rate = int(float(value))
    except (TypeError, ValueError):
        return None
    return rate if RATE_MIN_TOMAN <= rate <= RATE_MAX_TOMAN else None


def _snapshot_file() -> str:
    return os.environ.get("SMARTJUDGE_USD_RATE_FILE", "").strip() or os.path.join(
        tempfile.gettempdir(), "smartjudge_usd_toman_rate.json")


def _redis():
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        host = os.environ.get("REDIS_HOST", "").strip()
        if not host:
            return None
        url = f"redis://{host}:{os.environ.get('REDIS_PORT', '6379').strip()}/0"
    try:
        import redis  # type: ignore

        return redis.Redis.from_url(url, socket_timeout=0.5, socket_connect_timeout=0.5, decode_responses=True)
    except Exception:
        return None


def _load_snapshot() -> dict | None:
    client = _redis()
    if client is not None:
        try:
            raw = client.get(_RATE_REDIS_KEY)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    try:
        with open(_snapshot_file(), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _save_snapshot(snap: dict) -> None:
    raw = json.dumps(snap)
    client = _redis()
    if client is not None:
        try:
            client.set(_RATE_REDIS_KEY, raw, ex=RATE_SNAPSHOT_TTL_S * 2)
        except Exception:
            pass
    try:
        with open(_snapshot_file(), "w", encoding="utf-8") as fh:
            fh.write(raw)
    except Exception:
        pass


def _fetch_live_rate() -> tuple[int, str] | None:
    """Live USDT/IRT rate from the platform's existing source (currency_engine:
    Tetherland first, then Nobitex/Wallex; the same one /pricing/plans reports).
    Returns (toman, source) or None. A network call: only reached when the 7-day
    snapshot is missing or stale."""
    try:
        try:
            from output_apps.generated_modules.smartjudge.currency_engine import currency_engine
        except ImportError:  # pragma: no cover
            from currency_engine import currency_engine  # type: ignore
        info = currency_engine.get_live_usd_rate()
        source = str(info.get("source") or "")
        rate = _rate_ok(info.get("rate_toman"))
        if rate and "FALLBACK" not in source.upper():
            return rate, source
    except Exception as exc:  # network down, import problem: caller falls back
        logger.warning("usd rate fetch failed: %s", type(exc).__name__)
    return None


def _base_usd_toman_rate() -> dict[str, object]:
    """Rate used to price USD plans: {"rate_toman", "source", "snapshot_ts"}.

    Order: env SMARTJUDGE_USD_TOMAN_RATE (if within bounds) > snapshot younger
    than 7 days (memory / Redis / file) > live fetch (then snapshotted) > stale
    snapshot > fallback 280,000. A fallback value is never persisted."""
    global _mem_snapshot, _fail_until
    env_rate = _rate_ok(os.environ.get("SMARTJUDGE_USD_TOMAN_RATE", "").strip() or None)
    if env_rate:
        return {"rate_toman": env_rate, "source": "ENV_OVERRIDE", "snapshot_ts": None}
    now = time.time()
    with _rate_lock:
        snap = _mem_snapshot
        stored = None
        if not (snap and now - float(snap.get("ts", 0)) < RATE_SNAPSHOT_TTL_S):
            snap = None
            stored = _load_snapshot()
            if stored and _rate_ok(stored.get("rate")) and now - float(stored.get("ts", 0)) < RATE_SNAPSHOT_TTL_S:
                snap = _mem_snapshot = stored
            elif now >= _fail_until:
                live = _fetch_live_rate()
                if live:
                    snap = _mem_snapshot = {"rate": live[0], "source": live[1], "ts": now}
                    _save_snapshot(snap)
                else:
                    _fail_until = now + _RATE_FAIL_RETRY_S
        if snap is None:  # live failed: reuse any stale snapshot, else the safe fallback
            stale = _mem_snapshot or stored
            if stale and _rate_ok(stale.get("rate")):
                return {"rate_toman": int(stale["rate"]), "source": f"{stale.get('source', 'SNAPSHOT')}_STALE",
                        "snapshot_ts": stale.get("ts")}
            return {"rate_toman": RATE_FALLBACK_TOMAN, "source": "FALLBACK", "snapshot_ts": None}
        return {"rate_toman": int(snap["rate"]), "source": str(snap.get("source", "SNAPSHOT")),
                "snapshot_ts": snap.get("ts")}


RATE_FLOOR_DEFAULT_TOMAN = 280_000


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        value = float(os.environ.get(name, "").strip())
    except (TypeError, ValueError):
        return default
    return value if value >= minimum else default


def rate_floor_toman() -> int:
    """SMARTJUDGE_USD_TOMAN_RATE_FLOOR (default 280,000): the price never uses a lower rate."""
    value = int(_env_float("SMARTJUDGE_USD_TOMAN_RATE_FLOOR", RATE_FLOOR_DEFAULT_TOMAN, minimum=1))
    return value


def price_margin_pct() -> float:
    """SMARTJUDGE_PRICE_MARGIN_PCT (default 0): safety margin added on top of the rate."""
    return _env_float("SMARTJUDGE_PRICE_MARGIN_PCT", 0.0)


def get_usd_toman_rate() -> dict[str, object]:
    """Effective rate used to price USD plans.

    effective = max(live_or_override, floor) x (1 + margin/100). The explicit
    SMARTJUDGE_USD_TOMAN_RATE override replaces the live rate but the floor still
    applies. Returns {"rate_toman" (effective), "source", "snapshot_ts",
    "base_rate_toman", "floor_toman", "margin_pct"}."""
    base = _base_usd_toman_rate()
    floor = rate_floor_toman()
    margin = price_margin_pct()
    base_rate = int(base["rate_toman"])
    effective = int(round(max(base_rate, floor) * (1 + margin / 100.0)))
    source = str(base["source"])
    if base_rate < floor:
        source = f"{source}_FLOOR"
    return {"rate_toman": effective, "source": source, "snapshot_ts": base.get("snapshot_ts"),
            "base_rate_toman": base_rate, "floor_toman": floor, "margin_pct": margin}


def reset_rate_cache_for_tests() -> None:
    global _mem_snapshot, _fail_until
    _mem_snapshot = None
    _fail_until = 0.0


def usd_to_toman(usd: float, rate_toman: int) -> int:
    """USD -> Toman rounded to the nearest 10,000 (never below 10,000)."""
    raw = float(usd) * int(rate_toman)
    return max(10_000, int(raw / 10_000 + 0.5) * 10_000)


def env_plan_price_usd(plan_key: str, default_usd: float) -> float:
    raw = os.environ.get(f"PRICE_USD_{plan_key}")
    if raw is None or not raw.strip():
        return default_usd
    try:
        value = float(raw.strip())
    except ValueError:
        return default_usd
    return value if value > 0 else default_usd


def env_plan_price_toman(plan_key: str, default_toman: int) -> int:
    """Reads ``PRICE_TOMAN_<plan_key>`` from the environment; falls back to
    ``default_toman`` when the variable is unset, blank, non-numeric or not a
    positive integer. This is the only place a plan's Toman price is decided
    server-side — a client-supplied amount is never read."""
    raw = os.environ.get(f"PRICE_TOMAN_{plan_key}")
    if raw is None or not raw.strip():
        return default_toman
    try:
        value = int(raw.strip())
    except ValueError:
        return default_toman
    return value if value > 0 else default_toman


def get_calculated_pricing() -> dict[str, dict[str, object]]:
    """Price per plan, in Toman and Rial (1 Toman = 10 Rial). Legacy plans are
    fixed Toman; SJ_* plans are USD x snapshotted rate rounded to 10,000."""
    plans: dict[str, dict[str, object]] = {}
    for key, item in BASE_PLANS_TOMAN.items():
        price_toman = env_plan_price_toman(key, int(item["default_toman"]))
        plans[key] = {
            "name": item["name"],
            "price_toman": price_toman,
            "price_rial": price_toman * 10,
        }
        if "default_usd" in item:
            plans[key]["usd"] = env_plan_price_usd(key, float(item["default_usd"]))
    rate = get_usd_toman_rate()
    for key, item in USD_PLANS.items():
        usd = env_plan_price_usd(key, float(item["default_usd"]))
        price_toman = env_plan_price_toman(key, 0) or usd_to_toman(usd, int(rate["rate_toman"]))
        plans[key] = {
            "name": item["name"],
            "price_toman": price_toman,
            "price_rial": price_toman * 10,
            "usd": usd,
            "period_days": item["period_days"],
            "level": item["level"],
            "exchange_rate_toman": rate["rate_toman"],
            "rate_source": rate["source"],
        }
    return plans
