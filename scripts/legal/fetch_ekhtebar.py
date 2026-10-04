#!/usr/bin/env python3
"""Owner-run, polite downloader for Iranian laws from ekhtebar.ir (UNOFFICIAL aggregator).

Step 1 (download):   fetch_ekhtebar.py [--dry-run] [--only ID] [--out DIR]
Step 2 (to staged):  fetch_ekhtebar.py --to-staged [--out DIR]
Listing:             fetch_ekhtebar.py --list

Behaviour: honours robots.txt (urllib.robotparser), identifies itself, waits >= 3 s between
requests, retries with backoff, is resumable through manifest.json, stops after N consecutive
failures and never follows login / wp-admin links. Output goes OUTSIDE the repo (default
~/Backups/roxira-legal/ekhtebar_<date>/). Only summaries are printed, never law text.

Everything that depends on the real site's markup (search URL, result/link selectors, PDF links,
content container) is UNVERIFIED: it was written offline against generic WordPress markup. See
docs/ops/LEGAL_FETCH_EKHTEBAR.md. Stdlib + certifi only.
"""

# ruff: noqa: RUF001  (Persian text is intentional)
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import hashlib
import json
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path
from typing import ClassVar
from urllib.parse import quote, urljoin, urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config" / "ekhtebar_laws.json"
BASE_URL = "https://www.ekhtebar.ir"
ALLOWED_HOSTS = frozenset({"www.ekhtebar.ir", "ekhtebar.ir"})
USER_AGENT = (
    "RoxiraLegalResearchBot/1.0 (+owner-run, low-rate, robots.txt honoured; "
    "contact: project owner of roxira-platform)"
)
MIN_DELAY = 3.0
SIMILARITY_THRESHOLD = 0.6
CLOSE_MARGIN = 0.05
MAX_PAGE_BYTES = 20 * 1024 * 1024
BLOCKED_PATH_RE = re.compile(
    r"/(wp-admin|wp-login\.php|login|signin|register|my-account|account|cart|checkout)(/|$|\?)",
    re.I,
)
STAGED_NAME = "staged_ekhtebar.jsonl"

Transport = Callable[[str, dict], tuple[int, dict, bytes]]


class Blocked(Exception):
    """URL refused by robots.txt or by the login/admin guard (not counted as a failure)."""


class StopRun(Exception):
    """Too many consecutive failures."""


class FetchError(Exception):
    """A request failed after all retries."""


# ----------------------------------------------------------------------------- text helpers
_DIGITS = {
    **{chr(0x06F0 + i): str(i) for i in range(10)},  # Persian digits
    **{chr(0x0660 + i): str(i) for i in range(10)},  # Arabic-Indic digits
}
_LETTERS = {"ي": "ی", "ك": "ک", "‏": "", "‎": "", "ـ": ""}
_TEXT_TRANS = str.maketrans({**_DIGITS, **_LETTERS})
_MATCH_TRANS = str.maketrans({**_DIGITS, **_LETTERS, "‌": " ", "أ": "ا"})


def normalize_digits(text: str) -> str:
    """Persian/Arabic-Indic digits -> 0-9 (also Arabic yeh/kaf -> Persian, drop RTL marks)."""
    return str(text or "").translate(_TEXT_TRANS)


def norm_title(text: str) -> str:
    """Aggressive normalisation for title comparison only."""
    t = str(text or "").translate(_MATCH_TRANS)
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip().lower()


def similarity(target: str, candidate: str) -> float:
    """0..1: max of sequence ratio and (discounted) share of target tokens found in candidate."""
    a, b = norm_title(target), norm_title(candidate)
    if not a or not b:
        return 0.0
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    ta = set(a.split())
    cover = len(ta & set(b.split())) / len(ta) if ta else 0.0
    return round(max(ratio, 0.9 * cover), 4)


# ----------------------------------------------------------------------------- HTML parsing
class _Links(HTMLParser):
    """Collect (href, text, in_heading) anchors."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict] = []
        self._cur: dict | None = None
        self._heading = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h2", "h3", "h4"):
            self._heading += 1
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self._cur = {"href": href, "text": "", "heading": self._heading > 0}

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "h4") and self._heading:
            self._heading -= 1
        if tag == "a" and self._cur is not None:
            self._cur["text"] = re.sub(r"\s+", " ", self._cur["text"]).strip()
            self.links.append(self._cur)
            self._cur = None

    def handle_data(self, data):
        if self._cur is not None:
            self._cur["text"] += data


class _Text(HTMLParser):
    """Extract visible text of the main content container (UNVERIFIED selectors)."""

    SKIP: ClassVar[set[str]] = {
        "script",
        "style",
        "nav",
        "header",
        "footer",
        "aside",
        "form",
        "noscript",
        "svg",
    }
    BLOCK: ClassVar[set[str]] = {
        "p",
        "div",
        "br",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "tr",
        "section",
        "article",
    }
    CONTENT_CLASS = re.compile(r"entry-content|post-content|article-content|the-content", re.I)

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: dict[str, list[str]] = {"content": [], "article": [], "body": []}
        self._stack: list[tuple[str, str | None]] = []
        self._skip = 0

    def _in(self, kind: str) -> bool:
        return any(k == kind for _, k in self._stack)

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "meta", "link", "img", "input", "hr"):
            if tag == "br":
                self._emit("\n")
            return
        cls = dict(attrs).get("class", "") or ""
        kind = (
            "content"
            if self.CONTENT_CLASS.search(cls)
            else ("article" if tag == "article" else None)
        )
        self._stack.append((tag, kind))
        if tag in self.SKIP:
            self._skip += 1
        if tag in self.BLOCK:
            self._emit("\n")

    def handle_endtag(self, tag):
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i][0] == tag:
                del self._stack[i:]
                break
        else:
            return
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag in self.BLOCK:
            self._emit("\n")

    def _emit(self, s: str) -> None:
        if self._skip:
            return
        self.parts["body"].append(s)
        if self._in("article"):
            self.parts["article"].append(s)
        if self._in("content"):
            self.parts["content"].append(s)

    def handle_data(self, data):
        self._emit(data)


def clean_text(raw: str) -> str:
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in raw.splitlines()]
    out: list[str] = []
    for ln in lines:
        if ln or (out and out[-1]):
            out.append(ln)
    return "\n".join(out).strip()


def extract_text(html: str) -> str:
    """Main law text: entry-content container, else <article>, else whole visible body."""
    p = _Text()
    p.feed(html)
    for key in ("content", "article", "body"):
        text = clean_text("".join(p.parts[key]))
        if text:
            return text
    return ""


def page_links(html: str, base: str) -> list[dict]:
    p = _Links()
    p.feed(html)
    out = []
    for link in p.links:
        url = urljoin(base, link["href"]).split("#")[0]
        out.append({**link, "url": url})
    return out


def host_ok(url: str) -> bool:
    u = urlparse(url)
    return u.scheme in ("http", "https") and (u.hostname or "").lower() in ALLOWED_HOSTS


def guard_ok(url: str) -> bool:
    return host_ok(url) and not BLOCKED_PATH_RE.search(urlparse(url).path or "/")


def search_candidates(html: str, base: str, target_title: str) -> list[dict]:
    """Rank same-site result links by title similarity. Prefers anchors inside headings."""
    links = [x for x in page_links(html, base) if guard_ok(x["url"]) and len(x["text"]) >= 6]
    heads = [x for x in links if x["heading"]]
    pool = heads or links
    seen: dict[str, dict] = {}
    for x in pool:
        path = urlparse(x["url"]).path.rstrip("/")
        if x["url"].lower().split("?")[0].endswith((".pdf", ".jpg", ".png")):
            continue
        if (
            path in ("", "/")
            or "/?s=" in x["url"]
            or "/page/" in x["url"]
            or "/category/" in x["url"]
        ):
            continue
        cand = {"url": x["url"], "title": x["text"], "score": similarity(target_title, x["text"])}
        if x["url"] not in seen or cand["score"] > seen[x["url"]]["score"]:
            seen[x["url"]] = cand
    return sorted(seen.values(), key=lambda c: (-c["score"], c["url"]))[:8]


def choose(
    candidates: list[dict], threshold: float = SIMILARITY_THRESHOLD, margin: float = CLOSE_MARGIN
) -> tuple[dict | None, bool, list[str]]:
    """Return (chosen, needs_human_check, reasons)."""
    if not candidates:
        return None, True, ["no_candidates"]
    best = candidates[0]
    reasons = []
    if best["score"] < threshold:
        reasons.append("low_similarity")
    close = [
        c
        for c in candidates[1:]
        if best["score"] - c["score"] <= margin and c["score"] >= threshold
    ]
    if close:
        reasons.append("several_close_candidates")
    return best, bool(reasons), reasons


def find_pdf_links(html: str, base: str) -> list[str]:
    out = []
    for x in page_links(html, base):
        if urlparse(x["url"]).path.lower().endswith(".pdf") and guard_ok(x["url"]):
            if x["url"] not in out:
                out.append(x["url"])
    return out


# ----------------------------------------------------------------------------- HTTP layer
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover - environment dependent
        return ssl.create_default_context()


def default_transport(url: str, headers: dict) -> tuple[int, dict, bytes]:
    """One GET, no automatic redirects. Raises OSError/URLError on network trouble."""
    req = urllib.request.Request(url, headers=headers, method="GET")
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPSHandler(context=ssl_context())
    )
    try:
        with opener.open(req, timeout=45) as resp:
            return resp.status, dict(resp.headers.items()), resp.read(MAX_PAGE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers.items()), exc.read(65536)


class Fetcher:
    """Polite GET: robots.txt, guard, min delay, retries with backoff, failure circuit-breaker."""

    def __init__(
        self,
        transport: Transport = default_transport,
        *,
        delay: float = MIN_DELAY,
        retries: int = 3,
        backoff: float = 2.0,
        max_failures: int = 5,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        user_agent: str = USER_AGENT,
    ) -> None:
        if delay < MIN_DELAY:
            raise ValueError(f"delay must be >= {MIN_DELAY} seconds")
        self.transport = transport
        self.delay = delay
        self.retries = max(1, retries)
        self.backoff = backoff
        self.max_failures = max_failures
        self.sleep = sleep
        self.clock = clock
        self.user_agent = user_agent
        self.robots: urllib.robotparser.RobotFileParser | None = None
        self.consecutive_failures = 0
        self.requests = 0
        self._last: float | None = None

    # -- single request with the inter-request delay
    def _once(self, url: str) -> tuple[int, dict, bytes]:
        if self._last is not None:
            wait = self.delay - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
        try:
            return self.transport(
                url, {"User-Agent": self.user_agent, "Accept-Language": "fa,en;q=0.5"}
            )
        finally:
            self._last = self.clock()
            self.requests += 1

    def load_robots(self) -> None:
        url = BASE_URL + "/robots.txt"
        status, _, body = self._request(url, check=False)
        rp = urllib.robotparser.RobotFileParser()
        if status == 200:
            rp.parse(body.decode("utf-8", "replace").splitlines())
        elif status in (404, 410):
            rp.parse([])  # no robots.txt: everything allowed
        else:
            raise FetchError(f"robots.txt returned HTTP {status}; refusing to crawl")
        self.robots = rp

    def allowed(self, url: str) -> bool:
        if not guard_ok(url):
            return False
        if self.robots is None:
            raise RuntimeError("robots.txt not loaded")
        return self.robots.can_fetch(self.user_agent, url)

    def _request(self, url: str, *, check: bool = True) -> tuple[int, dict, bytes]:
        last_err = "unknown"
        for attempt in range(self.retries):
            if attempt:
                self.sleep(self.backoff * (2 ** (attempt - 1)))
            try:
                status, headers, body = self._once(url)
            except (OSError, urllib.error.URLError) as exc:
                last_err = f"{type(exc).__name__}"
                continue
            if status == 429 or status >= 500:
                last_err = f"HTTP {status}"
                retry_after = {k.lower(): v for k, v in headers.items()}.get("retry-after", "")
                if retry_after.isdigit():
                    self.sleep(min(int(retry_after), 60))
                continue
            self.consecutive_failures = 0
            return status, headers, body
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.max_failures:
            raise StopRun(f"stopping after {self.consecutive_failures} consecutive failures")
        raise FetchError(f"{last_err} for {urlparse(url).path or '/'}")

    def get(self, url: str, *, max_redirects: int = 3) -> tuple[int, dict, bytes, str]:
        """GET honouring robots and the guard; follows only same-site, allowed redirects."""
        for _ in range(max_redirects + 1):
            if not self.allowed(url):
                raise Blocked(url)
            status, headers, body = self._request(url)
            if status in (301, 302, 303, 307, 308):
                loc = {k.lower(): v for k, v in headers.items()}.get("location", "")
                if not loc:
                    return status, headers, body, url
                url = urljoin(url, loc)
                continue
            if len(body) > MAX_PAGE_BYTES:
                raise FetchError("response larger than size limit")
            return status, headers, body, url
        raise FetchError("too many redirects")


# ----------------------------------------------------------------------------- manifest
def utc_now() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_manifest(out: Path) -> dict:
    path = out / "manifest.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"schema_version": 1, "source": "ekhtebar.ir", "source_tier": "unofficial", "laws": {}}


def save_manifest(out: Path, manifest: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "manifest.json.tmp"
    tmp.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    tmp.replace(out / "manifest.json")


def is_done(out: Path, entry: dict | None) -> bool:
    return bool(entry and entry.get("status") == "done" and (out / entry.get("file", "")).is_file())


def load_config(path: Path) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    laws = data["laws"]
    for law in laws:
        for key in ("id", "title_fa", "query_fa", "topic", "priority"):
            if key not in law:
                raise ValueError(f"config entry {law.get('id')!r} lacks {key!r}")
    return sorted(laws, key=lambda x: (x["priority"], x["id"]))


def default_out(today: dt.date | None = None) -> Path:
    d = (today or dt.date.today()).strftime("%Y%m%d")
    return Path.home() / "Backups" / "roxira-legal" / f"ekhtebar_{d}"


def assert_outside_repo(out: Path) -> Path:
    resolved = out.expanduser().resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        raise ValueError("refused: --out must be outside the repository (data never goes in git)")
    return resolved


# ----------------------------------------------------------------------------- download
def search_law(fetcher: Fetcher, law: dict, threshold: float) -> dict:
    url = f"{BASE_URL}/?s={quote(law['query_fa'])}"
    status, _, body, final = fetcher.get(url)
    if status != 200:
        raise FetchError(f"search returned HTTP {status}")
    cands = search_candidates(body.decode("utf-8", "replace"), final, law["title_fa"])
    chosen, flag, reasons = choose(cands, threshold)
    return {"candidates": cands, "chosen": chosen, "needs_human_check": flag, "reasons": reasons}


def download_law(fetcher: Fetcher, law: dict, out: Path, found: dict) -> dict:
    """Fetch the chosen page; save the PDF if linked, else the page text. Returns manifest bits."""
    chosen = found["chosen"]
    status, _, body, final = fetcher.get(chosen["url"])
    if status != 200:
        raise FetchError(f"law page returned HTTP {status}")
    html = body.decode("utf-8", "replace")
    out.mkdir(parents=True, exist_ok=True)
    for pdf_url in find_pdf_links(html, final):
        pstatus, _, pbody, pfinal = fetcher.get(pdf_url)
        if pstatus == 200 and pbody[:5] == b"%PDF-":
            name = f"{law['id']}.pdf"
            (out / name).write_bytes(pbody)
            return {
                "kind": "pdf",
                "file": name,
                "sha256": sha256_bytes(pbody),
                "bytes": len(pbody),
                "file_url": pfinal,
            }
    text = extract_text(html)
    if not text:
        raise FetchError("no PDF link and no extractable page text")
    data = text.encode("utf-8")
    name = f"{law['id']}.txt"
    (out / name).write_bytes(data)
    return {
        "kind": "text",
        "file": name,
        "sha256": sha256_bytes(data),
        "bytes": len(data),
        "file_url": final,
    }


def run_download(
    laws: list[dict],
    out: Path,
    fetcher: Fetcher,
    *,
    dry_run: bool = False,
    threshold: float = SIMILARITY_THRESHOLD,
    log: Callable[[str], None] = print,
) -> dict:
    manifest = load_manifest(out) if not dry_run else {"laws": {}}
    counts = {"done": 0, "skipped_resume": 0, "flagged": 0, "failed": 0, "blocked": 0}
    try:
        fetcher.load_robots()
        for law in laws:
            entry = manifest["laws"].get(law["id"])
            if not dry_run and is_done(out, entry):
                counts["skipped_resume"] += 1
                log(f"{law['id']}: skip (already downloaded)")
                continue
            try:
                found = search_law(fetcher, law, threshold)
                rec = {
                    "id": law["id"],
                    "title_fa": law["title_fa"],
                    "query_fa": law["query_fa"],
                    "topic": law["topic"],
                    **found,
                }
                ch = found["chosen"]
                if dry_run:
                    log(
                        f"{law['id']}: {'FLAG ' if found['needs_human_check'] else 'ok   '}"
                        f"{ch['score'] if ch else '-'} {ch['title'] if ch else '(none)'} "
                        f"{ch['url'] if ch else ''} {found['reasons']}"
                    )
                    counts["flagged"] += int(found["needs_human_check"])
                    continue
                if ch is None:
                    rec.update(status="no_candidates", fetched_at=utc_now())
                    counts["failed"] += 1
                else:
                    rec.update(download_law(fetcher, law, out, found))
                    rec.update(status="done", source_url=ch["url"], fetched_at=utc_now())
                    counts["done"] += 1
                    counts["flagged"] += int(found["needs_human_check"])
                manifest["laws"][law["id"]] = rec
                log(
                    f"{law['id']}: {rec['status']} {rec.get('kind', '')} "
                    f"{'NEEDS_HUMAN_CHECK' if found['needs_human_check'] else ''}".rstrip()
                )
            except Blocked as exc:
                counts["blocked"] += 1
                log(f"{law['id']}: blocked by robots/guard ({urlparse(str(exc)).path})")
            except FetchError as exc:
                counts["failed"] += 1
                if not dry_run:
                    manifest["laws"][law["id"]] = {
                        "id": law["id"],
                        "status": "failed",
                        "error": str(exc),
                        "fetched_at": utc_now(),
                    }
                log(f"{law['id']}: failed ({exc})")
            if not dry_run:
                save_manifest(out, manifest)
    except StopRun as exc:
        counts["stopped"] = str(exc)
        log(str(exc))
    finally:
        if not dry_run:
            save_manifest(out, manifest)
    return counts


# ----------------------------------------------------------------------------- to-staged
ARTICLE_RE = re.compile(
    r"^\s*(?:ماده\s*(?P<num>\d+)(?:\s*[-–ـ]?\s*(?P<mok>مکرر))?|(?P<wahed>ماده\s*واحده))\s*[-–:.ـ)]*\s*(?P<rest>.*)$"
)


def split_articles(text: str) -> tuple[list[dict], int]:
    """Split on lines that START with «ماده N» / «ماده N مکرر» / «ماده واحده».

    Returns (articles, preamble_chars). Cross-references inside a sentence are not split points
    because only line-initial markers count. Each article: article_no, article_label, text,
    reasons. A repeated (no, label) gets a ' (2)' style label and a duplicate reason.
    """
    text = normalize_digits(text)
    arts: list[dict] = []
    pre: list[str] = []
    cur: dict | None = None
    for line in text.splitlines():
        m = ARTICLE_RE.match(line)
        if m and (m.group("wahed") or m.group("num")):
            if m.group("wahed"):
                no, label = "1", "ماده واحده"
            else:
                no = str(int(m.group("num")))
                label = f"ماده {no}" + (" مکرر" if m.group("mok") else "")
                if m.group("mok"):
                    no += "-mokarrar"
            cur = {
                "article_no": no,
                "article_label": label,
                "lines": [m.group("rest").strip()],
                "reasons": [],
            }
            arts.append(cur)
        elif cur is not None:
            cur["lines"].append(line)
        else:
            pre.append(line)
    seen: dict[tuple[str, str], int] = {}
    out = []
    for a in arts:
        body = "\n".join(a.pop("lines")).strip()
        key = (a["article_no"], a["article_label"])
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            a["article_label"] = f"{a['article_label']} ({seen[key]})"
            a["reasons"].append("duplicate_article_number")
        if not body:
            a["reasons"].append("empty_article_text")
        a["text"] = body
        out.append(a)
    return out, len("\n".join(pre).strip())


def pdf_to_text(path: Path, runner: Callable | None = None) -> str | None:
    """Text of a PDF via pdftotext, or None when it is not installed."""
    exe = shutil.which("pdftotext")
    if not exe:
        return None
    run = runner or subprocess.run
    res = run([exe, "-layout", "-enc", "UTF-8", str(path), "-"], capture_output=True, check=False)
    return res.stdout.decode("utf-8", "replace") if res.returncode == 0 else None


def article_gaps(arts: list[dict]) -> list[int]:
    nums = sorted(
        {int(a["article_no"].split("-")[0]) for a in arts if a["article_no"][0].isdigit()}
    )
    return [n for n in range(1, nums[-1] + 1) if n not in nums] if nums else []


def staged_rows(entry: dict, text: str) -> tuple[list[dict], dict]:
    arts, pre = split_articles(text)
    base_reasons = ["unofficial_source", "approval_date_missing", "in_force_status_unverified"]
    if entry.get("needs_human_check"):
        base_reasons.append("candidate_match_needs_human_check")
    rows = []
    for i, a in enumerate(arts):
        body = a["text"]
        rows.append(
            {
                "law_id": f"{entry.get('law_id_prefix', 'ekhtebar')}_{entry['id']}",
                "law_name": entry["title_fa"],
                "law_type": "LAW",
                "article_no": a["article_no"],
                "article_label": a["article_label"],
                "chapter": None,
                "amended_on": None,
                "approval_date": None,
                "status": "UNVERIFIED",
                "is_active": True,
                "source_url": entry.get("source_url"),
                "source": entry.get("source_site") or "ekhtebar.ir",
                "source_tier": "unofficial",
                "content_hash": sha256_bytes(body.encode("utf-8")),
                "chunk_index": i,
                "text": body,
                "title": a["article_label"],
                "category": entry.get("topic"),
                "scope_tags": [],
                "needs_review": True,
                "review_reasons": base_reasons + a["reasons"],
            }
        )
    return rows, {
        "articles": len(arts),
        "preamble_chars": pre,
        "missing_numbers": article_gaps(arts),
    }


def run_to_staged(
    out: Path,
    *,
    include_flagged: bool = False,
    log: Callable[[str], None] = print,
    pdf_reader: Callable = pdf_to_text,
) -> dict:
    manifest = load_manifest(out)
    rows: list[dict] = []
    summary: dict = {"laws": {}, "skipped": {}}
    for lid, entry in sorted(manifest["laws"].items()):
        if not is_done(out, entry):
            summary["skipped"][lid] = "not_downloaded"
            continue
        if entry.get("needs_human_check") and not include_flagged:
            summary["skipped"][lid] = "needs_human_check (re-run with --include-flagged to convert)"
            continue
        path = out / entry["file"]
        if entry["kind"] == "pdf":
            text = pdf_reader(path)
            if text is None:
                summary["skipped"][lid] = (
                    "pdf_needs_pdftotext (install poppler: brew install poppler)"
                )
                continue
        else:
            text = path.read_text(encoding="utf-8")
        r, info = staged_rows(entry, text)
        if not r:
            summary["skipped"][lid] = "no_articles_found"
            continue
        rows.extend(r)
        summary["laws"][lid] = info
    target = out / STAGED_NAME
    with target.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    summary.update(rows=len(rows), file=str(target))
    log(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return summary


# ----------------------------------------------------------------------------- CLI
def main(
    argv: list[str] | None = None,
    *,
    transport: Transport = default_transport,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output dir (default ~/Backups/roxira-legal/ekhtebar_<date>/)",
    )
    ap.add_argument("--only", metavar="ID")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="search only; print chosen candidates")
    ap.add_argument("--to-staged", action="store_true")
    ap.add_argument(
        "--include-flagged",
        action="store_true",
        help="with --to-staged: also convert needs_human_check laws",
    )
    ap.add_argument(
        "--delay", type=float, default=MIN_DELAY, help=f"seconds between requests (>= {MIN_DELAY})"
    )
    ap.add_argument("--max-failures", type=int, default=5)
    ap.add_argument("--threshold", type=float, default=SIMILARITY_THRESHOLD)
    args = ap.parse_args(argv)
    try:
        laws = load_config(args.config)
        if args.only:
            laws = [x for x in laws if x["id"] == args.only]
            if not laws:
                print(f"unknown id {args.only!r}; use --list", file=sys.stderr)
                return 2
        if args.list:
            for x in laws:
                print(f"{x['id']:28} p{x['priority']} {x['topic']:20} {x['title_fa']}")
            return 0
        out = assert_outside_repo(args.out or default_out())
        if args.to_staged:
            if not out.is_dir():
                print(f"output dir {out} does not exist", file=sys.stderr)
                return 2
            run_to_staged(out, include_flagged=args.include_flagged)
            return 0
        fetcher = Fetcher(transport, delay=args.delay, max_failures=args.max_failures, sleep=sleep)
        counts = run_download(laws, out, fetcher, dry_run=args.dry_run, threshold=args.threshold)
        print(json.dumps({"out": str(out), "dry_run": args.dry_run, **counts}, ensure_ascii=False))
        return 4 if "stopped" in counts else 0
    except (ValueError, FetchError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
