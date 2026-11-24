#!/usr/bin/env python3
"""Phone cost model and abuse caps auditor (T298 / R30).

Loads effective-dated telephony and platform pricing from config/phone_pricing.json,
models carrier rounding (e.g. 60/60 rounding on Telnyx/Twilio/sipgate vs 1/1 on easybell)
and LiveKit Scale plan fee ($500/mo EU pinning, $0.01 agent-min, $0.01 obs-min, 10s min),
and monitors per-number daily caps, global daily caps, and monthly spend cap (alert at 80%).

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PRICING_PATH = REPO_ROOT / "config/phone_pricing.json"
DEFAULT_STATE_PATH = Path("/srv/data/phone/state/phone_usage_state.json")


def parse_iso(ts: str) -> datetime:
    """Parse ISO8601 string to timezone-aware UTC datetime."""
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts).astimezone(UTC)


def is_effective(dates: dict[str, str], now: datetime | None = None) -> bool:
    """Check if effective date bounds cover the given timestamp."""
    now = now or datetime.now(UTC)
    try:
        from_dt = parse_iso(dates["valid_from"])
        to_dt = parse_iso(dates["valid_to"])
        return from_dt <= now <= to_dt
    except (KeyError, ValueError):
        return False


def load_pricing_config(path: Path | None = None) -> dict[str, Any]:
    """Load and validate the phone pricing config."""
    p = path or DEFAULT_PRICING_PATH
    if not p.is_file():
        raise FileNotFoundError(f"Phone pricing config not found at {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    if "effective_dates" not in data:
        raise ValueError(f"Missing effective_dates in {p}")
    return data


def calculate_carrier_billable_seconds(duration_seconds: int, carrier: dict[str, Any]) -> int:
    """Compute carrier billable seconds using carrier increment (e.g. 60/60 rounding)."""
    if duration_seconds <= 0:
        return 0
    inc = max(1, int(carrier.get("billing_increment_seconds", 1)))
    rounded = math.ceil(duration_seconds / inc) * inc
    min_dur = int(carrier.get("minimum_duration_seconds", 0))
    return max(rounded, min_dur)


def calculate_livekit_billable_seconds(duration_seconds: int, plan: dict[str, Any]) -> int:
    """Compute LiveKit billable seconds with minimum duration floor (e.g. 10s minimum)."""
    if duration_seconds <= 0:
        return 0
    min_dur = int(plan.get("minimum_duration_seconds", 0))
    return max(duration_seconds, min_dur)


def calculate_call_cost(
    duration_seconds: int,
    config: dict[str, Any],
    carrier_key: str = "sabanet",
    plan_key: str = "self_hosted",
    stt_key: str | None = None,
    tts_key: str | None = None,
    tts_chars: int = 0,
    enable_observability: bool = False,
) -> dict[str, Any]:
    """Compute complete cost breakdown for a call in USD cents."""
    carriers = config.get("carriers", {})
    plans = config.get("platform_plans", {})
    speech = config.get("speech_models", {})

    carrier = carriers.get(carrier_key) or carriers.get("sabanet", {})
    plan = plans.get(plan_key) or plans.get("self_hosted", {})

    dur = max(0, duration_seconds)
    carrier_billable = calculate_carrier_billable_seconds(dur, carrier)
    livekit_billable = calculate_livekit_billable_seconds(dur, plan)

    inbound_rate = float(carrier.get("inbound_per_minute_usd_cents", 0.0))
    voice_api_rate = float(carrier.get("voice_api_fee_per_minute_usd_cents", 0.0))
    carrier_cost_cents = (carrier_billable / 60.0) * (inbound_rate + voice_api_rate)

    agent_rate = float(plan.get("agent_minute_usd_cents", 0.0))
    obs_rate = (
        float(plan.get("observability_minute_usd_cents", 0.0))
        if enable_observability
        else 0.0
    )

    livekit_agent_cost_cents = (livekit_billable / 60.0) * agent_rate
    livekit_obs_cost_cents = (livekit_billable / 60.0) * obs_rate

    stt_cost_cents = 0.0
    if stt_key:
        stt_info = speech.get("stt", {}).get(stt_key, {})
        stt_rate = float(stt_info.get("usd_cents_per_minute", 0.0))
        stt_cost_cents = (dur / 60.0) * stt_rate

    tts_cost_cents = 0.0
    if tts_key and tts_chars > 0:
        tts_info = speech.get("tts", {}).get(tts_key, {})
        tts_rate = float(tts_info.get("usd_cents_per_1k_chars", 0.0))
        tts_cost_cents = (tts_chars / 1000.0) * tts_rate

    total_cost_cents = (
        carrier_cost_cents
        + livekit_agent_cost_cents
        + livekit_obs_cost_cents
        + stt_cost_cents
        + tts_cost_cents
    )

    return {
        "duration_seconds": dur,
        "carrier_billable_seconds": carrier_billable,
        "livekit_billable_seconds": livekit_billable,
        "carrier_cost_cents": round(carrier_cost_cents, 4),
        "livekit_agent_cost_cents": round(livekit_agent_cost_cents, 4),
        "livekit_obs_cost_cents": round(livekit_obs_cost_cents, 4),
        "stt_cost_cents": round(stt_cost_cents, 4),
        "tts_cost_cents": round(tts_cost_cents, 4),
        "total_cost_cents": round(total_cost_cents, 4),
    }


def audit_phone_costs(
    state_path: Path,
    pricing_path: Path,
    plan_key: str = "self_hosted",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Audit phone usage state against budget and abuse caps."""
    now = now or datetime.now(UTC)
    config = load_pricing_config(pricing_path)
    effective = is_effective(config["effective_dates"], now)

    caps = config.get("abuse_caps", {})
    spend_cap_cents = caps.get("monthly_spend_cap", {}).get("cap_usd_cents", 100000)
    alert_ratio = caps.get("monthly_spend_cap", {}).get("alert_threshold_ratio", 0.80)
    global_max_calls = caps.get("global_daily", {}).get("max_calls", 200)
    global_max_sec = caps.get("global_daily", {}).get("max_connected_seconds", 36000)

    if not state_path.is_file():
        return {
            "state": "absent",
            "effective": effective,
            "cap_cents": spend_cap_cents,
            "spend_cents": 0,
            "ratio": 0.0,
            "alert_80": False,
            "cap_exceeded": False,
            "detail": f"State file {state_path} absent",
        }

    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        return {
            "state": "unknown",
            "effective": effective,
            "error": f"Failed to parse state file: {err}",
        }

    current_month = now.strftime("%Y-%m")
    today_str = now.strftime("%Y-%m-%d")

    monthly_total = float(data.get("monthlyTotalCents", 0.0))
    ratio = monthly_total / spend_cap_cents if spend_cap_cents > 0 else 0.0
    alert_80 = ratio >= alert_ratio
    cap_exceeded = ratio >= 1.0

    today_usage = data.get("dailyUsage", {}).get(today_str, {})
    today_calls = int(today_usage.get("totalCalls", 0))
    today_seconds = int(today_usage.get("totalConnectedSeconds", 0))

    daily_exceeded = today_calls >= global_max_calls or today_seconds >= global_max_sec

    return {
        "state": "ok",
        "effective": effective,
        "current_month": current_month,
        "cap_cents": spend_cap_cents,
        "spend_cents": monthly_total,
        "spend_usd": round(monthly_total / 100.0, 2),
        "cap_usd": round(spend_cap_cents / 100.0, 2),
        "ratio": round(ratio, 4),
        "alert_80": alert_80,
        "cap_exceeded": cap_exceeded,
        "today_calls": today_calls,
        "max_daily_calls": global_max_calls,
        "today_seconds": today_seconds,
        "max_daily_seconds": global_max_sec,
        "daily_exceeded": daily_exceeded,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pricing-file", type=Path, default=DEFAULT_PRICING_PATH)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--plan", default=os.getenv("PHONE_PLATFORM_PLAN", "self_hosted"))
    parser.add_argument("--carrier", default=os.getenv("PHONE_CARRIER", "sabanet"))
    parser.add_argument(
        "--check",
        action="store_true",
        help="Audit caps and exit non-zero if alert/cap fired",
    )
    parser.add_argument(
        "--simulate-call",
        type=int,
        metavar="SECONDS",
        help="Simulate a call duration and print cost",
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="Print human-readable usage and limits report",
    )
    parser.add_argument("--json", action="store_true", help="Output results as JSON")

    args = parser.parse_args(argv)

    if args.simulate_call is not None:
        cfg = load_pricing_config(args.pricing_file)
        result = calculate_call_cost(
            args.simulate_call,
            cfg,
            carrier_key=args.carrier,
            plan_key=args.plan,
        )
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(
                f"Call simulation for {args.simulate_call}s "
                f"(carrier={args.carrier}, plan={args.plan}):"
            )
            print(f"  Carrier billable duration: {result['carrier_billable_seconds']}s")
            print(f"  LiveKit billable duration: {result['livekit_billable_seconds']}s")
            print(f"  Carrier cost: {result['carrier_cost_cents']} cents")
            print(f"  LiveKit agent cost: {result['livekit_agent_cost_cents']} cents")
            print(f"  Total cost: {result['total_cost_cents']} cents")
        return 0

    audit = audit_phone_costs(args.state_file, args.pricing_file, plan_key=args.plan)

    if args.json:
        print(json.dumps(audit, indent=2))
    elif args.report or not args.check:
        print("Phone Cost & Abuse Caps Report:")
        print(f"  State: {audit.get('state')}")
        print(f"  Effective dates valid: {audit.get('effective')}")
        if audit.get("state") == "ok":
            pct = audit.get("ratio", 0) * 100
            print(
                f"  Monthly spend: ${audit.get('spend_usd')} / ${audit.get('cap_usd')} ({pct:.1f}%)"
            )
            print(f"  80% Alert threshold reached: {audit.get('alert_80')}")
            print(f"  100% Monthly cap exceeded: {audit.get('cap_exceeded')}")
            print(f"  Today calls: {audit.get('today_calls')} / {audit.get('max_daily_calls')}")
            today_sec = audit.get('today_seconds')
            max_sec = audit.get('max_daily_seconds')
            print(f"  Today connected seconds: {today_sec} / {max_sec}s")

    if args.check:
        if audit.get("cap_exceeded"):
            spend = audit.get("spend_cents")
            cap = audit.get("cap_cents")
            msg = f"CRITICAL: Monthly spend cap exceeded: {spend} cents >= {cap} cents\n"
            sys.stderr.write(msg)
            return 2
        if audit.get("alert_80"):
            spend = audit.get("spend_cents")
            sys.stderr.write(f"WARNING: Monthly spend reached 80% threshold: {spend} cents\n")
            return 1
        if audit.get("daily_exceeded"):
            sys.stderr.write("WARNING: Global daily cap exceeded\n")
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
