"""Shared helpers for the Roxira monitors: alert state machine, e-mail, PII scrubbing.

Stdlib only. No network access at import time.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import tempfile
import time

REMIND_SECONDS = 2 * 3600

_PHONE = re.compile(r"(?<!\d)(?:\+?98|0)?9\d{9}(?!\d)")
_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+")
_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*")
_LONG_TOKEN = re.compile(r"[A-Za-z0-9_\-]{24,}")
_KV_SECRET = re.compile(r"(?i)\b(token|key|secret|password|pass|otp|code|authorization)=\S+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")


def scrub(text: str, limit: int = 160) -> str:
    """Remove phone numbers, tokens, e-mails and IPs from a log fragment."""
    text = _JWT.sub("[jwt]", text)
    text = _BEARER.sub("[bearer]", text)
    text = _KV_SECRET.sub(lambda m: m.group(1) + "=[x]", text)
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    text = _IPV4.sub("[ip]", text)
    text = _LONG_TOKEN.sub("[token]", text)
    return text[:limit]


# ---------------------------------------------------------------- state -----
def load_state(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(path: str, state: dict) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".state-")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, path)


def evaluate(checks: dict, results: dict, now: float, remind_seconds: int = REMIND_SECONDS):
    """Alert-on-change state machine.

    checks: previous per-check state {key: {"ok": bool, "since": ts, "last_alert": ts}}.
    results: {key: (ok: bool, detail: str)} for the checks that ran this time.
    Returns (new_checks, alerts) where alerts is a list of (kind, key, detail) with
    kind in {"FAIL", "RECOVERED", "STILL FAILING"}.
    Checks that did not run keep their previous state untouched.
    """
    new = {k: dict(v) for k, v in checks.items()}
    alerts = []
    for key, (ok, detail) in results.items():
        prev = new.get(key)
        if prev is None:
            # First sight: only a failure is worth an alert.
            new[key] = {"ok": ok, "since": now, "detail": detail,
                        "last_alert": now if not ok else 0}
            if not ok:
                alerts.append(("FAIL", key, detail))
            continue
        if prev["ok"] and not ok:
            new[key] = {"ok": False, "since": now, "detail": detail, "last_alert": now}
            alerts.append(("FAIL", key, detail))
        elif not prev["ok"] and ok:
            down = int(now - prev.get("since", now))
            new[key] = {"ok": True, "since": now, "detail": detail, "last_alert": 0}
            alerts.append(("RECOVERED", key, f"{detail} (down {down // 60} min)"))
        elif not ok:
            prev["detail"] = detail
            if now - prev.get("last_alert", 0) >= remind_seconds:
                prev["last_alert"] = now
                alerts.append(("STILL FAILING", key, detail))
        else:
            prev["detail"] = detail
    return new, alerts


# ---------------------------------------------------------------- e-mail ----
def format_alerts(alerts, host: str, title: str) -> tuple[str, str]:
    kinds = {a[0] for a in alerts}
    tag = "ALERT" if kinds - {"RECOVERED"} else "OK"
    subject = f"[Roxira {tag}] {title}: " + ", ".join(sorted({a[1] for a in alerts}))[:120]
    lines = [f"{kind}: {key} - {detail}" for kind, key, detail in alerts]
    return subject, "\n".join(lines) + f"\n\nhost: {host}\n"


_NOTIFY_BOT = None


def _notify_module():
    """Load scripts/ops/notify/notify.py once (the single digest queue). False when unavailable."""
    global _NOTIFY_BOT
    if _NOTIFY_BOT is None:
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            path = os.path.join(here, "..", "notify", "notify.py")
            spec = importlib.util.spec_from_file_location("notify", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            _NOTIFY_BOT = module
        except Exception:
            _NOTIFY_BOT = False
    return _NOTIFY_BOT


def queue_alerts(alerts, source: str, dry_run: bool = False) -> None:
    """Put evaluate() alerts into the digest queue (no e-mail now). Call on EVERY run, even with
    an empty list: the urgent rule (site down > 15 min -> Telegram) needs to see ongoing failures."""
    if dry_run:
        for kind, key, detail in alerts:
            print(f"[dry-run] would queue {kind}: {key} - {detail}")
        return
    mod = _notify_module()
    if mod:
        mod.enqueue_alerts(alerts, source)


def queue_report(title: str, body: str, path: str = "", source: str = "report", dry_run: bool = False) -> bool:
    """Queue a report for the next digest (short summary + file path only)."""
    if dry_run:
        print(f"[dry-run] would queue report: {title}\n" + "\n".join("    " + x for x in body.splitlines()[:8]))
        return True
    mod = _notify_module()
    return bool(mod and mod.enqueue_report(source, title, body, path))


def send_email(subject: str, body: str, dry_run: bool = False) -> bool:
    """Compatibility name: nothing is mailed at once any more (owner rule 2026-11-04, max 2 mails a day).

    The message goes into the digest queue; roxira-digest.timer mails ONE digest at 08:00 and 20:00 Tehran.
    """
    return queue_report(subject, body, source="mail", dry_run=dry_run)


def silenced() -> bool:
    """MONITOR_SILENCE=1 or an existing silence file mutes e-mail (checks still run)."""
    path = os.environ.get("MONITOR_SILENCE_FILE", "/var/lib/roxira-monitor/silence")
    if os.environ.get("MONITOR_SILENCE") == "1":
        return True
    try:
        return os.path.getmtime(path) + float(os.environ.get("MONITOR_SILENCE_MAX_HOURS", "24")) * 3600 > time.time()
    except OSError:
        return False
