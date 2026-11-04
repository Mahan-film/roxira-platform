#!/usr/bin/env python3
"""One-way notification client for the owner's Telegram/Bale control plane.

Telegram (https://api.telegram.org) and Bale (https://tapi.bale.ai) expose the SAME
bot API, so ONE stdlib-only implementation (urllib, no dependencies) serves both.

Usage:
  python3 notify.py "some text"          # CLI: send one message
  from notify import send; send("text", buttons=[("OK", "cmd:ok")])

Env (read from the server .env, values never printed):
  NOTIFY_BOT_TOKEN  bot token from @BotFather / @botfather
  NOTIFY_CHAT_ID    owner chat id; the bot only ever talks to this chat
  NOTIFY_BOT_API    api base, default https://api.telegram.org (Bale: https://tapi.bale.ai)

Digest queue (owner rule 2026-11-04: at most 2 e-mails a day, ~08:00 and ~20:00 Tehran):
  every alert/recovery/report is QUEUED here instead of mailed; `notify.py --digest`
  (roxira-digest.timer) sends ONE grouped e-mail. Only URGENT problems go out at once,
  and only to Telegram (cooldown 1 h per problem). See docs/ops/NOTIFY_DIGEST.md.
    notify.py --digest [--dry-run] [--force]
    notify.py --urgent KEY "text"
    notify.py --queue info|alert SOURCE KEY "text"

When the token or chat id is missing the feature is OFF: send() is a silent no-op
and the CLI exits 0. A failure to reach the API never raises into the caller.
"""

from __future__ import annotations

import json
import os
import re
import smtplib
import sqlite3
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

DEFAULT_API = "https://api.telegram.org"
DEFAULT_ENV_FILE = "/opt/roxira_platform/.env"
TIMEOUT = 10
MAX_MESSAGE = 4096

# Same intent as monitor_common.scrub(): never let a token, phone number, e-mail,
# bearer header, JWT or IP leave through a notification. Kept local so this module
# has no import-time dependency on the monitor package.
_PHONE = re.compile(r"(?<!\d)(?:\+?98|0)?9\d{9}(?!\d)")
_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+")
_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*")
_KV_SECRET = re.compile(r"(?i)\b(token|key|secret|password|pass|otp|code|authorization)=\S+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_LONG_TOKEN = re.compile(r"[A-Za-z0-9_\-]{24,}")


def scrub(text: str, limit: int = 3500) -> str:
    """Remove phone numbers, tokens, e-mails, bearer headers, JWTs and IPs."""
    text = _JWT.sub("[jwt]", text)
    text = _BEARER.sub("[bearer]", text)
    text = _KV_SECRET.sub(lambda m: m.group(1) + "=[x]", text)
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    text = _IPV4.sub("[ip]", text)
    text = _LONG_TOKEN.sub("[token]", text)
    return text[:limit]


def _read_env_file(path: str) -> dict:
    """Parse KEY=VALUE lines (with optional export/quote handling); missing file = {}."""
    values: dict = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.removeprefix("export ").partition("=")
                key, value = key.strip(), value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values.setdefault(key, value)
    except OSError:
        pass
    return values


def settings() -> dict:
    """Resolve NOTIFY_* from the environment, then from the server .env. Values never printed."""
    file_env = _read_env_file(os.environ.get("NOTIFY_ENV_FILE", DEFAULT_ENV_FILE))

    def get(name: str, default: str = "") -> str:
        return os.environ.get(name) or file_env.get(name) or default

    return {
        "token": get("NOTIFY_BOT_TOKEN"),
        "chat_id": get("NOTIFY_CHAT_ID"),
        "api": get("NOTIFY_BOT_API", DEFAULT_API),
    }


def http_post(url: str, payload: dict, timeout: float = TIMEOUT) -> dict:
    """Default transport: JSON POST via urllib. Raises on network/HTTP errors."""
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    return json.loads(body) if body else {}


def send(text: str, buttons=None, *, http=None, timeout: float = TIMEOUT) -> bool:
    """Send a message to the configured chat. Silent no-op when not configured.

    buttons: optional list of (label, callback_data) pairs, rendered as one inline row.
    Returns True when the message was handed to the transport, False otherwise.
    Never raises into the caller.
    """
    try:
        cfg = settings()
        if not cfg["token"] or not cfg["chat_id"]:
            return False
        payload = {
            "chat_id": cfg["chat_id"],
            "text": scrub(text)[:MAX_MESSAGE],
            "disable_web_page_preview": True,
        }
        if buttons:
            payload["reply_markup"] = {
                "inline_keyboard": [
                    [{"text": label, "callback_data": data} for label, data in buttons]
                ]
            }
        url = f"{cfg['api'].rstrip('/')}/bot{cfg['token']}/sendMessage"
        result = (http or http_post)(url, payload, timeout)
        if isinstance(result, dict) and result.get("ok") is False:
            return False  # Telegram answers HTTP 200 {"ok": false} for chat-not-found / bot-blocked
        return True
    except Exception:
        return False



# ============================================================ digest queue ====
QUEUE_DB_DEFAULT = "/var/lib/roxira-notify/queue.db"
URGENT_COOLDOWN_S = 3600          # one Telegram message per problem per hour
URGENT_DOWN_S = 15 * 60           # a site down this long in a row is urgent
DIGEST_MIN_GAP_S = 6 * 3600       # never send two digests closer than this (unless --force)
TEHRAN = timezone(timedelta(hours=3, minutes=30))  # no DST since 2022
_URGENT_KEY = re.compile(r"^(site:|judge-health$)")
_DOWN_MIN = re.compile(r"\(down (\d+) min\)")

SCHEMA = """
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, source TEXT NOT NULL,
  key TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', down_s REAL NOT NULL DEFAULT 0, path TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS open_failures(
  key TEXT PRIMARY KEY, source TEXT NOT NULL, since REAL NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS cooldown(key TEXT PRIMARY KEY, last_ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


def light_scrub(text: str, limit: int = 2000) -> str:
    """Scrub secrets/PII but keep file paths readable (no long-token rule)."""
    text = _JWT.sub("[jwt]", text)
    text = _BEARER.sub("[bearer]", text)
    text = _KV_SECRET.sub(lambda m: m.group(1) + "=[x]", text)
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    return text[:limit]


def _db(path=None):
    path = path or os.environ.get("NOTIFY_QUEUE_DB", QUEUE_DB_DEFAULT)
    os.makedirs(os.path.dirname(path) or ".", mode=0o700, exist_ok=True)
    con = sqlite3.connect(path, timeout=30)
    con.executescript(SCHEMA)
    return con


def enqueue(source, key, kind, text="", severity="INFO", down_s=0.0, path="", now=None, db=None):
    """Append one event to the digest queue. Never raises; returns True when stored."""
    try:
        con = _db(db)
        with con:
            con.execute(
                "INSERT INTO events(ts,source,key,kind,severity,text,down_s,path) VALUES(?,?,?,?,?,?,?,?)",
                (now or time.time(), source, key, kind, severity, light_scrub(text), float(down_s), path))
        con.close()
        return True
    except Exception:
        return False


def enqueue_alerts(alerts, source, now=None, db=None, http=None) -> int:
    """Queue monitor_common.evaluate() alerts [(kind, key, detail)] and run the urgent rule.

    FAIL / RECOVERED become events; "STILL FAILING" repeats are muted (the open failure is
    reported once per digest from the open_failures table). Call it on EVERY run, also with an
    empty list, so a site that stays down is noticed. Returns the number of urgent messages sent.
    """
    now = now or time.time()
    try:
        con = _db(db)
        with con:
            for kind, key, detail in alerts:
                if kind == "FAIL":
                    con.execute("INSERT INTO events(ts,source,key,kind,severity,text) VALUES(?,?,?,?,?,?)",
                                (now, source, key, "FAIL", "ALERT", light_scrub(detail)))
                    con.execute("INSERT OR IGNORE INTO open_failures(key,source,since,detail) VALUES(?,?,?,?)",
                                (key, source, now, light_scrub(detail)))
                elif kind == "RECOVERED":
                    m = _DOWN_MIN.search(detail)
                    row = con.execute("SELECT since FROM open_failures WHERE key=?", (key,)).fetchone()
                    down = int(m.group(1)) * 60 if m else (now - row[0] if row else 0)
                    con.execute("INSERT INTO events(ts,source,key,kind,severity,text,down_s) VALUES(?,?,?,?,?,?,?)",
                                (now, source, key, "RECOVERED", "ALERT", light_scrub(detail), down))
                    con.execute("DELETE FROM open_failures WHERE key=?", (key,))
                else:  # STILL FAILING: refresh the detail only, no event, no mail
                    con.execute("UPDATE open_failures SET detail=? WHERE key=?", (light_scrub(detail), key))
        rows = con.execute("SELECT key, since, detail FROM open_failures WHERE source=?", (source,)).fetchall()
        con.close()
    except Exception:
        return 0
    sent = 0
    for key, since, detail in rows:
        if _URGENT_KEY.match(key) and now - since >= URGENT_DOWN_S:
            if urgent(f"down:{key}", f"{key} is down for {int((now - since) // 60)} min: {detail}",
                      now=now, db=db, http=http):
                sent += 1
    return sent


def enqueue_report(source, title, text, path="", now=None, db=None) -> bool:
    """Queue a report: only a short summary and its file path reach the digest."""
    return enqueue(source, title, "REPORT", text, "INFO", path=path, now=now, db=db)


URGENT_RETRY_S = 300  # after a failed Telegram send, try again after 5 min (not after a full hour)


def _urgent(key, text, cooldown_s=URGENT_COOLDOWN_S, now=None, db=None, http=None) -> str:
    """Returns "sent", "cooldown" or "failed" (Telegram refused / unreachable / queue unwritable)."""
    now = now or time.time()
    try:
        con = _db(db)
        with con:
            row = con.execute("SELECT last_ts FROM cooldown WHERE key=?", (key,)).fetchone()
            if row and now - row[0] < cooldown_s:
                return "cooldown"
            if not row:  # first attempt for this problem: one record for the digest
                con.execute("INSERT INTO events(ts,source,key,kind,severity,text) VALUES(?,?,?,?,?,?)",
                            (now, "urgent", key, "URGENT", "URGENT", light_scrub(text)))
            con.execute("INSERT OR REPLACE INTO cooldown(key,last_ts) VALUES(?,?)", (key, now))
        con.close()
    except Exception:
        return "failed"
    if send(f"URGENT {key}: {text}", http=http):
        return "sent"
    try:  # not delivered: allow a retry soon instead of silencing the problem for an hour
        con = _db(db)
        with con:
            con.execute("UPDATE cooldown SET last_ts=? WHERE key=?", (now - cooldown_s + URGENT_RETRY_S, key))
        con.close()
    except Exception:
        pass
    return "failed"


def urgent(key, text, cooldown_s=URGENT_COOLDOWN_S, now=None, db=None, http=None) -> bool:
    """Telegram-only urgent message, at most one per `key` per cooldown. Returns True if sent now.

    Urgent = site down > 15 min in a row, backup failed, deploy failed/rolled back, disk > 90%.
    Never e-mails. The event is also recorded in the next digest (once per problem).
    """
    return _urgent(key, text, cooldown_s, now, db, http) == "sent"


# ------------------------------------------------------------------ digest ---
def _fmt_min(seconds: float) -> str:
    m = int(round(seconds / 60))
    return f"{m} min" if m < 120 else f"{m // 60} h {m % 60} min"


def _first_lines(text: str, n=3, width=160) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return " | ".join(ln[:width] for ln in lines[:n])


def render_digest(events, open_failures, now=None):
    """events: rows (id, ts, source, key, kind, severity, text, down_s, path); open_failures: (key, source, since, detail).

    Returns (subject, body, counts). Flapping FAIL/RECOVERED pairs collapse to one line per key.
    """
    now = now or time.time()
    local = datetime.fromtimestamp(now, TEHRAN)
    urgent_ev = [e for e in events if e[5] == "URGENT"]
    reports = [e for e in events if e[4] == "REPORT"]
    flap: dict = {}
    for e in events:
        if e[4] in ("FAIL", "RECOVERED"):
            f = flap.setdefault(e[3], {"fail": 0, "rec": 0, "down": 0.0, "source": e[2]})
            f["fail" if e[4] == "FAIL" else "rec"] += 1
            f["down"] += e[7]
    open_map = {k: (src, since, det) for k, src, since, det in open_failures}
    out = []
    if urgent_ev:
        out.append("== URGENT (already sent to Telegram) ==")
        for e in urgent_ev:
            out.append(f"- {datetime.fromtimestamp(e[1], TEHRAN):%H:%M} {e[3]}: {e[6][:200]}")
        out.append("")
    if open_map or flap:
        out.append("== ALERTS ==")
        for key in sorted(open_map):
            src, since, det = open_map[key]
            f = flap.get(key, {"fail": 0, "rec": 0, "down": 0.0})
            out.append(f"- STILL FAILING {key} [{src}] for {_fmt_min(now - since)}: {det[:160]}"
                       + (f" (+{f['rec']} earlier recoveries, downtime {_fmt_min(f['down'])})" if f["rec"] else ""))
        for key in sorted(flap):
            if key in open_map:
                continue
            f = flap[key]
            out.append(f"- {key} [{f['source']}]: failed {f['fail']}x, recovered {f['rec']}x, "
                       f"total downtime {_fmt_min(f['down'])}")
        out.append("")
    if reports:
        out.append("== REPORTS ==")
        for e in reports:
            line = f"- {e[3]} [{e[2]}]: {_first_lines(e[6])}"
            out.append(line + (f"\n    file: {e[8]}" if e[8] else ""))
        out.append("")
    counts = {"urgent": len(urgent_ev), "open": len(open_map), "flapping": len(flap), "reports": len(reports)}
    subject = (f"[Roxira digest] {local:%Y-%m-%d %H:%M} Tehran - "
               f"{counts['urgent']} urgent, {len(set(open_map) | set(flap))} alerts, {counts['reports']} reports")
    return subject, "\n".join(out).rstrip() + "\n", counts


def smtp_send(subject: str, body: str) -> bool:
    """Send one e-mail with BACKUP_SMTP_USER/PASS -> BACKUP_NOTIFY_TO. Values are never printed."""
    file_env = _read_env_file(os.environ.get("NOTIFY_MAIL_ENV_FILE", "/etc/roxira/monitor.env"))

    def get(n, d=""):
        return os.environ.get(n) or file_env.get(n) or d

    user, to = get("BACKUP_SMTP_USER"), get("BACKUP_NOTIFY_TO")
    password = "".join(get("BACKUP_SMTP_PASS").split())  # Gmail shows App Passwords with spaces
    if not (user and password and to):
        print("digest not mailed: BACKUP_SMTP_USER/BACKUP_SMTP_PASS/BACKUP_NOTIFY_TO not all set")
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = get("BACKUP_NOTIFY_FROM", user), to, subject
    msg.set_content(body)
    host, port = get("BACKUP_SMTP_HOST", "smtp.gmail.com"), int(get("BACKUP_SMTP_PORT", "465"))
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30) as s:
                s.login(user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(user, password)
                s.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException) as exc:
        print(f"digest mail failed: {type(exc).__name__}")
        return False


def send_digest(now=None, db=None, dry_run=False, force=False, mailer=None, http=None) -> str:
    """Send ONE grouped e-mail with everything queued, plus a short Telegram version.

    Returns "sent", "empty", "too-soon", "failed" or "dry-run". Events stay queued on failure.
    """
    now = now or time.time()
    con = _db(db)
    last = con.execute("SELECT v FROM meta WHERE k='last_digest'").fetchone()
    if last and not force and not dry_run and now - float(last[0]) < DIGEST_MIN_GAP_S:
        con.close()
        return "too-soon"
    events = con.execute("SELECT id,ts,source,key,kind,severity,text,down_s,path FROM events ORDER BY id").fetchall()
    opens = con.execute("SELECT key,source,since,detail FROM open_failures").fetchall()
    if not events and not opens and not force:
        con.close()
        return "empty"
    subject, body, counts = render_digest(events, opens, now)
    if dry_run:
        print(subject + "\n\n" + body)
        con.close()
        return "dry-run"
    if not (mailer or smtp_send)(subject, body):
        con.close()
        return "failed"
    with con:
        if events:
            con.execute("DELETE FROM events WHERE id<=?", (events[-1][0],))
        con.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('last_digest',?)", (str(now),))
    con.close()
    short = subject.replace("[Roxira digest] ", "Digest ") + (
        ("\nstill failing: " + ", ".join(sorted(o[0] for o in opens))[:300]) if opens else "")
    send(short, http=http)
    return "sent"


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["--digest"]:
        res = send_digest(dry_run="--dry-run" in args, force="--force" in args)
        print(f"digest: {res}")
        return 1 if res == "failed" else 0
    if args[:1] == ["--urgent"] and len(args) >= 3:
        res = _urgent(args[1], " ".join(args[2:]))
        print(f"urgent: {res}")
        return 1 if res == "failed" else 0
    if args[:1] == ["--queue"] and len(args) >= 5:
        sev = args[1].upper() if args[1].upper() in ("INFO", "ALERT") else "INFO"
        return 0 if enqueue(args[2], args[3], "REPORT", " ".join(args[4:]), sev) else 1
    text = " ".join(args).strip()
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read().strip()
    if text:
        send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
