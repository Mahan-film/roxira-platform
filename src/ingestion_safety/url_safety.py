"""URL safety checks for ingestion (SSRF guard and robots.txt). Stdlib only."""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

Resolver = Callable[[str], list[str]]

_BLOCKED_HOSTS = {"localhost", "localhost.localdomain", "metadata.google.internal"}


def default_resolver(host: str) -> list[str]:
    """Resolve a hostname to a list of IP strings (performs network DNS)."""
    infos = socket.getaddrinfo(host, None)
    return [str(info[4][0]) for info in infos]


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def is_safe_public_url(url: str, resolver: Resolver | None = None) -> tuple[bool, str]:
    """Return (ok, reason). Reason is 'ok' when the URL is safe to fetch."""
    try:
        parts = urlsplit(url.strip())
        host = parts.hostname
        _ = parts.port  # raises ValueError on a bad port
    except ValueError:
        return False, "malformed url"
    if parts.scheme not in ("http", "https"):
        return False, "scheme not allowed"
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        return False, "credentials in url"
    if not host:
        return False, "missing host"
    host = host.rstrip(".").lower()
    if host in _BLOCKED_HOSTS or host.endswith(".localhost"):
        return False, "localhost not allowed"

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _ip_is_public(literal):
            return False, "non-public ip"
        return True, "ok"

    try:
        addrs = (resolver or default_resolver)(host)
    except OSError:
        return False, "unresolvable host"
    if not addrs:
        return False, "unresolvable host"
    for addr in addrs:
        try:
            ip = ipaddress.ip_address(addr.split("%")[0])
        except ValueError:
            return False, "invalid resolved address"
        if not _ip_is_public(ip):
            return False, "host resolves to non-public ip"
    return True, "ok"


def robots_allows(robots_txt: str, url: str, user_agent: str) -> bool:
    """Check already-fetched robots.txt text. No network access."""
    parser = RobotFileParser()
    parser.parse(robots_txt.splitlines())
    return parser.can_fetch(user_agent, url)
