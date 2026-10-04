#!/usr/bin/env python3
"""Owner-run, persistent multi-source law acquisition (never gives up while a source is left).

For every law in config/ekhtebar_laws.json it walks an ordered source chain and stops at the
first source that delivers text:

  1 ekhtebar   ekhtebar.ir (the verified adapter from fetch_ekhtebar.py, reused as one source)
  2 qavanin    qavanin.ir      (UNVERIFIED search URL / markup: generic link ranking)
  3 wikisource fa.wikisource.org (MediaWiki API: list=search + action=parse)
  4 discovery  web-search API (Brave/Exa/Tavily keys from the ENVIRONMENT via
               src/ops_fallback/search_adapter.py) -> candidate URLs on allow-listed domains only
  5 archive    web.archive.org availability / CDX for any page URL that failed in 1-4

Per host: robots.txt honoured, identifying User-Agent, >= 3 s between requests, timeout, retries
with exponential backoff + jitter. HTTP 403/429 is NEVER retried or worked around: the host is
left alone for the rest of the run and the chain moves on. Per source: circuit breaker (reuses
src/ops_fallback Cooldown) skips the source after N consecutive hard failures for this run.
Every attempt (source, step, status, reason) lands in manifest.json. When a second source also
delivers, normalised text is compared; disagreement sets needs_human_check. Resumable: laws
already "done" are skipped. Output goes OUTSIDE the repo. Only summaries are printed.

  fetch_laws.py --dry-run [--only ID]     locate only, no downloads
  fetch_laws.py [--only ID] [--out DIR]   download (resumes)
  fetch_laws.py --report [--out DIR]      per-law outcome / "GAVE UP after trying: ..."
  fetch_laws.py --to-staged [--out DIR]   same staging as fetch_ekhtebar.py --to-staged

See docs/ops/LEGAL_FETCH_LAWS.md. Stdlib + certifi (+ PyYAML via src/ops_fallback) only.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.ops_fallback.chains import (  # noqa: E402
    AllStepsFailed,
    Cooldown,
    StepFailure,
    run_with_fallback,
)


def _load_ekhtebar():
    existing = sys.modules.get("fetch_ekhtebar")
    if existing is not None:
        return existing
    path = Path(__file__).with_name("fetch_ekhtebar.py")
    spec = importlib.util.spec_from_file_location("fetch_ekhtebar", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_ekhtebar"] = module
    spec.loader.exec_module(module)
    return module


fe = _load_ekhtebar()

DEFAULT_CONFIG = fe.DEFAULT_CONFIG
USER_AGENT = fe.USER_AGENT
MIN_DELAY = fe.MIN_DELAY
MAX_PAGE_BYTES = fe.MAX_PAGE_BYTES
BLOCKED_PATH_RE = fe.BLOCKED_PATH_RE
SOURCE_ORDER = ("ekhtebar", "qavanin", "wikisource", "discovery", "archive")
ARCHIVE_HOSTS = ("web.archive.org", "archive.org")
DEFAULT_ALLOWED = (
    "ekhtebar.ir",
    "qavanin.ir",
    "rc.majlis.ir",
    "dotic.ir",
    "rrk.ir",
    "fa.wikisource.org",
    "ical.ir",
)
QAVANIN_SEARCH = "https://qavanin.ir/?q={q}"  # UNVERIFIED; override via law hints
WIKISOURCE = "https://fa.wikisource.org"
MIN_TEXT_CHARS = 200
SHORT_WIKI_CHARS = 1500
NO_BREAKER = 10**12  # breaker stays open for the rest of the run

Transport = Callable[[str, dict], tuple[int, dict, bytes]]


# ----------------------------------------------------------------------------- errors
class SoftFailure(StepFailure):
    """The source could not help (robots, not found) but is not unhealthy: no breaker count."""


class RobotsDenied(SoftFailure):
    """robots.txt / allow-list / login-path guard refused the URL. Never worked around."""


class Blocked(Exception):
    pass


class HttpDenied(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(f"HTTP {status}")
        self.status = status


class HttpFailure(Exception):
    pass


# ----------------------------------------------------------------------------- HTTP layer
def make_transport(timeout: float = 45.0) -> Transport:
    """Real transport: one GET, no automatic redirects, per-request timeout."""

    def transport(url: str, headers: dict) -> tuple[int, dict, bytes]:
        req = urllib.request.Request(url, headers=headers, method="GET")
        opener = urllib.request.build_opener(
            fe._NoRedirect, urllib.request.HTTPSHandler(context=fe.ssl_context())
        )
        try:
            with opener.open(req, timeout=timeout) as resp:
                return resp.status, dict(resp.headers.items()), resp.read(MAX_PAGE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers.items()), exc.read(65536)

    return transport


def host_in(host: str, domains) -> bool:
    host = (host or "").lower()
    return any(host == d or host.endswith("." + d) for d in domains)


class HostHttp:
    """Polite multi-host GET. 403/429 => host is left alone for the whole run (no bypass)."""

    def __init__(
        self,
        transport: Transport,
        allowed_domains,
        *,
        delay: float = MIN_DELAY,
        retries: int = 3,
        backoff: float = 2.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        rng: Callable[[], float] = random.random,
        user_agent: str = USER_AGENT,
    ) -> None:
        if delay < MIN_DELAY:
            raise ValueError(f"delay must be >= {MIN_DELAY} seconds")
        self.transport = transport
        self.allowed = tuple(d.lower() for d in allowed_domains) + ARCHIVE_HOSTS
        self.delay = delay
        self.retries = max(1, retries)
        self.backoff = backoff
        self.sleep = sleep
        self.clock = clock
        self.rng = rng
        self.user_agent = user_agent
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self.denied: dict[str, int] = {}
        self.requests = 0

    def _once(self, url: str, host: str) -> tuple[int, dict, bytes]:
        last = self._last.get(host)
        if last is not None:
            wait = self.delay - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        try:
            return self.transport(
                url, {"User-Agent": self.user_agent, "Accept-Language": "fa,en;q=0.5"}
            )
        finally:
            self._last[host] = self.clock()
            self.requests += 1

    def _request(self, url: str) -> tuple[int, dict, bytes]:
        host = (urlparse(url).hostname or "").lower()
        if host in self.denied:
            raise HttpDenied(self.denied[host])
        last_err = "unknown"
        for attempt in range(self.retries):
            if attempt:
                self.sleep(self.backoff * (2 ** (attempt - 1)) * (1 + 0.5 * self.rng()))
            try:
                status, headers, body = self._once(url, host)
            except (OSError, urllib.error.URLError) as exc:
                last_err = type(exc).__name__
                continue
            if status in (403, 429):
                self.denied[host] = status  # back off for the rest of the run; never retry
                raise HttpDenied(status)
            if status >= 500:
                last_err = f"HTTP {status}"
                continue
            if len(body) > MAX_PAGE_BYTES:
                raise HttpFailure("response_too_large")
            return status, headers, body
        raise HttpFailure(last_err)

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser:
        u = urlparse(url)
        key = f"{u.scheme}://{u.hostname}"
        if key not in self._robots:
            status, _, body = self._request(key + "/robots.txt")
            rp = urllib.robotparser.RobotFileParser()
            if status == 200:
                rp.parse(body.decode("utf-8", "replace").splitlines())
            elif status in (404, 410):
                rp.parse([])
            else:
                raise Blocked(f"robots.txt returned HTTP {status}")
            self._robots[key] = rp
        return self._robots[key]

    def check(self, url: str) -> None:
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not host_in(u.hostname, self.allowed):
            raise Blocked("host_not_allowlisted")
        if BLOCKED_PATH_RE.search(u.path or "/"):
            raise Blocked("login_or_admin_path")
        if not self._robots_for(url).can_fetch(self.user_agent, url):
            raise Blocked("robots_disallow")

    def get(self, url: str, *, max_redirects: int = 3) -> tuple[int, dict, bytes, str]:
        for _ in range(max_redirects + 1):
            self.check(url)
            status, headers, body = self._request(url)
            if status in (301, 302, 303, 307, 308):
                loc = {k.lower(): v for k, v in headers.items()}.get("location", "")
                if not loc:
                    return status, headers, body, url
                url = urljoin(url, loc)
                continue
            return status, headers, body, url
        raise HttpFailure("too_many_redirects")


# ----------------------------------------------------------------------------- run context
class RunCooldown(Cooldown):
    """Cooldown that ignores one failure when `skip_next` is set (soft failures)."""

    skip_next: bool = False

    def record_failure(self, name: str) -> None:
        if self.skip_next:
            self.skip_next = False
            return
        super().record_failure(name)


@dataclass
class Ctx:
    http: HostHttp
    threshold: float = fe.SIMILARITY_THRESHOLD
    search_fn: Callable[..., dict] | None = None
    env: Mapping[str, str] | None = None
    allowed_domains: tuple = DEFAULT_ALLOWED
    attempts: list = field(default_factory=list)
    failed_urls: dict = field(default_factory=dict)
    phase: str = "primary"

    def note(self, source: str, step: str, status: str, reason: str = "", url: str | None = None):
        rec = {"source": source, "step": step, "status": status, "phase": self.phase}
        if reason:
            rec["reason"] = reason
        if url:
            rec["url"] = url
        self.attempts.append(rec)

    def get(self, url: str, *, ok_statuses=(200,)) -> tuple[int, dict, bytes, str]:
        """http.get translated into StepFailure types; non-OK status raises."""
        try:
            status, headers, body, final = self.http.get(url)
        except Blocked as exc:
            raise RobotsDenied(None, f"robots_denied:{exc}") from exc
        except HttpDenied as exc:
            raise StepFailure(exc.status, f"denied_http_{exc.status}") from exc
        except HttpFailure as exc:
            raise StepFailure(None, f"network:{exc}") from exc
        if status not in ok_statuses:
            cls = SoftFailure if status in (404, 410) else StepFailure
            raise cls(status, f"http_{status}")
        return status, headers, body, final

    def hints(self, law: dict, source: str) -> dict:
        h = (law.get("sources") or {}).get(source)
        return h if isinstance(h, dict) else {}


# ----------------------------------------------------------------------------- shared helpers
def rank_links(html: str, base: str, title: str, domains) -> list[dict]:
    """Rank same-domain links by title similarity (generic, markup-agnostic)."""
    seen: dict[str, dict] = {}
    for x in fe.page_links(html, base):
        u = urlparse(x["url"])
        if u.scheme not in ("http", "https") or not host_in(u.hostname, domains):
            continue
        if BLOCKED_PATH_RE.search(u.path or "/") or len(x["text"]) < 6:
            continue
        path = u.path.rstrip("/").lower()
        if path in ("",) or path.endswith((".jpg", ".png", ".css", ".js")):
            continue
        if "/page/" in x["url"] or "/category/" in x["url"] or "search" in path:
            continue
        score = fe.similarity(title, x["text"])
        if x["url"] not in seen or score > seen[x["url"]]["score"]:
            seen[x["url"]] = {"url": x["url"], "title": x["text"], "score": score}
    return sorted(seen.values(), key=lambda c: (-c["score"], c["url"]))[:8]


def payload_from_response(body: bytes, final: str) -> dict:
    """PDF (magic bytes) or HTML -> {kind, data, text, final_url}; raises when no text."""
    if body[:5] == b"%PDF-":
        return {"kind": "pdf", "data": body, "text": None, "final_url": final}
    text = fe.extract_text(body.decode("utf-8", "replace"))
    if len(text) < MIN_TEXT_CHARS:
        raise SoftFailure(None, "text_too_short_or_empty")
    return {"kind": "text", "data": text.encode("utf-8"), "text": text, "final_url": final}


def mark_low(cand: dict, threshold: float) -> dict:
    reasons = list(cand.get("reasons") or [])
    if (
        cand.get("score") is not None
        and cand["score"] < threshold
        and "low_similarity" not in reasons
    ):
        reasons.append("low_similarity")
    cand["reasons"] = reasons
    return cand


# ----------------------------------------------------------------------------- source adapters
class Source:
    name = ""
    max_candidates = 1

    def locate(self, law: dict, ctx: Ctx) -> list[dict]:
        raise NotImplementedError

    def download(self, cand: dict, law: dict, ctx: Ctx) -> dict:
        _, _, body, final = ctx.get(cand["url"])
        return payload_from_response(body, final)


class EkhtebarSource(Source):
    """The fetch_ekhtebar.py logic (search -> choose -> PDF-or-text) as one adapter."""

    name = "ekhtebar"

    def locate(self, law, ctx):
        h = ctx.hints(law, "ekhtebar")
        url = f"{fe.BASE_URL}/?s={quote(h.get('query') or law['query_fa'])}"
        _, _, body, final = ctx.get(url)
        cands = fe.search_candidates(body.decode("utf-8", "replace"), final, law["title_fa"])
        chosen, _flag, reasons = fe.choose(cands, ctx.threshold)
        if chosen is None:
            raise SoftFailure(None, "no_candidates")
        return [{**chosen, "reasons": reasons}]

    def download(self, cand, law, ctx):
        _, _, body, final = ctx.get(cand["url"])
        html = body.decode("utf-8", "replace")
        for pdf_url in fe.find_pdf_links(html, final):
            try:
                _, _, pbody, pfinal = ctx.get(pdf_url)
            except StepFailure:
                continue  # fall back to the page text
            if pbody[:5] == b"%PDF-":
                return {"kind": "pdf", "data": pbody, "text": None, "final_url": pfinal}
        return payload_from_response(body, final)


class QavaninSource(Source):
    """qavanin.ir. UNVERIFIED: search URL and markup are guesses; robots checked per request."""

    name = "qavanin"
    max_candidates = 2

    def locate(self, law, ctx):
        h = ctx.hints(law, "qavanin")
        tpl = h.get("search_url") or QAVANIN_SEARCH
        url = tpl.format(q=quote(h.get("query") or law["query_fa"]))
        _, _, body, final = ctx.get(url)
        cands = rank_links(body.decode("utf-8", "replace"), final, law["title_fa"], ["qavanin.ir"])
        if not cands:
            raise SoftFailure(None, "no_candidates")
        return [
            mark_low({**c, "reasons": ["qavanin_selectors_unverified"]}, ctx.threshold)
            for c in cands
        ]


class WikisourceSource(Source):
    """fa.wikisource.org through the MediaWiki API (list=search, action=parse)."""

    name = "wikisource"
    max_candidates = 2

    def locate(self, law, ctx):
        h = ctx.hints(law, "wikisource")
        q = h.get("query") or law["query_fa"]
        url = (
            f"{WIKISOURCE}/w/api.php?action=query&list=search&format=json&srlimit=8"
            f"&srnamespace=0&srsearch={quote(q)}"
        )
        _, _, body, _ = ctx.get(url)
        try:
            hits = json.loads(body.decode("utf-8", "replace"))["query"]["search"]
        except (ValueError, KeyError, TypeError) as exc:
            raise StepFailure(None, "bad_api_json") from exc
        cands = []
        for hit in hits:
            title = str(hit.get("title", ""))
            if not title:
                continue
            cands.append(
                {
                    "url": f"{WIKISOURCE}/w/api.php?action=parse&format=json&formatversion=2"
                    f"&redirects=1&prop=text&page={quote(title)}",
                    "page_url": f"{WIKISOURCE}/wiki/{quote(title.replace(' ', '_'))}",
                    "title": title,
                    "score": fe.similarity(law["title_fa"], title),
                }
            )
        cands.sort(key=lambda c: (-c["score"], c["title"]))
        if not cands:
            raise SoftFailure(None, "no_candidates")
        return [mark_low(c, ctx.threshold) for c in cands[:5]]

    def download(self, cand, law, ctx):
        _, _, body, _ = ctx.get(cand["url"])
        try:
            data = json.loads(body.decode("utf-8", "replace"))["parse"]["text"]
        except (ValueError, KeyError, TypeError) as exc:
            raise StepFailure(None, "bad_api_json") from exc
        html = data.get("*", "") if isinstance(data, dict) else str(data)
        text = fe.extract_text(html)
        if len(text) < MIN_TEXT_CHARS:
            raise SoftFailure(None, "text_too_short_or_empty")
        out = {"kind": "text", "data": text.encode("utf-8"), "text": text}
        out["final_url"] = cand["page_url"]
        if len(text) < SHORT_WIKI_CHARS:
            out["reasons"] = ["possibly_index_or_partial_page"]
        return out


class DiscoverySource(Source):
    """Search-engine discovery (keys from env via src/ops_fallback); allow-listed domains only."""

    name = "discovery"
    max_candidates = 3

    def locate(self, law, ctx):
        from src.ops_fallback.search_adapter import search_with_fallback

        search = ctx.search_fn or search_with_fallback
        h = ctx.hints(law, "discovery")
        query = h.get("query") or f"{law['title_fa']} متن کامل قانون"
        kwargs = {"env": ctx.env} if ctx.env is not None else {}
        try:
            res = search(query, **kwargs)
        except AllStepsFailed as exc:
            raise StepFailure(None, "search_unavailable_or_no_keys") from exc
        except Exception as exc:  # defensive: provider clients must never crash the run
            raise StepFailure(None, f"search_error:{type(exc).__name__}") from exc
        site_domains = [d for d in ctx.allowed_domains if not host_in(d, ARCHIVE_HOSTS)]
        cands: dict[str, dict] = {}
        for r in res.get("results", []):
            url = str(r.get("url") or "")
            u = urlparse(url)
            if u.scheme not in ("http", "https") or not host_in(u.hostname, site_domains):
                continue
            if BLOCKED_PATH_RE.search(u.path or "/"):
                continue
            title = str(r.get("title") or "")
            c = {"url": url, "title": title, "score": fe.similarity(law["title_fa"], title)}
            if url not in cands or c["score"] > cands[url]["score"]:
                cands[url] = c
        ranked = sorted(cands.values(), key=lambda c: (-c["score"], c["url"]))
        if not ranked:
            raise SoftFailure(None, "no_allowlisted_results")
        return [
            mark_low({**c, "reasons": ["found_by_search_engine"]}, ctx.threshold)
            for c in ranked[:5]
        ]


class ArchiveSource(Source):
    """web.archive.org snapshots (availability API, then CDX) of URLs that failed earlier."""

    name = "archive"
    max_candidates = 3

    def locate(self, law, ctx):
        urls = [
            u
            for u in ctx.failed_urls.get(law["id"], [])
            if not host_in(urlparse(u).hostname, ARCHIVE_HOSTS)
        ]
        if not urls:
            raise SoftFailure(None, "no_failed_urls_to_archive")
        cands = []
        for orig in urls[:3]:
            snap = self._availability(orig, ctx) or self._cdx(orig, ctx)
            if snap:
                cands.append(
                    {
                        "url": snap,
                        "original": orig,
                        "title": "",
                        "score": None,
                        "reasons": ["archive_snapshot_may_be_stale"],
                    }
                )
        if not cands:
            raise SoftFailure(None, "no_snapshot")
        return cands

    @staticmethod
    def _raw(url: str) -> str:
        url = re.sub(r"^http://", "https://", url)
        return re.sub(r"(/web/\d+)(/)", r"\1id_\2", url, count=1)

    def _availability(self, orig: str, ctx: Ctx) -> str | None:
        try:
            _, _, body, _ = ctx.get(
                f"https://archive.org/wayback/available?url={quote(orig, safe='')}"
            )
            snap = json.loads(body.decode("utf-8", "replace"))["archived_snapshots"]["closest"]
        except (StepFailure, ValueError, KeyError, TypeError):
            return None
        return self._raw(snap["url"]) if snap.get("available") and snap.get("url") else None

    def _cdx(self, orig: str, ctx: Ctx) -> str | None:
        api = (
            "https://web.archive.org/cdx/search/cdx?output=json&limit=-1"
            f"&filter=statuscode:200&url={quote(orig, safe='')}"
        )
        try:
            _, _, body, _ = ctx.get(api)
            rows = json.loads(body.decode("utf-8", "replace"))
        except (StepFailure, ValueError):
            return None
        if not isinstance(rows, list) or len(rows) < 2:
            return None
        ts, original = rows[-1][1], rows[-1][2]
        return f"https://web.archive.org/web/{ts}id_/{original}"


def build_sources() -> dict[str, Source]:
    return {
        s.name: s
        for s in (
            EkhtebarSource(),
            QavaninSource(),
            WikisourceSource(),
            DiscoverySource(),
            ArchiveSource(),
        )
    }


# ----------------------------------------------------------------------------- cross-check
def normalize_for_compare(text: str) -> str:
    t = fe.normalize_digits(text).replace("‌", " ")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip().lower()


def compare_texts(a: str, b: str) -> tuple[bool, str]:
    """Heuristic agreement of two sources' texts (normalised). Different sites format
    differently, so this is length + article-count based, not a diff."""
    na, nb = normalize_for_compare(a), normalize_for_compare(b)
    if fe.sha256_bytes(na.encode()) == fe.sha256_bytes(nb.encode()):
        return True, "identical_after_normalisation"
    lo, hi = sorted((len(na), len(nb)))
    ratio = lo / hi if hi else 0.0
    if ratio < 0.8:
        return False, f"length_ratio={ratio:.2f}"
    ca, cb = len(fe.split_articles(a)[0]), len(fe.split_articles(b)[0])
    if ca and cb and ca != cb:
        return False, f"article_count {ca} vs {cb}"
    return True, f"similar length_ratio={ratio:.2f}"


# ----------------------------------------------------------------------------- chain driver
def source_steps(law: dict, skip: set[str]) -> list[str]:
    hints = law.get("sources") or {}
    order = [s for s in (hints.get("order") or SOURCE_ORDER) if s in SOURCE_ORDER]
    skipped = set(hints.get("skip") or []) | skip
    return [s for s in order if s not in skipped]


def make_call(law, ctx: Ctx, sources: dict[str, Source], cooldown: RunCooldown, dry_run: bool):
    def call(name: str) -> dict:
        src = sources[name]
        try:
            cands = src.locate(law, ctx)
        except StepFailure as exc:
            cooldown.skip_next = isinstance(exc, SoftFailure)
            ctx.note(name, "locate", str(exc.status or "error"), exc.label)
            raise
        if dry_run:
            ctx.note(name, "locate", "ok", f"{len(cands)} candidate(s)", cands[0]["url"])
            return {"source": name, "candidate": cands[0], "payload": None}
        last: StepFailure | None = None
        soft_all = True
        for cand in cands[: src.max_candidates]:
            try:
                payload = src.download(cand, law, ctx)
            except StepFailure as exc:
                ctx.note(name, "download", str(exc.status or "error"), exc.label, cand["url"])
                blocked = isinstance(exc, RobotsDenied) or exc.status in (403, 429)
                if not blocked and name != "archive":
                    ctx.failed_urls.setdefault(law["id"], []).append(
                        cand.get("page_url") or cand["url"]
                    )
                soft_all = soft_all and isinstance(exc, SoftFailure)
                last = exc
                continue
            ctx.note(name, "download", "ok", "", cand["url"])
            return {"source": name, "candidate": cand, "payload": payload}
        cooldown.skip_next = soft_all
        raise last or StepFailure(None, "no_candidates")

    return call


def _chain(steps, call, cooldown, ctx):
    try:
        out = run_with_fallback(steps, call, is_retryable=lambda _s: True, cooldown=cooldown)
    except AllStepsFailed as exc:
        for a in exc.attempts:
            if a["status"] == "cooldown":
                ctx.note(a["step"], "skipped", "skipped", "circuit_open")
        return None
    for a in out["attempts"]:
        if a["status"] == "cooldown":
            ctx.note(a["step"], "skipped", "skipped", "circuit_open")
    return out["result"]


def acquire_law(
    law: dict,
    ctx: Ctx,
    sources: dict[str, Source],
    cooldown: RunCooldown,
    *,
    dry_run: bool,
    cross_check: bool,
    skip: set[str],
) -> tuple[dict | None, dict]:
    """Returns (winner result or None, extra manifest fields: cross_check, reasons)."""
    ctx.attempts = []
    ctx.phase = "primary"
    steps = source_steps(law, skip)
    winner = _chain(steps, make_call(law, ctx, sources, cooldown, dry_run), cooldown, ctx)
    extra: dict = {"cross_check": None, "reasons": []}
    if winner is None:
        return None, extra
    extra["reasons"] = list(winner["candidate"].get("reasons") or []) + list(
        (winner["payload"] or {}).get("reasons") or []
    )
    if dry_run or not cross_check or winner["source"] == "archive":
        return winner, extra
    ctx.phase = "cross_check"
    others = [s for s in steps if s not in (winner["source"], "archive")]
    second = _chain(others, make_call(law, ctx, sources, cooldown, False), cooldown, ctx)
    if second is None:
        extra["cross_check"] = {"status": "single_source"}
    else:
        ta, tb = winner["payload"]["text"], second["payload"]["text"]
        if ta is None or tb is None:
            extra["cross_check"] = {"status": "not_comparable_pdf", "with": second["source"]}
        else:
            agree, detail = compare_texts(ta, tb)
            extra["cross_check"] = {
                "status": "agree" if agree else "disagree",
                "with": second["source"],
                "with_url": second["candidate"]["url"],
                "detail": detail,
            }
            if not agree:
                extra["reasons"].append("sources_disagree")
    return winner, extra


# ----------------------------------------------------------------------------- run / manifest
def manual_hint(law: dict, out: Path) -> str:
    return (
        f"search «{law['title_fa']}» by hand on rc.majlis.ir / qavanin.ir / ekhtebar.ir, save the "
        f"text as {out}/manual/{law['id']}.txt, and ask a lawyer which instrument is meant "
        "(manual files are not auto-ingested yet)"
    )


def run_download(
    laws: list[dict],
    out: Path,
    ctx: Ctx,
    *,
    sources: dict[str, Source] | None = None,
    dry_run: bool = False,
    cross_check: bool = True,
    max_failures: int = 3,
    skip: set[str] | None = None,
    log: Callable[[str], None] = print,
) -> dict:
    sources = sources or build_sources()
    skip = skip or set()
    cooldown = RunCooldown(threshold=max_failures, seconds=NO_BREAKER, clock=ctx.http.clock)
    manifest = {"schema_version": 2, "source": "multi", "source_tier": "unofficial", "laws": {}}
    if not dry_run:
        manifest = fe.load_manifest(out)
        manifest.update(schema_version=2, source="multi")
    counts = {"done": 0, "skipped_resume": 0, "flagged": 0, "gave_up": 0}
    try:
        for law in laws:
            entry = manifest["laws"].get(law["id"])
            if not dry_run and fe.is_done(out, entry):
                counts["skipped_resume"] += 1
                log(f"{law['id']}: skip (already downloaded)")
                continue
            winner, extra = acquire_law(
                law, ctx, sources, cooldown, dry_run=dry_run, cross_check=cross_check, skip=skip
            )
            flag = bool(extra["reasons"])
            if winner is None:
                counts["gave_up"] += 1
                rec = {
                    "id": law["id"],
                    "title_fa": law["title_fa"],
                    "status": "gave_up",
                    "attempts": ctx.attempts,
                    "next_step": manual_hint(law, out),
                    "fetched_at": fe.utc_now(),
                }
                log(f"{law['id']}: GAVE UP ({len(ctx.attempts)} attempts)")
            elif dry_run:
                c = winner["candidate"]
                log(
                    f"{law['id']}: would use {winner['source']} {c.get('score')} {c['url']} "
                    f"{extra['reasons']}"
                )
                counts["flagged"] += int(flag)
                continue
            else:
                pl = winner["payload"]
                name = f"{law['id']}.{'pdf' if pl['kind'] == 'pdf' else 'txt'}"
                out.mkdir(parents=True, exist_ok=True)
                (out / name).write_bytes(pl["data"])
                rec = {
                    "id": law["id"],
                    "title_fa": law["title_fa"],
                    "query_fa": law["query_fa"],
                    "topic": law["topic"],
                    "status": "done",
                    "kind": pl["kind"],
                    "file": name,
                    "sha256": fe.sha256_bytes(pl["data"]),
                    "bytes": len(pl["data"]),
                    "file_url": pl["final_url"],
                    "source_url": winner["candidate"].get("original") or winner["candidate"]["url"],
                    "source": winner["source"],
                    "law_id_prefix": winner["source"],
                    "source_site": urlparse(
                        winner["candidate"].get("original") or pl["final_url"]
                    ).hostname,
                    "needs_human_check": flag,
                    "reasons": extra["reasons"],
                    "cross_check": extra["cross_check"],
                    "attempts": ctx.attempts,
                    "fetched_at": fe.utc_now(),
                }
                counts["done"] += 1
                counts["flagged"] += int(flag)
                log(
                    f"{law['id']}: done via {winner['source']} {pl['kind']}"
                    f"{' NEEDS_HUMAN_CHECK ' + ','.join(extra['reasons']) if flag else ''}"
                )
            if dry_run:
                continue
            manifest["laws"][law["id"]] = rec
            fe.save_manifest(out, manifest)
        return counts
    finally:
        if not dry_run:
            fe.save_manifest(out, manifest)


def report(laws: list[dict], out: Path, log: Callable[[str], None] = print) -> dict:
    manifest = fe.load_manifest(out)
    summary = {"done": 0, "gave_up": 0, "not_attempted": 0, "flagged": 0}
    for law in laws:
        e = manifest["laws"].get(law["id"])
        if not e:
            summary["not_attempted"] += 1
            log(f"{law['id']}: NOT ATTEMPTED yet")
        elif e.get("status") == "done":
            summary["done"] += 1
            line = f"{law['id']}: got it from {e.get('source', '?')} ({e.get('source_url')})"
            if e.get("needs_human_check"):
                summary["flagged"] += 1
                line += f" | NEEDS_HUMAN_CHECK: {', '.join(e.get('reasons') or [])}"
            cc = e.get("cross_check") or {}
            if cc.get("status"):
                line += f" | cross-check: {cc['status']}" + (
                    f" with {cc['with']}" if cc.get("with") else ""
                )
            log(line)
        else:
            summary["gave_up"] += 1
            tried: dict[str, str] = {}
            for a in e.get("attempts", []):
                tried[a["source"]] = f"{a['source']}({a.get('reason') or a['status']})"
            log(
                f"{law['id']}: GAVE UP after trying: {', '.join(tried.values()) or 'nothing'}"
                f"\n    next: {e.get('next_step') or manual_hint(law, out)}"
            )
    log(json.dumps(summary))
    return summary


def read_allowed(config: Path) -> tuple[str, ...]:
    data = json.loads(Path(config).read_text(encoding="utf-8"))
    return tuple(data.get("allowed_domains") or DEFAULT_ALLOWED)


def default_out() -> Path:
    return fe.default_out().with_name(fe.default_out().name.replace("ekhtebar_", "laws_", 1))


# ----------------------------------------------------------------------------- CLI
def main(
    argv: list[str] | None = None,
    *,
    transport: Transport | None = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    rng: Callable[[], float] = random.random,
    search_fn: Callable[..., dict] | None = None,
    env: Mapping[str, str] | None = None,
) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument(
        "--out", type=Path, default=None, help="default ~/Backups/roxira-legal/laws_<date>/"
    )
    ap.add_argument("--only", metavar="ID")
    ap.add_argument("--dry-run", action="store_true", help="locate only, download nothing")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--to-staged", action="store_true")
    ap.add_argument("--include-flagged", action="store_true")
    ap.add_argument(
        "--delay", type=float, default=MIN_DELAY, help=f"per-host seconds (>= {MIN_DELAY})"
    )
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--timeout", type=float, default=45.0)
    ap.add_argument("--max-failures", type=int, default=3, help="per-source breaker threshold")
    ap.add_argument("--threshold", type=float, default=fe.SIMILARITY_THRESHOLD)
    ap.add_argument("--no-cross-check", action="store_true")
    ap.add_argument("--skip-source", action="append", default=[], choices=SOURCE_ORDER)
    args = ap.parse_args(argv)
    try:
        laws = fe.load_config(args.config)
        if args.only:
            laws = [x for x in laws if x["id"] == args.only]
            if not laws:
                print(f"unknown id {args.only!r}", file=sys.stderr)
                return 2
        out = fe.assert_outside_repo(args.out or default_out())
        if args.report or args.to_staged:
            if not out.is_dir():
                print(f"output dir {out} does not exist", file=sys.stderr)
                return 2
            if args.report:
                report(laws, out)
            else:
                fe.run_to_staged(out, include_flagged=args.include_flagged)
            return 0
        allowed = read_allowed(args.config)
        http = HostHttp(
            transport or make_transport(args.timeout),
            allowed,
            delay=args.delay,
            retries=args.retries,
            sleep=sleep,
            clock=clock,
            rng=rng,
        )
        ctx = Ctx(
            http, threshold=args.threshold, search_fn=search_fn, env=env, allowed_domains=allowed
        )
        counts = run_download(
            laws,
            out,
            ctx,
            dry_run=args.dry_run,
            cross_check=not args.no_cross_check,
            max_failures=args.max_failures,
            skip=set(args.skip_source),
        )
        print(json.dumps({"out": str(out), "dry_run": args.dry_run, **counts}, ensure_ascii=False))
        return 0
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
