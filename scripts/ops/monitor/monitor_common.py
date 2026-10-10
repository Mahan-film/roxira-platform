"""Shared helpers for the Roxira monitors: alert state machine, e-mail, PII scrubbing.

Stdlib only. No network access at import time.
"""

from __future__ import annotations

import json
import os
import re
import smtplib
import ssl
import tempfile
import time
from email.message import EmailMessage

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


def send_email(subject: str, body: str, dry_run: bool = False) -> bool:
    """Send via SMTP using BACKUP_SMTP_USER / BACKUP_SMTP_PASS / BACKUP_NOTIFY_TO."""
    user = os.environ.get("BACKUP_SMTP_USER", "")
    password = os.environ.get("BACKUP_SMTP_PASS", "")
    to = os.environ.get("BACKUP_NOTIFY_TO", "")
    if dry_run:
        print(f"[dry-run] would send email to={'<set>' if to else '<unset>'}\n"
              f"  subject: {subject}\n  body:\n" + "\n".join("    " + x for x in body.splitlines()))
        return True
    if not (user and password and to):
        print("email not sent: BACKUP_SMTP_USER/BACKUP_SMTP_PASS/BACKUP_NOTIFY_TO not all set")
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = user, to, subject
    msg.set_content(body)
    host = os.environ.get("BACKUP_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("BACKUP_SMTP_PORT", "465"))
    try:
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30) as s:
            s.login(user, password)
            s.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException) as exc:
        print(f"email send failed: {type(exc).__name__}")
        return False


def silenced() -> bool:
    """MONITOR_SILENCE=1 or an existing silence file mutes e-mail (checks still run)."""
    path = os.environ.get("MONITOR_SILENCE_FILE", "/var/lib/roxira-monitor/silence")
    if os.environ.get("MONITOR_SILENCE") == "1":
        return True
    try:
        return os.path.getmtime(path) + float(os.environ.get("MONITOR_SILENCE_MAX_HOURS", "24")) * 3600 > time.time()
    except OSError:
        return False
