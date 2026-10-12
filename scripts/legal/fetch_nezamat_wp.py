#!/usr/bin/env python3
"""nezamat.ir (WordPress) law fetcher -> staged jsonl via corpus_fill.stage_law. Deterministic, no LLM.

nezamat.ir is an owner-approved, UNOFFICIAL source (every row: `source: nezamat`, `source_tier: unofficial`,
`needs_review: true`; allowlist entries are "proposed"). Reachable only from Iranian IPs. It publishes every
enactment as one WordPress post (41,988 posts on 2026-10-13); the category `نامعتبر` (id 327) marks instruments that
are no longer valid, so "valid" == not in category 327. Consolidated law texts carry inline amendment tags
(«[اصلاحی ۱۳۹۲/۶/۱۲]») and the post HTML shows approval date, number and publication date.

  fetch_nezamat_wp.py index   --out FILE.jsonl [--categories 130 344 ...]   title index of VALID posts (small)
  fetch_nezamat_wp.py fetch   [--only ID ...] [--raw-dir DIR]              config post_id -> REST content + the HTML
                              page (metadata) -> DIR/<id>.txt, DIR/manifest.json
  fetch_nezamat_wp.py stage   --raw-dir DIR --out FILE.jsonl [--only ID ...]
                              split into one row per ماده (تبصره stays with its ماده) through corpus_fill.stage_law,
                              write the jsonl (+ .repealed.jsonl), run the ingest gates and the checks below
  fetch_nezamat_wp.py run     --out FILE.jsonl [--only ID ...]              fetch + stage
  fetch_nezamat_wp.py validate FILE.jsonl
  fetch_nezamat_wp.py crosscheck FILE.jsonl [--n 5 | --fraction 0.05] [--seed 7] [--report FILE.json]
                              compare sampled articles with ekhtebar.ir (config sources.ekhtebar.url) and flag mismatches

Politeness: browser User-Agent, >= 2 s between requests, <= 600 requests per run, robots.txt honoured (RFC 9309).
401/403/429/451/5xx, CAPTCHA or a JS challenge stops the run immediately; nothing is bypassed. Stdlib + certifi.
"""

# ruff: noqa: RUF001
from __future__ import annotations

import argparse
import difflib
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://nezamat.ir"
ALLOWED_HOSTS = frozenset({"nezamat.ir", "www.nezamat.ir"})
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
MIN_DELAY = 2.0
MAX_REQUESTS = 600
DEFAULT_CONFIG = ROOT / "config/nezamat_laws.json"
DEFAULT_ALLOWLISTS = (ROOT / "config/legal_allowlist.json", ROOT / "config/legal_allowlist_nezamat.json")
INVALID_CATEGORY = 327  # «نامعتبر»
BLOCKED_PATH_RE = re.compile(r"/(wp-admin|wp-login\.php)(/|$|\?)", re.I)
BLOCK_MARKERS = (
    "captcha", "cf-chl", "cf-browser-verification", "Just a moment", "Attention Required",
    "Access Denied", "Transferring to the website", "در حال انتقال به سایت",
)  # fmt: skip
META_LABELS = {"تاریخ تصویب": "approval", "تاریخ ثبت": "registered", "شماره": "number", "تاریخ انتشار": "published"}


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


# ----------------------------------------------------------------------------- polite HTTP
class Client:
    def __init__(self, delay: float = MIN_DELAY, max_requests: int = MAX_REQUESTS, opener=None, sleep=time.sleep):
        self.delay = max(delay, MIN_DELAY)
        self.max_requests = max_requests
        self.requests = 0
        self._last = 0.0
        self._ctx = _ssl_context()
        self._opener = opener  # test hook: callable(url, headers) -> (status, headers, bytes)
        self._sleep_fn = sleep
        self._robots: tuple[urllib.robotparser.RobotFileParser | None, bool] | None = None

    def _sleep(self) -> None:
        gap = time.monotonic() - self._last
        if self._last and gap < self.delay:
            self._sleep_fn(self.delay - gap)
        self._last = time.monotonic()

    def _raw(self, url: str) -> tuple[int, dict, bytes]:
        parsed = urllib.parse.urlparse(url)
        if parsed.netloc not in ALLOWED_HOSTS:
            raise Blocked(f"host not allowed: {parsed.netloc}")
        if BLOCKED_PATH_RE.search(parsed.path):
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
                data, hdrs, status = r.read(), dict(r.headers), r.status
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

    def get(self, url: str, retries: int = 3) -> tuple[int, dict, bytes]:
        self.check_robots()
        rp, allow_all = self._robots
        if not allow_all and not (rp and rp.can_fetch(USER_AGENT, url)):
            raise Blocked(f"robots.txt disallows {url}")
        last: Exception | None = None
        for _ in range(retries + 1):
            try:
                status, hdrs, data = self._raw(url)
            except (http.client.IncompleteRead, http.client.RemoteDisconnected, ConnectionResetError, TimeoutError) as exc:
                last = exc  # truncated transfers are transient (seen on nezamat); each retry waits and counts
                continue
            except urllib.error.URLError as exc:
                raise FetchFailed(f"{url}: {exc}") from exc
            if status in (401, 403, 429, 451) or status >= 500:
                raise Blocked(f"HTTP {status} for {url}")
            head = data[:6000].decode("utf-8", "replace")
            if status == 200 and "wp-json" not in url and any(m.lower() in head.lower() for m in BLOCK_MARKERS):
                raise Blocked(f"challenge/CAPTCHA marker in {url}")
            return status, hdrs, data
        raise FetchFailed(f"{url}: transfer kept failing ({type(last).__name__})")

    def json(self, url: str):
        status, hdrs, data = self.get(url)
        if status != 200:
            raise FetchFailed(f"{url}: HTTP {status}")
        return json.loads(data), hdrs


def robots_decision(status: int | None, body: str | None):
    """RFC 9309: 2xx parse; 4xx allow all; 5xx/unreachable disallow all; an HTML body instead of robots.txt = disallow."""
    if status is not None and 200 <= status < 300 and body is not None:
        if "<html" in body[:500].lower():
            return None, False
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(body.splitlines())
        return rp, False
    if status is not None and 400 <= status < 500:
        return None, True
    return None, False


# ----------------------------------------------------------------------------- HTML -> text
_REF_P_RE = re.compile(r'<p[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>(.*?)</p>', re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def extract_refs(fragment: str) -> tuple[str, list[str]]:
    """nezamat inserts centred «[<link to the executive regulation>]» paragraphs between articles. They are site
    navigation, not law text: drop them from the text and return their titles."""
    refs = [re.sub(r"\s+", " ", html.unescape(_TAG_RE.sub(" ", m))).strip(" []") for m in _REF_P_RE.findall(fragment)]
    return _REF_P_RE.sub("", fragment), [r for r in refs if r]


def html_to_text(fragment: str) -> tuple[str, list[str]]:
    ek = _load("fetch_ekhtebar_wp", "scripts/legal/fetch_ekhtebar_wp.py")
    cleaned, refs = extract_refs(fragment)
    return ek.html_to_text(cleaned), refs


def join_bracket_blocks(text: str, max_lines: int = 120) -> str:
    """A quoted amending text «[قانون اصلاح ... ماده ۱ـ ... ماده ۲ـ ...]» spans many lines and contains line-initial
    «ماده N» that must NOT start a new article. Lines inside an open «[» are joined with a space into the line that
    opened it. An unbalanced «[» is abandoned after `max_lines` lines (the lines are then kept as they are)."""
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        depth = ln.count("[") - ln.count("]")
        if depth > 0:
            j, acc, d = i + 1, ln, depth
            while j < len(lines) and d > 0 and j - i <= max_lines:
                acc += " " + lines[j].strip()
                d += lines[j].count("[") - lines[j].count("]")
                j += 1
            if d <= 0:
                out.append(re.sub(r"\s+", " ", acc))
                i = j
                continue
        out.append(ln)
        i += 1
    return "\n".join(out) + "\n"


_ZWNJ_SEP_RE = re.compile(r"(?<=[\d۰-۹٠-٩])‌+(?=\s*[ـ\-–—:.])")
_POINTER_RE = re.compile(r"^\[\s*(?:‌)?(?:آیین\W{0,2}نامه|دستورالعمل|بخشنامه|قانون تفسیر|مأخذ محاسبه|تصویب\W{0,2}نامه)[^\]]{0,200}\]$")
_POINTER_VERB_RE = re.compile(r"می\W?شود|می\W?گردد|باید|مکلف|\.\s*\]?$")
_REMOVED_RE = re.compile(
    r"^ماده\s*(?P<n>\d+)(?P<mok>\s*مکرر(?:\s*\d+)?)?\s*[-–—ـ:]?\s*\[\s*(?:حذف|حذفی|منسوخ|نسخ|ملغی|لغو)[^\]]*\]\s*[-–—ـ]?\s*$"
)  # fmt: skip
_RANGE_NOTE_RE = re.compile(r"^\[\s*مواد\s*(?P<spec>[^\]]*?)\s*[،,]?\s*به\s+موجب[^\]]*(?:نسخ|منسوخ|لغو|ملغی)[^\]]*\]$")
_MARKER_NUM_RE = re.compile(r"^ماده\s*(\d+)(\s*مکرر)?")


def expand_number_spec(spec: str, cap: int = 120) -> list[int]:
    """«۲۱، ۲۲، ۴۰، ۴۶ تا ۴۹ و بند ۴ ماده ۹۳» -> [21, 22, 40, 46, 47, 48, 49, 93?]. A «بند N ماده M» is only part of
    an article, so it is dropped. A range wider than `cap` is not trusted and yields nothing."""
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    s = cf.normalise_text(spec)
    s = re.sub(r"بند\s*\d+\s*(?:ماده)?\s*\d*", " ", s)  # partial article
    nums: list[int] = []
    for m in re.finditer(r"(\d+)\s*(?:تا|الی)\s*(\d+)|(\d+)", s):
        if m.group(3):
            nums.append(int(m.group(3)))
        elif 0 <= int(m.group(2)) - int(m.group(1)) <= cap:
            nums.extend(range(int(m.group(1)), int(m.group(2)) + 1))
    return sorted(set(nums))


def prep_text(text: str, sequential: bool = False) -> tuple[str, dict]:
    """Deterministic clean-up of a nezamat law text before corpus_fill.parse_articles.
    Returns (text, extras): extras["removed"] = [(label, no, note)] for «ماده N – [حذف ...]» one-liners and
    for «[مواد A تا B ... نسخ شده است]» notes (they become inactive rows), extras["related"] = editorial pointers
    dropped from the text, extras["skipped_markers"] = out-of-sequence «ماده» lines folded into the previous line."""
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    text = _ZWNJ_SEP_RE.sub("", text)
    extras: dict = {"removed": [], "related": [], "skipped_markers": 0}
    kept = []
    for ln in text.splitlines():
        s = ln.strip()
        if _POINTER_RE.match(s) and len(s) <= 220 and not _POINTER_VERB_RE.search(s):
            extras["related"].append(s.strip("[] "))
            continue
        kept.append(ln)
    text = join_bracket_blocks("\n".join(kept))
    kept = []
    for ln in text.splitlines():
        s = cf.normalise_text(ln.strip())
        m = _REMOVED_RE.match(s)
        if m:
            k = re.sub(r"\D", "", m["mok"] or "")
            label = f"ماده {int(m['n'])}" + (" مکرر" + (f" {k}" if k else "") if m["mok"] else "")
            no = str(int(m["n"])) + ("-mokarrar" if m["mok"] else "")
            extras["removed"].append((label, no, re.search(r"\[.*\]", s).group(0)))
            continue
        r = _RANGE_NOTE_RE.match(s)
        if r:
            nums = expand_number_spec(re.split(r"\sقانون\b|\(|مصوب", r["spec"])[0])
            if nums:
                for n in nums:
                    extras["removed"].append((f"ماده {n}", str(n), s))
                continue
        kept.append(ln)
    if sequential:
        out, expect = [], 1

        def fold(line: str) -> bool:
            """Append `line` to the last non-empty line (a quoted article of another law)."""
            for k in range(len(out) - 1, -1, -1):
                if out[k].strip():
                    out[k] = out[k].rstrip() + " " + line.strip()
                    extras["skipped_markers"] += 1
                    return True
            return False

        for ln in kept:
            m = _MARKER_NUM_RE.match(cf.normalise_text(ln.strip()))
            if m and (m.group(2) or int(m.group(1)) != expect):
                if fold(ln):
                    continue
            elif m:
                expect += 1
            out.append(ln)
        kept = out
    return "\n".join(kept) + "\n", extras


def parse_meta(page_html: str) -> dict:
    """Header block of a nezamat post page: label line followed by its value line."""
    t = re.sub(r"(?is)<(script|style).*?</\1>", "", page_html)
    t = html.unescape(_TAG_RE.sub("\n", t))
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    meta: dict = {}
    for i, ln in enumerate(lines[:80]):
        if ln in META_LABELS and i + 1 < len(lines) and META_LABELS[ln] not in meta:
            meta[META_LABELS[ln]] = lines[i + 1]
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    for key in ("approval", "registered", "published"):
        if key in meta:
            m = cf.DATE_RE.search(cf.normalise_text(meta[key]))
            meta[key + "_iso"] = cf.fmt_date(m) if m else None
    return meta


def slug_of(url: str) -> str:
    return urllib.parse.unquote(urllib.parse.urlparse(url).path.strip("/").split("/")[-1])


# ----------------------------------------------------------------------------- commands
def _cfg(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _select(cfg: dict, only: list[str] | None) -> list[dict]:
    laws = [x for x in cfg["laws"] if not only or x["id"] in only]
    missing = set(only or []) - {x["id"] for x in laws}
    if missing:
        raise SystemExit(f"unknown law ids: {sorted(missing)}")
    return laws


def fetch_post(client: Client, post_id: int, allow_invalid: bool = False) -> dict:
    data, _ = client.json(f"{BASE}/wp-json/wp/v2/posts/{post_id}?_fields=id,link,title,date,modified,categories,content")
    if INVALID_CATEGORY in data.get("categories", []) and not allow_invalid:
        raise FetchFailed(f"post {post_id} is in category 327 (نامعتبر): not fetched")
    text, refs = html_to_text(data["content"]["rendered"])
    status, _, page = client.get(data["link"])
    meta = parse_meta(page.decode("utf-8", "replace")) if status == 200 else {}
    return {"id": data["id"], "link": data["link"], "title": html.unescape(data["title"]["rendered"]).strip(),
            "date": data.get("date"), "modified": data.get("modified"), "categories": data.get("categories", []),
            "text": text, "refs": refs, "meta": meta}  # fmt: skip


def cmd_fetch(args) -> int:
    cfg = _cfg(args.config)
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    client = Client(args.delay, args.max_requests)
    mf_path = args.raw_dir / "manifest.json"
    manifest: dict[str, dict] = json.loads(mf_path.read_text(encoding="utf-8"))["laws"] if mf_path.exists() else {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rc = 0
    try:
        for law in _select(cfg, args.only):
            pid = ((law.get("sources") or {}).get("nezamat") or {}).get("post_id")
            if not pid:
                manifest[law["id"]] = {"status": "failed", "reason": "no sources.nezamat.post_id"}
                rc = 4
                continue
            got = fetch_post(client, int(pid), args.allow_invalid)
            (args.raw_dir / f"{law['id']}.txt").write_text(got["text"], encoding="utf-8")
            manifest[law["id"]] = {
                "status": "done", "kind": "text", "file": f"{law['id']}.txt", "source_url": got["link"],
                "source": "nezamat", "source_label": "nezamat.ir", "post_id": got["id"], "title": got["title"],
                "modified": got["modified"], "categories": got["categories"], "meta": got["meta"],
                "related_instruments": got["refs"], "fetched_at": now, "chars": len(got["text"]),
            }  # fmt: skip
            print(law["id"], "done", got["id"], len(got["text"]), "chars", got["meta"].get("approval"), flush=True)
    except Blocked as exc:
        print(f"STOPPED (not bypassed): {exc}", file=sys.stderr)
        rc = 6
    except FetchFailed as exc:
        print(f"FETCH FAILED: {exc}", file=sys.stderr)
        rc = 4
    mf_path.write_text(json.dumps({"laws": manifest}, ensure_ascii=False, indent=2), encoding="utf-8")
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
        law = json.loads(json.dumps(law))  # do not mutate the config
        st = law.setdefault("stage", {})
        if not st.get("approval_date") and ent.get("meta", {}).get("approval_iso"):
            st["approval_date"] = ent["meta"]["approval_iso"]
        text, extras = prep_text((raw_dir / ent["file"]).read_text(encoding="utf-8"), bool(st.get("sequential")))
        res = cf.stage_law(law, text, ent, allowlist)
        have = {(a["article_no"], a["article_label"]) for a in res["rows"] + res["repealed_rows"]}
        gone = []
        for label, no, note in extras["removed"]:
            if (no, label) not in have:
                gone.append({"no": no, "label": label, "body": note, "chapter": None, "repealed": True, "tags": ""})
                have.add((no, label))
        if gone:
            extra_rows = cf.build_rows(law, gone, ent, text[:1500])
            for i, r in enumerate(extra_rows):
                r["chunk_index"] = len(res["rows"]) + len(res["repealed_rows"]) + i
            res["repealed_rows"] = res["repealed_rows"] + extra_rows
        supersede_older_duplicates(res)
        active_nums = {a["article_label"] for a in res["rows"]}
        conflicts = sorted(lbl for lbl, _, _ in extras["removed"] if lbl in active_nums)
        for r in res["rows"] + res["repealed_rows"]:
            r["source"] = "nezamat"
            r["source_url"] = ent["source_url"]
            r["fetched_at"] = ent["fetched_at"]
            r["nezamat_post_id"] = ent["post_id"]
            r["source_modified"] = ent.get("modified")
            r["staging_status"] = "proposed"
        rows += res["rows"]
        repealed += res["repealed_rows"]
        report[law["id"]] = {"rows": len(res["rows"]), "repealed_excluded": len(res["repealed_rows"]),
                             "approval_date": st.get("approval_date"), "removed_notes": len(extras["removed"]),
                             "removed_vs_active_conflicts": conflicts, "pointers_dropped": len(extras["related"]),
                             "skipped_markers": extras["skipped_markers"], "analysis": res["analysis"],
                             "gates": res.get("gates")}  # fmt: skip
    return rows, repealed, report


def supersede_older_duplicates(res: dict) -> int:
    """nezamat prints the current wording and the previous one of an amended article under the same number
    (e.g. «ماده ۲۴۴ – [اصلاحی ۱۴۰۰]» then «ماده ۲۴۴ – [اصلاحی ۱۳۸۰]»). corpus_fill relabels the second «ماده N (2)».
    When that second row carries an OLDER amendment date than the first, it is the superseded wording: it moves
    to the inactive list (never answered from). When it is newer or undated both stay active and are flagged."""
    by_label = {r["article_label"]: r for r in res["rows"]}
    moved = 0
    for r in list(res["rows"]):
        m = re.match(r"^(.*) \(\d+\)$", r["article_label"])
        first = by_label.get(m.group(1)) if m else None
        if not first:
            continue
        a, b = first.get("amended_on"), r.get("amended_on")
        if a and b and b < a:
            r.update(status="REPEALED", is_active=False)
            r["review_reasons"] = [*r["review_reasons"], "superseded_version_same_number"]
            res["rows"].remove(r)
            res["repealed_rows"].append(r)
            moved += 1
        else:
            for x in (first, r):
                x["review_reasons"] = [*x["review_reasons"], "duplicate_article_number_check_versions"]
    return moved


def load_allowlist(paths) -> dict:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    ing = cf._load_ingest()
    merged: dict = {}
    for p in paths:
        merged.update(ing.load_allowlist(p, allow_proposed=True))
    return merged


def cmd_stage(args) -> int:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    rows, repealed, report = stage_rows(_cfg(args.config), args.raw_dir, args.only, load_allowlist(args.allowlist))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    empty = [k for k, v in report.items() if not v.get("rows")]
    if empty:
        print(f"ERROR: selected law(s) with 0 rows: {empty}; nothing written", file=sys.stderr)
        return 5
    if args.out.exists() and not args.overwrite:
        print(f"ERROR: {args.out} exists (never overwritten; pass --overwrite for your own scratch file)", file=sys.stderr)
        return 2
    cf.write_jsonl(args.out, rows)
    args.out.with_name(args.out.stem + "_report.json").write_text(
        json.dumps({"generated_by": "scripts/legal/fetch_nezamat_wp.py", "status": "proposed", "laws": report},
                   ensure_ascii=False, indent=2), encoding="utf-8")
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
    return rc or cmd_stage(args)


def validate_rows(rows: list[dict]) -> dict:
    """ekhtebar's validator, with «برچسب» (a price label in a law text) no longer counted as page chrome
    (only «برچسب‌ها»/«برچسب ها», the WordPress tag list, is)."""
    ek = _load("fetch_ekhtebar_wp", "scripts/legal/fetch_ekhtebar_wp.py")
    saved = ek.HTML_JUNK_RE
    ek.HTML_JUNK_RE = re.compile(saved.pattern.replace("برچسب|", "برچسب[\u200c ]?ها|"), saved.flags)
    try:
        return ek.validate_rows(rows)
    finally:
        ek.HTML_JUNK_RE = saved


def _read(path: Path) -> list[dict]:
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def cmd_validate(args) -> int:
    rep = validate_rows(_read(args.file))
    print(json.dumps(rep, ensure_ascii=False, indent=2))
    return 3 if rep["html_junk"] or rep["not_normalised"] or rep["not_idempotent"] or rep["duplicate_keys"] else 0


def cmd_index(args) -> int:
    """Title index of VALID posts (id, date, title, categories) for the categories given; no bodies."""
    client = Client(args.delay, args.max_requests)
    out: dict[int, dict] = {}
    try:
        for page in range(1, 400):
            q = {"categories": ",".join(map(str, args.categories)), "categories_exclude": INVALID_CATEGORY,
                 "per_page": 50, "page": page, "_fields": "id,date,modified,title,categories,link"}  # fmt: skip
            try:
                data, hdrs = client.json(f"{BASE}/wp-json/wp/v2/posts?" + urllib.parse.urlencode(q))
            except FetchFailed as exc:
                if "HTTP 400" in str(exc):
                    break
                raise
            for x in data:
                out[x["id"]] = {"id": x["id"], "date": x["date"][:10], "modified": x["modified"][:10],
                                "title": html.unescape(x["title"]["rendered"]), "categories": x["categories"],
                                "link": x["link"]}  # fmt: skip
            if page >= int(hdrs.get("X-WP-TotalPages", hdrs.get("x-wp-totalpages", 1))):
                break
    except (Blocked, FetchFailed) as exc:
        print(f"STOPPED: {exc}", file=sys.stderr)
    args.out.write_text("".join(json.dumps(v, ensure_ascii=False) + "\n" for v in out.values()), encoding="utf-8")
    print(f"{len(out)} valid posts, requests made: {client.requests}")
    return 0


# ----------------------------------------------------------------------------- cross-check vs ekhtebar
_TAG_STRIP_RE = re.compile(r"\[[^\]]{0,80}\]|\((?:اصلاحی|الحاقی|اصلاح|الحاق|منسوخ|حذف)[^)]{0,80}\)")


def comparable(text: str) -> list[str]:
    """Tokens of an article body for source comparison: law-name prefix, amendment tags, digits style, ZWNJ,
    punctuation and spacing are neutralised, so only wording differences remain."""
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    t = cf.normalise_text(text)
    t = t.split(":", 1)[1] if ":" in t[:200] and re.match(r"^(ماده|اصل)", t) else t
    t = _TAG_STRIP_RE.sub(" ", t).replace("‌", " ").replace("ـ", " ")
    t = re.sub(r"[ً-ٟ«»\"'()\[\]:؛؟،,.;!?\-–—_]", " ", t)
    return t.split()


_ORTHO = str.maketrans({"ئ": "ی", "ؤ": "و", "أ": "ا", "إ": "ا", "ة": "ه", "ۀ": "ه", "ء": ""})


def compact(text: str) -> str:
    """Spelling-neutral form: no spaces/ZWNJ (تشکل‌های = تشکلهای = تشکل های), hamza carriers folded."""
    return "".join(comparable(text)).translate(_ORTHO)


def similarity(a: str, b: str) -> float:
    ca, cb = compact(a), compact(b)
    if not ca and not cb:
        return 1.0
    return difflib.SequenceMatcher(None, ca, cb, autojunk=False).ratio()


def sample_rows(rows: list[dict], n: int | None, fraction: float | None, seed: int) -> dict[str, list[dict]]:
    rnd = random.Random(seed)
    by_law: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_law[r["law_name"] + "|" + r["law_id"]].append(r)
    picked = {}
    for k, rs in by_law.items():
        size = n if n else max(1, round(len(rs) * (fraction or 0.05)))
        picked[k] = rnd.sample(rs, min(size, len(rs)))
    return picked


def compare_rows(picked: dict[str, list[dict]], other: dict[str, dict[str, str]], threshold: float = 0.97,
                 minor: float = 0.90) -> list[dict]:
    """other: law key -> {article_label: text}. Returns one record per sampled article."""
    out = []
    for key, rs in picked.items():
        arts = other.get(key)
        for r in rs:
            rec = {"law": key.split("|")[0], "law_id": key.split("|")[1], "article": r["article_label"]}
            if arts is None:
                rec["result"] = "no_other_source"
            elif r["article_label"] not in arts:
                rec["result"] = "missing_in_other"
            else:
                s = similarity(r["text"], arts[r["article_label"]])
                rec.update(similarity=round(s, 4),
                           result="match" if s >= threshold else "minor_diff" if s >= minor else "MISMATCH")
            out.append(rec)
    return out


def ekhtebar_articles(client, post_id: int, law_cfg: dict) -> dict[str, str]:
    """ekhtebar.ir post (REST, by id) -> {article_label: body}, split by the same corpus_fill rules."""
    ek = _load("fetch_ekhtebar_wp", "scripts/legal/fetch_ekhtebar_wp.py")
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    status, data = client.get(f"{ek.BASE}/wp-json/wp/v2/posts/{post_id}?_fields=id,link,content")
    if status != 200:
        raise ek.FetchFailed(f"ekhtebar post {post_id}: HTTP {status}")
    st = law_cfg.get("stage") or {}
    text, _ = prep_text(ek.html_to_text(json.loads(data)["content"]["rendered"]), bool(st.get("sequential")))
    arts, _ = cf.parse_articles(text, (law_cfg.get("stage") or {}).get("marker", "madde"))
    return {a["label"]: a["body"] for a in arts}


def local_articles(spec: dict) -> dict[str, str]:
    """Existing repo corpus rows of one law (read-only) -> {article_label: text after «label law:»}."""
    out: dict[str, str] = {}
    for r in _read(ROOT / spec["file"]):
        if r["law_name"] == spec["law_name"] and r.get("is_active", True):
            out.setdefault(r["article_label"], r["text"])
    return out


def cmd_crosscheck(args) -> int:
    ek = _load("fetch_ekhtebar_wp", "scripts/legal/fetch_ekhtebar_wp.py")
    cfg = _cfg(args.config)
    by_id = {x["stage"]["law_id"]: x for x in cfg["laws"]}
    picked = sample_rows(_read(args.file), args.n, args.fraction, args.seed)
    client = ek.Client(args.delay, 120)
    other: dict[str, dict[str, str]] = {}
    try:
        for key in picked:
            law_cfg = by_id.get(key.split("|")[1])
            srcs = (law_cfg or {}).get("sources") or {}
            try:
                if (srcs.get("ekhtebar") or {}).get("post_id"):
                    other[key] = ekhtebar_articles(client, srcs["ekhtebar"]["post_id"], law_cfg)
                elif srcs.get("local"):
                    other[key] = local_articles(srcs["local"])
            except ek.FetchFailed as exc:  # one law failing must not hide the others
                print(f"SKIPPED {key}: {exc}", file=sys.stderr)
    except ek.Blocked as exc:
        print(f"STOPPED (not bypassed): {exc}", file=sys.stderr)
    report = compare_rows(picked, other)
    summary = defaultdict(lambda: defaultdict(int))
    for r in report:
        summary[r["law"]][r["result"]] += 1
    print(json.dumps({k: dict(v) for k, v in summary.items()}, ensure_ascii=False, indent=2))
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ekhtebar requests: {client.requests}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    default_raw = Path(tempfile.gettempdir()) / "roxira_nezamat_raw"

    def common(p, stage=False, fetch=False):
        p.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
        p.add_argument("--only", nargs="*")
        if fetch:
            p.add_argument("--delay", type=float, default=MIN_DELAY)
            p.add_argument("--max-requests", type=int, default=MAX_REQUESTS)
            p.add_argument("--allow-invalid", action="store_true")
        p.add_argument("--raw-dir", type=Path, default=default_raw)
        if stage:
            p.add_argument("--out", type=Path, required=True)
            p.add_argument("--allowlist", type=Path, nargs="+", default=list(DEFAULT_ALLOWLISTS))
            p.add_argument("--overwrite", action="store_true")

    ix = sub.add_parser("index")
    ix.add_argument("--categories", type=int, nargs="+", required=True)
    ix.add_argument("--out", type=Path, required=True)
    ix.add_argument("--delay", type=float, default=MIN_DELAY)
    ix.add_argument("--max-requests", type=int, default=MAX_REQUESTS)
    common(sub.add_parser("fetch"), fetch=True)
    common(sub.add_parser("stage"), stage=True)
    common(sub.add_parser("run"), stage=True, fetch=True)
    v = sub.add_parser("validate")
    v.add_argument("file", type=Path)
    cc = sub.add_parser("crosscheck")
    cc.add_argument("file", type=Path)
    cc.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    cc.add_argument("--n", type=int)
    cc.add_argument("--fraction", type=float)
    cc.add_argument("--seed", type=int, default=7)
    cc.add_argument("--delay", type=float, default=MIN_DELAY)
    cc.add_argument("--report", type=Path)
    args = ap.parse_args(argv)
    return {"index": cmd_index, "fetch": cmd_fetch, "stage": cmd_stage, "run": cmd_run,
            "validate": cmd_validate, "crosscheck": cmd_crosscheck}[args.cmd](args)  # fmt: skip


if __name__ == "__main__":
    sys.exit(main())
