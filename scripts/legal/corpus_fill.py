#!/usr/bin/env python3
"""Normalise fetched law text into the canonical JSONL rows used by the legal ingest pipeline.

Input is the OUTPUT of `scripts/legal/fetch_laws.py` (an `--out` directory with `manifest.json` and
`<id>.txt`) or of the `fetch-articles` command below. Nothing here writes to Qdrant/Postgres.

  corpus_fill.py stage  --fetched DIR --config config/corpus_fill_laws.json --out DIR [--only ID]
        Parse articles (ماده / اصل), drop site chrome, mark repealed articles, dedupe keys, write
        `staged_<id>.jsonl` (ingestable: active rows only) + `staged_<id>.repealed.jsonl` (excluded
        rows, kept for the record) + `stage_summary.json`; then run the ingest gates on every file.
  corpus_fill.py fetch-articles --out DIR --first 498 --last 728 [--slug-template ...]
        Per-article page fetch (ekhtebar.ir has the تعزیرات book only as one page per article),
        >= 3 s between requests, robots.txt honoured, resumable (per-article cache), 403/429 => stop.

Rows follow data/legal/phase1_canonical.jsonl: law_id, law_name, law_type, article_no
("13" / "13-mokarrar"), article_label ("ماده 13"), chapter, amended_on, approval_date, status,
is_active, source_url, source, source_tier, content_hash (md5 of the text), chunk_index, text
("ماده 13 <law>: <body>"), title, category, scope_tags, plus needs_review / review_reasons.
All text is UNVERIFIED until a lawyer signs off. Stdlib only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ----------------------------------------------------------------------------- text cleaning
_TRANS = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يك", "01234567890123456789یک"
)
BIDI_RE = re.compile("[‎‏‪-‮⁦-⁩﻿ً-ْٰ]")
# ekhtebar.ir / wikisource page chrome that can follow the statute (exact-line match)
END_LINES = frozenset(
    {
        "برچسب ها",
        "برچسب‌ها",
        "کپی لینک",
        "منابع",
        "مستندات مرتبط",
        "قوانین مرتبط",
        "رای وحدت رویه",
        "رأی وحدت رویه",
        "نظریه مشورتی",
        "آیین‌نامه",
        "آیین نامه",
    }
)
END_RE = re.compile(r"^(?:تازه[‌ ]?های قوانین|قانون فوق مشتمل بر|فهرست مصادیق محتوای مجرمانه$|"
    r"قانون .{3,150} مشتمل بر \d+ ماده)"
)
NOISE_LINE_RE = re.compile(
    r"(دانلود پی ?دی ?اف|را اینجا (?:بخوانید|دانلود)|جهت خرید آنلاین|کلیک کنید|فایل PDF|"
    r"کتاب الکترونیک مجموعه|^فهرست$|^Toggle$|^پرش به محتوا$)"
)
CHAPTER_RE = re.compile(r"^(?:کتاب|باب|بخش|فصل|مبحث|قسمت|گفتار)\s+\S.{0,110}$")
SEP = r"[-–—ـ:.]"
MARKER_RE = re.compile(
    r"^(?P<kind>ماده)\s*(?P<num>\d+)"
    r"(?:\s*(?P<mok>مکرر)(?:\s*(?P<mokn>\d+))?)?"
    r"(?P<tags>(?:\s*(?:\([^)\n]{0,160}\)|\[[^\]\n]{0,60}\]))*)"
    rf"\s*(?:(?P<sep>{SEP}+)\s*(?P<rest>.*)|(?P<eol>$))"
)
WAHED_RE = re.compile(rf"^ماده\s*واحده\s*(?:\([^)]*\))?\s*(?:{SEP}+\s*(?P<rest>.*)|$)")
REPEALED_TAG_RE = re.compile(
    r"(\[\s*منسوخ[^\]]*\]|\(\s*منسوخ[^)]*\)|\[\s*حذف\s*شد[^\]]*\]|\(\s*حذف\s*شد[^)]*\)|"
    r"\(\s*ملغی[^)]*\)|\[\s*ملغی[^\]]*\])"
)
REPEALED_NOTE_RE = re.compile(
    r"^\[\s*به\s+(?:موجب|تبع)[^\]]{0,200}?(?:نسخ|منسوخ|لغو)\s*(?:صریح\s*)?شده", re.S
)
PRIOR_TEXT_RE = re.compile(r"^متن\s+سابق")
NEW_PARA_RE = re.compile(r"^(?:تبصره|ماده|بند)\b")
DATE_RE = re.compile(r"(1[34]\d\d)\s*/\s*(\d{1,2})\s*/\s*(\d{1,2})")
LEADING_JUNK = "‌ \t"


def normalise_text(raw: str) -> str:
    """Digits -> 0-9, Arabic yeh/kaf -> Persian, strip bidi marks/diacritics, trim lines."""
    text = BIDI_RE.sub("", raw).translate(_TRANS)
    lines = []
    for ln in text.splitlines():
        ln = re.sub(r"[ \t ]+", " ", ln).strip(LEADING_JUNK).rstrip(" \t")
        lines.append(ln)
    return "\n".join(lines)


def fmt_date(m: re.Match) -> str:
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def latest_date(text: str) -> str | None:
    dates = [fmt_date(m) for m in DATE_RE.finditer(text)]
    return max(dates) if dates else None


# ----------------------------------------------------------------------------- ordinals (اصل ...)
_UNITS = {
    "یک": 1, "یکم": 1, "اول": 1, "دو": 2, "دوم": 2, "سه": 3, "سوم": 3, "چهار": 4, "چهارم": 4,
    "پنج": 5, "پنجم": 5, "شش": 6, "ششم": 6, "هفت": 7, "هفتم": 7, "هشت": 8, "هشتم": 8, "نه": 9,
    "نهم": 9, "ده": 10, "دهم": 10, "یازده": 11, "یازدهم": 11, "دوازده": 12, "دوازدهم": 12,
    "سیزده": 13, "سیزدهم": 13, "چهارده": 14, "چهاردهم": 14, "پانزده": 15, "پانزدهم": 15,
    "شانزده": 16, "شانزدهم": 16, "هفده": 17, "هفدهم": 17, "هجده": 18, "هجدهم": 18, "نوزده": 19,
    "نوزدهم": 19, "بیست": 20, "بیستم": 20, "سی": 30, "سیم": 30, "چهل": 40, "چهلم": 40,
    "پنجاه": 50, "پنجاهم": 50, "شصت": 60, "شصتم": 60, "هفتاد": 70, "هفتادم": 70, "هشتاد": 80,
    "هشتادم": 80, "نود": 90, "نودم": 90, "صد": 100, "صدم": 100, "یکصد": 100, "یکصدم": 100,
}  # fmt: skip


def ordinal_to_int(words: str) -> int | None:
    """«یکصد و هفتاد و پنجم» -> 175; tolerates glued forms («یکصدو سی ویکم», «وچهارم»).

    Greedy longest-match over the known number words with spaces/«و»/ZWNJ ignored. None when any
    part is unknown (so ordinary headings never become articles).
    """
    s = BIDI_RE.sub("", words).replace("ّ", "").replace("اوّل", "اول").replace("آ", "ا")
    s = re.sub(r"[\s\u200c]+", "", s)
    keys = sorted(_UNITS, key=len, reverse=True)
    total, i = 0, 0
    while i < len(s):
        if s[i] == "و" and i > 0:
            i += 1
            continue
        if s.startswith("ام", i) and total:
            i += 2
            continue
        for k in keys:
            if s.startswith(k, i):
                total += _UNITS[k]
                i += len(k)
                break
        else:
            return None
    return total if 0 < total < 1000 else None


ASL_RE = re.compile(r"^اصل\s+(?P<words>[^\d:]{1,60})$")


# ----------------------------------------------------------------------------- parsing
def _is_noise(line: str) -> bool:
    return bool(NOISE_LINE_RE.search(line))


def parse_articles(text: str, marker: str = "madde", repealed_numbers=()) -> tuple[list[dict], dict]:
    """Return (articles, info). Article: no, label, body, chapter, repealed, tags.

    marker "madde": line-initial «ماده N [مکرر] [(..)|[..]] <sep> text» (a separator or end of line
    is REQUIRED so a sentence that merely starts with «ماده 14 این قانون» is not a marker).
    marker "asl": a line that is exactly «اصل <ordinal words>» (constitution style).
    Lines of the "اصل سابق:" kind (superseded wording) are dropped.
    """
    text = normalise_text(text)
    arts: list[dict] = []
    cur: dict | None = None
    chapter: str | None = None
    dropped_prev_version = 0
    for line in text.splitlines():
        line = line.strip(LEADING_JUNK)
        if not line:
            if cur is not None and cur["body"] and cur["body"][-1] != "":
                cur["body"].append("")
            continue
        if (line in END_LINES or END_RE.match(line)) and arts:
            break
        if _is_noise(line):
            continue
        start = None
        if marker == "asl":
            m = ASL_RE.match(line)
            if m:
                n = ordinal_to_int(m.group("words"))
                if n:
                    start = {"no": str(n), "label": f"اصل {n}", "rest": "", "tags": ""}
        else:
            m = MARKER_RE.match(line)
            if m:
                no = str(int(m.group("num")))
                label = f"ماده {no}"
                if m.group("mok"):
                    no += "-mokarrar"
                    label += " مکرر" + (f" {m.group('mokn')}" if m.group("mokn") else "")
                start = {
                    "no": no,
                    "label": label,
                    "rest": (m.group("rest") or "").strip(),
                    "tags": (m.group("tags") or "").strip(),
                }
            else:
                w = WAHED_RE.match(line)
                if w:
                    start = {
                        "no": "1",
                        "label": "ماده واحده",
                        "rest": (w.group("rest") or "").strip(),
                        "tags": "",
                    }
        if start:
            cur = {**start, "chapter": chapter, "body": [start["rest"]] if start["rest"] else []}
            arts.append(cur)
            continue
        if CHAPTER_RE.match(line) and len(line) < 120 and "." not in line.rstrip(".") and (
            cur is None or not cur["body"] or cur["body"][-1] == ""
        ):
            chapter = line
            continue
        if cur is None:
            continue  # preamble before the first article is dropped
        if marker == "asl" and (line.startswith("اصل سابق") or cur.get("in_prev")):
            # wikisource prints the superseded wording after the current one: drop it up to the next heading
            cur["in_prev"] = True
            dropped_prev_version += 1
            continue
        cur["body"].append(line)
    out = []
    rep = {str(x) for x in repealed_numbers}
    for a in arts:
        body = "\n".join(a["body"]).strip()
        body = re.sub(r"\n{3,}", "\n\n", body)
        repealed_note = bool(REPEALED_NOTE_RE.match(body))
        body, had_prior = strip_prior_text(body)
        head = f"{a['tags']} {body[:60]}"
        repealed = (
            bool(REPEALED_TAG_RE.search(head)) or repealed_note or a["no"].split("-")[0] in rep
        )
        out.append(
            {**a, "body": body, "repealed": repealed, "had_prev": bool(a.get("in_prev")) or had_prior}
        )
    info = {"dropped_previous_version_lines": dropped_prev_version}
    return out, info


def strip_prior_text(body: str) -> tuple[str, bool]:
    """Drop «متن سابق ...» paragraphs (superseded wording printed after a repeal note).

    From a line that starts with «متن سابق» up to the next line starting with «تبصره»/«ماده»/«بند»
    (which is not itself a «متن سابق» line). Returns (clean_body, removed_anything).
    """
    out, skipping, removed = [], False, False
    for ln in body.split("\n"):
        if PRIOR_TEXT_RE.match(ln.strip()):
            skipping = removed = True
            continue
        if skipping and NEW_PARA_RE.match(ln.strip()):
            skipping = False
        if not skipping:
            out.append(ln)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip(), removed


def analyse(arts: list[dict]) -> dict:
    """Gaps / duplicates / order anomalies over the parsed article numbers."""
    nums = [int(a["no"].split("-")[0]) for a in arts if a["no"].split("-")[0].isdigit()]
    uniq = sorted(set(nums))
    gaps = [n for n in range(uniq[0], uniq[-1] + 1) if n not in set(uniq)] if uniq else []
    dup = [k for k, v in Counter(a["no"] + "|" + a["label"] for a in arts).items() if v > 1]
    backward = sum(1 for x, y in zip(nums, nums[1:], strict=False) if y < x)
    return {
        "articles": len(arts),
        "first": uniq[0] if uniq else None,
        "last": uniq[-1] if uniq else None,
        "missing_numbers": gaps,
        "duplicate_keys": dup,
        "order_regressions": backward,
        "empty_bodies": [a["label"] for a in arts if not a["body"]],
    }


def dedupe(arts: list[dict]) -> tuple[list[dict], list[str]]:
    """Keep the first occurrence of each (no, label); later ones get a numbered label + a reason."""
    seen: Counter = Counter()
    out, notes = [], []
    for a in arts:
        key = (a["no"], a["label"])
        seen[key] += 1
        if seen[key] > 1:
            a = {**a, "label": f"{a['label']} ({seen[key]})", "dup_of": a["label"]}
            notes.append(f"duplicate_key:{a['label']}")
        out.append(a)
    return out, notes


# ----------------------------------------------------------------------------- rows
def md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()  # noqa: S324 - content id, same as v2 rows


def build_rows(cfg: dict, arts: list[dict], fetched: dict, header_text: str = "") -> list[dict]:
    st = cfg.get("stage") or {}
    law_name = st.get("law_name") or cfg["title_fa"]
    approval = st.get("approval_date")
    if approval is None:
        m = re.search(r"مصوب\w*\s*:?\s*(1[34]\d\d\s*/\s*\d{1,2}\s*/\s*\d{1,2})", header_text)
        approval = fmt_date(DATE_RE.search(m.group(1))) if m else None
    tier = st.get("source_tier") or ("secondary" if "wikisource" in str(fetched.get("source_url", "")) else "unofficial")
    rows = []
    for i, a in enumerate(arts):
        body = a["body"]
        text = f"{a['label']} {law_name}: {body}" if body else f"{a['label']} {law_name}:"
        repealed = a["repealed"]
        reasons = ["unofficial_source" if tier == "unofficial" else "secondary_source", "lawyer_review_pending"]
        if a.get("dup_of"):
            reasons.append("duplicate_key_relabelled")
        if a.get("had_prev"):
            reasons.append("superseded_wording_dropped")
        if not body:
            reasons.append("empty_body")
        if len(body) > 6000:
            reasons.append("very_long_article")
        if approval is None:
            reasons.append("approval_date_missing")
        rows.append(
            {
                "law_id": st.get("law_id") or f"corpus_fill_{cfg['id']}",
                "law_name": law_name,
                "law_type": st.get("law_type", "LAW"),
                "article_no": a["no"],
                "article_label": a["label"],
                "chapter": a.get("chapter"),
                "amended_on": latest_date(f"{a['tags']} {body[:200]}"),
                "approval_date": approval,
                "status": "REPEALED" if repealed else "VALID",
                "is_active": not repealed,
                "source_url": fetched.get("source_url"),
                "source": fetched.get("source_label") or fetched.get("source") or "",
                "source_tier": tier,
                "content_hash": md5(text),
                "chunk_index": i,
                "text": text,
                "title": f"{law_name} - {a['label']}",
                "category": st.get("category") or cfg.get("topic"),
                "scope_tags": st.get("scope_tags", []),
                "needs_review": True,
                "review_reasons": reasons,
            }
        )
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def _load_ingest():
    path = ROOT / "scripts/legal/ingest_pipeline.py"
    spec = importlib.util.spec_from_file_location("ingest_pipeline", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("ingest_pipeline", mod)
    spec.loader.exec_module(mod)
    return mod


def stage_law(cfg: dict, text: str, fetched: dict, allowlist: dict | None = None) -> dict:
    """Pure: raw text -> {rows, repealed_rows, analysis, gates}. No I/O besides the ingest import."""
    st = cfg.get("stage") or {}
    arts, info = parse_articles(text, st.get("marker", "madde"), st.get("repealed_numbers", ()))
    analysis = {**analyse(arts), **info}
    lo, hi = st.get("article_range", (None, None))
    if lo is not None:
        arts = [a for a in arts if a["no"].split("-")[0].isdigit() and lo <= int(a["no"].split("-")[0]) <= hi]
    arts, notes = dedupe(arts)
    header = normalise_text(text)[:1500]
    rows = build_rows(cfg, arts, fetched, header)
    active = [r for r in rows if r["is_active"]]
    repealed = [r for r in rows if not r["is_active"]]
    result = {
        "id": cfg["id"],
        "analysis": analysis,
        "dedupe_notes": notes,
        "rows": active,
        "repealed_rows": repealed,
    }
    if allowlist is not None:
        ing = _load_ingest()
        rep = ing.validate_rows(active, allowlist)
        result["gates"] = {"ok": rep["ok"], "gate_counts": rep["gate_counts"]}
    return result


def run_stage(
    fetched_dir: Path,
    config: Path,
    out: Path,
    only: str | None,
    allowlist_path: Path | None,
    allow_proposed: bool | None = None,
) -> dict:
    cfg_all = json.loads(config.read_text(encoding="utf-8"))
    manifest = json.loads((fetched_dir / "manifest.json").read_text(encoding="utf-8"))["laws"]
    ing = _load_ingest()
    allowlist = ing.load_allowlist(
        allowlist_path or ing.DEFAULT_ALLOWLIST, allow_proposed=allow_proposed
    )
    summary = {"laws": {}}
    for law in cfg_all["laws"]:
        if only and law["id"] != only:
            continue
        if law.get("audit_only"):
            continue
        ent = manifest.get(law["id"])
        if not ent or ent.get("status") != "done" or ent.get("kind") != "text":
            summary["laws"][law["id"]] = {"skipped": "not_fetched_as_text"}
            continue
        text = (fetched_dir / ent["file"]).read_text(encoding="utf-8")
        res = stage_law(law, text, ent, allowlist)
        write_jsonl(out / f"staged_{law['id']}.jsonl", res["rows"])
        if res["repealed_rows"]:
            write_jsonl(out / f"staged_{law['id']}.repealed.jsonl", res["repealed_rows"])
        summary["laws"][law["id"]] = {
            "rows": len(res["rows"]),
            "repealed_excluded": len(res["repealed_rows"]),
            "analysis": res["analysis"],
            "dedupe_notes": res["dedupe_notes"],
            "gates": res.get("gates"),
        }
    out.mkdir(parents=True, exist_ok=True)
    (out / "stage_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return summary


# ----------------------------------------------------------------------------- per-article fetch
DEFAULT_SLUG = "ماده-{n}-قانون-مجازات-اسلامی-تعزیرات-و-مج"
ARTICLE_TAIL_RE = re.compile(r"جهت خرید آنلاین")


def article_page_text(html_text: str, fe_extract) -> str:
    """Law text of one per-article page: drop the page-title line and the shop/footer lines."""
    lines = [ln for ln in fe_extract(html_text).splitlines()]
    out = []
    for ln in lines:
        if ARTICLE_TAIL_RE.search(ln):
            break
        out.append(ln)
    # first non-empty line is the page title «ماده N قانون ... (…)» without a dash: drop it
    for i, ln in enumerate(out):
        if ln.strip():
            if re.match(r"^\s*ماده\s*[\d۰-۹]+\s+قانون", ln):
                out = out[i + 1 :]
            break
    return "\n".join(out).strip()


def fetch_articles(out: Path, first: int, last: int, slug_template: str, delay: float, http=None) -> dict:
    """Polite per-article crawl (resumable). 404 = article page absent; 403/429 stops the run."""
    fl_path = ROOT / "scripts/legal/fetch_laws.py"
    spec = importlib.util.spec_from_file_location("fetch_laws", fl_path)
    fl = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("fetch_laws", fl)
    spec.loader.exec_module(fl)
    out = fl.fe.assert_outside_repo(out)
    cache = out / "pages"
    cache.mkdir(parents=True, exist_ok=True)
    http = http or fl.HostHttp(fl.make_transport(45.0), ("ekhtebar.ir",), delay=delay)
    stats = {"fetched": 0, "cached": 0, "absent": [], "stopped": None}
    for n in range(first, last + 1):
        f = cache / f"{n}.txt"
        if f.exists():
            stats["cached"] += 1
            continue
        url = "https://www.ekhtebar.ir/" + urllib.parse.quote(slug_template.format(n=n)) + "/"
        try:
            status, _, body, _ = http.get(url)
        except fl.HttpDenied as exc:
            stats["stopped"] = f"denied_http_{exc.status}_at_{n}"
            break
        except (fl.Blocked, fl.HttpFailure) as exc:
            stats["stopped"] = f"{type(exc).__name__}:{exc}_at_{n}"
            break
        if status == 404:
            stats["absent"].append(n)
            f.write_text("", encoding="utf-8")
            continue
        if status != 200:
            stats["stopped"] = f"http_{status}_at_{n}"
            break
        f.write_text(article_page_text(body.decode("utf-8", "replace"), fl.fe.extract_text), encoding="utf-8")
        stats["fetched"] += 1
    return stats


def combine_articles(out: Path, first: int, last: int) -> Path:
    parts = []
    for n in range(first, last + 1):
        f = out / "pages" / f"{n}.txt"
        if f.exists() and f.read_text(encoding="utf-8").strip():
            parts.append(f.read_text(encoding="utf-8").strip())
    path = out / "taazirat_1375.txt"
    path.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stage")
    s.add_argument("--fetched", type=Path, required=True)
    s.add_argument("--config", type=Path, default=ROOT / "config/corpus_fill_laws.json")
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--only")
    s.add_argument("--allowlist", type=Path)
    s.add_argument(
        "--allow-proposed",
        action="store_true",
        help="include allowlist entries with status 'proposed' (pending lawyer review); asserts the "
        "owner accepts their unofficial/secondary sources. Same as env LEGAL_ALLOW_PROPOSED=1",
    )
    f = sub.add_parser("fetch-articles")
    f.add_argument("--out", type=Path, required=True)
    f.add_argument("--first", type=int, required=True)
    f.add_argument("--last", type=int, required=True)
    f.add_argument("--slug-template", default=DEFAULT_SLUG)
    f.add_argument("--delay", type=float, default=3.0)
    fl_ = sub.add_parser(
        "fetch-laws",
        help="fetch whole law pages: default engine ekhtebar (scripts/legal/fetch_ekhtebar_wp.py, owner's only accepted "
        "source); crawl4ai is optional (other sites)",
    )
    fl_.add_argument("--engine", choices=("ekhtebar", "http", "crawl4ai"), default="ekhtebar")
    fl_.add_argument("--out", type=Path, required=True)
    fl_.add_argument("--only", nargs="*")
    args = ap.parse_args(argv)
    if args.cmd == "fetch-laws":
        if args.engine == "http":
            print("engine http = scripts/legal/fetch_laws.py --config config/corpus_fill_laws.json --out DIR")
            return 2
        extra = ["--only", *args.only] if args.only else []
        if args.engine == "ekhtebar":
            spec = importlib.util.spec_from_file_location("fetch_ekhtebar_wp", ROOT / "scripts/legal/fetch_ekhtebar_wp.py")
            mod = importlib.util.module_from_spec(spec)
            sys.modules["fetch_ekhtebar_wp"] = mod
            spec.loader.exec_module(mod)
            return mod.main(["fetch", "--raw-dir", str(args.out), *extra])
        spec = importlib.util.spec_from_file_location("corpus_crawl4ai", ROOT / "scripts/legal/corpus_crawl4ai.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["corpus_crawl4ai"] = mod
        spec.loader.exec_module(mod)
        return mod.main(["fetch", "--out", str(args.out), *extra])
    if args.cmd == "stage":
        summary = run_stage(
            args.fetched,
            args.config,
            args.out,
            args.only,
            args.allowlist,
            allow_proposed=args.allow_proposed,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2)[:6000])
        bad = [k for k, v in summary["laws"].items() if v.get("gates") and not v["gates"]["ok"]]
        return 3 if bad else 0
    stats = fetch_articles(args.out, args.first, args.last, args.slug_template, args.delay)
    combine_articles(args.out, args.first, args.last)
    print(json.dumps(stats, ensure_ascii=False))
    return 4 if stats["stopped"] else 0


if __name__ == "__main__":
    sys.exit(main())
