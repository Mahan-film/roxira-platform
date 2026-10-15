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

When the token or chat id is missing the feature is OFF: send() is a silent no-op
and the CLI exits 0. A failure to reach the API never raises into the caller.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

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
        (http or http_post)(url, payload, timeout)
        return True
    except Exception:
        return False


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    text = " ".join(args).strip()
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read().strip()
    if text:
        send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())