#!/usr/bin/env python3
"""Iran relay: collect official Iranian legal texts from a Mac on an Iranian IP.

Foreign server IPs are refused by the government sites below, so this job runs on the OWNER'S MAC
(VPN OFF) and publishes the staged rows as a GitHub PR (scripts/legal/relay_publish.sh). It is the
companion of law_watch.py (ekhtebar.ir / nezamat.ir) and uses the same conventions: stdlib only,
polite fetching, state outside the repo, staged output as a NEW file per day.

Subcommand:
  run   fetch new documents from every reachable source -> data/legal/staged/iran_relay_<date>.jsonl

Sources (all allow crawling in robots.txt; NEVER try to pass a bot challenge):
  taxreg    regulation.tax.gov.ir  list pages lws3?act=last_nz|last_ry|last_mq|usable_* and
                                   document pages lwvi?lid=<id>&ty=<ty>
  dotic     dotic.ir               sitemap.php?page=N -> news pages whose slug names a rule
  rcmajlis  rc.majlis.ir           https://rc.majlis.ir/fa/law/show/<id> for the ids in
                                   config/iran_relay.json ("rc_law_ids", empty by default)

qavanin.ir is excluded: it sits behind an ArvanCloud JS challenge. If a source answers with a
non-200 or a challenge page, it is skipped quietly for this run and the program exits 0.

Row keys: source, source_tier ("official"), url, doc_id, title, doc_type, number, date, issuer,
text, fetched_at, staging_status ("proposed"), needs_review (true).
"""

# ruff: noqa: RUF001
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config" / "iran_relay.json"
STAGED_DIR = ROOT / "data" / "legal" / "staged"
STATE_DIR = Path(os.environ.get("IRAN_RELAY_STATE_DIR", str(Path.home() / ".roxira" / "iran_relay")))

USER_AGENT = "Mozilla/5.0 (RoxiraLegalRelay; contact info@roxira.ir)"
MIN_DELAY = 3.0
TIMEOUT = 25.0
MAX_PER_SOURCE = 40
MAX_TEXT_CHARS = 20000

TAXREG_BASE = "https://regulation.tax.gov.ir"
DOTIC_SITEMAP = "https://dotic.ir/view/sitemap.php?page={page}"
RCMAJLIS_BASE = "https://rc.majlis.ir"

SOURCES = ("taxreg", "dotic", "rcmajlis")
SOURCE_TIER = "official"
TAXREG_LIST_ACTS = ("last_nz", "last_ry", "last_mq", "usable_qh", "usable_mq")
DOTIC_SITEMAP_MAX_PAGES = 5

# A slug names a rule when it contains one of these (normalised: ZWNJ and '-' become spaces).
DOTIC_KEYWORDS = (
    "بخشنامه", "دستورالعمل", "آیین نامه", "تصویب نامه", "تصویبنامه", "مصوبه", "قانون",
)

# Bot-challenge screen. The dotic comment form also contains the word "captcha", so a bare captcha
# mention only counts when the page carries almost no readable content (a challenge shell).
CHALLENGE_MARKERS = (
    "transferring to the website", "just a moment", "cf-chl", "challenge-platform", "/cdn-cgi/",
    "ddos protection", "در حال انتقال به وبسایت",
)

# document kind keywords, matched against the normalised title (first match wins)
TYPE_RULES = (
    ("circular", ("بخشنامه", "دستورالعمل", "شیوه نامه", "ابلاغیه", "مکاتبه")),
    ("bylaw", ("آیین نامه", "اساسنامه", "تصویب نامه", "مقررات", "ضوابط")),
    ("ruling", ("وحدت رویه", "رأی", "رای شماره", "نظریه", "دادنامه", "قرار شماره", "رای ")),
    ("law", ("قانون", "ماده واحده", "لایحه قانونی")),
)

_LABELS = ("نوع", "تاریخ تصویب", "تاریخ ابلاغ", "مرجع تصویب", "مرجع صدور", "شماره مصوبه", "شماره نامه")
_DATE_RE = re.compile(r"[0-9۰-۹]{4}/[0-9۰-۹]{1,2}/[0-9۰-۹]{1,2}")
_NUM_RE = re.compile(r"[0-9۰-۹][0-9۰-۹/\-]{2,}")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _type_norm(s: str) -> str:
    return _norm(s).replace("\u200c", " ").replace("ي", "ی").replace("ك", "ک")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _first_date(text: str) -> str | None:
    m = _DATE_RE.search(text or "")
    return m.group(0) if m else None


# --------------------------------------------------------------------------- tiny DOM (html.parser)
VOID = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
})


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, attrs: list | None = None, parent: "Node | None" = None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children: list = []
        self.parent = parent

    def iter(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.iter()

    def text(self) -> str:
        parts = []
        for c in self.children:
            parts.append(c if isinstance(c, str) else c.text())
        return "".join(parts)

    def find_all(self, tag: str | None = None, cls: str | None = None):
        for n in self.iter():
            if n is self:
                continue
            if tag and n.tag != tag:
                continue
            if cls and cls not in (n.attrs.get("class", "") or "").split():
                continue
            yield n

    def first(self, tag: str | None = None, cls: str | None = None) -> "Node | None":
        return next(self.find_all(tag, cls), None)


class TreeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.stack = [self.root]
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag in ("script", "style"):
            self.skip += 1
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs, self.stack[-1]))

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip > 0:
            self.skip -= 1
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if not self.skip and data:
            self.stack[-1].children.append(data)


def parse(markup: str) -> Node:
    # the taxreg pages close some comments with the malformed "--!>" (which html.parser would keep
    # open, swallowing real anchors); normalise it to a proper "-->" first.
    p = TreeParser()
    p.feed((markup or "").replace("--!>", "-->"))
    p.close()
    return p.root


def txt(node: Node | None) -> str:
    return _norm(node.text()) if node is not None else ""


def strip_html(markup: str) -> str:
    return txt(parse(markup))


# --------------------------------------------------------------------------- challenges
def is_challenge(body: bytes | str) -> bool:
    """True for a bot-challenge / transfer page (never attempt to solve it)."""
    if isinstance(body, bytes):
        body = body.decode("utf-8", "replace")
    low = body.lower()
    if any(m in low for m in CHALLENGE_MARKERS):
        return True
    if "captcha" in low:
        visible = txt(parse(body)) if "<" in body else _norm(body)
        if len(visible) < 200:  # a near-empty shell: a challenge gate, not a content page
            return True
    return False


# --------------------------------------------------------------------------- HTTP
def _sleep(seconds: float) -> None:  # patched in tests
    time.sleep(seconds)



def _iri_to_uri(url: str) -> str:
    """Percent-encode non-ASCII path/query characters (dotic links contain Persian slugs)."""
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parts.path, safe="/%:@!$&'()*+,;=-._~")
    query = urllib.parse.quote(parts.query, safe="=&%:@!$'()*+,;/?-._~")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc.encode("idna").decode("ascii"), path, query, parts.fragment))

def fetch_url(url: str, timeout: float = TIMEOUT) -> tuple[int, bytes]:
    """GET one URL. Returns (status, body). Network errors propagate to the caller."""
    url = _iri_to_uri(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return int(getattr(r, "status", 0) or 0), r.read()
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError) and os.path.exists(SYSTEM_CURL):
            # Some Iranian sites send an incomplete chain that Python's bundled CA store cannot
            # verify; macOS /usr/bin/curl verifies against the system keychain. Verification
            # stays ON (no -k): we only switch to the OS trust store.
            return _fetch_with_system_curl(url, timeout)
        if isinstance(e, urllib.error.HTTPError):
            try:
                body = e.read()
            except Exception:
                body = b""
            return int(e.code), body
        raise
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return int(e.code), body



SYSTEM_CURL = "/usr/bin/curl"


def _fetch_with_system_curl(url: str, timeout: float) -> tuple[int, bytes]:
    """GET via the OS curl (system trust store, certificate verification kept on)."""
    marker = b"\n__ROXIRA_HTTP_STATUS__:"
    out = subprocess.run(
        [SYSTEM_CURL, "-sS", "-L", "--max-time", str(int(timeout)), "-A", USER_AGENT,
         "-w", marker.decode() + "%{http_code}", url],
        capture_output=True, timeout=timeout + 5, check=False,
    )
    if out.returncode != 0:
        raise urllib.error.URLError(f"curl exit {out.returncode}: {out.stderr.decode(errors='replace')[:120]}")
    body, _, code = out.stdout.rpartition(marker)
    return int(code or 0), body

class Fetcher:
    """Polite GET (>= MIN_DELAY between requests); the transport is injectable for tests."""

    def __init__(self, delay: float | None = None, sleep=None, fetch=None):
        self.delay = MIN_DELAY if delay is None else delay
        self.sleep = sleep or _sleep
        self._fetch = fetch
        self._last = 0.0
        self.requests = 0

    def get(self, url: str, timeout: float = TIMEOUT) -> tuple[int, bytes]:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            self.sleep(wait)
        self._last = time.monotonic()
        self.requests += 1
        fn = self._fetch or fetch_url
        return fn(url, timeout=timeout)


def _get(fetcher: Fetcher, url: str) -> bytes | None:
    """One polite GET; logs and returns None on failure, non-200 or a challenge page."""
    try:
        status, body = fetcher.get(url)
    except Exception as e:  # noqa: BLE001 - a reachability probe must never crash the run
        print(f"  skip {url}: {e!r}")
        return None
    if status != 200:
        print(f"  skip {url}: HTTP {status}")
        return None
    if is_challenge(body):
        print(f"  skip {url}: challenge page (not attempted)")
        return None
    return body


# --------------------------------------------------------------------------- state / config
def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def load_state() -> dict:
    return load_json(STATE_DIR / "state.json", {}) or {}


def seen_ids(state: dict, source: str) -> set[str]:
    raw = (state.get("seen") or {}).get(source) or []
    return {str(x) for x in raw if x}


def remember(state: dict, source: str, ids: set[str]) -> None:
    seen = state.setdefault("seen", {})
    merged = sorted(set(seen.get(source) or []) | ids)
    seen[source] = merged[-20000:]  # bounded, newest last


def load_config() -> dict:
    return load_json(CONFIG, {}) or {}


def rc_law_ids(cfg: dict | None = None) -> list[str]:
    cfg = cfg if cfg is not None else load_config()
    return [str(x) for x in (cfg.get("rc_law_ids") or []) if str(x).strip()]


# --------------------------------------------------------------------------- shared helpers
def guess_doc_type(title: str) -> str:
    t = _type_norm(title)
    for kind, keys in TYPE_RULES:
        if any(k in t for k in keys):
            return kind
    return "other"


def dotic_doc_id(url: str) -> str:
    m = re.search(r"/news/(\d+)", url)
    return f"dotic:{m.group(1)}" if m else f"dotic:{_norm(urlparse(url).path)}"


def dotic_title_from_url(url: str) -> str:
    slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    return _norm(unquote(slug).replace("-", " "))


def dotic_matches(title: str) -> bool:
    t = _type_norm(title)
    return any(_type_norm(k) in t for k in DOTIC_KEYWORDS)


def make_row(source: str, url: str, doc_id: str, title: str, doc_type: str,
             number: str | None, date: str | None, issuer: str | None, text: str) -> dict:
    return {
        "source": source,
        "source_tier": SOURCE_TIER,
        "url": url,
        "doc_id": doc_id,
        "title": _norm(title),
        "doc_type": doc_type,
        "number": number or None,
        "date": date or None,
        "issuer": issuer or None,
        "text": _norm(text)[:MAX_TEXT_CHARS],
        "fetched_at": _now(),
        "staging_status": "proposed",
        "needs_review": True,
    }


def _label_values(root: Node) -> dict:
    """Map a metadata label paragraph ('نوع', 'تاریخ تصویب', ...) to the following text."""
    vals: dict[str, str] = {}
    ps = [txt(p) for p in root.find_all("p")]
    for i, t in enumerate(ps):
        key = t.rstrip(":").strip()
        if key in _LABELS and i + 1 < len(ps) and ps[i + 1] and ps[i + 1] != t:
            vals.setdefault(key, ps[i + 1])
    return vals


# --------------------------------------------------------------------------- taxreg
def parse_taxreg_list(markup: str) -> list[dict]:
    root = parse(markup)
    out, seen = [], set()
    for a in root.find_all("a"):
        href = (a.attrs.get("href", "") or "").replace("&amp;", "&")
        m = re.search(r"lwvi\?([^\"'#\s]+)", href)
        if not m:
            continue
        qs = parse_qs(m.group(1))
        lid = (qs.get("lid") or [None])[0]
        ty = (qs.get("ty") or [""])[0]
        if not lid:
            continue
        doc_id = f"taxreg:{lid}"
        if doc_id in seen:
            continue
        tip = a.first(cls="lw_tooltip")
        title = (tip.attrs.get("data-tooltip") if tip else "") or ""
        body = txt(a)
        num = _NUM_RE.search(body.split("شماره مصوبه:", 1)[-1]) if "شماره مصوبه:" in body else None
        issuer = None
        mi = re.search(r"مرجع صدور\s*:\s*(.+?)\s*(?:شماره مصوبه|$)", body)
        if mi:
            issuer = mi.group(1)
        seen.add(doc_id)
        out.append({
            "doc_id": doc_id,
            "url": f"{TAXREG_BASE}/lwvi?lid={lid}&ty={ty}",
            "title": title,
            "number": num.group(0) if num else None,
            "issuer": issuer,
        })
    return out


def _taxreg_body_text(markup: str) -> str:
    parts = []
    for m in re.finditer(r'"s80512493":"((?:[^"\\]|\\.)*)"', markup):
        try:
            frag = json.loads('"' + m.group(1) + '"')
        except ValueError:
            continue
        t = strip_html(frag)
        if t:
            parts.append(t)
    return "\n".join(parts)


def parse_taxreg_doc(markup: str, url: str, fallback: dict | None = None) -> dict | None:
    fallback = fallback or {}
    root = parse(markup)
    title = txt(root.first("title")) or _norm(fallback.get("title", ""))
    if not title:
        return None
    labels = _label_values(root)
    body_text = txt(root)
    text = _taxreg_body_text(markup) or body_text
    date = _first_date(labels.get("تاریخ تصویب", "")) or _first_date(body_text)
    issuer = labels.get("مرجع تصویب") or labels.get("مرجع صدور") or fallback.get("issuer")
    number = fallback.get("number") or labels.get("شماره مصوبه") or labels.get("شماره نامه")
    lid = url.rsplit("lid=", 1)[-1].split("&", 1)[0] if "lid=" in url else url
    return make_row("taxreg", url, f"taxreg:{lid}", title, guess_doc_type(title), number, date, issuer, text)


def collect_taxreg(fetcher: Fetcher, seen: set[str], max_new: int = MAX_PER_SOURCE) -> list[dict]:
    candidates, cand_seen, reachable = [], set(), False
    for act in TAXREG_LIST_ACTS:
        if len(candidates) >= max_new * 2:
            break
        body = _get(fetcher, f"{TAXREG_BASE}/lws3?act={act}")
        if body is None:
            continue
        reachable = True
        for it in parse_taxreg_list(body.decode("utf-8", "replace")):
            if it["doc_id"] in cand_seen:
                continue
            cand_seen.add(it["doc_id"])
            candidates.append(it)
    if not reachable:
        print("taxreg: not reachable (or challenged) this run; skipping")
        return []
    rows = []
    for c in candidates:
        if len(rows) >= max_new:
            break
        if c["doc_id"] in seen:
            continue
        body = _get(fetcher, c["url"])
        if body is None:
            continue
        row = parse_taxreg_doc(body.decode("utf-8", "replace"), c["url"], fallback=c)
        if row:
            rows.append(row)
            seen.add(c["doc_id"])
    return rows


# --------------------------------------------------------------------------- dotic
def parse_sitemap(xml_text: str) -> list[str]:
    return [html.unescape(m.group(1)).strip() for m in re.finditer(r"<loc>\s*(.*?)\s*</loc>", xml_text, re.S)]


def parse_dotic_news(markup: str, url: str) -> dict | None:
    root = parse(markup)
    title = txt(root.first("h5", cls="title")) or txt(root.first("title"))
    if not title:
        return None
    matn = root.first(cls="matn")
    text = txt(matn) if matn else txt(root)
    body = txt(root)
    number = None
    mn = re.search(r"با شماره\s*([0-9۰-۹][0-9۰-۹/\-]{2,})", text)
    if mn:
        number = mn.group(1)
    date = _first_date(text) or _first_date(body)
    issuer = None
    for div in root.find_all("div"):
        if "tags" not in (div.attrs.get("class", "") or "").split():
            continue
        h4 = div.first("h4")
        if h4 and "مرجع وضع" in txt(h4):
            ul = div.first("ul")
            issuer = txt(ul) or None
            break
    doc_type = guess_doc_type(title)
    return make_row("dotic", url, dotic_doc_id(url), title, doc_type, number, date, issuer, text)


def collect_dotic(fetcher: Fetcher, seen: set[str], max_new: int = MAX_PER_SOURCE) -> list[dict]:
    candidates, cand_seen, reachable = [], set(), False
    page = 1
    while page <= DOTIC_SITEMAP_MAX_PAGES and len(candidates) < max_new * 2:
        body = _get(fetcher, DOTIC_SITEMAP.format(page=page))
        if body is None:
            break
        reachable = True
        locs = parse_sitemap(body.decode("utf-8", "replace"))
        if not locs:
            break
        for url in locs:
            if not dotic_matches(dotic_title_from_url(url)):
                continue
            doc_id = dotic_doc_id(url)
            if doc_id in cand_seen:
                continue
            cand_seen.add(doc_id)
            candidates.append((doc_id, url))
        page += 1
    if not reachable:
        print("dotic: not reachable (or challenged) this run; skipping")
        return []
    rows = []
    for doc_id, url in candidates:
        if len(rows) >= max_new:
            break
        if doc_id in seen:
            continue
        body = _get(fetcher, url)
        if body is None:
            continue
        row = parse_dotic_news(body.decode("utf-8", "replace"), url)
        if row:
            rows.append(row)
            seen.add(doc_id)
    return rows


# --------------------------------------------------------------------------- rcmajlis
def parse_rcmajlis_index(markup: str) -> list[dict]:
    root = parse(markup)
    out, seen = [], set()
    for a in root.find_all("a"):
        href = (a.attrs.get("href", "") or "").replace("&amp;", "&")
        m = re.search(r"/law/show/(\d+)", href)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        h2 = a.first("h2")
        out.append({"id": m.group(1), "title": txt(h2) or txt(a)})
    return out


def parse_rcmajlis_doc(markup: str, url: str) -> dict | None:
    root = parse(markup)
    title = txt(root.first("h1", cls="law-title")) or txt(root.first("title"))
    if not title:
        return None
    meta: dict[str, str] = {}
    for div in root.find_all("div", cls="law-meta-container"):
        spans = [txt(s) for s in div.find_all("span")]
        spans = [s for s in spans if s]
        if len(spans) >= 2:
            meta.setdefault(spans[0].rstrip(":").strip(), spans[-1])
    body = txt(root.first(cls="law_text")) or txt(root)
    date = _first_date(meta.get("تاریخ تصویب", "")) or _first_date(body)
    issuer = meta.get("مرجع تصویب") or meta.get("مرجع صدور")
    number = None
    mn = re.search(r"شماره(?:\s*مصوبه)?\s*:?\s*([0-9۰-۹][0-9۰-۹/\-]{2,})", body)
    if mn:
        number = mn.group(1)
    mid = re.search(r"/law/show/(\d+)", url)
    doc_id = f"rcmajlis:{mid.group(1)}" if mid else f"rcmajlis:{_norm(url)}"
    return make_row("rcmajlis", url, doc_id, title, guess_doc_type(title), number, date, issuer, body)


def collect_rcmajlis(fetcher: Fetcher, seen: set[str], ids: list[str],
                     max_new: int = MAX_PER_SOURCE) -> list[dict]:
    if not ids:
        print("rcmajlis: no rc_law_ids configured; skipping")
        return []
    first_url = f"{RCMAJLIS_BASE}/fa/law/show/{ids[0]}"
    first = _get(fetcher, first_url)
    if first is None:
        print("rcmajlis: not reachable (or challenged) this run; skipping")
        return []
    rows = []
    for i, lid in enumerate(ids):
        if len(rows) >= max_new:
            break
        doc_id = f"rcmajlis:{lid}"
        if doc_id in seen:
            continue
        url = first_url if i == 0 else f"{RCMAJLIS_BASE}/fa/law/show/{lid}"
        body = first if i == 0 else _get(fetcher, url)
        if body is None:
            continue
        row = parse_rcmajlis_doc(body.decode("utf-8", "replace"), url)
        if row:
            rows.append(row)
            seen.add(doc_id)
    return rows


# --------------------------------------------------------------------------- run
def append_rows(rows: list[dict], path: Path) -> int:
    if not rows:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:  # append: a new file per day, never rewritten
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return len(rows)


def cmd_run(args, fetcher: Fetcher | None = None) -> int:
    fetcher = fetcher or Fetcher()
    cfg = load_config()
    state = load_state()
    day = dt.date.today().isoformat()
    out_path = STAGED_DIR / f"iran_relay_{day}.jsonl"
    rows: list[dict] = []
    for source in SOURCES:
        print(f"{source}: collecting...")
        if source == "taxreg":
            got = collect_taxreg(fetcher, seen_ids(state, "taxreg"), args.max_per_source)
        elif source == "dotic":
            got = collect_dotic(fetcher, seen_ids(state, "dotic"), args.max_per_source)
        else:
            got = collect_rcmajlis(fetcher, seen_ids(state, "rcmajlis"), rc_law_ids(cfg), args.max_per_source)
        if got:
            remember(state, source, {r["doc_id"] for r in got})
        rows.extend(got)
    n = append_rows(rows, out_path)
    state.update({"last_run": _now(), "last_written": n, "requests": fetcher.requests})
    save_json(STATE_DIR / "state.json", state)
    if n:
        print(f"run: wrote {n} rows -> {out_path} (requests={fetcher.requests})")
    else:
        print(f"run: nothing new (requests={fetcher.requests})")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("run", help="fetch new documents from every reachable source")
    pr.add_argument("--max-per-source", type=int, default=MAX_PER_SOURCE)
    args = ap.parse_args(argv)
    if args.cmd == "run":
        return cmd_run(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
