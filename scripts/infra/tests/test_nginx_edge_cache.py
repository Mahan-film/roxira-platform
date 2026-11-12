"""Static checks for the nginx edge-cache locations (no nginx binary needed).

The edge policy lives in nginx (Next.js overwrites Cache-Control for these
force-dynamic pages), so assert: the cached locations exist in every frontend
server block, they carry the cache headers, and nothing private is cached.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
NGINX = ROOT / "output_apps" / "nginx_config"
CONF = (NGINX / "nginx.conf").read_text(encoding="utf-8")
SNIPPET = (NGINX / "snippets" / "edge_cache_headers.conf").read_text(encoding="utf-8")

PAGES_RE = r"^/(laws|regulations|guides)(/|$)"
SITEMAP_RE = r"^/(sitemap_index\.xml|sitemap/\d+\.xml)$"
CACHE_LINE = (
    'add_header Cache-Control "public, s-maxage=3600, stale-while-revalidate=86400";'
)
PRIVATE = ["/chat", "/api", "/owner", "/admin", "/auth", "/payment", "/verify-email",
           "/api/v1/auth/send-otp", "/reset-password", "/api/backend/x"]


def _cached_blocks() -> list[tuple[str, str]]:
    """Return (pattern, body) for every location that includes the edge snippet."""
    out = []
    for m in re.finditer(r"location\s+~\s+(\S+)\s*\{(.*?)\n\s*\}", CONF, re.S):
        if "edge_cache_headers.conf" in m.group(2):
            out.append((m.group(1), m.group(2)))
    return out


def test_snippet_has_cache_policy():
    assert "proxy_hide_header Cache-Control;" in SNIPPET
    assert "proxy_ignore_headers Cache-Control;" not in SNIPPET
    assert "proxy_hide_header Set-Cookie;" in SNIPPET
    assert CACHE_LINE in SNIPPET
    # add_header in a location drops inherited headers: security headers re-included.
    assert "snippets/security_headers.conf" in SNIPPET
    # Nginx local cache directives (T17)
    assert "proxy_cache laws_cache;" in SNIPPET
    assert "proxy_cache_lock on;" in SNIPPET
    assert "proxy_cache_use_stale updating error timeout;" in SNIPPET
    assert "http_500" not in SNIPPET
    assert "proxy_cache_valid 200 3600s;" in SNIPPET
    assert "301" not in SNIPPET and "302" not in SNIPPET
    assert "proxy_cache_bypass $laws_cookie_bypass $http_authorization;" in SNIPPET
    assert "proxy_no_cache $laws_cookie_bypass $http_authorization $upstream_http_set_cookie;" in SNIPPET
    assert "add_header X-Cache-Status $upstream_cache_status always;" in SNIPPET
    assert "proxy_cache_key" not in SNIPPET
    assert "proxy_cache_path /var/cache/nginx/laws_cache" in CONF
    assert "inactive=2h" in CONF
    assert "$laws_cookie_bypass" in CONF
    assert "default 1;" in CONF


def test_cached_locations_exist_per_frontend_server():
    patterns = [p for p, _ in _cached_blocks()]
    # ghazihoushmand.ir, roxira.ir, roxira.net -> two locations each
    assert patterns.count(PAGES_RE) == 3
    assert patterns.count(SITEMAP_RE) == 3
    assert len(patterns) == 6


def test_cached_locations_keep_frontend_proxy():
    for pattern, body in _cached_blocks():
        assert "proxy_pass http://$frontend_backend;" in body
        assert "proxy_set_header X-Forwarded-Proto $scheme;" in body
        assert "add_header Content-Language" in body
        if pattern == SITEMAP_RE:
            assert 'proxy_cache_key "$scheme$request_method$host$uri";' in body
        else:
            assert 'proxy_cache_key "$scheme$request_method$host$request_uri";' in body


def test_private_paths_never_match_cached_locations():
    for pattern, _ in _cached_blocks():
        rx = re.compile(pattern)
        for path in PRIVATE:
            assert not rx.search(path), f"{path} must not be edge cached ({pattern})"
        assert any(rx.search(x) for x in ("/laws/1", "/sitemap/1.xml", "/sitemap_index.xml"))
    assert re.search(PAGES_RE, "/guides") and re.search(PAGES_RE, "/regulations/x")
    assert re.search(SITEMAP_RE, "/sitemap/12.xml") and not re.search(SITEMAP_RE, "/sitemap/x.xml")


def test_no_edge_cache_outside_the_public_locations():
    assert CONF.count("s-maxage") == 0, "cache policy must come only from the snippet"
    for other in (NGINX / "snippets").glob("*.conf"):
        if other.name != "edge_cache_headers.conf":
            assert "s-maxage" not in other.read_text(encoding="utf-8")
    # the snippet is included only from the six dedicated locations
    assert CONF.count("include /etc/nginx/snippets/edge_cache_headers.conf;") == 6


def test_braces_balanced():
    assert CONF.count("{") == CONF.count("}")
