#!/usr/bin/env python3
"""T254 (#993): ERP guard alert for Smart Judge co-location.

Fires a Telegram alert (the trigger to move Smart Judge to its own server) when:
1. ERP p95 latency rises > 10% above its 7-day baseline, OR
2. Host RAM usage stays > 7.0 GB for >= 15 consecutive minutes.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from dataclasses import dataclass
from typing import Callable

ERP_P95_RISE_THRESHOLD = 0.10  # > 10% above 7-day baseline
HOST_RAM_GB_THRESHOLD = 7.0
HOST_RAM_SUSTAINED_MINUTES = 15


@dataclass(frozen=True)
class GuardEvaluation:
    should_alert: bool
    reasons: tuple[str, ...]

    def format_message(self) -> str:
        header = "[ERP GUARD ALERT - T254] Trigger to move Smart Judge to its own server:"
        lines = [header, *[f"- {r}" for r in self.reasons]]
        return "\n".join(lines)


def evaluate_erp_guard(
    *,
    erp_p95_ms: float,
    baseline_7d_p95_ms: float,
    host_ram_samples_gb: list[tuple[float, float]],
) -> GuardEvaluation:
    """Evaluate ERP p95 latency and sustained host RAM usage.

    `host_ram_samples_gb` is a chronologically ordered list of `(timestamp_seconds, ram_gb)`
    samples. The RAM trigger fires if the trailing window of samples above 7.0 GB spans
    at least 15 minutes (900 seconds).
    """
    reasons: list[str] = []

    if baseline_7d_p95_ms > 0:
        rise_ratio = (erp_p95_ms - baseline_7d_p95_ms) / baseline_7d_p95_ms
        if rise_ratio > ERP_P95_RISE_THRESHOLD:
            pct = rise_ratio * 100.0
            reasons.append(
                f"ERP p95 latency {erp_p95_ms:.1f}ms is +{pct:.1f}% vs 7d baseline {baseline_7d_p95_ms:.1f}ms (> 10%)"
            )

    if host_ram_samples_gb:
        # Find the longest trailing contiguous span where ram_gb > HOST_RAM_GB_THRESHOLD
        first_over_ts: float | None = None
        last_over_ts: float | None = None
        for ts, ram_gb in host_ram_samples_gb:
            if ram_gb > HOST_RAM_GB_THRESHOLD:
                if first_over_ts is None:
                    first_over_ts = ts
                last_over_ts = ts
            else:
                first_over_ts = None
                last_over_ts = None

        if first_over_ts is not None and last_over_ts is not None:
            sustained_min = (last_over_ts - first_over_ts) / 60.0
            if sustained_min >= HOST_RAM_SUSTAINED_MINUTES:
                latest_ram = host_ram_samples_gb[-1][1]
                reasons.append(
                    f"Host RAM {latest_ram:.2f} GB > {HOST_RAM_GB_THRESHOLD:.1f} GB for {sustained_min:.1f} min (>= 15 min)"
                )

    return GuardEvaluation(should_alert=bool(reasons), reasons=tuple(reasons))


def send_telegram_alert(
    message: str,
    *,
    bot_token: str | None = None,
    chat_id: str | None = None,
    sender: Callable[[str], None] | None = None,
) -> bool:
    """Send alert via Telegram Bot API (or injected `sender` in tests)."""
    if sender is not None:
        sender(message)
        return True

    token = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    target = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not target:
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({"chat_id": target, "text": message}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return 200 <= resp.status < 300


def run_check(
    *,
    erp_p95_ms: float,
    baseline_7d_p95_ms: float,
    host_ram_samples_gb: list[tuple[float, float]],
    sender: Callable[[str], None] | None = None,
) -> GuardEvaluation:
    ev = evaluate_erp_guard(
        erp_p95_ms=erp_p95_ms,
        baseline_7d_p95_ms=baseline_7d_p95_ms,
        host_ram_samples_gb=host_ram_samples_gb,
    )
    if ev.should_alert:
        send_telegram_alert(ev.format_message(), sender=sender)
    return ev


if __name__ == "__main__":
    # CLI smoke mode: reads JSON payload from stdin
    data = json.load(sys.stdin)
    samples = [(float(ts), float(gb)) for ts, gb in data.get("host_ram_samples_gb", [])]
    result = run_check(
        erp_p95_ms=float(data["erp_p95_ms"]),
        baseline_7d_p95_ms=float(data["baseline_7d_p95_ms"]),
        host_ram_samples_gb=samples,
    )
    print(result.format_message() if result.should_alert else "OK: ERP guard within thresholds")
    sys.exit(1 if result.should_alert else 0)
