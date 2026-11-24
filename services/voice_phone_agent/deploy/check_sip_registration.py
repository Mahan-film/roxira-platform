#!/usr/bin/env python3
"""SIP Trunk Registration and NAT Traversal Monitor for Asterisk Bridge.

Monitors SIP trunk registration status and carrier contact qualify (OPTIONS keepalive):
- Verifies 'Registered' state in Asterisk bridge (`pjsip show registrations`).
- Verifies carrier qualify ('Avail') and RTT (`pjsip show contacts`).
- Tracks 7-day continuous registration stability over time.
- Triggers immediate alerts when registration status transitions away from 'Registered'.
- Persists state in an audit history file (pruned at 30 days).

Privacy: Never stores, prints, or transmits private credentials, SIP URIs, IP addresses,
or phone numbers. Status words, timestamps, and RTTs only.
Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_STATE_FILE = "/srv/data/phone/state/sip_registration_history.json"
DEFAULT_BRIDGE_CONTAINER = "lk-sabanet-bridge"
DEFAULT_AOR = "sabanet_aor"
RETENTION_DAYS = 30
SEVEN_DAYS_SECONDS = 7 * 24 * 3600.0

REG_STATUS_WORDS = (
    "Registered",
    "Unregistered",
    "Rejected",
    "Failed",
    "Stopped",
    "Retry Wait",
    "Auth. Sent",
    "Unknown",
)


def _run(cmd: list[str], timeout: float = 20) -> tuple[int, str]:
    """Execute shell command capturing stdout without raising."""
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return res.returncode, res.stdout
    except FileNotFoundError:
        return 127, ""
    except subprocess.TimeoutExpired:
        return 124, ""
    except OSError:
        return 126, ""


def parse_registrations(raw_text: str) -> list[str]:
    """Extract registration status word for each registration row.

    Rows are identified by '/sip' URI or registration table structure; the URI is discarded.
    """
    statuses = []
    pattern = re.compile(r"\b(" + "|".join(re.escape(w) for w in REG_STATUS_WORDS) + r")\b")
    for line in raw_text.splitlines():
        if "/sip" not in line and "Objects found" not in line:
            status_re = r"\S+\s+\S+\s+(?:" + "|".join(re.escape(w) for w in REG_STATUS_WORDS) + r")"
            if not re.search(status_re, line):
                continue
        m = pattern.search(line)
        if m:
            statuses.append(m.group(1))
    return statuses


def parse_contacts(raw_text: str, aor_name: str | None = None) -> dict:
    """Extract carrier contact qualify state and RTT.

    Status: Avail, Unavail, NonQual, Unknown, Created, Removed.
    """
    qual_pattern = re.compile(
        r"^\s*Contact:\s+(\S+?)/(?:sips?:\S+)\s+\S+\s+"
        r"(Avail|Unavail|NonQual|Unknown|Created|Removed)\s+(\S+)",
        re.IGNORECASE,
    )
    external_contacts = []
    for line in raw_text.splitlines():
        m = qual_pattern.match(line)
        if not m:
            continue
        contact_aor = m.group(1).split("/")[0]
        status = m.group(2)
        rtt_raw = m.group(3)
        try:
            rtt = float(rtt_raw)
            if rtt != rtt:  # NaN
                rtt = None
        except ValueError:
            rtt = None

        # Filter by AOR if specified
        if aor_name and aor_name.lower() not in contact_aor.lower():
            continue

        external_contacts.append({"aor_match": True, "status": status, "rtt_ms": rtt})

    if not external_contacts:
        return {"state": "none", "rtt_ms": None}

    # Worst status wins
    bad = [c["status"] for c in external_contacts if c["status"] != "Avail"]
    rtts = [c["rtt_ms"] for c in external_contacts if c["rtt_ms"] is not None]
    return {
        "state": bad[0] if bad else "Avail",
        "rtt_ms": max(rtts) if rtts else None,
    }


def collect_bridge_status(
    bridge_container: str = DEFAULT_BRIDGE_CONTAINER,
    aor_name: str = DEFAULT_AOR,
    runner=_run,
) -> dict:
    """Query Asterisk bridge via Docker exec and parse registration & qualify status."""
    cmd_reg = ["docker", "exec", bridge_container, "asterisk", "-rx", "pjsip show registrations"]
    cmd_cont = ["docker", "exec", bridge_container, "asterisk", "-rx", "pjsip show contacts"]
    rc_reg, out_reg = runner(cmd_reg)
    _rc_cont, out_cont = runner(cmd_cont)

    if rc_reg != 0:
        return {
            "bridge": bridge_container,
            "connected": False,
            "status": "error",
            "registrations": [],
            "qualify": {"state": "unknown", "rtt_ms": None},
            "error": f"asterisk exec failed (code {rc_reg})",
        }

    regs = parse_registrations(out_reg)
    cont = parse_contacts(out_cont, aor_name=aor_name)

    # Determine overall registration status word
    if not regs:
        overall_status = "none"
    elif all(r == "Registered" for r in regs):
        overall_status = "Registered"
    else:
        # Pick the worst status
        non_reg = [r for r in regs if r != "Registered"]
        overall_status = non_reg[0] if non_reg else "Unknown"

    return {
        "bridge": bridge_container,
        "connected": True,
        "status": overall_status,
        "registrations": regs,
        "qualify": cont,
        "error": None,
    }


def load_history(state_file: Path) -> dict:
    """Load JSON state history from disk."""
    if not state_file.exists():
        return {
            "first_seen": None,
            "last_check": None,
            "current_status": "Unknown",
            "registered_since": None,
            "consecutive_registered_seconds": 0.0,
            "seven_day_stable": False,
            "transitions": [],
            "samples": [],
        }
    try:
        data = json.loads(state_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("not a dict")
        return data
    except (OSError, ValueError):
        return {
            "first_seen": None,
            "last_check": None,
            "current_status": "Unknown",
            "registered_since": None,
            "consecutive_registered_seconds": 0.0,
            "seven_day_stable": False,
            "transitions": [],
            "samples": [],
        }


def update_history(
    history: dict,
    status_snapshot: dict,
    now: float | None = None,
) -> tuple[dict, bool, str | None]:
    """Update state history with the latest snapshot, compute 7-day uptime, and detect alerts.

    Returns (updated_history, alert_triggered, alert_message).
    """
    now = time.time() if now is None else now
    prev_status = history.get("current_status", "Unknown")
    curr_status = status_snapshot.get("status", "Unknown")

    if history.get("first_seen") is None:
        history["first_seen"] = now
    history["last_check"] = now

    alert_triggered = False
    alert_message = None

    # Detect state transition
    if prev_status != curr_status and prev_status != "Unknown":
        transition_entry = {
            "ts": now,
            "from": prev_status,
            "to": curr_status,
        }
        history.setdefault("transitions", []).append(transition_entry)

        if prev_status == "Registered" and curr_status != "Registered":
            alert_triggered = True
            b_name = status_snapshot.get("bridge")
            alert_message = (
                f"ALERT: SIP registration dropped from Registered to {curr_status} "
                f"on bridge {b_name} (NAT/firewall drop or carrier disconnect)"
            )
        elif prev_status != "Registered" and curr_status == "Registered":
            b_name = status_snapshot.get("bridge")
            alert_message = f"INFO: SIP registration recovered to Registered on bridge {b_name}"

    # Update registered_since and consecutive seconds
    if curr_status == "Registered":
        if history.get("registered_since") is None:
            history["registered_since"] = now
        consecutive_s = now - history["registered_since"]
    else:
        history["registered_since"] = None
        consecutive_s = 0.0

    history["current_status"] = curr_status
    history["consecutive_registered_seconds"] = max(0.0, consecutive_s)
    history["consecutive_registered_days"] = round(consecutive_s / 86400.0, 2)
    history["seven_day_stable"] = consecutive_s >= SEVEN_DAYS_SECONDS

    # Append sample
    samples = history.setdefault("samples", [])
    samples.append({
        "ts": now,
        "status": curr_status,
        "qualify": status_snapshot.get("qualify", {}).get("state"),
        "rtt_ms": status_snapshot.get("qualify", {}).get("rtt_ms"),
    })

    # Prune samples and transitions older than RETENTION_DAYS
    retention_cutoff = now - (RETENTION_DAYS * 86400.0)
    history["samples"] = [s for s in samples if s.get("ts", 0) >= retention_cutoff]
    history["transitions"] = [
        t for t in history.get("transitions", []) if t.get("ts", 0) >= retention_cutoff
    ]

    return history, alert_triggered, alert_message


def save_history(state_file: Path, history: dict) -> None:
    """Save state history atomically."""
    state_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_file.with_name(f"{state_file.name}.tmp")
    tmp.write_text(json.dumps(history, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(state_file)


def format_report(snapshot: dict, history: dict) -> str:
    """Format human-readable audit report."""
    status = snapshot.get("status", "unknown")
    qualify = snapshot.get("qualify", {})
    qual_str = qualify.get("state", "unknown")
    if qualify.get("rtt_ms") is not None:
        qual_str += f" ({qualify['rtt_ms']:.1f} ms)"

    consec_days = history.get("consecutive_registered_days", 0.0)
    consec_s = history.get("consecutive_registered_seconds", 0.0)
    if history.get("seven_day_stable"):
        seven_day_goal = "MET (>= 7 days)"
    else:
        seven_day_goal = f"IN PROGRESS ({consec_days:.1f}/7.0 days)"

    lines = [
        "=== SIP Trunk Registration & NAT Status ===",
        f"Bridge Container:     {snapshot.get('bridge')}",
        f"Registration Status:  {status}",
        f"Carrier Qualify:      {qual_str}",
        f"Continuous Uptime:    {consec_days:.2f} days ({int(consec_s)} seconds)",
        f"7-Day Stability Goal: {seven_day_goal}",
    ]

    transitions = history.get("transitions", [])
    if transitions:
        lines.append(f"Transitions (last {RETENTION_DAYS}d):  {len(transitions)} event(s)")
        for t in transitions[-5:]:
            ts_iso = datetime.fromtimestamp(t["ts"], UTC).strftime("%Y-%m-%d %H:%M:%SZ")
            lines.append(f"  - {ts_iso}: {t['from']} -> {t['to']}")
    else:
        lines.append("Transitions:          None recorded (clean uptime)")

    if snapshot.get("error"):
        lines.append(f"Warning / Error:      {snapshot['error']}")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--state-file",
        default=os.environ.get("PHONE_SIP_STATE_FILE", DEFAULT_STATE_FILE),
        help=f"Path to JSON state history file (default: {DEFAULT_STATE_FILE})",
    )
    parser.add_argument(
        "--bridge",
        default=os.environ.get("PHONE_SIP_BRIDGE", DEFAULT_BRIDGE_CONTAINER),
        help=f"Asterisk bridge docker container (default: {DEFAULT_BRIDGE_CONTAINER})",
    )
    parser.add_argument(
        "--aor",
        default=os.environ.get("PHONE_SIP_AOR", DEFAULT_AOR),
        help=f"Carrier AOR name (default: {DEFAULT_AOR})",
    )
    parser.add_argument("--json", action="store_true", help="Output summary in JSON format")
    parser.add_argument("--dry-run", action="store_true", help="Do not persist updated state")
    parser.add_argument("--short", action="store_true", help="Output only status word and 7d goal")
    parser.add_argument("--alert", action="store_true", help="Emit alert message on state change")

    args = parser.parse_args(argv)

    snapshot = collect_bridge_status(
        bridge_container=args.bridge,
        aor_name=args.aor,
    )

    state_path = Path(args.state_file)
    history = load_history(state_path)
    updated_history, alert_triggered, alert_msg = update_history(history, snapshot)

    if not args.dry_run:
        try:
            save_history(state_path, updated_history)
        except OSError as e:
            sys.stderr.write(f"Warning: could not save state to {state_path}: {e}\n")

    if alert_triggered and (args.alert or not args.short):
        sys.stderr.write(f"{alert_msg}\n")

    if args.json:
        out = {
            "snapshot": snapshot,
            "uptime": {
                "consecutive_registered_seconds": updated_history.get(
                    "consecutive_registered_seconds", 0.0
                ),
                "consecutive_registered_days": updated_history.get(
                    "consecutive_registered_days", 0.0
                ),
                "seven_day_stable": updated_history.get("seven_day_stable", False),
            },
            "alert": {
                "triggered": alert_triggered,
                "message": alert_msg,
            },
        }
        print(json.dumps(out, indent=2, sort_keys=True))
    elif args.short:
        status = snapshot.get("status", "unknown")
        seven_d = "7d-stable" if updated_history.get("seven_day_stable") else "unstable"
        print(f"{status} ({seven_d})")
    else:
        print(format_report(snapshot, updated_history))

    return 0 if snapshot.get("status") == "Registered" else 1


if __name__ == "__main__":
    sys.exit(main())
