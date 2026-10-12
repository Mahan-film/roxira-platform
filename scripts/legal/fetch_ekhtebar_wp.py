#!/usr/bin/env python3
"""ekhtebar.ir (WordPress) full-law fetcher -> one jsonl via corpus_fill.stage_law. Deterministic, no LLM.

ekhtebar.ir is the owner's only accepted legal source for this corpus fill. It is UNOFFICIAL: every row is
`source_tier: unofficial`, `needs_review: true` and the allowlist entries are status "proposed" (ingest needs
--allow-proposed). No Qdrant/DB writes, no other host is ever contacted.

  fetch_ekhtebar_wp.py search  "قانون ..."                     REST search (posts + pages): id, title, link
  fetch_ekhtebar_wp.py fetch   [--only ID ...] [--raw-dir DIR]  config sources.ekhtebar.url -> WordPress REST
                                (wp-json/wp/v2/posts?slug=...&_fields=...content) -> raw text DIR/<id>.txt and
                                DIR/manifest.json; falls back to the HTML page if the REST API is unavailable
  fetch_ekhtebar_wp.py stage   --raw-dir DIR --out FILE.jsonl [--only ID ...]
                                split into one row per ماده (تبصره stays with its ماده) through
                                corpus_fill.stage_law, add source/source_url/fetched_at, write the jsonl
                                (+ .repealed.jsonl), run the ingest gates and the checks below. EXIT 5 when a
                                selected law yields 0 rows.
  fetch_ekhtebar_wp.py run     --out FILE.jsonl [--only ID ...]  fetch + stage in one go
  fetch_ekhtebar_wp.py validate FILE.jsonl                      gaps / HTML junk / idempotence / duplicate keys
  fetch_ekhtebar_wp.py sample   FILE.jsonl [--n 5] [--seed 7]   random articles per law with their source URL

Politeness: browser User-Agent, >= 2 s between requests, <= 400 requests per run, robots.txt honoured
(RFC 9309: 4xx = allow all, 5xx/unreachable = disallow all), gzip. 401/403/429/451/5xx, CAPTCHA or a JS challenge stops the
run immediately; nothing is bypassed or retried around. Stdlib + certifi.
"""

# ruff: noqa: RUF001
from __future__ import annotations

import argparse
import gzip
import html
import http.client
import importlib.util
import json
import random
import re
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://www.ekhtebar.ir"
ALLOWED_HOSTS = frozenset({"www.ekhtebar.ir", "ekhtebar.ir"})
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
MIN_DELAY = 2.0
MAX_REQUESTS = 400
DEFAULT_CONFIG = ROOT / "config/corpus_fill_laws.json"
DEFAULT_ALLOWLIST = ROOT / "config/legal_allowlist.json"
BLOCKED_PATH_RE = re.compile(r"/(wp-admin|wp-login\.php)(/|$|\?)", re.I)
BLOCK_MARKERS = (
    "captcha", "cf-chl", "cf-browser-verification", "Just a moment", "Attention Required",
    "Access Denied", "Transferring to the website", "در حال انتقال به سایت",
)  # fmt: skip
# the four laws of the 2026-10-12 fill; --only selects others that carry sources.ekhtebar.url
DEFAULT_IDS = ("taazirat_1375", "admin_justice_court", "third_party_insurance_1395", "smuggling_goods_currency")
HTML_JUNK_RE = re.compile(
    r"<\/?[a-zA-Z][^>]*>|&[a-z]+;|&#\d+;|https?://|www\.|\bclass=|\bhref=|برچسب|ارسال دیدگاه|"
    r"دسته ?بندی|کپی لینک|\[\]\(|\]\(http|^\s*[#>*]{1,3}\s|\*\*|!\[|دانلود|پی ?دی ?اف"
    # page chrome that is only junk as a WHOLE line («قوانین مرتبط» inside a sentence is law text)
    r"|^\s*(?:تازه‌های قوانین:?|مطالب مرتبط|قوانین مرتبط|مستندات مرتبط|آیین‌نامه|رای وحدت رویه|نظریه مشورتی|فهرست|Toggle)\s*$",
    re.M,
)


class Blocked(Exception):
    """403/429/challenge/CAPTCHA/robots refusal: the run stops, nothing is bypassed."""


class FetchFailed(Exception):
    pass


def _load(name: str, rel: str):
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, ROOT / rel)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover
        return ssl.create_default_context()


# ----------------------------------------------------------------------------- robots (RFC 9309)
def robots_decision(status: int | None, body: str | None) -> tuple[urllib.robotparser.RobotFileParser | None, bool]:
    """(parser, allow_all). 2xx: parse. 4xx: no robots.txt => allow everything (RFC 9309 2.3.1.3).
    5xx / unreachable (status None): treat as complete disallow (2.3.1.4)."""
    if status is not None and 200 <= status < 300 and body is not None:
        if "<html" in body[:500].lower():  # an HTML page (challenge) instead of robots.txt: unreadable => disallow
            return None, False
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(body.splitlines())
        return rp, False
    if status is not None and 400 <= status < 500:
        return None, True
    return None, False


# ----------------------------------------------------------------------------- polite HTTP
class Client:
    def __init__(self, delay: float = MIN_DELAY, max_requests: int = MAX_REQUESTS, opener=None):
        self.delay = max(delay, MIN_DELAY)
        self.max_requests = max_requests
        self.requests = 0
        self._last = 0.0
        self._ctx = _ssl_context()
        self._opener = opener  # test hook: callable(url, headers) -> (status, headers, bytes)
        self._robots: tuple[urllib.robotparser.RobotFileParser | None, bool] | None = None

    def _sleep(self) -> None:
        gap = time.monotonic() - self._last
        if self._last and gap < self.delay:
            time.sleep(self.delay - gap)
        self._last = time.monotonic()

    def _raw(self, url: str) -> tuple[int, dict, bytes]:
        host = urllib.parse.urlparse(url).netloc
        if host not in ALLOWED_HOSTS:
            raise Blocked(f"host not allowed: {host}")
        if BLOCKED_PATH_RE.search(urllib.parse.urlparse(url).path):
            raise Blocked(f"path not allowed: {url}")
        if self.requests >= self.max_requests:
            raise Blocked(f"request budget ({self.max_requests}) exhausted")
        self._sleep()
        self.requests += 1
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/html;q=0.9, */*;q=0.5",
            "Accept-Language": "fa,en;q=0.5",
            "Accept-Encoding": "gzip",
        }
        if self._opener:
            return self._opener(url, headers)
        req = urllib.request.Request(url, headers=headers)  # noqa: S310 - https, allow-listed hosts only
        try:
            with urllib.request.urlopen(req, context=self._ctx, timeout=60) as r:  # noqa: S310
                data = r.read()
                hdrs = dict(r.headers)
                status = r.status
        except urllib.error.HTTPError as exc:
            data, hdrs, status = exc.read() or b"", dict(exc.headers or {}), exc.code
        if hdrs.get("Content-Encoding", "").lower() == "gzip":
            data = gzip.decompress(data)
        return status, hdrs, data

    def check_robots(self) -> None:
        if self._robots is None:
            try:
                status, _, data = self._raw(f"{BASE}/robots.txt")
                self._robots = robots_decision(status, data.decode("utf-8", "replace"))
            except (urllib.error.URLError, OSError, http.client.HTTPException):
                self._robots = robots_decision(None, None)
        rp, allow_all = self._robots
        if not allow_all and rp is None:
            raise Blocked("robots.txt unreadable/5xx: treated as disallow-all")

    def allowed(self, url: str) -> bool:
        self.check_robots()
        rp, allow_all = self._robots
        return True if allow_all else bool(rp and rp.can_fetch(USER_AGENT, url))

    def get(self, url: str, retries: int = 2) -> tuple[int, bytes]:
        self.check_robots()
        if not self.allowed(url):
            raise Blocked(f"robots.txt disallows {url}")
        last: Exception | None = None
        for _ in range(retries + 1):
            try:
                status, _, data = self._raw(url)
            except (http.client.IncompleteRead, http.client.RemoteDisconnected, ConnectionResetError, TimeoutError) as exc:
                last = exc  # a truncated transfer is transient; each retry still waits >= delay and counts
                continue
            except urllib.error.URLError as exc:
                raise FetchFailed(f"{url}: {exc}") from exc
            if status in (401, 403, 429, 451) or status >= 500:
                raise Blocked(f"HTTP {status} for {url}")
            head = data[:6000].decode("utf-8", "replace")
            if status == 200 and any(m.lower() in head.lower() for m in BLOCK_MARKERS) and "wp-json" not in url:
                raise Blocked(f"challenge/CAPTCHA marker in {url}")
            return status, data
        raise FetchFailed(f"{url}: transfer kept failing ({type(last).__name__})")


# ----------------------------------------------------------------------------- HTML -> text
_SKIP_TAGS = {"script", "style", "svg", "nav", "noscript", "iframe", "form", "button", "head"}
_BLOCK_TAGS = {"p", "div", "br", "li", "tr", "ul", "ol", "table", "section", "article", "blockquote", "hr"}
_HEAD_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_JUNK_CLASS_RE = re.compile(r"ez-toc|related|share|sharedaddy|jp-relatedposts|comment|tags?-links|post-tags|adsbygoogle|"
                            r"yarpp|breadcrumb|widget|wp-block-buttons", re.I)  # fmt: skip


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._skip_depth = 0
        self._stack: list[tuple[str, bool]] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        junk = tag in _SKIP_TAGS or bool(_JUNK_CLASS_RE.search((a.get("class") or "") + " " + (a.get("id") or "")))
        if tag in ("br", "hr", "img", "input", "meta", "link"):
            if tag in ("br", "hr"):
                self.out.append("\n")
            return
        self._stack.append((tag, junk))
        if junk:
            self._skip_depth += 1
            return
        if tag in _HEAD_TAGS:
            self.out.append("\n\n")
        elif tag in _BLOCK_TAGS:
            self.out.append("\n")

    def handle_endtag(self, tag):
        # pop to the matching open tag (tolerates unclosed <p>/<li>)
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i][0] == tag:
                popped = self._stack[i:]
                del self._stack[i:]
                self._skip_depth -= sum(1 for _, j in popped if j)
                break
        else:
            return
        if self._skip_depth == 0:
            if tag in _HEAD_TAGS:
                self.out.append("\n\n")
            elif tag in _BLOCK_TAGS:
                self.out.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self.out.append(data)


def html_to_text(fragment: str) -> str:
    p = _Text()
    p.feed(fragment)
    p.close()
    text = html.unescape("".join(p.out)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if ln == "" and (not out or out[-1] == ""):
            continue
        out.append(ln)
    return "\n".join(out).strip() + "\n"


# ----------------------------------------------------------------------------- WordPress REST
def slug_of(url: str) -> str:
    path = urllib.parse.urlparse(url).path.strip("/")
    return path.split("/")[-1]


def _rest(kind: str, query: dict) -> str:
    return f"{BASE}/wp-json/wp/v2/{kind}?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote)


def search(client: Client, query: str) -> list[dict]:
    found = []
    for kind in ("posts", "pages"):
        status, data = client.get(_rest(kind, {"search": query, "_fields": "id,link,title", "per_page": 15}))
        if status != 200:
            continue
        for x in json.loads(data):
            found.append({"kind": kind, "id": x["id"], "title": html.unescape(x["title"]["rendered"]), "link": x["link"]})
    return found


def fetch_content(client: Client, url: str) -> dict:
    """Law page -> {text, link, title, modified, via}. REST first (clean content.rendered), HTML page as fallback."""
    slug = urllib.parse.unquote(slug_of(url)) if "?p=" not in url else ""
    if slug:
        for kind in ("posts", "pages"):
            status, data = client.get(_rest(kind, {"slug": slug, "_fields": "id,link,title,modified,content"}))
            if status != 200:
                break
            try:
                arr = json.loads(data)
            except ValueError:
                break
            if arr:
                x = arr[0]
                return {"text": html_to_text(x["content"]["rendered"]), "link": x["link"], "id": x["id"],
                        "title": html.unescape(x["title"]["rendered"]), "modified": x.get("modified"), "via": f"rest:{kind}"}  # fmt: skip
    status, data = client.get(url)
    if status != 200:
        raise FetchFailed(f"{url}: HTTP {status}")
    page = data.decode("utf-8", "replace")
    m = re.search(r'<div[^>]+class="[^"]*(?:entry-content|post-content|the-content)[^"]*"[^>]*>(.*?)</article>', page, re.S)
    t = re.search(r"<title>(.*?)</title>", page, re.S)
    return {"text": html_to_text(m.group(1) if m else page), "link": url, "id": None,
            "title": html.unescape(t.group(1)).strip() if t else "", "modified": None, "via": "html"}  # fmt: skip


# ----------------------------------------------------------------------------- commands
def _cfg(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _select(cfg: dict, only: list[str] | None) -> list[dict]:
    ids = set(only) if only else set(DEFAULT_IDS)
    laws = [x for x in cfg["laws"] if x["id"] in ids]
    missing = ids - {x["id"] for x in laws}
    if missing:
        raise SystemExit(f"unknown law ids: {sorted(missing)}")
    return laws


def _urls(law: dict) -> list[str]:
    ek = (law.get("sources") or {}).get("ekhtebar") or {}
    return [ek["url"], *ek.get("extra_urls", [])] if ek.get("url") else []


HEADING_RE = re.compile(r"^(?:فصل|مبحث|بخش|باب|گفتار|قسمت)\s+\S.{0,300}$")
RANGE_NOTE_RE = re.compile(
    r"^ماده\s*(?P<a>\d+)\s*(?P<join>تا|و)\s*(?P<b>\d+)\s*(?P<sep>[-–—ـ:])\s*(?P<rest>.*)$", re.M
)


def expand_range_notes(text: str) -> tuple[str, dict[str, str]]:
    """«ماده 625 تا 629– [... نسخ شده است.]» (one note for several repealed articles) -> one «ماده N– [...]» line per
    number, so each article gets its own (repealed) row and the numbering stays continuous. «و» joins exactly two."""
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")

    def repl(m: re.Match) -> str:
        a, b = int(m["a"]), int(m["b"])
        nums = range(a, b + 1) if m["join"] == "تا" else (a, b)
        if len(nums) > 60:  # not a plausible repeal note
            return m[0]
        return "\n".join(f"ماده {n}{m['sep']} {m['rest']}" for n in nums)

    text = RANGE_NOTE_RE.sub(repl, cf.normalise_text(text))
    # a chapter heading glued to the previous article (no blank line) would end up inside that article's body;
    # corpus_fill only recognises headings shorter than 120 chars, so a longer one is shortened for parsing and
    # the full heading is put back into the row's `chapter` afterwards (returned map)
    out: list[str] = []
    restore: dict[str, str] = {}
    for ln in text.splitlines():
        if HEADING_RE.match(ln) and "." not in ln:
            if len(ln) >= 118:
                short = ln[:100].rstrip()
                restore[short] = ln
                ln = short
            if out and out[-1].strip():
                out.append("")
        out.append(ln)
    return "\n".join(out) + "\n", restore


def cmd_search(args) -> int:
    for r in search(Client(args.delay), args.query):
        print(r["kind"], r["id"], r["title"], urllib.parse.unquote(r["link"]))
    return 0


def cmd_fetch(args) -> int:
    cfg = _cfg(args.config)
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    client = Client(args.delay, args.max_requests)
    manifest: dict[str, dict] = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rc = 0
    try:
        for law in _select(cfg, args.only):
            urls = _urls(law)
            if not urls:
                manifest[law["id"]] = {"status": "failed", "reason": "no sources.ekhtebar.url in config"}
                rc = 4
                continue
            texts, used, titles = [], [], []
            for u in urls:
                got = fetch_content(client, u)
                texts.append(got["text"])
                used.append(got["link"])
                titles.append(got["title"])
            (args.raw_dir / f"{law['id']}.txt").write_text("\n\n".join(texts), encoding="utf-8")
            manifest[law["id"]] = {
                "status": "done", "kind": "text", "file": f"{law['id']}.txt", "source_url": used[0],
                "source_urls": used, "source": "ekhtebar", "source_label": "ekhtebar.ir", "titles": titles,
                "fetched_at": now, "via": got["via"], "chars": sum(len(t) for t in texts),
            }  # fmt: skip
            print(law["id"], "done", got["via"], manifest[law["id"]]["chars"], "chars", flush=True)
    except Blocked as exc:
        print(f"STOPPED (not bypassed): {exc}", file=sys.stderr)
        rc = 6
    except FetchFailed as exc:
        print(f"FETCH FAILED: {exc}", file=sys.stderr)
        rc = 4
    (args.raw_dir / "manifest.json").write_text(json.dumps({"laws": manifest}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"requests made: {client.requests}")
    return rc


def stage_rows(cfg: dict, raw_dir: Path, only: list[str] | None, allowlist) -> tuple[list[dict], list[dict], dict]:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    manifest = json.loads((raw_dir / "manifest.json").read_text(encoding="utf-8"))["laws"]
    rows, repealed, report = [], [], {}
    for law in _select(cfg, only):
        ent = manifest.get(law["id"])
        if not ent or ent.get("status") != "done":
            report[law["id"]] = {"error": "not_fetched"}
            continue
        text, long_headings = expand_range_notes((raw_dir / ent["file"]).read_text(encoding="utf-8"))
        res = cf.stage_law(law, text, ent, allowlist)
        for r in res["rows"] + res["repealed_rows"]:
            r["chapter"] = long_headings.get(r["chapter"], r["chapter"])
            r["source"] = "ekhtebar"
            r["source_url"] = ent["source_url"]
            r["fetched_at"] = ent["fetched_at"]
        rows += res["rows"]
        repealed += res["repealed_rows"]
        report[law["id"]] = {"rows": len(res["rows"]), "repealed_excluded": len(res["repealed_rows"]),
                             "analysis": res["analysis"], "gates": res.get("gates")}  # fmt: skip
    return rows, repealed, report


def cmd_stage(args) -> int:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    ing = cf._load_ingest()
    cfg = _cfg(args.config)
    allowlist = ing.load_allowlist(args.allowlist, allow_proposed=True)
    rows, repealed, report = stage_rows(cfg, args.raw_dir, args.only, allowlist)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    empty = [k for k, v in report.items() if not v.get("rows")]
    if empty:  # (a) never write a half-empty staged file silently
        print(f"ERROR: selected law(s) with 0 rows: {empty}; nothing written", file=sys.stderr)
        return 5
    if args.out.exists() and not args.overwrite:
        print(f"ERROR: {args.out} exists (never overwritten; pass --overwrite for your own scratch file)", file=sys.stderr)
        return 2
    cf.write_jsonl(args.out, rows)
    if repealed:
        cf.write_jsonl(args.out.with_suffix(".repealed.jsonl"), repealed)
    problems = validate_rows(rows + repealed)
    print(json.dumps(problems, ensure_ascii=False, indent=2))
    bad = problems["html_junk"] or problems["not_normalised"] or problems["duplicate_keys"] or problems["not_idempotent"]
    gates_bad = [k for k, v in report.items() if v.get("gates") and not v["gates"]["ok"]]
    return 3 if bad or gates_bad else 0


def cmd_run(args) -> int:
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    rc = cmd_fetch(args)
    if rc:
        return rc
    return cmd_stage(args)


# ----------------------------------------------------------------------------- validate / sample
def validate_rows(rows: list[dict]) -> dict:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    by_law: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_law[r["law_name"]].append(r)
    rep: dict = {"per_law": {}, "html_junk": [], "not_normalised": [], "not_idempotent": [], "duplicate_keys": []}
    for law, rs in by_law.items():
        nums = sorted({int(r["article_no"].split("-")[0]) for r in rs if r["article_no"].split("-")[0].isdigit()})
        gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in set(nums)] if nums else []
        rep["per_law"][law] = {"rows": len(rs), "first": nums[0] if nums else None, "last": nums[-1] if nums else None,
                               "gaps": gaps, "repealed": sum(1 for r in rs if not r["is_active"]),
                               "mokarrar": sum(1 for r in rs if "mokarrar" in r["article_no"])}  # fmt: skip
        keys = [r["law_name"] + "|" + r["article_no"] + "|" + r["article_label"] for r in rs]
        rep["duplicate_keys"] += sorted({k for k in keys if keys.count(k) > 1})
    for r in rows:
        tag = r["article_label"] + " / " + r["law_name"]
        if HTML_JUNK_RE.search(r["text"]):
            rep["html_junk"].append(tag)
        n1 = cf.normalise_text(r["text"])
        if n1 != r["text"]:
            rep["not_normalised"].append(tag)
        if cf.normalise_text(n1) != n1:
            rep["not_idempotent"].append(tag)
    return rep


def _read(path: Path) -> list[dict]:
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def cmd_validate(args) -> int:
    rep = validate_rows(_read(args.file))
    print(json.dumps(rep, ensure_ascii=False, indent=2))
    return 3 if rep["html_junk"] or rep["not_normalised"] or rep["not_idempotent"] or rep["duplicate_keys"] else 0


def cmd_sample(args) -> int:
    rnd = random.Random(args.seed)
    by_law: dict[str, list[dict]] = defaultdict(list)
    for r in _read(args.file):
        by_law[r["law_name"]].append(r)
    for law, rs in by_law.items():
        print(f"\n== {law} ({len(rs)} rows)")
        for r in rnd.sample(rs, min(args.n, len(rs))):
            print(f"- {r['article_label']} | {urllib.parse.unquote(r['source_url'])}\n  {r['text'][:300]!r}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    default_raw = Path(tempfile.gettempdir()) / "roxira_ekhtebar_raw"

    def common(p, stage=False, fetch=False):
        p.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
        p.add_argument("--only", nargs="*")
        if fetch:
            p.add_argument("--delay", type=float, default=MIN_DELAY)
            p.add_argument("--max-requests", type=int, default=MAX_REQUESTS)
        p.add_argument("--raw-dir", type=Path, default=default_raw)
        if stage:
            p.add_argument("--out", type=Path, required=True)
            p.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
            p.add_argument("--overwrite", action="store_true")

    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--delay", type=float, default=MIN_DELAY)
    common(sub.add_parser("fetch"), fetch=True)
    common(sub.add_parser("stage"), stage=True)
    common(sub.add_parser("run"), stage=True, fetch=True)
    v = sub.add_parser("validate")
    v.add_argument("file", type=Path)
    sm = sub.add_parser("sample")
    sm.add_argument("file", type=Path)
    sm.add_argument("--n", type=int, default=5)
    sm.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)
    return {"search": cmd_search, "fetch": cmd_fetch, "stage": cmd_stage, "run": cmd_run,
            "validate": cmd_validate, "sample": cmd_sample}[args.cmd](args)  # fmt: skip


if __name__ == "__main__":
    sys.exit(main())
