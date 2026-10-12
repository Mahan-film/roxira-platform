#!/usr/bin/env python3
"""Law watch (P0): track new/changed Iranian legal texts from ekhtebar.ir ONLY.

Subcommands (see docs/legal/LAW_WATCH_DESIGN.md):
  poll      fetch ekhtebar WordPress posts changed since the cursor -> local state dir
  classify  rule-based classification + law/article linking of polled items (optional --llm for ambiguous)
  stage     write a NEW data/legal/staged/law_watch_<date>.jsonl (status "proposed"), never edits old files
  digest    write a Markdown summary of the latest changes (optionally e-mail it)
  run       poll + classify + stage + digest (what launchd calls)

Rules: only www.ekhtebar.ir / ekhtebar.ir is contacted (plus openrouter.ai for the optional LLM step),
>= 2 s between requests, no paid LLM in the fetch path, state lives in ~/.roxira/law_watch/ (outside the
repo). Output never modifies anything under data/ except creating a new staged file. Stdlib (+certifi if present).
"""

# ruff: noqa: RUF001
from __future__ import annotations

import argparse
import datetime as dt
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
import urllib.request
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode, urlparse

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://www.ekhtebar.ir"
ALLOWED_HOSTS = frozenset({"www.ekhtebar.ir", "ekhtebar.ir"})
USER_AGENT = "RoxiraLegalResearchBot/1.0 (owner-run, low-rate, 1 req/2s; contact: roxira-platform owner)"
MIN_DELAY = 2.0
PER_PAGE = 20
MAX_PAGES_PER_RUN = 40
MAX_TEXT_CHARS = 12000
STATE_DIR = Path(os.environ.get("LAW_WATCH_STATE_DIR", str(Path.home() / ".roxira" / "law_watch")))
STAGED_DIR = ROOT / "data" / "legal" / "staged"
ALLOWLIST = ROOT / "config" / "legal_allowlist.json"
SCHEMA_VERSION = 1

# ekhtebar category id -> (change type hint, bucket). Verified live 2026-10-12 via /wp-json/wp/v2/categories.
CATEGORY_HINTS: dict[int, tuple[str, str]] = {
    794: ("annulment", "آرای دیوان عدالت اداری"),
    247: ("unity_ruling", "آرا وحدت رویه"),
    1112: ("judicial_ruling", "رای اصراری"),
    24: ("resolution", "مصوبات"),
    854: ("regulation", "آیین نامه ها"),
    2164: ("regulation", "اساسنامه"),
    2113: ("regulation", "مصوبه شورای عالی شهرسازی و معماری"),
    1072: ("circular", "بخشنامه ها"),
    127: ("law_text", "متن قوانین"),
    5460: ("law_text", "مواد قانونی"),
    1890: ("bill", "طرح و لایحه"),
    826: ("advisory_opinion", "نظریه های مشورتی"),
    1148: ("advisory_opinion", "نظریه رئیس مجلس"),
    4846: ("advisory_opinion", "نظریه شورای نگهبان"),
    1875: ("judicial_procedure", "رویه قضایی"),
    5525: ("judicial_procedure", "نشست‌های قضایی"),
    1079: ("policy", "سیاست های کلی"),
    503: ("news", "اخبار قوه قضائیه"),
    539: ("news", "اخبار مجلس"),
    1138: ("news", "اخبار دولت"),
    1130: ("news", "اخبار شورای نگهبان"),
    4701: ("news", "اخبار مجمع تشخیص مصلحت"),
}
POLL_CATEGORIES = sorted(CATEGORY_HINTS)

# change types that can alter the corpus (everything else is digest-only unless it links to a law)
LEGAL_TYPES = {"new_law", "amendment", "repeal", "annulment", "unity_ruling", "cabinet_decision",
               "regulation", "circular", "judicial_procedure", "judicial_ruling", "resolution"}

_TRANS = str.maketrans({
    "ي": "ی", "ك": "ک", "ة": "ه", "أ": "ا", "إ": "ا", "‌": " ", "‏": "", "‎": "", "ـ": "",
    **{chr(0x06F0 + i): str(i) for i in range(10)}, **{chr(0x0660 + i): str(i) for i in range(10)},
})


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").translate(_TRANS)).strip()


def strip_html(raw: str) -> str:
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw or "")
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


# ----------------------------------------------------------------------------- state
def _p(name: str) -> Path:
    return STATE_DIR / name


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


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    os.replace(tmp, path)


# ----------------------------------------------------------------------------- HTTP
def _ssl_ctx() -> ssl.SSLContext:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


class Fetcher:
    """Polite GET with retries; transport injectable for tests."""

    def __init__(self, transport=None, delay: float = MIN_DELAY, sleep=time.sleep):
        self.transport, self.delay, self.sleep, self._last = transport, delay, sleep, 0.0
        self.requests = 0
        self._ctx = None

    def get(self, url: str) -> tuple[bytes, dict]:
        host = (urlparse(url).hostname or "").lower()
        if host not in ALLOWED_HOSTS:
            raise ValueError(f"refused: host {host!r} is not ekhtebar.ir")
        last_err: Exception | None = None
        for attempt in range(4):
            wait = self.delay - (time.monotonic() - self._last)
            if wait > 0:
                self.sleep(wait)
            self._last = time.monotonic()
            self.requests += 1
            try:
                if self.transport:
                    return self.transport(url)
                if self._ctx is None:
                    self._ctx = _ssl_ctx()
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
                with urllib.request.urlopen(req, timeout=40, context=self._ctx) as r:
                    return r.read(), dict(r.headers.items())
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):  # e.g. page beyond last (400 rest_post_invalid_page_number)
                    raise
                last_err = e
            except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last_err = e
            self.sleep(self.delay * (attempt + 2))
        raise ConnectionError(f"ekhtebar unreachable: {last_err!r}")


# ----------------------------------------------------------------------------- poll
def build_posts_url(modified_after: str, page: int) -> str:
    q = {
        "per_page": PER_PAGE, "page": page, "orderby": "modified", "order": "asc",
        "modified_after": modified_after, "categories": ",".join(map(str, POLL_CATEGORIES)),
        "_fields": "id,date,modified,link,title,excerpt,categories",
    }
    return f"{BASE}/wp-json/wp/v2/posts?{urlencode(q)}"


def item_from_post(p: dict) -> dict:
    text = strip_html((p.get("content") or {}).get("rendered", ""))
    return {
        "post_id": int(p["id"]), "date": p.get("date"), "modified": p.get("modified"), "link": p.get("link"),
        "title": strip_html((p.get("title") or {}).get("rendered", "")),
        "excerpt": strip_html((p.get("excerpt") or {}).get("rendered", ""))[:600],
        "text": text[:MAX_TEXT_CHARS], "text_len": len(text),
        "categories": [int(c) for c in p.get("categories", [])],
        # sha of the fetched body only; None while no body is known. A change record keeps text AND text_sha256
        # together (legal types) or drops both (everything else).
        "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest() if text else None,
    }


def wants_body(it: dict) -> bool:
    return any(CATEGORY_HINTS.get(c, ("", ""))[0] != "news" for c in it.get("categories", []))


MAX_BODY_RETRIES = 20


def fetch_text(fetcher: Fetcher, post_id: int) -> str | None:
    """Full body of one post (fetched only for non-news items; list responses stay small and reliable)."""
    try:
        body, _ = fetcher.get(f"{BASE}/wp-json/wp/v2/posts/{post_id}?_fields=content")
        return strip_html(json.loads(body).get("content", {}).get("rendered", ""))
    except (ConnectionError, ValueError, urllib.error.HTTPError):
        return None  # failure (distinct from an empty body, which is "")


def _apply_body(it: dict, full: str | None) -> None:
    """Attach a fetched body, or flag the item for retry (no classification from a missing body)."""
    if full is None:
        it["needs_body_retry"] = True
        it["body_retries"] = int(it.get("body_retries", 0)) + 1
        if it["body_retries"] > MAX_BODY_RETRIES:
            it["needs_body_retry"], it["body_gave_up"] = False, True  # classified later as low confidence
        return
    it["needs_body_retry"] = False
    if full:
        it["text"], it["text_len"] = full[:MAX_TEXT_CHARS], len(full)
        it["text_sha256"] = hashlib.sha256(full.encode("utf-8")).hexdigest()


def _minus_one_second(ts: str) -> str:
    return (dt.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S") - dt.timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S")


def cmd_poll(args, fetcher: Fetcher | None = None) -> int:
    """Cursor semantics: cursor_modified is the `modified` of the last post actually processed (pages are ordered
    by modified ascending). It advances after every fully processed page, so a page cap, a crash or an outage never
    skips anything; the next run asks modified_after = cursor - 1 s (same-second safety) and dedupes by id + modified."""
    fetcher = fetcher or Fetcher()
    state = load_json(_p("state.json"), {})
    if args.since_days is not None or not state.get("cursor_modified"):
        days = args.since_days if args.since_days is not None else 30
        cursor = (dt.datetime.now() - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    else:
        cursor = state["cursor_modified"]
    window_start = cursor  # posts published after this are "fresh"
    items = {i["post_id"]: i for i in read_jsonl(_p("items.jsonl"))}
    new = edited = pages = retried = 0
    last_processed = None
    caught_up = ok = False
    try:
        # 1) retry bodies that failed earlier (legal-category items stay unclassified until they succeed)
        if not getattr(args, "no_text", False):
            for it in items.values():
                if it.get("needs_body_retry") and retried < 50:
                    _apply_body(it, fetch_text(fetcher, it["post_id"]))
                    retried += 1
        # 2) page through changes since the cursor
        page = 1
        cap = args.max_pages or MAX_PAGES_PER_RUN
        while True:
            if page > cap:
                print("poll: page cap reached, cursor stays at the last processed item; next run continues")
                break
            try:
                body, _ = fetcher.get(build_posts_url(_minus_one_second(cursor), page))
            except urllib.error.HTTPError as e:
                if e.code == 400:  # past the last page
                    caught_up = True
                    break
                raise
            posts = json.loads(body)
            pages += 1
            if not posts:
                caught_up = True
                break
            for p in posts:
                it = item_from_post(p)
                old = items.get(it["post_id"])
                if it["modified"] and (last_processed is None or it["modified"] > last_processed):
                    last_processed = it["modified"]
                if old is None:
                    it["first_seen"] = _now()
                    it["revisions"] = 1
                    new += 1
                elif old.get("modified") != it["modified"]:
                    it["first_seen"] = old.get("first_seen", _now())
                    it["revisions"] = int(old.get("revisions", 1)) + 1
                    it["is_edit"] = True
                    edited += 1
                else:
                    continue  # same id + same modified: already have it
                if not getattr(args, "no_text", False) and wants_body(it):
                    _apply_body(it, fetch_text(fetcher, it["post_id"]))
                it["fresh"] = bool(it.get("date") and it["date"] >= window_start)
                it["classified"] = False
                items[it["post_id"]] = it
            if len(posts) < PER_PAGE:
                caught_up = True
                break
            page += 1
        ok = True
    except (ConnectionError, ValueError, OSError) as e:
        print(f"poll: ekhtebar not reachable ({e}); cursor kept at last processed item, will catch up next run")
    write_jsonl(_p("items.jsonl"), sorted(items.values(), key=lambda i: i.get("modified") or ""))
    if last_processed:
        state["cursor_modified"] = last_processed
    elif ok and not state.get("cursor_modified"):
        state["cursor_modified"] = cursor
    state.update({"last_poll": _now(), "last_poll_ok": ok, "caught_up": caught_up, "requests": fetcher.requests})
    save_json(_p("state.json"), state)
    pending = sum(1 for i in items.values() if i.get("needs_body_retry"))
    print(f"poll: ok={ok} caught_up={caught_up} pages={pages} new={new} edited={edited} body_retry_pending={pending} "
          f"requests={fetcher.requests} cursor={state.get('cursor_modified')}")
    return 0 if ok else 3


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ----------------------------------------------------------------------------- classify
REPEAL_RE = re.compile(r"(نسخ|لغو\s|ملغی|ملغا|منسوخ|لغو شد|فسخ)")
AMEND_RE = re.compile(r"(اصلاح|اصلاحیه|الحاق|الحاقیه|تمدید|تغییر|جایگزین|تفسیر|اصلاحی)")
NEWLAW_RE = re.compile(r"(^|\s)(قانون|ماده واحده|قانون جدید)\s")
ANNUL_RE = re.compile(r"(ابطال|باطل شد|ابطال شد|لغو و ابطال)")
UNITY_RE = re.compile(r"(رای|رأی)\s*(شماره\s*)?(وحدت رویه|وحدت رویه)|وحدت رویه")
CABINET_RE = re.compile(r"(هیئت وزیران|هیات وزیران|تصویب ?نامه|هیئت دولت)")
CIRC_RE = re.compile(r"(بخشنامه|دستورالعمل|شیوه ?نامه|ابلاغیه)")
REG_RE = re.compile(r"(آیین ?نامه|اساسنامه|مقررات)")
JUD_RE = re.compile(r"(رویه قضایی|قوه قضاییه|قوه قضائیه|رییس قوه|رئیس قوه)")
BILL_RE = re.compile(r"(طرح|لایحه)")
ENACTED_RE = re.compile(r"(تصویب شد|ابلاغ شد|ابلاغی|ابلاغ قانون|به ?تصویب رسید|مصوب مجلس|فایل ابلاغی)")
RECENT_JALALI_YEAR = 1404  # approved/communicated in the last ~2 years counts as a new act
ISSUERS = [
    ("مجلس شورای اسلامی", r"مجلس"), ("هیئت وزیران", r"هیئت وزیران|هیات وزیران|هیئت دولت"),
    ("بیمه مرکزی", r"بیمه مرکزی|بیمه ایران"), ("سازمان امور مالیاتی", r"امور مالیاتی|مالیات"),
    ("وزارت صنعت، معدن و تجارت", r"صمت|صنعت، معدن|وزارت صنعت"),
    ("سازمان ثبت اسناد و املاک", r"ثبت اسناد|سازمان ثبت"), ("قوه قضاییه", r"قوه قضاییه|قوه قضائیه"),
    ("دیوان عالی کشور", r"دیوان عالی"), ("دیوان عدالت اداری", r"دیوان عدالت"),
    ("شورای نگهبان", r"شورای نگهبان"), ("بانک مرکزی", r"بانک مرکزی"),
]
ART_RE = re.compile(r"(?:مواد|ماده|بند|تبصره)\s*(?:های\s*)?((?:\d{1,4}(?:\s*مکرر)?)(?:\s*(?:،|,|و|تا|الی|-)\s*\d{1,4})*)")
JALALI_RE = re.compile(r"\b(13\d{2}|14\d{2})/(\d{1,2})/(\d{1,2})\b")


def load_law_names(path: Path = ALLOWLIST) -> list[str]:
    data = load_json(path, {})
    return [item["name"] for item in data.get("laws", []) if item.get("name")]


def _core_name(name: str) -> str:
    """Strip parentheses and the 'مصوب ...' suffix so titles match the bare law name."""
    n = norm(name)
    n = re.sub(r"\(.*?\)", "", n)
    n = re.sub(r"\s*مصوب.*$", "", n)
    return n.strip()


def link_laws(title: str, text: str, law_names: list[str]) -> list[dict]:
    """Rule-based link to corpus laws (longest core name wins; mentioned in title => high confidence)."""
    t, body = norm(title), norm(text[:2500])
    cores = sorted({(_core_name(n), n) for n in law_names}, key=lambda x: -len(x[0]))
    refs, taken = [], []
    for core, orig in cores:
        if len(core) < 6 or core in taken or any(core in x for x in taken):
            continue
        toks = [w for w in core.split() if w not in {"قانون", "آیین", "نامه"}]
        in_title = core in t or (len(toks) >= 2 and all(w in t.split() for w in toks))
        if in_title or core in body:
            taken.append(core)
            scope = t if in_title else body
            arts = extract_articles(scope)
            refs.append({"law_name": orig, "article_nos": arts, "confidence": "high" if in_title else "medium",
                         "evidence": "title" if in_title else "body"})
    return refs


_TARGET_RE = re.compile(r"((?:قانون|لایحه قانونی|آیین ?نامه|دستورالعمل|بخشنامه)\s[^،:؛|/()\n]{3,80}?)(?=\s+(?:مصوب|موضوع|در\s|به\s|و\s(?:ماده|تبصره)|ماده|تبصره|سال|\d)|[،:؛|/()\n]|$)")


def extract_target_law(title: str) -> str | None:
    """First 'قانون X' phrase after an amend/repeal verb in the title, even when X is not in our corpus."""
    t = norm(title)
    t = re.sub(r"^(?:قانون\s+)?(?:اصلاح|الحاق|لغو|نسخ|تمدید)\s+", "", t) if re.match(r"^(?:قانون\s+)?(?:اصلاح|الحاق|لغو|نسخ|تمدید)\s+(?:ماده|تبصره|بند|مواد)", t) else t
    t = re.sub(r"^.*?(?:ماده|مواد|تبصره|بند)\s+[\d\s،و]+\s+(?=قانون)", "", t)
    m = _TARGET_RE.search(t)
    return m.group(1).strip() if m else None


def extract_articles(text: str) -> list[str]:
    nums: list[str] = []
    for m in ART_RE.finditer(norm(text)):
        for n in re.findall(r"\d{1,4}(?:\s*مکرر)?", m.group(1)):
            n = re.sub(r"\s*مکرر", "-mokarrar", n)
            if n not in nums:
                nums.append(n)
    return nums[:30]


def classify_item(it: dict, law_names: list[str] | None = None) -> dict:
    """Return a change record (dict). Pure function; deterministic."""
    title = norm(it.get("title", ""))
    body = norm(it.get("text", ""))
    cats = it.get("categories", [])
    hints = [CATEGORY_HINTS[c][0] for c in cats if c in CATEGORY_HINTS]
    hint_set = set(hints)
    signals: list[str] = []
    ctype, effect = "other", "informs"

    if re.match(r"^(نشست قضایی|صورتجلسه|نشست)", title):
        ctype = "judicial_procedure"
        signals.append("judicial-session")
    elif re.match(r"^نظریه", title):
        ctype = "advisory_opinion"
        signals.append("advisory-title")
    elif 1890 in cats or re.match(r"^(طرح|لایحه(?! قانونی))", title) or "پیش نویس" in title:
        ctype = "bill"
        signals.append("bill-cat" if 1890 in cats else "bill-title")
    elif ANNUL_RE.search(title):
        ctype, effect = "annulment", "annuls"
        signals.append("annul")
    elif "unity_ruling" in hint_set or UNITY_RE.search(title):
        ctype, effect = "unity_ruling", "informs"
        signals.append("unity")
    elif "annulment" in hint_set:
        ctype, effect = "annulment", "annuls"
        signals.append("annul-cat")
    elif REPEAL_RE.search(title):
        ctype, effect = "repeal", "repeals"
        signals.append("repeal")
    elif CABINET_RE.search(title):
        ctype, effect = "cabinet_decision", "modifies" if AMEND_RE.search(title) else "adds"
        signals.append("cabinet")
    elif "judicial_procedure" in hint_set or "judicial_ruling" in hint_set:
        ctype = "judicial_ruling" if "judicial_ruling" in hint_set else "judicial_procedure"
        signals.append("judicial-cat")
    elif AMEND_RE.search(title) and ("law_text" in hint_set or "resolution" in hint_set or NEWLAW_RE.search(title)):
        ctype, effect = "amendment", "modifies"
        signals.append("amend")
    elif "circular" in hint_set or CIRC_RE.search(title):
        ctype, effect = "circular", "adds"
        signals.append("circular")
    elif "regulation" in hint_set or REG_RE.search(title):
        ctype, effect = "regulation", "adds"
        signals.append("regulation")
    elif "advisory_opinion" in hint_set:
        ctype = "advisory_opinion"
    elif "law_text" in hint_set or "resolution" in hint_set:
        blob = norm(f"{title} {it.get('excerpt', '')} {body[:600]}")
        yrs = [int(y) for y in re.findall(r"(?:مصوب|مورخ|سال|ابلاغ\w*)\D{0,25}?(1[34]\d\d)", blob)]
        cue = bool(ENACTED_RE.search(blob))
        recent = bool(yrs) and max(yrs) >= RECENT_JALALI_YEAR
        if "law_text" in hint_set and title.startswith(("قانون", "لایحه قانونی")) and not (cue or recent):
            ctype = "law_text"  # library page of an older law: not a new act
            signals.append("law-library-page")
        elif "law_text" in hint_set and title.startswith(("قانون", "لایحه قانونی")):
            ctype, effect = "new_law", "adds"
            signals.append("law-cat+enacted-cue" if cue else "law-cat+recent-year")
        else:
            ctype, effect = "resolution", "adds"
            signals.append("resolution-cat")
    elif "news" in hint_set:
        ctype = "news"
    elif "policy" in hint_set:
        ctype = "policy"

    refs = link_laws(title, body, law_names or [])
    raw_target = extract_target_law(title) if ctype in {"amendment", "repeal", "annulment", "cabinet_decision", "regulation"} else None
    issuer = next((n for n, rx in ISSUERS if re.search(rx, title) or re.search(rx, body[:400])), None)
    m = JALALI_RE.search(body[:3000])
    approval = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None

    # ambiguity: legal change whose target law could not be linked, or conflicting category/title signals
    conflicts = len(hint_set - {"news"}) > 1 and ctype in {"new_law", "other"}
    ambiguous = (ctype in {"amendment", "repeal", "cabinet_decision"} and not refs and not raw_target) or ctype == "other" or conflicts
    if ctype == "news" and not refs:
        ambiguous = False
    conf = "high" if (signals and refs and not ambiguous) else ("medium" if signals and not ambiguous else "low")
    rec = {
        "record_type": "law_change", "schema_version": SCHEMA_VERSION,
        "change_id": f"ekhtebar:{it['post_id']}", "source": "ekhtebar.ir", "source_tier": "unofficial",
        "status": "proposed", "source_url": it.get("link"), "title": it.get("title"),
        "published_at": it.get("date"), "modified_at": it.get("modified"), "is_edit": bool(it.get("is_edit")),
        "ekhtebar_categories": cats, "change_type": ctype, "effect": effect, "issuer": issuer,
        "approval_date": approval, "law_refs": refs, "target_law_raw": raw_target, "fresh": it.get("fresh", True), "classification": {"method": "rules", "confidence": conf, "signals": signals},
        "needs_llm": bool(ambiguous), "excerpt": it.get("excerpt", ""),
        # text and text_sha256 travel together: kept for legal types, absent/None for the rest
        "text": it.get("text", "") if ctype in LEGAL_TYPES else "",
        "text_sha256": it.get("text_sha256") if ctype in LEGAL_TYPES else None,
        "ingest_eligible": ctype in LEGAL_TYPES and it.get("fresh", True) and bool(refs or ctype in {"new_law"}),
    }
    if not it.get("fresh", True):  # an old post that ekhtebar edited: the law page changed, not a new act
        rec["effect"] = "informs"
        rec["classification"]["signals"].append("page-edited-not-new")
    rec["proposed_actions"] = proposed_actions(rec) if it.get("fresh", True) else (
        [{"action": "recheck_corpus_text", "change_id": rec["change_id"]}] if rec["change_type"] in LEGAL_TYPES else [])
    return rec


def proposed_actions(rec: dict) -> list[dict]:
    acts = []
    for ref in rec["law_refs"]:
        base = {"law_name": ref["law_name"], "article_nos": ref["article_nos"], "change_id": rec["change_id"]}
        if rec["effect"] == "repeals":
            acts.append({**base, "action": "mark_repealed", "set": {"status": "REPEALED", "is_active": False, "valid_to": rec["approval_date"]}})
        elif rec["effect"] == "annuls":
            acts.append({**base, "action": "mark_annulled", "set": {"status": "ANNULLED", "is_active": False, "valid_to": rec["approval_date"]}})
        elif rec["effect"] == "modifies":
            acts.append({**base, "action": "add_new_version_and_supersede", "set": {"valid_from": rec["approval_date"]}})
        elif rec["effect"] == "adds":
            acts.append({**base, "action": "review_new_text"})
    if not acts and rec["change_type"] == "new_law":
        acts.append({"action": "fetch_and_add_new_law", "change_id": rec["change_id"]})
    return acts


# ----------------------------------------------------------------------------- optional cheap LLM (ambiguous only)
DAILY_LLM_CAP_USD = 0.02
LLM_PROMPT = (
    "Classify this Persian legal news item. Reply ONLY with JSON: "
    '{"change_type": one of [new_law, amendment, repeal, annulment, unity_ruling, cabinet_decision, regulation, '
    'circular, judicial_procedure, advisory_opinion, bill, news, other], "law_name": string or null, "articles": [strings]}.\n\n'
)


def _registry():
    spec = importlib.util.spec_from_file_location(
        "model_registry", ROOT / "output_apps" / "generated_modules" / "smartjudge" / "model_registry.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pick_llm_model() -> tuple[str, float, float]:
    reg = _registry()
    ids = reg.models_for("cheap", sensitive=False)
    mid = next((i for i in ids if "v4.1-flash" in i), ids[0])
    price = (0.30, 1.20)
    for e in reg.role_entries("cheap"):
        if e.get("id") == mid and isinstance(e.get("price_per_1m"), dict):
            price = (float(e["price_per_1m"].get("in", 0.3)), float(e["price_per_1m"].get("out", 1.2)))
    return mid, price[0], price[1]


def llm_classify(rec: dict, item: dict, http_post=None) -> dict | None:
    """One cheap call. Returns updated record or None (budget exhausted / no key / error)."""
    budget = load_json(_p("llm_budget.json"), {})
    today = dt.date.today().isoformat()
    spent = budget.get("spent", 0.0) if budget.get("day") == today else 0.0
    if spent >= DAILY_LLM_CAP_USD:
        return None
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key and http_post is None:
        return None
    model, p_in, p_out = pick_llm_model()
    prompt = LLM_PROMPT + f"Title: {item.get('title')}\nText: {norm(item.get('text', ''))[:1500]}"
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 120,
            "temperature": 0, "reasoning": {"enabled": False}}
    try:
        resp = (http_post or _openrouter_post)(body, key)
        out = json.loads(re.search(r"\{.*\}", resp["choices"][0]["message"]["content"], re.S).group(0))
        usage = resp.get("usage", {})
        cost = (usage.get("prompt_tokens", 700) * p_in + usage.get("completion_tokens", 60) * p_out) / 1e6
    except Exception:
        return None
    save_json(_p("llm_budget.json"), {"day": today, "spent": round(spent + cost, 6)})
    allowed = {"new_law", "amendment", "repeal", "annulment", "unity_ruling", "cabinet_decision", "regulation",
               "circular", "judicial_procedure", "advisory_opinion", "bill", "news", "other"}
    if out.get("change_type") not in allowed:
        return None
    rec = dict(rec)
    rec["change_type"] = out["change_type"]
    rec["effect"] = {"repeal": "repeals", "annulment": "annuls", "amendment": "modifies", "new_law": "adds"}.get(out["change_type"], "informs")
    rec["classification"] = {"method": "llm", "confidence": "medium", "signals": ["llm:" + model]}
    rec["needs_llm"] = False
    rec["llm_law_name"] = out.get("law_name")
    rec["ingest_eligible"] = False  # LLM-classified items always need a human look
    legal = out["change_type"] in LEGAL_TYPES
    rec["text"] = item.get("text", "") if legal else ""
    rec["text_sha256"] = item.get("text_sha256") if legal and rec["text"] else None
    if legal and not rec["text"]:
        rec["needs_review"] = True  # upgraded to a legal type without a body: no proposal until the text is available
        rec["proposed_actions"] = []
    else:
        rec["proposed_actions"] = [] if not rec["law_refs"] else proposed_actions(rec)
    return rec


def _openrouter_post(body: dict, key: str) -> dict:
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx()) as r:
        return json.loads(r.read())


def cmd_classify(args) -> int:
    items = read_jsonl(_p("items.jsonl"))
    changes = {c["change_id"] + "@" + str(c.get("modified_at")): c for c in read_jsonl(_p("changes.jsonl"))}
    names = load_law_names()
    done = llm_used = 0
    for it in items:
        if it.get("classified") or it.get("needs_body_retry"):
            continue  # body fetch failed earlier: wait for the retry in `poll`, no record from a missing body
        rec = classify_item(it, names)
        if it.get("body_gave_up"):
            rec["classification"]["confidence"] = "low"
            rec["classification"]["signals"].append("body-missing")
            rec["ingest_eligible"], rec["needs_review"] = False, True
        if rec["needs_llm"] and getattr(args, "llm", False):
            upd = llm_classify(rec, it)
            if upd:
                rec, llm_used = upd, llm_used + 1
        changes[rec["change_id"] + "@" + str(rec["modified_at"])] = rec
        it["classified"] = True
        done += 1
    write_jsonl(_p("items.jsonl"), items)
    write_jsonl(_p("changes.jsonl"), list(changes.values()))
    print(f"classify: {done} items classified, llm_calls={llm_used}, needs_llm_left={sum(1 for c in changes.values() if c['needs_llm'])}")
    return 0


# ----------------------------------------------------------------------------- stage / digest
def select_unstaged(changes: list[dict], staged_ids: set[str]) -> list[dict]:
    return [c for c in changes if c["change_type"] != "news" and f"{c['change_id']}@{c['modified_at']}" not in staged_ids]


def cmd_stage(args) -> int:
    changes = read_jsonl(_p("changes.jsonl"))
    staged_ids = set(load_json(_p("staged_ids.json"), []))
    pick = select_unstaged(changes, staged_ids)
    if not pick:
        print("stage: nothing new to stage")
        return 0
    out_dir = Path(args.out_dir) if args.out_dir else STAGED_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    day = dt.date.today().isoformat()
    path = out_dir / f"law_watch_{day}.jsonl"
    n = 2
    while path.exists():  # never modify an existing file: write a sibling
        path = out_dir / f"law_watch_{day}_{n}.jsonl"
        n += 1
    with path.open("x", encoding="utf-8") as fh:
        for c in pick:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")
    staged_ids |= {f"{c['change_id']}@{c['modified_at']}" for c in pick}
    save_json(_p("staged_ids.json"), sorted(staged_ids))
    print(f"stage: wrote {len(pick)} change records -> {path}")
    return 0


TYPE_FA = {"new_law": "قانون جدید", "amendment": "اصلاحیه", "repeal": "نسخ/لغو", "annulment": "ابطال دیوان عدالت",
           "unity_ruling": "رای وحدت رویه", "cabinet_decision": "مصوبه هیئت وزیران", "regulation": "آیین‌نامه/مقررات",
           "circular": "بخشنامه/دستورالعمل", "judicial_procedure": "رویه قضایی", "judicial_ruling": "رای قضایی",
           "resolution": "مصوبه", "advisory_opinion": "نظریه مشورتی", "bill": "طرح/لایحه", "news": "خبر",
           "policy": "سیاست کلی", "law_text": "صفحه قانون قدیمی", "other": "سایر"}


def render_digest(changes: list[dict], day: str) -> str:
    cnt = Counter(c["change_type"] for c in changes)
    L = [f"# Law watch digest {day} / خلاصه تغییرات قوانین", "",
         "_Source: ekhtebar.ir only (unofficial). All items are proposals; nothing is ingested without approval. "
         "منبع غیررسمی؛ نیازمند تأیید وکیل._", "", f"Total: {len(changes)}", ""]
    L += ["| type | count |", "|---|---|"] + [f"| {k} ({TYPE_FA.get(k, k)}) | {v} |" for k, v in cnt.most_common()]
    for ctype in ("repeal", "annulment", "amendment", "new_law", "cabinet_decision", "unity_ruling", "regulation",
                  "circular", "judicial_procedure", "resolution", "law_text", "bill", "advisory_opinion", "judicial_ruling", "policy", "other", "news"):
        rows = [c for c in changes if c["change_type"] == ctype]
        if not rows:
            continue
        L += ["", f"## {ctype} / {TYPE_FA.get(ctype, ctype)} ({len(rows)})"]
        for c in rows[:25]:
            refs = "; ".join(r["law_name"] + (f" ماده {','.join(r['article_nos'][:5])}" if r["article_nos"] else "") for r in c["law_refs"])
            flag = " [needs review]" if c["needs_llm"] or c.get("needs_review") or c["classification"]["confidence"] == "low" else ""
            L.append(f"- {c['title']} ({(c['published_at'] or '')[:10]}){flag}" + (f" -> {refs}" if refs else "") + f"\n  {c['source_url']}")
        if len(rows) > 25:
            L.append(f"- ... and {len(rows) - 25} more")
    return "\n".join(L) + "\n"


SECRETS_ENV = Path(os.environ.get("ROXIRA_SECRETS_ENV", str(Path.home() / "Secrets" / "roxira" / "roxira.env")))
SMTP_KEYS = ("BACKUP_SMTP_USER", "BACKUP_SMTP_PASS", "BACKUP_NOTIFY_TO", "BACKUP_SMTP_HOST", "BACKUP_SMTP_PORT")


def load_smtp_env(path: Path | None = None) -> list[str]:
    """Copy only the SMTP variable names from a KEY=VALUE env file into os.environ (parsed, never executed).
    Existing environment values win. Returns the names that were set; values are never printed."""
    path = path or SECRETS_ENV
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    got = []
    for line in lines:
        m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
        if not m or m.group(1) not in SMTP_KEYS or os.environ.get(m.group(1)):
            continue
        v = m.group(2)
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        os.environ[m.group(1)] = v
        got.append(m.group(1))
    return got


def cmd_digest(args) -> int:
    changes = read_jsonl(_p("changes.jsonl"))
    since = (dt.datetime.now() - dt.timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%S")
    changes = [c for c in changes if (c.get("modified_at") or "") >= since]
    day = dt.date.today().isoformat()
    text = render_digest(changes, day)
    path = _p(f"digests/digest_{day}.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"digest: {len(changes)} changes -> {path}")
    if args.email:
        mc_path = ROOT / "scripts" / "ops" / "monitor" / "monitor_common.py"
        spec = importlib.util.spec_from_file_location("monitor_common", mc_path)
        mc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mc)
        load_smtp_env()
        if not all(os.environ.get(k) for k in SMTP_KEYS[:3]):
            print(f"digest: e-mail skipped, SMTP settings missing in {SECRETS_ENV}")
        else:
            try:
                mc.send_email(f"[Roxira] law watch digest {day}", text, dry_run=args.dry_run)
            except Exception as e:  # never fail the job over mail
                print(f"digest: e-mail failed: {e!r}")
    return 0


def cmd_run(args) -> int:
    rc = cmd_poll(args)
    cmd_classify(args)
    cmd_stage(args)
    args.days = 1
    cmd_digest(args)
    return 0 if rc in (0, 3) else rc  # offline (3) is not a launchd failure


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    pp, pc, ps, pd, pr = (sub.add_parser(n) for n in ("poll", "classify", "stage", "digest", "run"))
    for p in (pp, pr):
        p.add_argument("--since-days", type=int, default=None, help="ignore the cursor and start N days back")
        p.add_argument("--max-pages", type=int, default=None)
        p.add_argument("--no-text", action="store_true", help="skip per-post body fetch (titles/excerpts only)")
    for p in (pc, pr):
        p.add_argument("--llm", action="store_true", help="cheap-model step for ambiguous items only (<= $0.02/day)")
    for p in (ps, pr):
        p.add_argument("--out-dir", default=None)
    for p in (pd, pr):
        p.add_argument("--email", action="store_true")
        p.add_argument("--dry-run", action="store_true")
    pd.add_argument("--days", type=int, default=1)
    args = ap.parse_args(argv)
    return {"poll": cmd_poll, "classify": cmd_classify, "stage": cmd_stage, "digest": cmd_digest, "run": cmd_run}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
