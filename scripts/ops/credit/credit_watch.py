#!/usr/bin/env python3
"""Hourly OpenRouter credit watch (owner 2026-10-16: nothing may stop when credit runs out).

Reads the balance of each OpenRouter key named in WATCH_KEYS from the server .env (values never printed),
writes /root/deploy-state/credit.json, and warns the owner bot when a key is low or empty (at most once per
12 h per key). Routing already survives an empty key: vip-product falls back to the free ladder and agents
start on best-all; this watch only tells the owner to top up.

  credit_watch.py [--dry-run]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request

ENV_FILE = os.environ.get("ROXIRA_REPO_ENV", "/opt/roxira_platform/.env")
STATE = os.environ.get("CREDIT_STATE", "/root/deploy-state/credit.json")
NOTIFY = os.environ.get("NOTIFY_PY", "/opt/roxira_platform/scripts/ops/notify/notify.py")
WATCH_KEYS = ("OPENROUTER_API_KEY", "OPENROUTER_API_KEY_AGENTS")
LOW_USD = float(os.environ.get("CREDIT_LOW_USD", "1.0"))
REMIND_S = 12 * 3600


def env_values(path: str) -> dict:
    out = {}
    try:
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def get_json(url: str, key: str, timeout: float = 20) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def key_status(key: str, fetch=get_json) -> dict:
    """{'remaining': float|None, 'limit_remaining': float|None, 'credits_left': float|None, 'error': str}."""
    st = {"limit_remaining": None, "credits_left": None, "error": ""}
    try:
        data = fetch("https://openrouter.ai/api/v1/key", key).get("data", {})
        lr = data.get("limit_remaining")
        st["limit_remaining"] = float(lr) if lr is not None else None
    except Exception as exc:  # noqa: BLE001 - report, never crash
        st["error"] = f"key:{getattr(exc, 'code', type(exc).__name__)}"
    try:
        data = fetch("https://openrouter.ai/api/v1/credits", key).get("data", {})
        st["credits_left"] = float(data.get("total_credits", 0)) - float(data.get("total_usage", 0))
    except Exception as exc:  # noqa: BLE001
        st["error"] = (st["error"] + f" credits:{getattr(exc, 'code', type(exc).__name__)}").strip()
    vals = [v for v in (st["limit_remaining"], st["credits_left"]) if v is not None]
    st["remaining"] = min(vals) if vals else None
    return st


def alerts(report: dict, last: dict, now: float) -> list:
    out = []
    for name, st in report.items():
        rem = st.get("remaining")
        low = rem is not None and rem < LOW_USD
        if (low or st.get("error")) and now - last.get(name, 0) >= REMIND_S:
            what = f"باقی‌مانده {rem:.2f} دلار" if rem is not None else f"خطا: {st.get('error')}"
            out.append((name, f"⚠️ اعتبار OpenRouter کلید {name}: {what}. سیستم روی مدل‌های رایگان ادامه می‌دهد؛ لطفاً شارژ کنید."))
    return out


def main(argv=None) -> int:
    dry = "--dry-run" in (argv if argv is not None else sys.argv[1:])
    env = env_values(ENV_FILE)
    report = {n: key_status(env[n]) for n in WATCH_KEYS if env.get(n)}
    now = time.time()
    try:
        prev = json.load(open(STATE, encoding="utf-8"))
    except (OSError, ValueError):
        prev = {}
    last = prev.get("alerted", {})
    sent = alerts(report, last, now)
    for name, text in sent:
        if dry:
            print("[dry-run] would notify:", text)
        else:
            subprocess.run(["python3", NOTIFY, text], capture_output=True, timeout=30, check=False)
            last[name] = now
    for name, st in report.items():
        print(name, "remaining", st["remaining"], st["error"])
    if not dry:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        json.dump({"ts": now, "report": report, "alerted": last}, open(STATE, "w", encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
