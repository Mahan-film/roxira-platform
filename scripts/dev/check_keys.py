#!/usr/bin/env python3
"""Check that provider API keys in the environment are accepted by their providers.

Load keys first:  set -a; source ~/Secrets/roxira/roxira.env; set +a
Run:              python3 scripts/dev/check_keys.py

Keys are read from environment variables only. Each present key gets ONE
minimal authenticated request (10 s timeout, sequential). Output is one line
per service: ``NAME  STATUS  <latency ms>``. No key value, header or response
body is ever printed; exceptions are reduced to class name / HTTP status.
Exit code is always 0.
"""

from __future__ import annotations

import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.request

TIMEOUT = 10
SSL_HINT = "hint: pip install certifi"
OMNIROUTE_HINT = "hint: is the OmniRoute container running?"


def build_ssl_context() -> ssl.SSLContext:
    """Use certifi's CA bundle when installed, else the system default."""
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def _bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


# name, env var, method, url, header builder, json body (or None)
# Endpoints marked UNSURE could not be verified against live docs.
SIMPLE = [
    (
        "OPENROUTER",
        "OPENROUTER_API_KEY",
        "GET",
        "https://openrouter.ai/api/v1/auth/key",
        _bearer,
        None,
    ),
    ("MISTRAL", "MISTRAL_API_KEY", "GET", "https://api.mistral.ai/v1/models", _bearer, None),
    ("GROQ", "GROQ_API_KEY", "GET", "https://api.groq.com/openai/v1/models", _bearer, None),
    # UNSURE: SambaNova /v1/models auth behaviour (OpenAI-compatible, expected Bearer).
    ("SAMBANOVA", "SAMBANOVA_API_KEY", "GET", "https://api.sambanova.ai/v1/models", _bearer, None),
    (
        "BRAVE",
        "BRAVE_SEARCH_API_KEY",
        "GET",
        "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
        lambda k: {"X-Subscription-Token": k, "Accept": "application/json"},
        None,
    ),
    (
        "EXA",
        "EXA_API_KEY",
        "POST",
        "https://api.exa.ai/search",
        lambda k: {"x-api-key": k},
        {"query": "test", "numResults": 1},
    ),
    # UNSURE: Jina has a dashboard balance API but its URL is not confidently known;
    # s.jina.ai search is used instead (consumes a few tokens).
    (
        "JINA",
        "JINA_API_KEY",
        "GET",
        "https://s.jina.ai/?q=test",
        lambda k: {**_bearer(k), "Accept": "application/json"},
        None,
    ),
    # UNSURE: v1 path; Firecrawl also ships /v2/team/credit-usage.
    (
        "FIRECRAWL",
        "FIRECRAWL_API_KEY",
        "GET",
        "https://api.firecrawl.dev/v1/team/credit-usage",
        _bearer,
        None,
    ),
]

# Comma-separated key lists, tested by position.
LISTS = [
    (
        "TAVILY",
        "TAVILY_API_KEYS",
        "POST",
        # UNSURE: Bearer auth on /search is documented; costs 1 credit per key.
        "https://api.tavily.com/search",
        _bearer,
        {"query": "test", "max_results": 1},
    ),
    (
        "ASSEMBLYAI",
        "ASSEMBLYAI_API_KEYS",
        "GET",
        "https://api.assemblyai.com/v2/transcript?limit=1",
        lambda k: {"authorization": k},
        None,
    ),
]

PRESENCE_ONLY = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "KAVENEGAR_API_KEY"]


def probe(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict | None,
    context: ssl.SSLContext | None = None,
) -> tuple[str, int]:
    """Return (status, latency_ms). Never leaks key material."""
    data = None
    hdrs = dict(headers)
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    start = time.monotonic()
    status = "OK"
    try:
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=context) as resp:
            code = getattr(resp, "status", 200)
            if not 200 <= code < 300:
                status = f"FAIL({code})"
    except Exception as exc:
        status = _classify(exc)
    return status, int((time.monotonic() - start) * 1000)


def _classify(exc: Exception) -> str:
    """Reduce an exception to a status string without echoing its message."""
    if isinstance(exc, urllib.error.HTTPError):
        return f"FAIL({exc.code})"
    if isinstance(exc, TimeoutError):
        return "FAIL(timeout)"
    if isinstance(exc, urllib.error.URLError):
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            return "FAIL(timeout)"
        if isinstance(exc.reason, ssl.SSLError):
            return "FAIL(ssl-cert)"
        return "FAIL(network)"
    if isinstance(exc, ssl.SSLError):
        return "FAIL(ssl-cert)"
    return f"FAIL({type(exc).__name__})"


def probe_omniroute(
    base_url: str, key: str, context: ssl.SSLContext | None = None
) -> tuple[str, int, int | None]:
    """GET {base}/models. Return (status, latency_ms, model_count or None).

    The URL may be non-http(s) or non-loopback; it is used as given and never printed.
    """
    url = base_url.strip().rstrip("/") + "/models"
    start = time.monotonic()
    count: int | None = None
    status = "OK"
    try:
        req = urllib.request.Request(url, headers=_bearer(key), method="GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=context) as resp:
            code = getattr(resp, "status", 200)
            if not 200 <= code < 300:
                status = f"FAIL({code})"
            else:
                try:
                    data = json.loads(resp.read()).get("data")
                    count = len(data) if isinstance(data, list) else None
                except Exception:
                    count = None
    except Exception as exc:
        status = _classify(exc)
    return status, int((time.monotonic() - start) * 1000), count


def _line(name: str, status: str, latency: int | None, extra: str = "") -> str:
    suffix = "" if latency is None else f"{latency} ms"
    suffix += extra
    return f"{name:<14}{status:<18}{suffix}".rstrip()


def main() -> int:
    counts = {"OK": 0, "FAIL": 0, "SKIP": 0}
    ctx = build_ssl_context()
    ssl_failed = False

    def emit(name: str, status: str, latency: int | None = None, extra: str = "") -> None:
        nonlocal ssl_failed
        counts[status.split("(")[0]] += 1
        ssl_failed = ssl_failed or status == "FAIL(ssl-cert)"
        print(_line(name, status, latency, extra))

    for name, var, method, url, hdr, body in SIMPLE:
        key = os.environ.get(var, "").strip()
        if not key:
            emit(name, "SKIP(not set)")
            continue
        status, ms = probe(method, url, hdr(key), body, ctx)
        emit(name, status, ms)

    for name, var, method, url, hdr, body in LISTS:
        keys = [k.strip() for k in os.environ.get(var, "").split(",") if k.strip()]
        if not keys:
            emit(name, "SKIP(not set)")
            continue
        for i, key in enumerate(keys, 1):
            status, ms = probe(method, url, hdr(key), body, ctx)
            emit(f"{name}#{i}", status, ms)

    # OmniRoute: local gateway (Mac/agent side only). Key and URL are never printed.
    om_key = os.environ.get("OMNIROUTE_API_KEY", "").strip()
    om_base = os.environ.get("OMNIROUTE_BASE_URL", "").strip()
    omniroute_down = False
    if not om_key or not om_base:
        emit("OMNIROUTE", "SKIP(not set)")
    else:
        status, ms, n = probe_omniroute(om_base, om_key, ctx)
        omniroute_down = status == "FAIL(network)"
        emit("OMNIROUTE", status, ms, "" if n is None else f", {n} models")

    for var in PRESENCE_ONLY:
        value = os.environ.get(var, "")
        if value:
            print(_line(var, f"set (len={len(value)})", None))
        else:
            print(_line(var, "SKIP(not set)", None))

    print(f"Summary: {counts['OK']} OK, {counts['FAIL']} FAIL, {counts['SKIP']} SKIP")
    if ssl_failed:
        print(SSL_HINT)
    if omniroute_down:
        print(OMNIROUTE_HINT)
    return 0


if __name__ == "__main__":
    main()
