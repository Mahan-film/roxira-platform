# -*- coding: utf-8 -*-
import time
import json
import logging
import urllib.request
from typing import Dict, Any, Optional

logger = logging.getLogger("CurrencyEngine")

class MultiSourceCurrencyEngine:
    def __init__(self):
        self._cached_rate: int = 85000
        self._last_successful_fetch: float = 0
        self._cache_ttl_seconds: int = 900
        self._active_source: str = "INITIAL_FALLBACK"

    def _fetch_nobitex(self) -> Optional[int]:
        url = "https://api.nobitex.ir/v2/orderbook/USDTIRT"
        req = urllib.request.Request(url, headers={"User-Agent": "RoxiraEngine/2026"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            last_price = data.get("lastTradePrice")
            if last_price:
                return int(float(last_price) / 10)
        return None

    def _fetch_wallex(self) -> Optional[int]:
        url = "https://api.wallex.ir/v1/currencies/rates"
        req = urllib.request.Request(url, headers={"User-Agent": "RoxiraEngine/2026"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            rate = data.get("result", {}).get("rates", {}).get("USDT", {}).get("rate")
            if rate:
                return int(float(rate))
        return None

    def _fetch_tetherland(self) -> Optional[int]:
        """Primary live source: Tetherland USDT/IRT price (Toman)."""
        url = "https://api.tetherland.com/currencies"
        req = urllib.request.Request(url, headers={"User-Agent": "RoxiraEngine/2026"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            currencies = data.get("data", {}).get("currencies", {})

            # Tetherland exposes USDT as a dict {"price": ...} (and, on some
            # deployments, as a plain numeric scalar). Handle both shapes.
            entry = currencies.get("USDT") or currencies.get("usdt")
            rate = entry.get("price") if isinstance(entry, dict) else entry
            if rate:
                return int(float(rate))
        return None

    def get_tetherland_rate(self) -> Optional[int]:
        """Fetch the live Tetherland Toman rate, bypassing the cache."""
        try:
            return self._fetch_tetherland()
        except Exception:
            return None

    def get_live_usd_rate(self) -> Dict[str, Any]:
        now = time.time()
        if (now - self._last_successful_fetch < self._cache_ttl_seconds) and self._last_successful_fetch > 0:
            return {
                "rate_toman": self._cached_rate,
                "source": self._active_source,
                "cached": True,
                "last_sync_timestamp": int(self._last_successful_fetch)
            }

        # Tetherland is the platform's primary reference for the Tether (USDT)
        # rate; the other venues are ordered fallbacks only.
        sources = [
            ("TETHERLAND", self._fetch_tetherland),
            ("NOBITEX", self._fetch_nobitex),
            ("WALLEX", self._fetch_wallex)
        ]

        for name, fetch_func in sources:
            try:
                rate = fetch_func()
                if rate and rate > 30000:
                    self._cached_rate = rate
                    self._last_successful_fetch = now
                    self._active_source = name
                    return {
                        "rate_toman": self._cached_rate,
                        "source": self._active_source,
                        "cached": False,
                        "last_sync_timestamp": int(now)
                    }
            except Exception:
                continue

        return {
            "rate_toman": self._cached_rate,
            "source": self._active_source + "_FALLBACK",
            "cached": True,
            "last_sync_timestamp": int(self._last_successful_fetch)
        }

    def calculate_plan_pricing(self, base_usd: float) -> Dict[str, Any]:
        rate_info = self.get_live_usd_rate()
        toman_rate = rate_info["rate_toman"]
        raw_toman = base_usd * toman_rate
        rounded_toman = int((raw_toman + 999) // 1000 * 1000)
        return {
            "base_usd": base_usd,
            "exchange_rate_toman": toman_rate,
            "source": rate_info["source"],
            "amount_toman": rounded_toman,
            "amount_rial": rounded_toman * 10,
            "last_sync": rate_info["last_sync_timestamp"]
        }

currency_engine = MultiSourceCurrencyEngine()
