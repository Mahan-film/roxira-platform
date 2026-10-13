import re
from pathlib import Path

CONF = Path(__file__).resolve().parents[2] / "output_apps" / "nginx_config" / "nginx.conf"
SNIPPETS = CONF.parent / "snippets"
HEADERS_INCLUDE = "include /etc/nginx/snippets/security_headers.conf;"
DOCS_INCLUDE = "include /etc/nginx/snippets/block_docs.conf;"

HEADERS = [
    "add_header X-Content-Type-Options nosniff always;",
    "add_header X-Frame-Options SAMEORIGIN always;",
    "add_header Referrer-Policy strict-origin-when-cross-origin always;",
    'add_header Permissions-Policy "camera=(), geolocation=(), payment=(self), microphone=(self)" always;',
    'add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;',
    "add_header Content-Security-Policy-Report-Only \"default-src 'self'; img-src 'self' data: https:; "
    "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
    "connect-src 'self' wss: https:; frame-ancestors 'self'\" always;",
]


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


def test_real_ip_header_declared_exactly_once():
    """CF-Connecting-IP is declared once in nginx.conf, never in the include files.

    A duplicate is an nginx startup error; a missing one silently drops the real
    client IP (and rate-limits Cloudflare's own addresses).
    """
    content = _read()
    assert content.count("real_ip_header CF-Connecting-IP;") == 1
    assert content.count("real_ip_recursive on;") == 1
    params = CONF.parents[2] / "nginx" / "cloudflare_params.conf"
    assert "real_ip_header" not in params.read_text(encoding="utf-8")
    generator = CONF.parents[2] / "scripts" / "ops" / "nginx" / "update_cloudflare_ips.sh"
    assert "real_ip_header" not in generator.read_text(encoding="utf-8")


def test_security_headers_once_per_public_server():
    """Headers live in one snippet; every public vhost includes it exactly once."""
    snippet = (SNIPPETS / "security_headers.conf").read_text(encoding="utf-8")
    for header in HEADERS:
        assert snippet.count(header) == 1, header
    assert 'add_header Referrer-Policy "origin"' not in snippet
    public = [s for s in _blocks(_read(), "server") if "server_name _;" not in s]
    assert len(public) >= 3
    for block in public:
        assert block.count(HEADERS_INCLUDE) == 1
        assert "add_header X-Frame-Options" not in block  # no per-server copies


def test_docs_blocked_in_every_public_server():
    snippet = (SNIPPETS / "block_docs.conf").read_text(encoding="utf-8")
    for name in ("docs", "docs-json", "redoc", r"openapi\.json"):
        assert name in snippet
    assert "return 404;" in snippet
    public = [s for s in _blocks(_read(), "server") if "server_name _;" not in s]
    assert len(public) == 3
    for block in public:
        assert block.count(DOCS_INCLUDE) == 1
        assert "location /docs" not in block  # backend Swagger no longer proxied


def test_catch_all_default_server_drops_unknown_hosts():
    content = _read()
    assert len(re.findall(r"listen [^;]*default_server;", content)) == 2  # 80 + 443
    catch = [s for s in _blocks(content, "server") if "listen 80 default_server;" in s]
    assert len(catch) == 1
    assert "return 444;" in catch[0]
    code = re.sub(r"#[^\n]*", "", content)
    assert "5.75.200.67" not in code and "91.107.248.99" not in code


def test_auth_routes_rate_limited():
    assert "zone=auth_otp:10m rate=10r/m;" in _read()
    for name in ("auth_limit_judge", "auth_limit_frontend", "auth_limit_nest"):
        text = (SNIPPETS / (name + ".conf")).read_text(encoding="utf-8")
        assert "limit_req zone=auth_otp" in text


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


# ---------------------------------------------------------------------------
# auth_limit_* locations must route exactly like the location that serves the
# same path today (same upstream, forwarded headers, timeouts, buffering).
# ---------------------------------------------------------------------------
AUTH_INCLUDES = ("auth_limit_judge", "auth_limit_frontend", "auth_limit_nest")
SAMPLE_PATHS = [
    "/api/v1/auth/login", "/api/v1/auth",
    "/api/v1/apps/judge/auth/send-otp", "/api/v1/apps/judge/unifiedauth/x",
    "/api/v1/apps/judge/send-otp", "/api/v1/apps/judge/verify-otp",
    "/api/judge/auth/send-otp", "/api/judge/unifiedauth/x",
    "/api/judge/send-otp", "/api/judge/verify-otp",
    "/api/backend/auth/send-otp", "/api/backend/auth/webauthn/register",
]
INCLUDE_PATTERN = r"include /etc/nginx/snippets/([\w.]+);"


def _expand(text, skip=()):
    def sub(m):
        name = m.group(1)
        if name[:-5] in skip:
            return ""
        return _expand((SNIPPETS / name).read_text(encoding="utf-8"), skip)
    return re.sub(INCLUDE_PATTERN, sub, text)


def _locations(server_text):
    """Top-level `location` blocks of a server: (modifier, path, body)."""
    out, i = [], 0
    pat = re.compile(r"(?m)^\s*location\s+(?:(=|~\*|~|\^~)\s+)?(\S+)\s*\{")
    while True:
        m = pat.search(server_text, i)
        if not m:
            return out
        depth, j = 0, m.end() - 1
        while True:
            depth += server_text[j] == "{"
            depth -= server_text[j] == "}"
            if depth == 0:
                break
            j += 1
        out.append((m.group(1) or "", m.group(2), server_text[m.end():j]))
        i = j + 1


def _match(locations, path):
    """nginx location selection: exact, ^~ prefix, regex in order, longest prefix."""
    best = None
    for mod, pat, body in locations:
        if mod == "=" and pat == path:
            return (mod, pat, body)
        if mod in ("", "^~") and path.startswith(pat):
            if best is None or len(pat) > len(best[1]):
                best = (mod, pat, body)
    if best and best[0] == "^~":
        return best
    for mod, pat, body in locations:
        if mod in ("~", "~*") and re.search(pat, path, re.I if mod == "~*" else 0):
            return (mod, pat, body)
    return best


def _target(body):
    m = re.search(r"proxy_pass\s+http://(\$\w+)", body)
    return m.group(1) if m else None


def _directives(body, name):
    return set(re.findall(r"(?m)^\s*" + name + r"\s+([^;]+);", body))


def _servers_with_auth_limits():
    out = []
    for block in _blocks(_read(), "server"):
        if any(f"snippets/{n}.conf" in block for n in AUTH_INCLUDES):
            out.append(block)
    return out


def test_auth_limit_locations_mirror_live_routing():
    servers = _servers_with_auth_limits()
    assert len(servers) == 3
    checked = set()
    for block in servers:
        before = _locations(_expand(block, skip=AUTH_INCLUDES + ("block_docs",)))
        after = _locations(_expand(block))
        included = [n for n in AUTH_INCLUDES if f"snippets/{n}.conf" in block]
        own = {(m, p) for n in included
               for (m, p, _) in _locations((SNIPPETS / (n + ".conf")).read_text(encoding="utf-8"))}
        assert own
        for path in SAMPLE_PATHS:
            new = _match(after, path)
            if new is None or (new[0], new[1]) not in own:
                continue
            old = _match(before, path)
            assert old is not None and _target(old[2]), path
            assert _target(new[2]) == _target(old[2]), (path, new[1])
            # every forwarded header the old location set is still set
            old_hdr = {h.split()[0].lower() for h in _directives(old[2], "proxy_set_header")}
            new_hdr = {h.split()[0].lower() for h in _directives(new[2], "proxy_set_header")}
            assert old_hdr <= new_hdr, (path, old_hdr - new_hdr)
            # timeouts/buffering/http version the old location set are unchanged
            for d in ("proxy_connect_timeout", "proxy_read_timeout",
                      "proxy_send_timeout", "proxy_buffering", "proxy_http_version"):
                if _directives(old[2], d):
                    assert _directives(new[2], d) == _directives(old[2], d), (path, d)
            assert "limit_req zone=auth_otp" in new[2], path
            checked.add((new[0], new[1]))
    # every auth_limit location was exercised by at least one sample path
    all_own = {(m, p) for n in AUTH_INCLUDES
               for (m, p, _) in _locations((SNIPPETS / (n + ".conf")).read_text(encoding="utf-8"))}
    assert checked == all_own


def test_auth_limit_frontend_has_no_fastapi_upstream():
    text = (SNIPPETS / "auth_limit_frontend.conf").read_text(encoding="utf-8")
    assert "$frontend_backend" in text and "$judge_backend" not in text


def test_generated_include_dir_is_committed_placeholder():
    root = CONF.parents[2]
    keep = root / "nginx" / "generated" / ".keep.conf"
    assert keep.is_file()
    assert all(l.startswith("#") or not l.strip() for l in keep.read_text().splitlines())
    ignore = (root / ".gitignore").read_text(encoding="utf-8")
    assert "nginx/generated/*" in ignore and "!nginx/generated/.keep.conf" in ignore


def _prefix_locations(content):
    """Yield (prefix, body) for every simple prefix `location /x/ {` block."""
    for m in re.finditer(r"(?m)^\s*location\s+(/[^\s{]*)\s*\{", content):
        depth = 0
        for i in range(m.end() - 1, len(content)):
            if content[i] == "{":
                depth += 1
            elif content[i] == "}":
                depth -= 1
                if depth == 0:
                    yield m.group(1), content[m.end():i]
                    break


def _upstream_path(body, request_path):
    """Simulate `rewrite ... break;` + `proxy_pass` for a prefix location."""
    path = request_path
    for pattern, repl in re.findall(r"rewrite\s+(\S+)\s+(\S+)\s+break;", body):
        mt = re.match(pattern, path)
        if mt:
            path = re.sub(pattern, repl.replace("$1", r"\1"), path)
            break
    pp = re.search(r"proxy_pass\s+http://(\S+?)(/\S*)?;", body)
    uri = pp.group(2)
    # Static URI: nginx substitutes the matched prefix; variable host: URI is
    # used verbatim and the request path is lost (the live bug).
    assert uri is None or "$" not in pp.group(1), "variable proxy_pass with URI"
    return path


def test_no_variable_proxy_pass_with_uri():
    for m in re.finditer(r"proxy_pass\s+http://(\S+?)(/\S*)?;", _read()):
        if "$" in m.group(1):
            assert m.group(2) is None, m.group(0)


def test_backend_hub_and_judge_paths_are_mapped_once():
    cases = {
        "/api/backend/": [
            ("/api/backend/accounting", "/v1/accounting"),
            ("/api/backend/enterprise-hub/x/y", "/v1/enterprise-hub/x/y"),
        ],
        "/enterprise-hub/": [("/enterprise-hub/ping", "/v1/enterprise-hub/ping")],
        "/api/judge/": [("/api/judge/analyze", "/api/v1/apps/judge/analyze")],
    }
    locs = list(_prefix_locations(_read()))
    for prefix, items in cases.items():
        bodies = [b for p, b in locs if p == prefix]
        assert bodies, prefix
        for body in bodies:
            for req, want in items:
                assert _upstream_path(body, req) == want
