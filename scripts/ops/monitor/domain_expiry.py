#!/usr/bin/env python3
"""Domain registration expiry via WHOIS (port 43), for synthetic_check.py.

ghazihoushmand.ir was NXDOMAIN for ~2 h on 2026-10-22 because the domain had expired at
IRNIC; the TLS and site checks only noticed once it was already down. This warns weeks ahead.

Stdlib only. A WHOIS server that does not answer (registries rate-limit) returns None, so the
caller simply skips the check this round: an unreachable WHOIS never raises an alert.
"""

from __future__ import annotations

import re
import socket
from datetime import datetime, timezone

WHOIS_TIMEOUT_S = 15.0
# Registry WHOIS server per TLD. Domains with another TLD are skipped.
WHOIS_SERVERS = {
    "ir": "whois.nic.ir",
    "net": "whois.verisign-grs.com",
    "com": "whois.verisign-grs.com",
}

# IRNIC: "expire-date:   2027-03-15"; Verisign: "Registry Expiry Date: 2027-05-01T12:00:00Z".
_EXPIRY = (
    re.compile(r"^\s*expire-date:\s*(\d{4}-\d{2}-\d{2})", re.I | re.M),
    re.compile(r"^\s*Registry Expiry Date:\s*(\d{4}-\d{2}-\d{2})", re.I | re.M),
    re.compile(r"^\s*(?:Registrar Registration )?Expiration Date:\s*(\d{4}-\d{2}-\d{2})", re.I | re.M),
)
_NOT_FOUND = re.compile(r"no entries found|no match for", re.I)


def whois_server(domain: str) -> str | None:
    return WHOIS_SERVERS.get(domain.rsplit(".", 1)[-1].lower())


def whois_query(server: str, domain: str, timeout: float = WHOIS_TIMEOUT_S) -> str:
    with socket.create_connection((server, 43), timeout=timeout) as sock:
        sock.sendall(f"{domain}\r\n".encode())
        chunks = []
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks).decode("utf-8", "replace")


def parse_expiry(text: str) -> datetime | None:
    for pattern in _EXPIRY:
        match = pattern.search(text or "")
        if match:
            try:
                return datetime.strptime(match.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:  # e.g. "2026-13-45": unusable, never a false alert
                return None
    return None


def check_domain_expiry(domain: str, warn_days: float, now: datetime | None = None,
                        query=whois_query):
    """(ok, detail), or None when WHOIS gave no usable answer (skip this round)."""
    server = whois_server(domain)
    if server is None:
        return None
    try:
        text = query(server, domain)
    except OSError:
        return None
    if _NOT_FOUND.search(text or ""):
        return False, "WHOIS: not registered"
    expires = parse_expiry(text)
    if expires is None:
        return None
    days = (expires - (now or datetime.now(timezone.utc))).days
    return days >= warn_days, f"registration expires {expires:%Y-%m-%d} ({days} days left)"
