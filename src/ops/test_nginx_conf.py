import re
from pathlib import Path

CONF = Path(__file__).resolve().parents[2] / "output_apps" / "nginx_config" / "nginx.conf"

HEADERS = [
    "add_header X-Content-Type-Options nosniff always;",
    "add_header X-Frame-Options SAMEORIGIN always;",
    "add_header Referrer-Policy strict-origin-when-cross-origin always;",
    'add_header Permissions-Policy "camera=(), geolocation=(), payment=(self), microphone=(self)" always;',
    'add_header Strict-Transport-Security "max-age=300; includeSubDomains" always;',
    "add_header Content-Security-Policy-Report-Only \"default-src 'self'; img-src 'self' data: https:; "
    "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
    "connect-src 'self' wss: https:; frame-ancestors 'self'\" always;",
]
DOCS_404 = "location ~ ^/(docs|redoc|openapi\\.json)$ { return 404; }"


def _read():
    return CONF.read_text(encoding="utf-8")


def _blocks(content, keyword):
    """Return the text of every `keyword {` block (brace matched)."""
    out = []
    for m in re.finditer(r"(?m)^\s*" + keyword + r"\s*\{", content):
        depth = 0
        for i in range(m.end() - 1, len(content)):
            if content[i] == "{":
                depth += 1
            elif content[i] == "}":
                depth -= 1
                if depth == 0:
                    out.append(content[m.start():i + 1])
                    break
    return out


def test_braces_balanced_and_single_http():
    content = _read()
    assert content.count("{") == content.count("}")
    assert len(re.findall(r"(?m)^\s*http\s*\{", content)) == 1


def test_global_settings():
    content = _read()
    assert "server_tokens off;" in content
    assert "limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;" in content
    assert "limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;" in content


def test_security_headers_once_per_public_server():
    servers = _blocks(_read(), "server")
    assert len(servers) >= 3
    for block in servers:
        for header in HEADERS:
            assert block.count(header) == 1, header
        assert 'add_header Referrer-Policy "origin"' not in block


def test_docs_return_404_in_servers_that_proxy_docs():
    servers = [s for s in _blocks(_read(), "server") if "location /docs" in s]
    assert len(servers) == 2
    for block in servers:
        assert DOCS_404 in block
        assert block.index(DOCS_404) < block.index("location /docs")


def test_websocket_locations_not_rate_limited():
    content = _read()
    for m in re.finditer(r"location [^{]*live-voice[^{]*\{[^}]*\}", content):
        assert "limit_req" not in m.group(0)


def test_upstreams_and_proxy_targets_preserved():
    content = _read()
    for name in ["twenty_crm_upstream", "roxira_app_prod:8000",
                 "roxira_enterprise_frontend:3001", "roxira_enterprise_backend:3000",
                 "/etc/letsencrypt/live/ghazihoushmand.ir/fullchain.pem",
                 "/etc/letsencrypt/live/roxira.ir/fullchain.pem",
                 "/etc/letsencrypt/live/roxira.net/fullchain.pem"]:
        assert name in content, name
    for target in ["http://$judge_backend", "http://$frontend_backend",
                   "http://$enterprise_backend"]:
        assert target in content, target
