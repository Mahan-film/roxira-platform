#!/usr/bin/env python3
"""Redaction filter for text that leaves the box (R20-6, issue #1022). Stdlib only.

  redact.py < in > out      filter stdin to stdout
  redact.py --check < in    exit 1 if anything would be redacted (prints nothing)
Library: redact(text) -> str, findings(text) -> list[str] (kinds only, never the matched value).

Strips: provider key shapes, KEY=value / Authorization secrets, PEM blocks, credentials in URLs, e-mail addresses,
IPv4 and IPv6 (loopback kept), phone numbers, and personal names listed one per line in the file named by
REDACT_NAMES_FILE (kept outside the repo: this repo is public). Known false positive: a four-part version number
such as 1.2.3.4 looks like an IPv4 address.
"""
from __future__ import annotations

import ipaddress
import os
import re
import sys

_PEM = re.compile(r"-----BEGIN [A-Z0-9 ]+-----.*?(?:-----END [A-Z0-9 ]+-----|\Z)", re.DOTALL)
_URL_CRED = re.compile(r"(?P<scheme>[a-zA-Z][a-zA-Z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@")
_KEYS = [
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"\bsk-or-v1-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{10,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\bgsk_[A-Za-z0-9]{16,}"),
    re.compile(r"\bhf_[A-Za-z0-9]{20,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bnpm_[A-Za-z0-9]{30,}"),
    re.compile(r"\b\d{8,10}:[A-Za-z0-9_\-]{35}\b"),  # Telegram bot token
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),  # JWT
]
_BEARER = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{16,}")
_ASSIGN = re.compile(
    r"(?i)\b([A-Z0-9_.\-]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|MASTER[_-]?KEY)[A-Z0-9_.\-]*)"
    r"(\s*[=:]\s*)(['\"]?)[^\s'\"]{6,}\3"
)
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
_IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w]|\.\d)")
_IPV6 = re.compile(r"(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])")
_PHONES = [
    re.compile(r"(?<![\w+])\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,4}){2,4}(?!\d)"),
    re.compile(r"(?<![\w.])00\d{1,3}[\s.\-]?\d{7,12}(?!\d)"),
    re.compile(r"(?<![\w.])09\d{9}(?!\d)"),  # Iranian mobile, national format
]


def _names() -> list[re.Pattern]:
    path = os.environ.get("REDACT_NAMES_FILE")
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as f:
            raw = [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
    except OSError:
        return []
    return [re.compile(r"(?<!\w)" + re.escape(n) + r"(?!\w)", re.IGNORECASE) for n in raw if len(n) >= 3]


def _ipv4_sub(m: re.Match) -> str:
    s = m.group(0)
    try:
        ip = ipaddress.IPv4Address(s)
    except ValueError:
        return s  # 999.1.1.1 is not an address
    return s if ip.is_loopback else "[REDACTED:ip]"


def _ipv6_sub(m: re.Match) -> str:
    s = m.group(0)
    try:
        ip = ipaddress.IPv6Address(s)
    except ValueError:
        return s
    return s if ip.is_loopback or ip.is_unspecified else "[REDACTED:ip]"


def _steps():
    yield "pem", lambda t: _PEM.sub("[REDACTED:pem]", t)
    yield "urlcred", lambda t: _URL_CRED.sub(lambda m: m.group("scheme") + "[REDACTED:cred]@", t)
    for pat in _KEYS:
        yield "key", (lambda t, p=pat: p.sub("[REDACTED:key]", t))
    yield "key", lambda t: _BEARER.sub(lambda m: m.group(1) + " [REDACTED:key]", t)
    yield "secret", lambda t: _ASSIGN.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED:secret]", t)
    yield "email", lambda t: _EMAIL.sub("[REDACTED:email]", t)
    yield "ip", lambda t: _IPV6.sub(_ipv6_sub, t)
    yield "ip", lambda t: _IPV4.sub(_ipv4_sub, t)
    for pat in _PHONES:
        yield "phone", (lambda t, p=pat: p.sub("[REDACTED:phone]", t))
    for pat in _names():
        yield "name", (lambda t, p=pat: p.sub("[REDACTED:name]", t))


def redact(text: str) -> str:
    for _kind, fn in _steps():
        text = fn(text)
    return text


def findings(text: str) -> list[str]:
    """Kinds of sensitive content found (sorted, unique). Never returns the matched text."""
    kinds = set()
    for kind, fn in _steps():
        new = fn(text)
        if new != text:
            kinds.add(kind)
            text = new
    return sorted(kinds)


def main(argv: list[str]) -> int:
    if argv[1:] == ["--check"]:
        return 1 if findings(sys.stdin.read()) else 0
    if argv[1:]:
        print("usage: redact.py [--check] < text", file=sys.stderr)
        return 2
    sys.stdout.write(redact(sys.stdin.read()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
