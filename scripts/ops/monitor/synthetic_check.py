#!/usr/bin/env python3
"""Synthetic production monitor: HTTP, judge health, real chat round-trip, TLS, domain expiry, disk.

Stdlib only. Alerts by e-mail only on state change plus a reminder every 2 h.

Usage: synthetic_check.py [--once] [--dry-run] [--force-chat] [--state PATH]
Env (names only): MONITOR_DOMAINS, MONITOR_CHAT_BASE, MONITOR_CHAT_INTERVAL_MIN,
MONITOR_CHAT_TIMEOUT_S, MONITOR_CERT_WARN_DAYS, MONITOR_DISK_WARN_PCT, MONITOR_PATHS,
MONITOR_DOMAIN_WARN_DAYS, MONITOR_WHOIS_INTERVAL_H,
MONITOR_CHECK_DISK, MONITOR_STATE_FILE, MONITOR_SILENCE, MONITOR_BYPASS_TOKEN,
BACKUP_SMTP_USER, BACKUP_SMTP_PASS, BACKUP_NOTIFY_TO.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from http.client import HTTPException

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import domain_expiry  # noqa: E402
import monitor_common as mc  # noqa: E402

DEFAULT_DOMAINS = "ghazihoushmand.ir,roxira.ir,roxira.net"
# Extra pages that must answer 200, as host/path (comma separated), e.g. "roxira.ir/app".
# Opt-in (empty by default): set MONITOR_PATHS only after confirming the page returns 200
# from srv1 (not a 401 or a redirect to a login page).
DEFAULT_PATHS = ""
CHAT_QUESTION = "مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی چند روز است؟"
SANITY_MARKERS = ("۲۰", "20", "بیست")
HTTP_TIMEOUT_S = 5.0
MONITOR_BYPASS_MIN_LEN = 32


def monitor_bypass_token() -> str:
    """MONITOR_BYPASS_TOKEN when set and >= 32 chars; "" otherwise (feature off, matches the app)."""
    token = os.environ.get("MONITOR_BYPASS_TOKEN", "")
    return token if len(token) >= MONITOR_BYPASS_MIN_LEN else ""


def env_f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def http(url: str, timeout: float, data: bytes | None = None, headers: dict | None = None):
    """Return (status, body_bytes, elapsed_s). status 0 on transport error."""
    # Cloudflare blocks the default "Python-urllib" User-Agent with 403.
    hdrs = {"User-Agent": "RoxiraMonitor/1.0 (+https://roxira.ir)"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST" if data else "GET")
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return resp.status, resp.read(1_000_000), time.monotonic() - start
    except urllib.error.HTTPError as exc:
        return exc.code, b"", time.monotonic() - start
    except (urllib.error.URLError, OSError, ValueError, HTTPException):
        # HTTPException covers IncompleteRead / BadStatusLine / InvalidURL, which are not OSErrors.
        return 0, b"", time.monotonic() - start


def _guard(fn, *args):
    """Run one check; an unexpected exception becomes a FAIL for that check only."""
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 - one broken check must not stop the run
        return False, f"unexpected {type(exc).__name__}: {mc.scrub(str(exc), 80)}"


def whois_due(state: dict, now: float, interval_h: float) -> bool:
    """WHOIS only every few hours: registries rate-limit and expiry moves in days."""
    return now - state.get("last_whois_ts", 0) >= interval_h * 3600 - 30


def check_site(domain: str):
    for attempt in (1, 2):
        status, _, took = http(f"https://{domain}/", HTTP_TIMEOUT_S)
        if status == 200 and took < HTTP_TIMEOUT_S:
            return True, f"200 in {took:.1f}s"
        if attempt == 1:
            time.sleep(3)
    return False, f"status={status} in {took:.1f}s"


def check_health(base: str):
    detail = ""
    for attempt in (1, 2):
        status, _, took = http(f"{base}/api/v1/apps/judge/health", HTTP_TIMEOUT_S)
        if status != 200:
            st2, _, took = http(f"{base}/health", HTTP_TIMEOUT_S)
            status = st2 if st2 == 200 else status
        if status == 200:
            return True, f"200 in {took:.1f}s"
        detail = f"status={status}"
        if attempt == 1:
            time.sleep(3)
    return False, detail


def evaluate_chat_reply(status: int, body: bytes, took: float, limit: float,
                        bypass_configured: bool = False):
    """Pure verdict for a chat response (unit-tested).

    Without a bypass token a 429 is the guest/free daily cap: a WARN "quota" result, not an
    outage. With a token configured a 429 means the bypass is not working, so it stays a failure.
    """
    if status == 429 and not bypass_configured:
        return True, f"WARN quota: http status=429 in {took:.1f}s"
    if status != 200:
        return False, f"http status={status} in {took:.1f}s"
    try:
        reply = json.loads(body.decode("utf-8")).get("reply")
    except (ValueError, AttributeError):
        return False, "response is not JSON with a reply field"
    if not isinstance(reply, str) or not reply.strip():
        return False, "empty reply"
    if took >= limit:
        return False, f"too slow: {took:.1f}s >= {limit:.0f}s"
    if not any(m in reply for m in SANITY_MARKERS):
        return False, f"reply lacks expected answer (20 days) in {took:.1f}s"
    return True, f"ok in {took:.1f}s"


def check_chat(base: str):
    limit = env_f("MONITOR_CHAT_TIMEOUT_S", 45)
    token = monitor_bypass_token()
    payload = json.dumps({"message": CHAT_QUESTION, "request_id": "synthetic-" + uuid.uuid4().hex[:12]}).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "roxira-synthetic-monitor"}
    if token:
        headers["X-Roxira-Monitor"] = token
    verdict = (False, "not run")
    for attempt in (1, 2):
        status, body, took = http(f"{base}/api/v1/apps/judge/chat", limit + 5, payload, headers)
        verdict = evaluate_chat_reply(status, body, took, limit, bypass_configured=bool(token))
        if verdict[0]:
            return verdict
        if attempt == 1:
            time.sleep(5)
    return verdict


def check_cert(domain: str, warn_days: float):
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=HTTP_TIMEOUT_S) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as tls:
                cert = tls.getpeercert()
        days = (ssl.cert_time_to_seconds(cert["notAfter"]) - time.time()) / 86400
    except (OSError, ssl.SSLError, KeyError, ValueError) as exc:
        return False, f"tls error: {type(exc).__name__}"
    return days >= warn_days, f"{days:.0f} days left"


def check_disk(warn_pct: float):
    usage = shutil.disk_usage("/")
    pct = usage.used * 100 / usage.total
    return pct <= warn_pct, f"{pct:.0f}% used"


def chat_due(state: dict, now: float, interval_min: float, force: bool) -> bool:
    return force or now - state.get("last_chat_ts", 0) >= interval_min * 60 - 30


def run(args) -> int:
    state_path = args.state or os.environ.get("MONITOR_STATE_FILE", "/var/lib/roxira-monitor/state.json")
    domains = [d.strip() for d in os.environ.get("MONITOR_DOMAINS", DEFAULT_DOMAINS).split(",") if d.strip()]
    base = os.environ.get("MONITOR_CHAT_BASE", f"https://{domains[0]}").rstrip("/")
    warn_days = env_f("MONITOR_CERT_WARN_DAYS", 21)
    now = time.time()
    state = mc.load_state(state_path)
    results = {}
    try:
        for d in domains:
            results[f"site:{d}"] = _guard(check_site, d)
            results[f"tls:{d}"] = _guard(check_cert, d, warn_days)
        for p in os.environ.get("MONITOR_PATHS", DEFAULT_PATHS).split(","):
            if p.strip():
                results[f"site:{p.strip()}"] = _guard(check_site, p.strip().rstrip("/"))
        if whois_due(state, now, env_f("MONITOR_WHOIS_INTERVAL_H", 6)):
            domain_warn = env_f("MONITOR_DOMAIN_WARN_DAYS", 30)
            for d in domains:
                verdict = _guard(domain_expiry.check_domain_expiry, d, domain_warn)
                if verdict is not None:  # no WHOIS answer: skip, keep the previous state
                    results[f"domain:{d}"] = verdict
            state["last_whois_ts"] = now
        results["judge-health"] = _guard(check_health, base)
        if chat_due(state, now, env_f("MONITOR_CHAT_INTERVAL_MIN", 15), args.force_chat):
            results["chat"] = _guard(check_chat, base)
            state["last_chat_ts"] = now
        if os.environ.get("MONITOR_CHECK_DISK") == "1":
            results["disk:/"] = _guard(check_disk, env_f("MONITOR_DISK_WARN_PCT", 85))

        checks, alerts = mc.evaluate(state.get("checks", {}), results, now)
        state["checks"], state["last_run"] = checks, now
        for key, (ok, detail) in sorted(results.items()):
            print(f"{'OK  ' if ok else 'FAIL'} {key}: {detail}")

        if alerts:
            try:
                subject, body = mc.format_alerts(alerts, socket.gethostname(), "synthetic")
                if mc.silenced() and not args.dry_run:
                    print("alerts silenced:", subject)
                else:
                    mc.send_email(subject, body, dry_run=args.dry_run)
            except Exception as exc:  # noqa: BLE001 - state must still be saved below
                print(f"alert not sent: {type(exc).__name__}")
    finally:
        # Runs on every path (including an unexpected error above) so the alert state
        # and last_chat_ts are never lost between timer runs.
        if not args.dry_run:
            mc.save_state(state_path, state)
    return 1 if any(not v[0] for v in results.values()) else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--once", action="store_true", help="single run (default; kept for timers/launchd)")
    ap.add_argument("--dry-run", action="store_true", help="print the e-mail instead of sending; do not write state")
    ap.add_argument("--force-chat", action="store_true", help="run the chat check regardless of the interval")
    ap.add_argument("--state", help="state file path")
    try:
        return run(ap.parse_args(argv))
    except Exception as exc:  # noqa: BLE001 - exit 1 with a one-line reason, never a traceback
        print(f"FAIL monitor: unexpected {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
