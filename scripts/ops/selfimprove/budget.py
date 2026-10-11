"""Daily LLM budget ledger (append-only JSONL). Stdlib only.

Every paid LLM call (and every estimated live-chat call) is charged here first; when the
day's total would exceed SELFIMPROVE_DAILY_USD the call is refused. The day is the Tehran day.
"""
import json
import os
import time
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo("Asia/Tehran")
except Exception:  # noqa: BLE001 - tzdata missing: fixed +03:30
    _TZ = timezone(timedelta(hours=3, minutes=30))

DEFAULT_CAP_USD = 0.30


def today(now: float | None = None) -> str:
    return datetime.fromtimestamp(now if now is not None else time.time(), _TZ).strftime("%Y-%m-%d")


def cap_from_env() -> float:
    try:
        v = float(os.environ.get("SELFIMPROVE_DAILY_USD", "") or DEFAULT_CAP_USD)
    except ValueError:
        return DEFAULT_CAP_USD
    return v if v >= 0 else DEFAULT_CAP_USD


class BudgetExceeded(RuntimeError):
    pass


class Ledger:
    def __init__(self, path: str, cap_usd: float | None = None, clock=time.time):
        self.path = path
        self.cap = DEFAULT_CAP_USD if cap_usd is None else float(cap_usd)
        self._clock = clock

    def spent(self, day: str | None = None) -> float:
        day = day or today(self._clock())
        total = 0.0
        try:
            with open(self.path, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    if row.get("day") == day:
                        total += float(row.get("usd", 0) or 0)
        except OSError:
            pass
        return total

    def remaining(self) -> float:
        return max(0.0, self.cap - self.spent())

    def can_afford(self, usd: float) -> bool:
        return self.spent() + max(0.0, usd) <= self.cap + 1e-12

    def charge(self, usd: float, what: str) -> float:
        """Record a spend; raises BudgetExceeded (and records nothing) if it would pass the cap."""
        usd = max(0.0, float(usd))
        if not self.can_afford(usd):
            raise BudgetExceeded(f"{what}: {usd:.4f} USD would exceed cap {self.cap:.2f} (spent {self.spent():.4f})")
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        row = {"ts": int(self._clock()), "day": today(self._clock()), "usd": round(usd, 6), "what": what[:80]}
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        return self.remaining()
