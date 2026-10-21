#!/usr/bin/env python3
"""Polite incremental sync of nezamat.ir + ekhtebar.ir law pages -> NEW staged JSONL + review file + Markdown report.

Runs ON THE SERVER (qavanin.ir serves a JS challenge to non-browsers; we never bypass bot protection, see
docs/legal/SOURCES_ACCESS.md). Stdlib only; parsing/normalising/staging reuses corpus_fill + fetch_nezamat_wp.

  sync_sources.py --dry-run --limit 20              discovery only (robots + sitemaps), prints the first N law URLs
  sync_sources.py --host nezamat --limit 50          fetch + parse + stage at most 50 new/changed pages
  sync_sources.py                                    all hosts, incremental (state.json), no limit

Politeness: UA «RoxiraBot/1.0 (+https://ghazihoushmand.ir)», robots.txt obeyed (incl. Crawl-delay), one request per
>= 3 s per host, retry with backoff on 429/5xx/transport errors, on-disk cache with ETag/Last-Modified under
/var/lib/roxira-legal-sync/cache. A challenge/CAPTCHA page (ArvanCloud, Cloudflare, ...) or 401/403/451 stops that
host for the run: it is logged and skipped, never solved.

Output (all NEW files, existing data/ files are never opened for writing):
  data/legal/staged/sync_sources_<date>_<host>.jsonl            rows of laws NOT yet in the corpus (active)
  data/legal/staged/sync_sources_<date>_<host>.repealed.jsonl   rows of pages the site marks repealed
  data/legal/staged/sync_sources_<date>_review.jsonl            article-level differences for laws already in the corpus
  docs/legal/SYNC_REPORT_<date>.md                              counts, new laws, changed articles for review
All rows are unofficial, needs_review=true, lawyer_review_pending.
"""

# ruff: noqa: RUF001
from __future__ import annotations

import argparse
import glob as globmod
import gzip
import hashlib
import html
import http.client
import importlib.util
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
USER_AGENT = "RoxiraBot/1.0 (+https://ghazihoushmand.ir)"
DEFAULT_STATE_DIR = Path(os.environ.get("ROXIRA_LEGAL_SYNC_DIR", "/var/lib/roxira-legal-sync"))
MIN_DELAY = 3.0
MAX_REDIRECTS = 5
HOSTS = {
    "nezamat": {"base": "https://nezamat.ir", "netlocs": ("nezamat.ir", "www.nezamat.ir"),
                "source_label": "nezamat.ir"},
    "ekhtebar": {"base": "https://www.ekhtebar.ir", "netlocs": ("ekhtebar.ir", "www.ekhtebar.ir"),
                 "source_label": "ekhtebar.ir"},
}  # fmt: skip
NETLOC_TO_HOST = {n: k for k, v in HOSTS.items() for n in v["netlocs"]}

STRONG_CHALLENGE = (
    "arvancloud", "arvan-challenge", "cf-chl", "cf-browser-verification", "challenge-platform",
    "just a moment", "checking your browser", "attention required", "_incapsula_", "sucuri website firewall",
    "ddos protection by", "enable javascript and cookies", "در حال بررسی مرورگر", "در حال انتقال به سایت",
)  # fmt: skip
WEAK_CHALLENGE = ("captcha", "access denied")  # only trusted on small pages (a real law page is large)

LAW_SLUG_RE = re.compile(r"قانون|قوانین|آیین[\s‌-]?نامه|اصلاحیه|اصلاح|دستورالعمل|مقررات|تصویب[\s‌-]?نامه|بخشنامه|لایحه|ماده[\s‌-]واحده")
LAW_PATH_TRANS = str.maketrans({"ي": "ی", "ك": "ک", "ى": "ی"})  # ekhtebar slugs mix Arabic yeh/kaf
KIND_RES = (
    ("amendment", re.compile(r"اصلاح|الحاق")),
    ("regulation", re.compile(r"آیین[\s‌-]?نامه|دستورالعمل|مقررات|تصویب[\s‌-]?نامه|بخشنامه")),
)
SKIP_PATH_RE = re.compile(r"/(category|tag|author|page|feed|wp-json|wp-admin|wp-content|search|comments?)(/|$)", re.I)
SKIP_SITEMAP_RE = re.compile(r"taxonom|categor|tag|user|author|attachment|product_cat|image|video", re.I)
AUTHORITIES = (
    "مجلس شورای اسلامی", "هیئت وزیران", "هیأت وزیران", "مجمع تشخیص مصلحت نظام", "شورای نگهبان",
    "شورای عالی انقلاب فرهنگی", "شورای عالی اداری", "قوه قضاییه", "قوه قضائیه", "رئیس قوه قضاییه",
    "شورای عالی امنیت ملی", "بانک مرکزی", "شورای پول و اعتبار", "دیوان عدالت اداری", "وزارت [^\\s،.:]+( [^\\s،.:]+)?",
)  # fmt: skip
AUTHORITY_RE = re.compile("(" + "|".join(AUTHORITIES) + ")")
VOID_TAGS = frozenset({"br", "hr", "img", "input", "meta", "link", "source", "area", "base", "col", "wbr"})


class Blocked(Exception):
    """Robots refusal, 401/403/451, challenge or CAPTCHA: the host is skipped for the rest of the run."""


class BudgetExhausted(Blocked):
    """The per-host request budget for this run is used up: the URL is deferred to the next run, not a failure."""


class FetchFailed(Exception):
    """Transient/other failure for one URL: the URL is skipped, the run goes on."""


def _load(name: str, rel: str):
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, ROOT / rel)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


def cf():
    return _load("corpus_fill", "scripts/legal/corpus_fill.py")


def nz():
    return _load("fetch_nezamat_wp", "scripts/legal/fetch_nezamat_wp.py")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def host_key(url: str) -> str:
    netloc = urllib.parse.urlparse(url).netloc.lower()
    if netloc not in NETLOC_TO_HOST:
        raise Blocked(f"host not allowed: {netloc}")
    return NETLOC_TO_HOST[netloc]


# ----------------------------------------------------------------------------- challenge detection
def detect_challenge(status: int, headers: dict, body: bytes) -> str | None:
    """Return a reason string when the response is a bot-protection page (never to be solved), else None."""
    h = {k.lower(): str(v).lower() for k, v in headers.items()}
    if h.get("cf-mitigated") == "challenge":
        return "cf-mitigated: challenge"
    head = body[:8000].decode("utf-8", "replace").lower()
    for m in STRONG_CHALLENGE:
        if m in head:
            return f"challenge marker «{m}»"
    if status in (403, 503) and ("arvan" in h.get("server", "") or "arvan" in " ".join(h.values())):
        return f"HTTP {status} from ArvanCloud edge"
    visible = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", body[:20000].decode("utf-8", "replace")).lower()
    if len(body) < 20000 and "<article" not in visible and "entry-content" not in visible:
        for m in WEAK_CHALLENGE:
            if m in visible:
                return f"captcha/denied marker «{m}» on a short page"
    return None


# ----------------------------------------------------------------------------- polite fetcher
class Fetcher:
    """One request / `delay` s per host, robots.txt, redirects re-checked per hop, ETag cache, backoff, hard stop."""

    def __init__(self, cache_dir: Path, delay: float = MIN_DELAY, max_requests: int = 2000, retries: int = 3,
                 opener=None, sleep=time.sleep, clock=time.monotonic):
        self.cache_dir = cache_dir
        self.delay = max(delay, MIN_DELAY)
        self.max_requests = max_requests
        self.retries = retries
        self._opener = opener  # test hook: callable(url, headers) -> (status, headers, bytes); never follows redirects
        self._sleep = sleep
        self._clock = clock
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None | bool] = {}
        self._robots_text: dict[str, str] = {}
        self.requests: dict[str, int] = {}
        self.blocked: dict[str, str] = {}  # host -> reason
        self._ctx = None
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    # -- low level
    def _wait(self, host: str, extra_delay: float = 0.0) -> None:
        gap_needed = max(self.delay, extra_delay)
        last = self._last.get(host)
        if last is not None:
            gap = self._clock() - last
            if gap < gap_needed:
                self._sleep(gap_needed - gap)
        self._last[host] = self._clock()

    def _send(self, url: str, headers: dict) -> tuple[int, dict, bytes]:
        if self._opener:
            return self._opener(url, headers)
        if self._ctx is None:
            try:
                import certifi

                self._ctx = ssl.create_default_context(cafile=certifi.where())
            except ImportError:  # pragma: no cover
                self._ctx = ssl.create_default_context()

        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None

        opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=self._ctx))
        req = urllib.request.Request(url, headers=headers)  # noqa: S310 - https, allow-listed hosts only
        try:
            with opener.open(req, timeout=60) as r:
                data, hdrs, status = r.read(), dict(r.headers), r.status
        except urllib.error.HTTPError as exc:
            data, hdrs, status = exc.read() or b"", dict(exc.headers or {}), exc.code
        return status, hdrs, data

    def _robots_for(self, url: str):
        p = urllib.parse.urlparse(url)
        netloc = p.netloc.lower()
        if netloc in self._robots:
            return self._robots[netloc]
        rurl = f"{p.scheme}://{netloc}/robots.txt"
        hk = host_key(rurl)
        self._guard(hk)
        status = self._single(rurl, hk, robots=True)
        rp: urllib.robotparser.RobotFileParser | None | bool
        if status[0] is None:
            rp = None  # unreachable => disallow all (RFC 9309)
        else:
            st, body = status
            if 200 <= st < 300 and "<html" not in body[:500].lower():
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(body.splitlines())
            elif 400 <= st < 500:
                rp = True  # no robots.txt => allow all
            else:
                rp = None
        self._robots[netloc] = rp
        self._robots_text[netloc] = status[1] if status[0] is not None else ""
        return rp

    def prime_robots(self, base: str) -> None:
        if self._robots_for(f"{base}/robots.txt") is None:
            raise Blocked(f"robots.txt unreadable/5xx on {base}: treated as disallow-all")

    def robots_text(self, base: str) -> str:
        return self._robots_text.get(urllib.parse.urlparse(base).netloc.lower(), "")

    def _single(self, url: str, hk: str, robots: bool = False):
        """Robots fetch: one polite attempt with a couple of retries. Returns (status, text) or (None, '')."""
        for attempt in range(self.retries + 1):
            self._wait(hk)
            self.requests[hk] = self.requests.get(hk, 0) + 1
            try:
                status, hdrs, data = self._send(url, self._headers())
            except (OSError, http.client.HTTPException, urllib.error.URLError):
                self._sleep(2**attempt)
                continue
            data = _decode(hdrs, data)
            if 300 <= status < 400:  # robots redirect (http->https / www): follow within allow-list
                loc = urllib.parse.urljoin(url, _hget(hdrs, "location") or "")
                try:
                    hk2 = host_key(loc)
                except Blocked:
                    return None, ""
                if hk2 != hk or loc == url:
                    return None, ""
                url = loc
                continue
            if status >= 500 or status == 429:
                self._sleep(2**attempt * 2)
                continue
            if status in (401, 403, 451):
                reason = detect_challenge(status, hdrs, data) or f"HTTP {status} on robots.txt"
                self._block(hk, reason)
            return status, data.decode("utf-8", "replace")
        return None, ""

    def _headers(self, extra: dict | None = None) -> dict:
        h = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,text/xml;q=0.9,*/*;q=0.5",
             "Accept-Language": "fa,en;q=0.5", "Accept-Encoding": "gzip"}  # fmt: skip
        h.update(extra or {})
        return h

    def _block(self, hk: str, reason: str) -> None:
        self.blocked.setdefault(hk, reason)
        print(f"[BLOCKED {hk}] {reason} - host skipped for this run, nothing is bypassed", file=sys.stderr, flush=True)

    def _guard(self, hk: str) -> None:
        if hk in self.blocked:
            raise Blocked(f"{hk} already blocked: {self.blocked[hk]}")
        if self.requests.get(hk, 0) >= self.max_requests:
            raise BudgetExhausted(f"request budget ({self.max_requests}) exhausted for {hk}")

    # -- cache
    def _cache_paths(self, url: str) -> tuple[Path, Path]:
        d = hashlib.sha256(url.encode()).hexdigest()
        return self.cache_dir / f"{d}.json", self.cache_dir / f"{d}.body"

    def _cache_read(self, url: str):
        mp, bp = self._cache_paths(url)
        try:
            return json.loads(mp.read_text(encoding="utf-8")), bp.read_bytes()
        except (OSError, ValueError):
            return None, None

    def _cache_write(self, url: str, hdrs: dict, body: bytes) -> None:
        mp, bp = self._cache_paths(url)
        meta = {"url": url, "etag": _hget(hdrs, "etag"), "last_modified": _hget(hdrs, "last-modified"),
                "fetched_at": now_iso()}  # fmt: skip
        bp.write_bytes(body)
        mp.write_text(json.dumps(meta), encoding="utf-8")

    # -- public
    def get(self, url: str) -> tuple[int, dict, bytes, bool]:
        """GET with robots, rate limit, redirects, conditional cache. Returns (status, headers, body, from_cache).
        `from_cache` True means the server answered 304 (content unchanged since the cached copy)."""
        final = url
        for _hop in range(MAX_REDIRECTS + 1):
            hk = host_key(final)
            self._guard(hk)
            rp = self._robots_for(final)
            self._guard(hk)  # robots fetch may have blocked the host
            if rp is None:
                raise Blocked(f"robots.txt unreadable/5xx on {hk}: treated as disallow-all")
            if rp is not True:
                if not rp.can_fetch(USER_AGENT, final):
                    raise FetchFailed(f"robots.txt disallows {final}")
                cd = rp.crawl_delay(USER_AGENT)
            else:
                cd = None
            meta, cached = self._cache_read(final)
            extra = {}
            if meta and cached is not None:
                if meta.get("etag"):
                    extra["If-None-Match"] = meta["etag"]
                if meta.get("last_modified"):
                    extra["If-Modified-Since"] = meta["last_modified"]
            status, hdrs, data = self._fetch_with_retries(final, hk, extra, float(cd or 0))
            if status in (301, 302, 303, 307, 308):
                loc = _hget(hdrs, "location")
                if not loc:
                    raise FetchFailed(f"redirect without Location: {final}")
                final = urllib.parse.urljoin(final, loc)
                continue
            if status == 304 and cached is not None:
                return 200, hdrs, cached, True
            if status == 200:
                self._cache_write(final, hdrs, data)
            if final != url and status == 200:  # remember the answer under the requested URL too
                self._cache_write(url, hdrs, data)
            return status, hdrs, data, False
        raise FetchFailed(f"too many redirects: {url}")

    def _fetch_with_retries(self, url: str, hk: str, extra: dict, crawl_delay: float):
        last_exc: Exception | None = None
        for attempt in range(self.retries + 1):
            self._guard(hk)
            self._wait(hk, crawl_delay)
            self.requests[hk] = self.requests.get(hk, 0) + 1
            try:
                status, hdrs, data = self._send(url, self._headers(extra))
            except (OSError, http.client.HTTPException, urllib.error.URLError) as exc:
                last_exc = exc
                self._sleep(2**attempt * 2)
                continue
            data = _decode(hdrs, data)
            reason = detect_challenge(status, hdrs, data)
            if reason:
                self._block(hk, reason)
                raise Blocked(f"{hk}: {reason} ({url})")
            if status in (401, 403, 451):
                self._block(hk, f"HTTP {status}")
                raise Blocked(f"{hk}: HTTP {status} ({url})")
            if status == 429 or status >= 500:
                wait = _retry_after(hdrs) or 2**attempt * 5
                last_exc = FetchFailed(f"HTTP {status}")
                self._sleep(min(wait, 120))
                continue
            return status, hdrs, data
        if last_exc and "429" in str(last_exc):
            self._block(hk, "HTTP 429 persisted after retries")
            raise Blocked(f"{hk}: rate limited ({url})")
        raise FetchFailed(f"{url}: {last_exc}")


def _hget(hdrs: dict, name: str) -> str | None:
    for k, v in hdrs.items():
        if k.lower() == name:
            return v
    return None


def _retry_after(hdrs: dict) -> float | None:
    v = _hget(hdrs, "retry-after")
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def _decode(hdrs: dict, data: bytes) -> bytes:
    if (_hget(hdrs, "content-encoding") or "").lower() == "gzip" or data[:2] == b"\x1f\x8b":
        try:
            return gzip.decompress(data)
        except OSError:
            return data
    return data


# ----------------------------------------------------------------------------- discovery
_LOC_RE = re.compile(r"<(?:\w+:)?loc>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*</(?:\w+:)?loc>", re.S | re.I)
_URL_BLOCK_RE = re.compile(r"<(?:\w+:)?(url|sitemap)\b[^>]*>(.*?)</(?:\w+:)?\1>", re.S | re.I)
_LASTMOD_RE = re.compile(r"<(?:\w+:)?lastmod>\s*(.*?)\s*</(?:\w+:)?lastmod>", re.S | re.I)


def parse_sitemap(xml_bytes: bytes) -> tuple[list[tuple[str, str | None]], list[tuple[str, str | None]]]:
    """-> (child_sitemaps, urls), each a list of (loc, lastmod). Regex based on purpose: no XML entity expansion."""
    if xml_bytes[:2] == b"\x1f\x8b":
        xml_bytes = gzip.decompress(xml_bytes)
    text = xml_bytes.decode("utf-8", "replace")
    sitemaps, urls = [], []
    for kind, block in _URL_BLOCK_RE.findall(text):
        m = _LOC_RE.search(block)
        if not m:
            continue
        loc = html.unescape(m.group(1))
        lm = _LASTMOD_RE.search(block)
        (sitemaps if kind.lower() == "sitemap" else urls).append((loc, lm.group(1) if lm else None))
    return sitemaps, urls


def is_law_url(url: str) -> bool:
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path)
    if SKIP_PATH_RE.search(path) or path.strip("/") == "":
        return False
    return bool(LAW_SLUG_RE.search(path.translate(LAW_PATH_TRANS).replace("_", " ")))


def classify_kind(title: str) -> str:
    for kind, rx in KIND_RES:
        if rx.search(title):
            return kind
    return "law"


def discover(fetcher: Fetcher, host: str, max_urls: int | None = None, max_sitemaps: int = 200) -> list[dict]:
    """Law-like page URLs of a host from robots.txt Sitemap lines + the well-known sitemap paths on the base
    host. Newest first. Sitemaps/redirects on other netlocs are ignored (Fetcher follows redirects only within
    the source netlocs)."""
    base = HOSTS[host]["base"]
    robots_sm: list[str] = []
    try:
        fetcher.prime_robots(base)
        robots_sm = [ln.split(":", 1)[1].strip() for ln in fetcher.robots_text(base).splitlines()
                     if ln.lower().startswith("sitemap:")]  # fmt: skip
    except FetchFailed:
        pass
    well_known = [f"{base}/sitemap_index.xml", f"{base}/wp-sitemap.xml", f"{base}/sitemap.xml"]
    queue = list(dict.fromkeys(robots_sm + well_known))
    seen_sm: set[str] = set()
    found: dict[str, str | None] = {}
    while queue and len(seen_sm) < max_sitemaps:
        sm = queue.pop(0)
        if sm in seen_sm:
            continue
        seen_sm.add(sm)
        try:
            if host_key(sm) != host:
                continue
        except Blocked:
            continue  # a sitemap advertised on another domain is ignored
        try:
            status, _, body, _ = fetcher.get(sm)
        except FetchFailed:
            continue
        if status != 200:
            continue
        children, urls = parse_sitemap(body)
        queue += [loc for loc, _lm in children if not SKIP_SITEMAP_RE.search(loc)]
        for loc, lm in urls:
            try:
                if host_key(loc) == host and is_law_url(loc):
                    found.setdefault(loc, lm)
            except Blocked:
                continue
    items = [{"url": u, "lastmod": lm, "host": host} for u, lm in found.items()]
    items.sort(key=lambda x: x["lastmod"] or "", reverse=True)
    return items[:max_urls] if max_urls else items


# ----------------------------------------------------------------------------- parsing
def extract_main_html(page: str) -> str:
    """Inner HTML of the post body container (entry-content / post-content / theme-post-content / <article>)."""
    page = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", "", page)
    candidates = (
        re.compile(r'<(div|section)\b[^>]*class="[^"]*(?:entry-content|post-content|elementor-widget-theme-post-content)[^"]*"[^>]*>', re.I),
        re.compile(r"<(article)\b[^>]*>", re.I),
        re.compile(r"<(main)\b[^>]*>", re.I),
    )  # fmt: skip
    for rx in candidates:
        m = rx.search(page)
        if not m:
            continue
        tag = m.group(1).lower()
        depth, pos = 1, m.end()
        for t in re.finditer(rf"<(/?){tag}\b[^>]*>", page[pos:], re.I):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                return page[pos : pos + t.start()]
        return page[pos:]
    body = re.search(r"(?is)<body\b[^>]*>(.*)</body>", page)
    return body.group(1) if body else page


def _strip(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def extract_title(page: str) -> str:
    m = re.search(r"(?is)<h1\b[^>]*>(.*?)</h1>", page)
    if m and _strip(m.group(1)):
        return _strip(m.group(1))
    m = re.search(r'(?is)<meta[^>]+property="og:title"[^>]+content="([^"]+)"', page)
    if m:
        return re.split(r"\s[-|–]\s", html.unescape(m.group(1)))[0].strip()
    m = re.search(r"(?is)<title>(.*?)</title>", page)
    return re.split(r"\s[-|–]\s", _strip(m.group(1)))[0].strip() if m else ""


def parse_page_meta(page: str, main_text: str) -> dict:
    """approval date (ISO), number, authority, page status (valid/repealed/amended/unknown)."""
    c = cf()
    meta = nz().parse_meta(page)
    head = c.normalise_text("\n".join(re.sub(r"(?is)<(script|style).*?</\1>", "", page).splitlines()))
    plain = c.normalise_text(_strip(extract_main_html(page)))
    approval = meta.get("approval_iso")
    if not approval:
        m = re.search(r"(?:تاریخ تصویب|مصوب\w*)\s*:?\s*(1[34]\d\d\s*/\s*\d{1,2}\s*/\s*\d{1,2})", c.normalise_text(_strip(page)))
        if m:
            approval = c.fmt_date(c.DATE_RE.search(m.group(1)))
    authority = None
    m = re.search(r"(?:مرجع تصویب|تصویب کننده|مرجع)\s*:?\s*([^\n<|،]{3,80})", head)
    if m:
        authority = _strip(m.group(1))
    if not authority:
        m = AUTHORITY_RE.search(plain[:1500])
        authority = m.group(1) if m else None
    status = "unknown"
    low = _strip(page)
    cat_flag = re.search(r'class="[^"]*\bcategory-327\b|/category/[^"]*(?:%d8%a7%d9%84%d8%ba|نامعتبر)', page, re.I)
    if cat_flag or re.search(r"وضعیت\s*:?\s*(?:نامعتبر|منسوخ|لغو\s*شده|ملغی)", low) or "category-327" in page:
        status = "repealed"
    elif re.search(r"وضعیت\s*:?\s*(?:معتبر|لازم[\s‌-]?الاجرا)", low):
        status = "valid"
    return {"approval_date": approval, "number": c.normalise_text(meta["number"]) if meta.get("number") else None, "authority": authority, "page_status": status,
            "published": meta.get("published_iso")}  # fmt: skip


def law_id_for(host: str, url: str) -> str:
    p = urllib.parse.urlparse(url).path
    m = re.search(r"post-(\d+)", p) or re.search(r"[?&]p=(\d+)", url)
    ident = m.group(1) if m else hashlib.sha1(urllib.parse.unquote(p).strip("/").encode()).hexdigest()[:10]  # noqa: S324
    return f"sync_{host}_{ident}"


def parse_law_page(host: str, url: str, page: str) -> dict:
    """HTML -> {law_id, title, kind, meta, rows, repealed_rows, removed, related}. Pure, no I/O."""
    c = cf()
    title = extract_title(page)
    main_html = extract_main_html(page)
    text, refs = nz().html_to_text(main_html)
    text, extras = nz().prep_text(text)
    meta = parse_page_meta(page, text)
    kind = classify_kind(title)
    lid = law_id_for(host, url)
    cfg = {"id": lid, "title_fa": title, "topic": "sync_sources",
           "stage": {"law_id": lid, "law_name": c.normalise_text(title), "law_type": "LAW",
                     "category": "SYNC_" + kind.upper(), "source_tier": "unofficial",
                     "approval_date": meta["approval_date"], "scope_tags": [kind]}}  # fmt: skip
    fetched = {"source_url": url, "source_label": HOSTS[host]["source_label"], "source": host}
    res = c.stage_law(cfg, text, fetched, None)
    stamp = now_iso()
    rows, repealed = res["rows"], res["repealed_rows"]
    for r in rows + repealed:
        r.update(source=host, source_tier="unofficial", instrument_kind=kind, authority=meta["authority"],
                 page_status=meta["page_status"], fetched_at=stamp, staging_status="proposed")  # fmt: skip
        if meta["number"]:
            r["document_number"] = meta["number"]
        if "unofficial_source" not in r["review_reasons"]:
            r["review_reasons"].insert(0, "unofficial_source")
    if meta["page_status"] == "repealed":
        for r in rows:
            r.update(status="REPEALED", is_active=False)
            r["review_reasons"].append("page_marked_repealed")
        repealed, rows = repealed + rows, []
    return {"law_id": lid, "title": title, "kind": kind, "meta": meta, "rows": rows, "repealed_rows": repealed,
            "removed": len(extras["removed"]), "related": refs + extras["related"], "url": url}  # fmt: skip


# ----------------------------------------------------------------------------- corpus cross-check
def norm_name(name: str) -> str:
    t = cf().normalise_text(name or "").replace("‌", " ")
    return re.sub(r"[\s\-–—_:،,.()\[\]«»]+", " ", t).strip()


def load_corpus_index(patterns: list[str], exclude: set[str] | None = None) -> dict[str, dict[str, dict]]:
    """norm(law_name) -> {article_label: {text, law_id, source, file}} from READ-ONLY corpus jsonl files."""
    index: dict[str, dict[str, dict]] = {}
    exclude = {os.path.abspath(e) for e in (exclude or set())}
    for pat in patterns:
        for fp in sorted(globmod.glob(pat)):
            if os.path.abspath(fp) in exclude:
                continue
            try:
                fh = open(fp, encoding="utf-8")  # noqa: SIM115
            except OSError:
                continue
            with fh:
                for line in fh:
                    if '"article_label"' not in line and '"article_no"' not in line:
                        continue
                    try:
                        r = json.loads(line)
                    except ValueError:
                        continue
                    label, name, text = r.get("article_label"), r.get("law_name"), r.get("text")
                    if not (label and name and text) or r.get("is_active") is False:
                        continue
                    index.setdefault(norm_name(name), {}).setdefault(
                        norm_name(label), {"text": text, "law_id": r.get("law_id"), "source": r.get("source"),
                                           "file": os.path.basename(fp), "label": label})  # fmt: skip
    return index


def cross_check(parsed: dict, index: dict[str, dict[str, dict]], threshold: float = 0.97) -> list[dict] | None:
    """None when the law is not in the corpus; else the list of article-level differences (possible amendments)."""
    existing = index.get(norm_name(parsed["title"]))
    if existing is None:
        return None
    diffs = []
    new_labels = set()
    for r in parsed["rows"] + parsed["repealed_rows"]:
        key = norm_name(r["article_label"])
        new_labels.add(key)
        old = existing.get(key)
        base = {"law_name": parsed["title"], "article_label": r["article_label"], "new_source_url": parsed["url"],
                "new_law_id": parsed["law_id"], "page_status": parsed["meta"]["page_status"]}  # fmt: skip
        if old is None:
            diffs.append({**base, "result": "article_missing_in_corpus", "new_text": r["text"]})
            continue
        s = nz().similarity(old["text"], r["text"])
        if s < threshold:
            diffs.append({**base, "result": "text_differs", "similarity": round(s, 4), "old_text": old["text"],
                          "new_text": r["text"], "old_law_id": old["law_id"], "old_source": old["source"],
                          "old_file": old["file"]})  # fmt: skip
    for key, old in existing.items():
        if key not in new_labels:
            diffs.append({"law_name": parsed["title"], "article_label": old["label"], "new_source_url": parsed["url"],
                          "result": "article_missing_in_source", "old_text": old["text"], "old_law_id": old["law_id"]})  # fmt: skip
    return diffs


# ----------------------------------------------------------------------------- state / output
def load_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": 1, "urls": {}}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def write_new_jsonl(path: Path, rows: list[dict]) -> None:
    """data/ is immutable: refuse to touch an existing file."""
    if path.exists():
        raise SystemExit(f"refusing to overwrite existing file: {path} (use --tag for a distinct run)")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def build_report(date: str, run: dict) -> str:
    s = run["stats"]
    L = [f"# Legal sources sync report {date}", "",
         "Source policy: nezamat.ir and ekhtebar.ir only (qavanin.ir serves a bot challenge; see SOURCES_ACCESS.md). "
         "All rows are UNOFFICIAL and need lawyer review before ingest.", "",
         "## Counts", "", "| item | count |", "|---|---|"]  # fmt: skip
    for k in ("urls_discovered", "urls_skipped_unchanged", "pages_fetched", "pages_failed", "pages_deferred_budget",
              "laws_parsed", "new_laws", "new_rows", "repealed_rows", "existing_laws_checked", "article_diffs"):
        L.append(f"| {k} | {s.get(k, 0)} |")
    if s.get("pages_deferred_budget"):
        L += ["", f"Deferred: {s['pages_deferred_budget']} URL(s) were skipped because the per-host request budget "
              "was exhausted; nothing was lost and the sync continues on the next run (incremental state is saved)."]
    L += ["", "## Requests per host", ""]
    for h, n in sorted(run["requests"].items()):
        L.append(f"- {h}: {n} requests")
    L += ["", "## Blocked hosts (challenge / robots / 4xx - skipped, not bypassed)", ""]
    L += [f"- {h}: {r}" for h, r in run["blocked"].items()] or ["- none"]
    L += ["", "## Output files", ""] + [f"- `{f}`" for f in run["files"]] if run["files"] else ["", "## Output files", "", "- none (dry run or nothing new)"]  # fmt: skip
    L += ["", "## New laws (staged)", ""]
    L += [f"- {x['title']} ({x['kind']}, approval {x['approval'] or '?'}, {x['articles']} articles) - {x['url']}"
          for x in run["new_laws"]] or ["- none"]  # fmt: skip
    L += ["", "## Changed articles needing review (laws already in corpus)", ""]
    if run["diffs"]:
        L += ["| law | article | result | similarity | source |", "|---|---|---|---|---|"]
        for d in run["diffs"][:300]:
            L.append(f"| {d['law_name']} | {d['article_label']} | {d['result']} | {d.get('similarity', '')} | {d['new_source_url']} |")
        if len(run["diffs"]) > 300:
            L.append(f"\n... {len(run['diffs']) - 300} more in the review jsonl.")
    else:
        L.append("- none")
    L += ["", "## Failures", ""] + ([f"- {u}: {e}" for u, e in run["failures"][:100]] or ["- none"])
    return "\n".join(L) + "\n"


# ----------------------------------------------------------------------------- run
def run_sync(args, fetcher: Fetcher | None = None, today: str | None = None) -> int:
    state_dir: Path = args.state_dir
    fetcher = fetcher or Fetcher(state_dir / "cache", args.delay, args.max_requests)
    date = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tag = f"_{args.tag}" if args.tag else ""
    state_path = state_dir / "state.json"
    state = load_state(state_path)
    hosts = list(HOSTS) if args.host == "all" else [args.host]
    run = {"stats": dict.fromkeys(("urls_discovered", "urls_skipped_unchanged", "pages_fetched", "pages_failed",
                                   "pages_deferred_budget", "laws_parsed", "new_laws", "new_rows", "repealed_rows",
                                   "existing_laws_checked", "article_diffs"), 0),
           "new_laws": [], "diffs": [], "failures": [], "files": [], "requests": {}, "blocked": {}}  # fmt: skip
    st = run["stats"]

    queue: list[dict] = []
    for h in hosts:
        try:
            items = discover(fetcher, h)
        except Blocked as exc:
            run["failures"].append((h, f"discovery blocked: {exc}"))
            continue
        st["urls_discovered"] += len(items)
        print(f"[{h}] discovered {len(items)} law-like URLs", flush=True)
        for it in items:
            prev = state["urls"].get(it["url"])
            if not args.full and prev and it["lastmod"] and prev.get("lastmod") == it["lastmod"]:
                st["urls_skipped_unchanged"] += 1
                continue
            queue.append(it)
    if args.limit:
        queue = queue[: args.limit]

    if args.dry_run:
        print(f"DRY RUN: {len(queue)} URL(s) would be fetched (no page requests made):")
        for it in queue:
            print(f"  {it['host']}\t{it['lastmod'] or '-'}\t{urllib.parse.unquote(it['url'])}")
        run["requests"], run["blocked"] = dict(fetcher.requests), dict(fetcher.blocked)
        print(f"requests made: {fetcher.requests}; blocked: {fetcher.blocked or 'none'}")
        return 0

    patterns = args.corpus_glob or [str(ROOT / "data/legal/*.jsonl"), str(ROOT / "data/legal/staged/*.jsonl")]
    index = load_corpus_index(patterns)
    out_rows: dict[str, list[dict]] = {}
    out_rep: dict[str, list[dict]] = {}
    try:
        for it in queue:
            h, url = it["host"], it["url"]
            if h in fetcher.blocked:
                continue
            try:
                status, hdrs, body, cached = fetcher.get(url)
            except BudgetExhausted:
                st["pages_deferred_budget"] += 1
                continue
            except Blocked as exc:
                run["failures"].append((url, f"BLOCKED: {exc}"))
                st["pages_failed"] += 1
                continue
            except FetchFailed as exc:
                run["failures"].append((url, str(exc)))
                st["pages_failed"] += 1
                continue
            if status != 200:
                run["failures"].append((url, f"HTTP {status}"))
                st["pages_failed"] += 1
                continue
            st["pages_fetched"] += 1
            chash = hashlib.sha256(body).hexdigest()
            prev = state["urls"].get(url)
            if not args.full and prev and (cached or prev.get("content_hash") == chash):
                state["urls"][url] = {**prev, "lastmod": it["lastmod"]}
                st["urls_skipped_unchanged"] += 1
                continue
            parsed = parse_law_page(h, url, body.decode("utf-8", "replace"))
            nart = len(parsed["rows"]) + len(parsed["repealed_rows"])
            state["urls"][url] = {"lastmod": it["lastmod"], "content_hash": chash, "fetched_at": now_iso(),
                                  "articles": nart, "law_id": parsed["law_id"]}  # fmt: skip
            if not nart:
                run["failures"].append((url, "no articles parsed (not a statute page?)"))
                continue
            st["laws_parsed"] += 1
            diffs = cross_check(parsed, index)
            if diffs is None:
                st["new_laws"] += 1
                st["new_rows"] += len(parsed["rows"])
                st["repealed_rows"] += len(parsed["repealed_rows"])
                out_rows.setdefault(h, []).extend(parsed["rows"])
                out_rep.setdefault(h, []).extend(parsed["repealed_rows"])
                run["new_laws"].append({"title": parsed["title"], "kind": parsed["kind"], "url": url,
                                        "approval": parsed["meta"]["approval_date"], "articles": nart})  # fmt: skip
            else:
                st["existing_laws_checked"] += 1
                run["diffs"].extend(diffs)
                st["article_diffs"] += len(diffs)
    finally:
        save_state(state_path, state)
        run["requests"], run["blocked"] = dict(fetcher.requests), dict(fetcher.blocked)

    out_dir: Path = args.out_dir
    for h, rows in out_rows.items():
        if rows:
            p = out_dir / f"sync_sources_{date}_{h}{tag}.jsonl"
            write_new_jsonl(p, rows)
            run["files"].append(str(p))
    for h, rows in out_rep.items():
        if rows:
            p = out_dir / f"sync_sources_{date}_{h}{tag}.repealed.jsonl"
            write_new_jsonl(p, rows)
            run["files"].append(str(p))
    if run["diffs"]:
        p = out_dir / f"sync_sources_{date}_review{tag}.jsonl"
        write_new_jsonl(p, run["diffs"])
        run["files"].append(str(p))
    rp = args.report_dir / f"SYNC_REPORT_{date}{tag}.md"
    if rp.exists():
        raise SystemExit(f"refusing to overwrite existing report: {rp} (use --tag)")
    rp.parent.mkdir(parents=True, exist_ok=True)
    rp.write_text(build_report(date, run), encoding="utf-8")
    print(f"report: {rp}\nstats: {json.dumps(st)}\nblocked: {run['blocked'] or 'none'}")
    return 6 if run["blocked"] else 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--host", choices=["all", *HOSTS], default="all")
    ap.add_argument("--dry-run", action="store_true", help="discovery only (robots + sitemaps), list the URLs")
    ap.add_argument("--limit", type=int, default=None, help="max URLs to process (dry-run default: 20)")
    ap.add_argument("--full", action="store_true", help="ignore state.json (re-process everything)")
    ap.add_argument("--delay", type=float, default=MIN_DELAY, help="seconds per host between requests (min 3)")
    ap.add_argument("--max-requests", type=int, default=2000, help="request budget per host per run")
    ap.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    ap.add_argument("--out-dir", type=Path, default=ROOT / "data/legal/staged")
    ap.add_argument("--report-dir", type=Path, default=ROOT / "docs/legal")
    ap.add_argument("--corpus-glob", action="append", help="corpus jsonl glob(s) for the cross-check (read-only)")
    ap.add_argument("--tag", default="", help="suffix for output names (a second run on the same day)")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.dry_run and args.limit is None:
        args.limit = 20
    return run_sync(args)


if __name__ == "__main__":
    sys.exit(main())
