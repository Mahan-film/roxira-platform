#!/usr/bin/env python3
"""Failure-transition alerts for the box, sent to Telegram only (work package J). Stdlib only.

Run by a user timer every few minutes. It collects a fresh snapshot (box_status.collect), turns it into pass/fail
checks, and runs them through monitor_common.evaluate (the repo's alert-on-change state machine). Rules:

* Only a pass -> fail transition (or a failure seen on first sight) is sent. Recoveries and "still failing"
  reminders are never sent. At most one message per run, at most one message per incident.
* A per-check cooldown (default 3 h) stops a flapping check from re-sending.
* A check whose source is unknown (gh error, unreadable DB) is left out: it neither opens nor clears an incident.
* A message that could not be delivered stays pending and is retried while the check still fails.
* No e-mail at all (owner rule: max 2 e-mails a day, urgent goes to Telegram only).
* The Telegram token and chat id come from a mode-600 env file outside the repo (default
  ~/.config/roxira-status/telegram.env; keys TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID or NOTIFY_BOT_TOKEN/NOTIFY_CHAT_ID).
  Missing file, wrong mode or empty values: log a warning and exit 0 without doing anything. Values are never printed.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import stat
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path(os.environ.get("HOME", "/"))
DEFAULT_ENV = HOME / ".config/roxira-status/telegram.env"
DEFAULT_STATE = HOME / ".local/state/roxira-status/alert-state.json"
DISK_LIMIT_PCT = 85.0
RUNNER_GRACE_S = 600
COST_RATIO = 0.8
COOLDOWN_S = 3 * 3600
NEVER = 10 ** 12  # remind_seconds for monitor_common.evaluate: its reminders are switched off here


def log(msg: str) -> None:
    print(f"box-alert: {msg}", file=sys.stderr)


def _load(name: str, *candidates: Path):
    """Import a sibling module by path (installed copy first, repo layout second); lazy, no import-time work."""
    for path in candidates:
        if path.exists():
            spec = importlib.util.spec_from_file_location(name, path)
            mod = importlib.util.module_from_spec(spec)
            sys.modules.setdefault(name, mod)
            spec.loader.exec_module(mod)
            return mod
    raise ImportError(f"cannot find {name}.py")


def load_deps():
    mc = _load("monitor_common", HERE / "monitor_common.py", HERE.parents[1] / "monitor" / "monitor_common.py")
    nt = _load("notify", HERE / "notify.py", HERE.parents[1] / "notify" / "notify.py")
    bs = _load("box_status", HERE / "box_status.py")
    return mc, nt, bs


# ------------------------------------------------------------------ env file
def read_credentials(path: Path) -> tuple[dict | None, str]:
    """({"token", "chat_id"}, "") or (None, reason). Checks existence and mode 600; never returns/prints values in reason."""
    try:
        st = path.stat()
    except OSError:
        return None, "env file missing"
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        return None, "env file is group/world accessible (need mode 600)"
    vals = {}
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip().removeprefix("export ")
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            vals[k.strip()] = v
    except OSError:
        return None, "env file unreadable"
    token = vals.get("TELEGRAM_BOT_TOKEN") or vals.get("NOTIFY_BOT_TOKEN") or ""
    chat = vals.get("TELEGRAM_CHAT_ID") or vals.get("NOTIFY_CHAT_ID") or ""
    if not token or not chat:
        return None, "env file has no token or chat id yet"
    return {"token": token, "chat_id": chat}, ""


# ------------------------------------------------------------------ snapshot -> checks (pure)
def derive_results(snap: dict, state: dict, now: float) -> dict:
    """{check_key: (ok, detail)}. Unknown sources are omitted. Mutates state['runner_since'] (first-seen-offline)."""
    res: dict = {}
    # tunnel: only when the tunnel unit is installed (otherwise nobody expects a tunnel)
    tunnel_unit = (snap.get("units") or {}).get("roxira-gateway-tunnel.service") or {}
    tu = snap.get("tunnel") or {}
    if tunnel_unit.get("state") not in (None, "neutral") and tu.get("state") in ("ok", "failed"):
        res["tunnel"] = (tu["state"] == "ok", f"gateway tunnel: {tu.get('text', '')}")
    # disks
    for d in (snap.get("system") or {}).get("disks", []):
        if d.get("used_pct") is not None:
            res[f"disk:{d['path']}"] = (d["used_pct"] < DISK_LIMIT_PCT, f"disk {d['path']} at {d['used_pct']}% (limit {DISK_LIMIT_PCT:g}%)")
    # units: failed only; neutral/unknown are left out
    for unit, v in (snap.get("units") or {}).items():
        if v.get("state") in ("ok", "failed"):
            res[f"unit:{unit}"] = (v["state"] == "ok", f"{v.get('label', unit)}: {v.get('text', '')}")
    # runners: offline for more than 10 minutes
    since = state.setdefault("runner_since", {})
    reg = (snap.get("runners") or {}).get("registered") or {}
    if reg.get("state") == "ok":
        names = set()
        for r in reg.get("runners", []):
            names.add(r["name"])
            if r["status"] == "online":
                since.pop(r["name"], None)
                res[f"runner:{r['name']}"] = (True, f"runner {r['name']} online")
            else:
                t0 = since.setdefault(r["name"], now)
                res[f"runner:{r['name']}"] = (now - t0 < RUNNER_GRACE_S, f"runner {r['name']} offline for {int((now - t0) // 60)} min")
        for gone in [k for k in since if k not in names]:  # a runner that vanished from the list counts as offline too
            res[f"runner:{gone}"] = (now - since[gone] < RUNNER_GRACE_S, f"runner {gone} not registered for {int((now - since[gone]) // 60)} min")
    # orch breaker
    orch = snap.get("orch") or {}
    if orch.get("jobs") is not None and orch.get("state") == "ok":
        for b in orch.get("breakers", []):
            res[f"orch-breaker:{b['lane']}"] = (not b["open"], f"orch circuit breaker open for lane {b['lane']} ({b['fails']} failures)")
    # cost vs cap
    cost = snap.get("cost") or {}
    if cost.get("state") != "unknown" and "lanes" in cost:
        for lane, v in cost["lanes"].items():
            if v.get("usd_ratio") is not None:
                res[f"cost:{lane}"] = (v["usd_ratio"] < COST_RATIO, f"lane {lane} spent {v['usd']:.3f} of {v['cap_usd']:g} USD today")
        if cost.get("total_ratio") is not None:
            res["cost:total"] = (cost["total_ratio"] < COST_RATIO, f"gateway spend {cost['total_usd']:.3f} of {cost['daily_cap_usd']:g} USD today")
    return res


def step(mc, snap: dict, state: dict, now: float, cooldown: float = COOLDOWN_S) -> list[str]:
    """One run of the state machine. Mutates state; returns the incident lines that should be sent now."""
    results = derive_results(snap, state, now)
    checks, alerts = mc.evaluate(state.get("checks", {}), results, now, remind_seconds=NEVER)
    state["checks"] = checks
    pending = state.setdefault("pending", {})
    for kind, key, detail in alerts:
        if kind == "FAIL":
            pending[key] = detail
    for key in list(pending):  # recovered (or no longer tracked) incidents are dropped, never announced
        if checks.get(key, {}).get("ok", True):
            del pending[key]
    sent = state.setdefault("sent", {})
    due = [k for k in sorted(pending) if now - sent.get(k, 0) >= cooldown]
    return [f"{k}: {pending[k]}" for k in due]


def mark_sent(state: dict, lines: list[str], now: float) -> None:
    for line in lines:
        key = line.split(": ", 1)[0]
        state.setdefault("sent", {})[key] = now
        state.setdefault("pending", {}).pop(key, None)


# ------------------------------------------------------------------ main
def run_once(env_file: Path, state_file: Path, dry_run: bool = False, send_test: bool = False, deps=None, now=None) -> int:
    creds, why = read_credentials(env_file)
    if creds is None:
        log(f"warning: {why}; alerts are OFF (nothing collected, nothing sent). Expected a mode-600 file at the configured path.")
        return 0
    mc, nt, bs = deps or load_deps()
    os.environ["NOTIFY_BOT_TOKEN"], os.environ["NOTIFY_CHAT_ID"] = creds["token"], creds["chat_id"]
    os.environ["NOTIFY_ENV_FILE"] = os.devnull  # notify.settings(): environment only, no server .env lookup
    now = time.time() if now is None else now
    if send_test:
        ok = nt.send("[box] test message from the status alert (no incident).")
        log("test message sent" if ok else "test message FAILED (check proxy and credentials)")
        return 0 if ok else 1
    state = mc.load_state(str(state_file))
    lines = step(mc, bs.collect(), state, now)
    if lines:
        text = "[box] FAILURE\n" + "\n".join(f"- {x}" for x in lines)
        if dry_run:
            print(f"[dry-run] would send:\n{text}")
            return 0
        if nt.send(text):
            mark_sent(state, lines, now)
        else:
            log("telegram send failed; incidents stay pending and are retried next run")
    if not dry_run:
        mc.save_state(str(state_file), state)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--env-file", default=os.environ.get("STATUS_TELEGRAM_ENV") or str(DEFAULT_ENV))
    p.add_argument("--state", default=os.environ.get("STATUS_ALERT_STATE") or str(DEFAULT_STATE))
    p.add_argument("--dry-run", action="store_true", help="print what would be sent; send nothing, save nothing")
    p.add_argument("--send-test", action="store_true", help="send one test message to check delivery")
    a = p.parse_args(argv)
    return run_once(Path(a.env_file), Path(a.state), a.dry_run, a.send_test)


if __name__ == "__main__":
    sys.exit(main())
