"""Polite one-request site checker for the owner admin console.

What it does: resolve the host, refuse anything that is not a public internet address, read robots.txt,
and (only if our user agent is allowed) fetch the page ONCE with a short timeout, then report status,
title, selected response headers and a few SEO / hygiene checks.

What it deliberately does not do: no redirect following (the Location is reported instead), no retries,
no cookies, no JavaScript, no captcha or bot-detection bypass, no TLS or browser fingerprint spoofing (the
standard library TLS stack with full certificate verification, an honest user agent). A site that blocks
us simply shows its block page status.

SSRF defence: only http/https on ports 80/443, every resolved address must be globally routable, and the
socket connects to the address that was validated (no second DNS lookup), so DNS rebinding cannot swap in
an internal address between the check and the connection.
"""
from __future__ import annotations

import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
import urllib.parse
import urllib.robotparser
import zlib
from html.parser import HTMLParser
from typing import Any

USER_AGENT = "RoxiraBot/1.0 (+https://ghazihoushmand.ir)"
TIMEOUT_S = 10.0
MAX_BODY = 1_500_000
MAX_ROBOTS = 200_000
ALLOWED_PORTS = {"http": 80, "https": 443}
SECURITY_HEADERS = ("strict-transport-security", "content-security-policy", "x-frame-options",
                    "x-content-type-options", "referrer-policy", "permissions-policy")
REPORT_HEADERS = ("server", "content-type", "content-encoding", "cache-control", "content-language",
                  "last-modified", "etag", "location", "x-robots-tag", "link") + SECURITY_HEADERS


class SiteCheckError(Exception):
    """A request we refuse or cannot complete; ``str()`` is a short safe message for the owner."""


def parse_url(raw: str) -> urllib.parse.SplitResult:
    url = (raw or "").strip()
    if len(url) > 500 or any(c in url for c in "\r\n\t \x00"):
        raise SiteCheckError("آدرس نامعتبر است.")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ALLOWED_PORTS:
        raise SiteCheckError("فقط آدرس http یا https مجاز است.")
    if not parts.hostname or parts.username or parts.password:
        raise SiteCheckError("آدرس باید نام میزبان داشته باشد و شامل نام کاربری نباشد.")
    try:
        port = parts.port
    except ValueError as exc:
        raise SiteCheckError("پورت نامعتبر است.") from exc
    if port not in (None, ALLOWED_PORTS[parts.scheme]):
        raise SiteCheckError("فقط پورت‌های استاندارد ۸۰ و ۴۴۳ مجاز است.")
    return parts


def resolve_public(host: str) -> str:
    """First globally routable address of ``host``; refuses if ANY answer is private/loopback/link-local."""
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SiteCheckError("نام میزبان پیدا نشد.") from exc
    addrs = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped  # ::ffff:10.0.0.1 must be judged as the IPv4 address it really is
        if not ip.is_global or ip.is_multicast:
            raise SiteCheckError("این میزبان به آدرس داخلی یا غیرعمومی اشاره می‌کند و بررسی نمی‌شود.")
        addrs.append(str(ip))
    if not addrs:
        raise SiteCheckError("نام میزبان پیدا نشد.")
    return addrs[0]


class _Pinned:
    """Connection mixin: connect to a pre-validated IP instead of resolving the name again."""

    _pinned_ip: str

    def connect(self):  # type: ignore[override]
        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        if isinstance(self, http.client.HTTPSConnection):
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)  # full cert + hostname check
        else:
            self.sock = sock


class _HTTP(_Pinned, http.client.HTTPConnection):
    pass


class _HTTPS(_Pinned, http.client.HTTPSConnection):
    pass


def _fetch(parts: urllib.parse.SplitResult, path: str, ip: str, limit: int) -> dict:
    cls = _HTTPS if parts.scheme == "https" else _HTTP
    kwargs: dict[str, Any] = {"timeout": TIMEOUT_S}
    if cls is _HTTPS:
        kwargs["context"] = ssl.create_default_context()
    conn = cls(parts.hostname, ALLOWED_PORTS[parts.scheme], **kwargs)
    conn._pinned_ip = ip
    started = time.monotonic()
    try:
        conn.request("GET", path, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5",
                                           "Accept-Encoding": "gzip, deflate", "Connection": "close"})
        resp = conn.getresponse()
        first_byte_ms = int((time.monotonic() - started) * 1000)
        raw = resp.read(limit + 1)
        headers = {k.lower(): v for k, v in resp.getheaders()}
        status = resp.status
    except ssl.SSLCertVerificationError as exc:
        raise SiteCheckError("گواهی TLS سایت معتبر نیست: " + str(exc.verify_message)[:120]) from exc
    except (OSError, http.client.HTTPException) as exc:
        raise SiteCheckError(f"اتصال ناموفق بود ({type(exc).__name__}).") from exc
    finally:
        conn.close()
    truncated = len(raw) > limit
    raw = raw[:limit]
    enc = headers.get("content-encoding", "").lower()
    if enc in ("gzip", "deflate") and raw:
        try:
            d = zlib.decompressobj(16 + zlib.MAX_WBITS if enc == "gzip" else zlib.MAX_WBITS)
            raw = d.decompress(raw, MAX_BODY)
        except zlib.error:
            pass
    return {"status": status, "headers": headers, "body": raw, "ttfb_ms": first_byte_ms,
            "total_ms": int((time.monotonic() - started) * 1000), "truncated": truncated}


def robots_allows(parts: urllib.parse.SplitResult, ip: str, path_q: str) -> tuple[bool, str]:
    """(allowed, note). A missing robots.txt (404) allows; a server error or unreachable robots.txt is
    treated as disallow-all for polite crawling (RFC 9309: 5xx means do not crawl)."""
    try:
        res = _fetch(parts, "/robots.txt", ip, MAX_ROBOTS)
    except SiteCheckError as exc:
        return False, f"robots.txt قابل دریافت نبود ({exc})؛ برای رعایت ادب بررسی انجام نشد."
    status = res["status"]
    if 400 <= status < 500:
        return True, "robots.txt ندارد (مجاز)."
    if status >= 500 or status < 200 or 300 <= status < 400:
        return False, f"robots.txt قابل خواندن نبود (HTTP {status})؛ بررسی انجام نشد."
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(res["body"].decode("utf-8", "replace").splitlines())
    allowed = rp.can_fetch(USER_AGENT, path_q or "/")
    return allowed, "robots.txt اجازه می‌دهد." if allowed else "robots.txt این مسیر را برای ربات‌ها مسدود کرده است."


class _Seo(HTMLParser):
    """Collects the handful of tags the checks need; never executes anything."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.canonical: str | None = None
        self.hreflang: list[dict] = []
        self.h1 = 0
        self.imgs = 0
        self.imgs_no_alt = 0
        self.lang: str | None = None
        self.jsonld: list[str] = []
        self._in_ld = False
        self._ld_buf: list[str] = []
        self.links = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "html":
            self.lang = a.get("lang") or None
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key:
                self.meta.setdefault(key, a.get("content", ""))
        elif tag == "link":
            rel = a.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical = a.get("href") or None
            if "alternate" in rel and a.get("hreflang"):
                self.hreflang.append({"lang": a["hreflang"], "href": a.get("href", "")})
        elif tag == "h1":
            self.h1 += 1
        elif tag == "img":
            self.imgs += 1
            if "alt" not in a:
                self.imgs_no_alt += 1
        elif tag == "a":
            self.links += 1
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_ld = True
            self._ld_buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_ld:
            self._in_ld = False
            self.jsonld.append("".join(self._ld_buf))

    def handle_data(self, data: str) -> None:
        if self._in_title and len(self.title) < 300:
            self.title += data
        elif self._in_ld:
            self._ld_buf.append(data)


def _ld_types(blocks: list[str]) -> list[str]:
    types: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            t = node.get("@type")
            for x in (t if isinstance(t, list) else [t]):
                if isinstance(x, str) and x not in types:
                    types.append(x)
            for v in node.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for block in blocks:
        try:
            walk(json.loads(block))
        except ValueError:
            types.append("(invalid JSON-LD)")
    return types[:20]


def analyze(res: dict, final_url: str) -> dict:
    """Pure analysis of one fetched page (no network)."""
    headers, status = res["headers"], res["status"]
    body = res["body"]
    ctype = headers.get("content-type", "")
    out: dict[str, Any] = {
        "url": final_url, "status": status, "ttfb_ms": res["ttfb_ms"], "total_ms": res["total_ms"],
        "bytes": len(body), "truncated": res["truncated"], "content_type": ctype,
        "headers": {k: headers[k][:300] for k in REPORT_HEADERS if k in headers},
    }
    if 300 <= status < 400:
        out["redirect_to"] = headers.get("location", "")[:500]
    if "html" not in ctype.lower() and body[:200].lstrip()[:1] != b"<":
        out["seo"] = None
        out["checks"] = [_check("content-type", "info", f"پاسخ HTML نیست ({ctype or 'نامشخص'}).")]
        return out
    p = _Seo()
    try:
        p.feed(body.decode(_charset(ctype), "replace"))
    except Exception:  # noqa: BLE001 - malformed markup must not fail the report
        pass
    title = re.sub(r"\s+", " ", p.title).strip()
    desc = p.meta.get("description", "").strip()
    robots_meta = p.meta.get("robots", "")
    og = {k: v[:200] for k, v in p.meta.items() if k.startswith("og:")}
    ld_types = _ld_types(p.jsonld)
    out["seo"] = {
        "title": title, "title_len": len(title), "description": desc[:400], "description_len": len(desc),
        "canonical": p.canonical, "lang": p.lang, "hreflang": p.hreflang[:20], "viewport": p.meta.get("viewport"),
        "robots_meta": robots_meta, "og": og, "h1_count": p.h1, "images": p.imgs,
        "images_without_alt": p.imgs_no_alt, "links": p.links, "structured_data_types": ld_types,
    }
    checks = [
        _check("title", "ok" if 10 <= len(title) <= 65 else "warn" if title else "fail",
               f"عنوان {len(title)} نویسه" if title else "عنوان صفحه (title) وجود ندارد."),
        _check("description", "ok" if 50 <= len(desc) <= 170 else "warn" if desc else "fail",
               f"توضیحات {len(desc)} نویسه" if desc else "meta description وجود ندارد."),
        _check("canonical", "ok" if p.canonical else "warn", p.canonical or "canonical تعریف نشده."),
        _check("lang", "ok" if p.lang else "warn", p.lang or "ویژگی lang روی html نیست."),
        _check("viewport", "ok" if p.meta.get("viewport") else "fail", "viewport موبایل" if p.meta.get("viewport")
               else "meta viewport وجود ندارد (سازگاری موبایل)."),
        _check("h1", "ok" if p.h1 == 1 else "warn", f"تعداد h1: {p.h1}"),
        _check("image-alt", "ok" if p.imgs_no_alt == 0 else "warn", f"{p.imgs_no_alt} از {p.imgs} تصویر بدون alt"),
        _check("structured-data", "ok" if ld_types else "info", ", ".join(ld_types) or "داده ساختاریافته (JSON-LD) ندارد."),
        _check("noindex", "warn" if "noindex" in robots_meta.lower() or "noindex" in headers.get("x-robots-tag", "").lower()
               else "ok", "صفحه noindex است." if "noindex" in robots_meta.lower() else "قابل ایندکس."),
        _check("compression", "ok" if headers.get("content-encoding") else "warn",
               headers.get("content-encoding") or "فشرده‌سازی (gzip/br) فعال نیست."),
        _check("https", "ok" if final_url.startswith("https://") else "fail",
               "HTTPS" if final_url.startswith("https://") else "صفحه با HTTP ساده سرو می‌شود."),
        _check("page-weight", "ok" if len(body) < 500_000 else "warn", f"{len(body) // 1024} KB HTML"),
        _check("response-time", "ok" if res["ttfb_ms"] < 800 else "warn", f"{res['ttfb_ms']} ms تا اولین بایت"),
    ]
    missing = [h for h in SECURITY_HEADERS[:4] if h not in headers]
    checks.append(_check("security-headers", "ok" if not missing else "warn",
                         "همه هدرهای پایه موجود است." if not missing else "ناموجود: " + ", ".join(missing)))
    out["checks"] = checks
    return out


def _check(name: str, level: str, detail: str) -> dict:
    return {"name": name, "level": level, "detail": detail}


def _charset(ctype: str) -> str:
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    try:
        if m:
            "x".encode(m.group(1))
            return m.group(1)
    except LookupError:
        pass
    return "utf-8"


def check_site(raw_url: str) -> dict:
    """Validate, honour robots.txt, fetch once, analyse. Raises SiteCheckError with a safe message."""
    parts = parse_url(raw_url)
    ip = resolve_public(parts.hostname)  # type: ignore[arg-type]
    path = parts.path or "/"
    path_q = path + (f"?{parts.query}" if parts.query else "")
    allowed, note = robots_allows(parts, ip, path_q)
    base = {"requested": f"{parts.scheme}://{parts.hostname}{path_q}", "user_agent": USER_AGENT,
            "robots": {"allowed": allowed, "note": note}}
    if not allowed:
        return {**base, "fetched": False}
    res = _fetch(parts, path_q, ip, MAX_BODY)
    return {**base, "fetched": True, **analyze(res, base["requested"])}
