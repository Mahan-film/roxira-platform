"""Dynamic Toman pricing for token consumption (currency hedging).

The platform bills Iranian customers in Toman while the underlying model cost is
denominated in USD/Tether. This module keeps that conversion solvent:

* :class:`DynamicCurrencyPricer` owns *one* number - the base USD/Tether cost of
  1k tokens - and multiplies it by the live Tether -> Toman rate.
* The live rate is fetched from several Iranian venues (Tetherland, Nobitex,
  Wallex) and cached; the **most expensive** observed venue wins, because for a
  seller the conservative direction is "charge more", never "charge less".
* A safety buffer (default **+10%**) is applied on top of the rate, and the rate
  is floored at the session high-water mark, so a sudden Rial spike/depreciation
  between two refreshes can never turn a sale into a loss.

Everything degrades gracefully: a pinned rate via ``ROXIRA_USDT_TOMAN_RATE``, a
stale cached rate, or the configured fallback are all acceptable answers - the
pricer never raises and never blocks a request on the network.

Public surface::

    from currency_hedging import calculate_token_toman_price
    calculate_token_toman_price(12_000, "VIP")   # -> Toman, rounded up

``currency_pricer`` is the process-wide instance wired into
:class:`~user_auth_models.AuthQuotaService` (see ``price_tokens`` /
``charge_tokens``).
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "BASE_USD_COST_PER_1K_TOKENS",
    "FX_CACHE_TTL_SECONDS",
    "FX_SAFETY_MARGIN",
    "TIER_USD_MULTIPLIERS",
    "DynamicCurrencyPricer",
    "calculate_token_toman_price",
    "currency_pricer",
    "effective_usdt_toman_rate",
    "usd_to_toman",
]


def _env_float(name: str, default: float) -> float:
    try:
        raw = os.environ.get(name)
        return float(raw) if raw not in (None, "") else float(default)
    except (TypeError, ValueError):
        return float(default)


def _env_int(name: str, default: int) -> int:
    try:
        raw = os.environ.get(name)
        return int(float(raw)) if raw not in (None, "") else int(default)
    except (TypeError, ValueError):
        return int(default)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Base wholesale cost of 1k tokens in USD/Tether (a mid-tier Persian LLM
# blend). Operators override with ROXIRA_USD_PER_1K_TOKENS.
BASE_USD_COST_PER_1K_TOKENS = _env_float("ROXIRA_USD_PER_1K_TOKENS", 0.003)

# Conservative margin added on top of the live rate: protects against a rate
# jump between two refreshes (the customer pre-pays at today's protected rate).
FX_SAFETY_MARGIN = _env_float("ROXIRA_FX_SAFETY_MARGIN", 0.10)

FX_CACHE_TTL_SECONDS = _env_int("ROXIRA_FX_CACHE_TTL", 900)
FX_FALLBACK_RATE_TOMAN = _env_int("ROXIRA_FX_FALLBACK_TOMAN", 90_000)
FX_REQUEST_TIMEOUT = _env_float("ROXIRA_FX_TIMEOUT", 3.0)
FX_MIN_SANE_RATE = _env_int("ROXIRA_FX_MIN_RATE", 30_000)
FX_MAX_SANE_RATE = _env_int("ROXIRA_FX_MAX_RATE", 10_000_000)
# Ops escape hatch: pin the rate (skips the network entirely).
PINNED_RATE_TOMAN = _env_int("ROXIRA_USDT_TOMAN_RATE", 0)

# Toman amounts are rounded up to this step so the invoice never under-recovers.
PRICE_ROUNDING_TOMAN = max(1, _env_int("ROXIRA_PRICE_ROUNDING", 100))
# Smallest billable amount for a non-zero request.
PRICE_MINIMUM_TOMAN = _env_int("ROXIRA_PRICE_MINIMUM", PRICE_ROUNDING_TOMAN)

# When true (default) the first pricing call warms the rate in a daemon thread -
# live rates without ever blocking a request on the network.
FX_AUTOREFRESH = os.environ.get("ROXIRA_FX_AUTOREFRESH", "1") != "0"
# Floor for the periodic background refresh (protects the FX venues).
FX_MIN_REFRESH_INTERVAL = _env_float("ROXIRA_FX_MIN_REFRESH_INTERVAL", 30.0)

# Heavier tiers are routed to heavier models, so their USD cost is higher. Kept
# in sync with PLAN_LIMITS[*]["cost_multiplier"] in user_auth_models.
TIER_USD_MULTIPLIERS: Dict[str, float] = {
    "ANONYMOUS": 1.0,
    "FREE": 1.0,
    "PRO": 1.1,
    "VIP": 1.25,
    "ENTERPRISE": 1.5,
}

TIER_PRICE_ALIASES: Dict[str, str] = {
    "VIP_MONTHLY": "VIP",
    "VIP_MONTHLY_PRO": "VIP",
    "VIP_UNLIMITED": "VIP",
    "PREMIUM": "VIP",
    "TIER2": "PRO",
    "PRO": "PRO",
    "TIER3": "ENTERPRISE",
    "PLUS": "PRO",
    "GUEST": "ANONYMOUS",
}

for _tier in list(TIER_USD_MULTIPLIERS):
    _override = os.environ.get(f"ROXIRA_PRICE_MULT_{_tier}")
    if _override:
        TIER_USD_MULTIPLIERS[_tier] = _env_float(f"ROXIRA_PRICE_MULT_{_tier}", TIER_USD_MULTIPLIERS[_tier])

_USD_HEADERS = {"User-Agent": "RoxiraCurrencyPricer/2026", "Accept": "application/json"}


# ---------------------------------------------------------------------------
# Live rate sources (dependency-free HTTP via urllib)
# ---------------------------------------------------------------------------
def _http_json(url: str, timeout: float = FX_REQUEST_TIMEOUT) -> Any:
    request = urllib.request.Request(url, headers=_USD_HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed https URLs
        return json.loads(response.read().decode("utf-8", "replace"))


def fetch_tetherland_toman() -> Optional[int]:
    """Tetherland USDT/IRT (the platform's primary Tether reference)."""
    data = _http_json("https://api.tetherland.com/currencies")
    currencies = (data.get("data") or {}).get("currencies") or {}
    entry = currencies.get("USDT") or currencies.get("usdt")
    rate = entry.get("price") if isinstance(entry, dict) else entry
    return int(float(rate)) if rate else None


def fetch_nobitex_toman() -> Optional[int]:
    """Nobitex orderbook; prices are quoted in Rial, converted to Toman."""
    data = _http_json("https://api.nobitex.ir/v2/orderbook/USDTIRT")
    price = data.get("lastTradePrice")
    return int(float(price) / 10) if price else None


def fetch_wallex_toman() -> Optional[int]:
    """Wallex currency rates endpoint (already in Toman)."""
    data = _http_json("https://api.wallex.ir/v1/currencies/rates")
    rate = (((data.get("result") or {}).get("rates") or {}).get("USDT") or {}).get("rate")
    return int(float(rate)) if rate else None


DEFAULT_RATE_SOURCES: Tuple[Tuple[str, Callable[[], Optional[int]]], ...] = (
    ("TETHERLAND", fetch_tetherland_toman),
    ("NOBITEX", fetch_nobitex_toman),
    ("WALLEX", fetch_wallex_toman),
)

OFFLINE = os.environ.get("ROXIRA_FX_OFFLINE", "0") == "1"


# ---------------------------------------------------------------------------
# Pricer
# ---------------------------------------------------------------------------
class DynamicCurrencyPricer:
    """Convert a token count into a hedged Toman price.

    Parameters are overridable for tests (``fetcher``) and operators (env vars).
    The instance is thread-safe; refreshes are serialised by ``_lock`` and the
    network call itself is never made while holding it.
    """

    def __init__(
        self,
        *,
        base_usd_per_1k_tokens: Optional[float] = None,
        safety_margin: Optional[float] = None,
        cache_ttl: Optional[float] = None,
        fallback_rate: Optional[int] = None,
        sources: Optional[Sequence[Tuple[str, Callable[[], Optional[int]]]]] = None,
        fetcher: Optional[Callable[[], Optional[int]]] = None,
        pinned_rate: Optional[int] = None,
        offline: Optional[bool] = None,
        autorefresh: Optional[bool] = None,
    ) -> None:
        self.base_usd_per_1k_tokens = float(
            base_usd_per_1k_tokens if base_usd_per_1k_tokens is not None else BASE_USD_COST_PER_1K_TOKENS
        )
        self.safety_margin = float(safety_margin if safety_margin is not None else FX_SAFETY_MARGIN)
        self.cache_ttl = float(cache_ttl if cache_ttl is not None else FX_CACHE_TTL_SECONDS)
        self.fallback_rate = int(fallback_rate if fallback_rate is not None else FX_FALLBACK_RATE_TOMAN)
        if fetcher is not None:
            self.sources: Tuple[Tuple[str, Callable[[], Optional[int]]], ...] = (("CUSTOM", fetcher),)
        else:
            self.sources = tuple(sources) if sources else DEFAULT_RATE_SOURCES
        self.pinned_rate = int(pinned_rate if pinned_rate is not None else PINNED_RATE_TOMAN)
        self.offline = bool(OFFLINE if offline is None else offline)
        self.autorefresh = bool(FX_AUTOREFRESH if autorefresh is None else autorefresh)

        self._lock = threading.RLock()
        self._rate_toman: int = self.pinned_rate or self.fallback_rate
        self._high_water_rate: int = self._rate_toman
        self._source: str = "ENV_PINNED" if self.pinned_rate else "INITIAL_FALLBACK"
        self._fetched_at: float = 0.0
        self._observed: Dict[str, int] = {}
        self._errors: List[str] = []
        self._stats: Dict[str, int] = {"refreshes": 0, "fetch_success": 0, "fetch_failure": 0, "stale_serves": 0}
        self._refresh_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._primed = False

    # ---- tier helpers -----------------------------------------------------
    @staticmethod
    def normalize_tier(tier: Optional[str]) -> str:
        key = str(tier or "").strip().upper()
        if not key:
            return "FREE"
        return TIER_PRICE_ALIASES.get(key, key if key in TIER_USD_MULTIPLIERS else "FREE")

    def tier_multiplier(self, tier: Optional[str]) -> float:
        return float(TIER_USD_MULTIPLIERS.get(self.normalize_tier(tier), 1.0))

    def base_cost_usd_per_1k(self, tier: Optional[str] = None) -> float:
        """USD/Tether cost of 1k tokens for ``tier`` (base x tier multiplier)."""
        return round(self.base_usd_per_1k_tokens * self.tier_multiplier(tier), 8)

    # ---- live rate --------------------------------------------------------
    def _collect_rates(self) -> Dict[str, int]:
        observed: Dict[str, int] = {}
        errors: List[str] = []
        for name, fetch in self.sources:
            try:
                rate = fetch()
            except Exception as exc:  # noqa: BLE001 - a dead venue must not break pricing
                errors.append(f"{name}:{type(exc).__name__}")
                continue
            if rate is None:
                errors.append(f"{name}:empty")
                continue
            rate = int(rate)
            if rate < FX_MIN_SANE_RATE or rate > FX_MAX_SANE_RATE:
                errors.append(f"{name}:implausible({rate})")
                continue
            observed[name] = rate
        with self._lock:
            self._observed = observed
            self._errors = errors[:8]
        return observed

    def refresh(self, force: bool = False) -> Dict[str, Any]:
        """Update the live Tether -> Toman rate; returns a rate snapshot."""
        now = time.time()
        with self._lock:
            fresh = (now - self._fetched_at) < self.cache_ttl and self._fetched_at > 0
            if fresh and not force:
                return self._rate_snapshot(cached=True)

        if self.pinned_rate:
            with self._lock:
                self._rate_toman = int(self.pinned_rate)
                self._high_water_rate = max(self._high_water_rate, self._rate_toman)
                self._source = "ENV_PINNED"
                self._fetched_at = now
                self._stats["refreshes"] += 1
                self._stats["fetch_success"] += 1
                return self._rate_snapshot(cached=False)

        if self.offline:
            with self._lock:
                self._stats["refreshes"] += 1
                self._stats["stale_serves"] += 1
                return self._rate_snapshot(cached=True)

        observed = self._collect_rates()
        with self._lock:
            self._stats["refreshes"] += 1
            if observed:
                # Conservative for a seller: keep the priciest venue of the round
                # so a single cheap/stale venue cannot under-price the invoice.
                best_name, best_rate = max(observed.items(), key=lambda item: item[1])
                self._rate_toman = int(best_rate)
                self._high_water_rate = max(self._high_water_rate, int(best_rate))
                self._source = best_name
                self._fetched_at = now
                self._stats["fetch_success"] += 1
            else:
                # Total blackout: keep the last (high-water) rate, never lower it.
                self._rate_toman = max(self._rate_toman, self.fallback_rate, self._high_water_rate)
                self._source = f"{self._source}_STALE" if self._fetched_at else "FALLBACK"
                self._stats["fetch_failure"] += 1
                self._stats["stale_serves"] += 1
            return self._rate_snapshot(cached=not observed)

    async def refresh_async(self, force: bool = False) -> Dict[str, Any]:
        """Non-blocking refresh - safe to await from an async route."""
        return await asyncio.to_thread(self.refresh, force)

    def ensure_fresh(self) -> Dict[str, Any]:
        """Refresh only when the cached rate expired (best effort, never raises)."""
        try:
            return self.refresh(force=False)
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._errors.append(f"refresh:{type(exc).__name__}")
                self._stats["fetch_failure"] += 1
            return self.rate_snapshot()

    def _prime_rate_if_needed(self) -> None:
        """Kick a one-shot daemon refresh so the first quote is not a stale guess."""
        if not self.autorefresh or self.offline or self.pinned_rate:
            return
        with self._lock:
            if self._primed:
                return
            self._primed = True
            fetched_at = self._fetched_at
        if fetched_at and (time.time() - fetched_at) < self.cache_ttl:
            return

        def _one_shot() -> None:
            try:
                self.refresh(force=True)
            except Exception:  # noqa: BLE001 - warm-up only
                return

        threading.Thread(target=_one_shot, name="roxira-fx-priming", daemon=True).start()

    def start_background_refresh(self, interval: Optional[float] = None, min_interval: Optional[float] = None) -> bool:
        """Refresh the rate periodically in a daemon thread (idempotent).

        ``interval`` is floored at ``min_interval`` (default 30s) so a
        misconfiguration can never hammer the FX venues.
        """
        with self._lock:
            if self._refresh_thread is not None and self._refresh_thread.is_alive():
                return False
            period = float(interval if interval is not None else self.cache_ttl)
            floor = float(min_interval if min_interval is not None else FX_MIN_REFRESH_INTERVAL)
            self._stop_event.clear()
            thread = threading.Thread(
                target=self._refresh_loop, args=(max(floor, period),), name="roxira-fx-refresh", daemon=True
            )
            self._refresh_thread = thread
        thread.start()
        return True

    def stop_background_refresh(self) -> None:
        self._stop_event.set()

    def _refresh_loop(self, period: float) -> None:
        while not self._stop_event.wait(period):
            try:
                self.refresh(force=True)
            except Exception:  # noqa: BLE001 - background thread must never die loudly
                continue

    # ---- rate exposure ----------------------------------------------------
    @property
    def raw_rate_toman(self) -> int:
        """Last fetched (un-buffered) Tether -> Toman rate."""
        with self._lock:
            return int(self._rate_toman)

    @property
    def effective_rate_toman(self) -> int:
        """Hedged rate: high-water floored, then the +margin buffer applied."""
        with self._lock:
            baseline = max(int(self._rate_toman), int(self._high_water_rate), self.fallback_rate)
            return int(round(baseline * (1.0 + self.safety_margin)))

    def effective_rate(self) -> int:
        return self.effective_rate_toman

    @property
    def margin(self) -> float:
        return self.safety_margin

    # ---- pricing ----------------------------------------------------------
    def usd_to_toman(self, usd: float) -> int:
        """Hedged Toman value of a USD/Tether amount (rounded up to the step)."""
        try:
            amount = float(usd)
        except (TypeError, ValueError):
            return 0
        if amount <= 0:
            return 0
        toman = amount * self.effective_rate_toman
        return self._round_up(toman)

    def toman_to_usd(self, toman: float) -> float:
        rate = self.effective_rate_toman or 1
        return round(float(toman or 0) / float(rate), 6)

    @staticmethod
    def _round_up(toman: float) -> int:
        step = PRICE_ROUNDING_TOMAN
        return int(-(-float(toman) // step) * step)

    def calculate_token_toman_price(self, tokens: int, tier: Optional[str] = None) -> int:
        """Toman price of ``tokens`` at ``tier`` (0 for a free/empty request)."""
        try:
            count = int(tokens)
        except (TypeError, ValueError):
            return 0
        if count <= 0:
            return 0
        quote = self.quote(count, tier)
        return int(quote["toman_amount"])

    def quote(self, tokens: int, tier: Optional[str] = None, *, refresh: bool = False) -> Dict[str, Any]:
        """Full pricing breakdown for one request (hedge math included)."""
        try:
            count = max(0, int(tokens))
        except (TypeError, ValueError):
            count = 0
        if refresh:
            self.ensure_fresh()
        else:
            # Never block a request on FX: warm the rate off-thread instead.
            self._prime_rate_if_needed()
        normalized = self.normalize_tier(tier)
        multiplier = self.tier_multiplier(normalized)
        base_usd = self.base_cost_usd_per_1k(normalized)
        usd_amount = round((count / 1000.0) * base_usd, 8)

        with self._lock:
            raw_rate = int(self._rate_toman)
            high_water = int(self._high_water_rate)
            source = self._source
            fetched_at = self._fetched_at
            observed = dict(self._observed)
        effective_rate = self.effective_rate_toman

        unhedged_toman = self._round_up(usd_amount * raw_rate) if count else 0
        hedged_toman = self._round_up(usd_amount * effective_rate) if count else 0
        if count and hedged_toman < PRICE_MINIMUM_TOMAN:
            hedged_toman = PRICE_MINIMUM_TOMAN

        return {
            "tokens": count,
            "tier": normalized,
            "base_usd_cost_per_1k_tokens": base_usd,
            "tier_multiplier": multiplier,
            "usd_amount": usd_amount,
            "exchange_rate_toman": raw_rate,
            "observed_rates_toman": observed,
            "high_water_rate_toman": high_water,
            "safety_margin": self.safety_margin,
            "effective_rate_toman": effective_rate,
            "unhedged_toman": unhedged_toman,
            "hedge_buffer_toman": max(0, hedged_toman - unhedged_toman),
            "toman_amount": hedged_toman,
            "rial_amount": hedged_toman * 10,
            "source": source,
            "fetched_at": fetched_at,
            "age_seconds": round(max(0.0, time.time() - fetched_at), 3) if fetched_at else None,
        }

    def price_per_1k_tokens_toman(self, tier: Optional[str] = None) -> int:
        return self.calculate_token_toman_price(1_000, tier)

    def pricing_table(self, tiers: Optional[Sequence[str]] = None) -> Dict[str, Dict[str, Any]]:
        """Per-tier Toman price of 1k tokens (used by pricing pages/invoices)."""
        names = list(tiers) if tiers else list(TIER_USD_MULTIPLIERS)
        return {
            tier: {
                "tier": self.normalize_tier(tier),
                "usd_per_1k_tokens": self.base_cost_usd_per_1k(tier),
                "toman_per_1k_tokens": self.price_per_1k_tokens_toman(tier),
                "safety_margin": self.safety_margin,
            }
            for tier in names
        }

    # ---- observability ----------------------------------------------------
    def _rate_snapshot(self, *, cached: bool) -> Dict[str, Any]:
        with self._lock:
            rate, source, fetched_at = int(self._rate_toman), self._source, self._fetched_at
            observed, errors, high_water = dict(self._observed), list(self._errors), int(self._high_water_rate)
        return {
            "rate_toman": rate,
            "raw_rate_toman": rate,
            "high_water_rate_toman": high_water,
            "effective_rate_toman": self.effective_rate_toman,
            "safety_margin": self.safety_margin,
            "base_usd_cost_per_1k_tokens": self.base_usd_per_1k_tokens,
            "source": source,
            "observed_rates_toman": observed,
            "errors": errors,
            "cached": cached,
            "last_sync_timestamp": int(fetched_at) if fetched_at else 0,
            "age_seconds": round(max(0.0, time.time() - fetched_at), 3) if fetched_at else None,
            "pinned": bool(self.pinned_rate),
            "offline": bool(self.offline),
        }

    def rate_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            fetched = self._fetched_at > 0 and (time.time() - self._fetched_at) < self.cache_ttl
        return self._rate_snapshot(cached=fetched)

    # Backwards-friendly alias
    get_live_usd_rate = rate_snapshot

    def snapshot(self) -> Dict[str, Any]:
        """Operational status block (safe to publish on a health endpoint)."""
        payload = self.rate_snapshot()
        payload.update(
            {
                "stats": dict(self._stats),
                "cache_ttl_seconds": self.cache_ttl,
                "fallback_rate_toman": self.fallback_rate,
                "rounding_toman": PRICE_ROUNDING_TOMAN,
                "tier_multipliers": dict(TIER_USD_MULTIPLIERS),
                "toman_per_1k_tokens": {t: self.price_per_1k_tokens_toman(t) for t in TIER_USD_MULTIPLIERS},
            }
        )
        return payload

    def health(self) -> Dict[str, Any]:
        return self.snapshot()


# ---------------------------------------------------------------------------
# Process-wide instance + module-level helpers
# ---------------------------------------------------------------------------
currency_pricer = DynamicCurrencyPricer()


def calculate_token_toman_price(tokens: int, tier: Optional[str] = None) -> int:
    """Toman price of ``tokens`` at ``tier`` using the shared hedged pricer."""
    return currency_pricer.calculate_token_toman_price(tokens, tier)


def usd_to_toman(usd: float) -> int:
    """Hedged Toman value of a USD/Tether amount using the shared pricer."""
    return currency_pricer.usd_to_toman(usd)


def effective_usdt_toman_rate() -> int:
    """Current hedged Tether -> Toman rate (buffer included)."""
    return currency_pricer.effective_rate_toman
