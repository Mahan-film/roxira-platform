#!/usr/bin/env python3
# ruff: noqa: E501
"""Parse a Malaysian Act PDF into section rows in our ingest schema (INTERNAL EVALUATION ONLY).

PDF -> text with ``pdftotext -layout`` (poppler) -> sections -> JSONL rows accepted by
scripts/legal/ingest_pipeline.py validate/apply.

Layout handled (Laws of Malaysia reprints):
  * reprint cover and arrangement of sections (table of contents) are dropped: parsing starts
    after the "ENACTED by the Parliament of Malaysia" line;
  * running page headers/footers (``Laws of Malaysia ACT 136``, bare page numbers, any line that
    repeats at the top/bottom of three or more pages) are removed;
  * PART / CHAPTER / DIVISION headings are tracked (field ``part``) and kept out of section text;
  * a section starts at ``12.`` or ``12A.`` (indent <= 6) and its heading is the unindented
    line(s) just above it; section numbers must increase, which rejects numbered list items;
  * subsections ``(1)``, ``(a)``, ``(i)``, ``Illustration(s)`` and ``Explanation`` start new lines;
  * schedules and the list of amendments are not parsed (parsing stops there);
  * sections that are only "Repealed"/"Deleted"/"Omitted" are skipped and counted.

Row ``article_no`` is the section number with the letter suffix lower-cased after a hyphen
("12A" -> "12-a") because the ingest gate (ARTICLE_NO_RE) and eval_chat_golden match that form;
``article_label`` stays "Section 12A". Chunks after the first get the label
"Section 12A (part 2)" so (law, article_no, label) stays unique for the duplicate gate.

Law text is never printed; only counts.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_RAW = Path("/var/lib/roxira-global/my_law/raw")
DEFAULT_PARSED = Path("/var/lib/roxira-global/my_law/parsed")
MAX_CHUNK = 1800
SOURCE_LABEL = "lom.agc.gov.my (internal eval)"

SECTION_RE = re.compile(r"^ {0,6}(\d{1,4})([A-Z]{0,3})\.\s+(\S.*)$")
SECTION_ONLY_RE = re.compile(r"^ {0,6}(\d{1,4})([A-Z]{0,3})\.\s*$")
HEADER_RE = re.compile(r"^\s*(\d+\s+)?laws\s+of\s+malaysia(\s+act\s+[A-Z]?\d+)?(\s+\d+)?\s*$", re.I)
PAGE_NO_RE = re.compile(r"^\s*(\d{1,4}|[ivxlc]{1,6})\s*$", re.I)
STRUCT_RE = re.compile(r"^\s*(PART|CHAPTER|DIVISION)\s+([IVXLC]+|\d+[A-Z]?|[A-Z][a-z]+)\s*$", re.I)
ENACTED_RE = re.compile(r"ENACTED\s+by\s+the\s+Parliament", re.I)
STOP_RE = re.compile(r"^\s*(LIST\s+OF\s+AMENDMENTS|(THE\s+)?(\w+\s+)?SCHEDULE)\s*$")
SUB_START_RE = re.compile(r"^\s*(\(\d+[A-Z]{0,2}\)|\([a-z]{1,3}\)|\([ivx]+\)|\([A-Z]\)|Illustrations?\b|Explanations?\b)")
REPEALED_RE = re.compile(r"^\(?\s*(Repealed|Deleted|Omitted|Spent)\b", re.I)
DATE_RES = (
    re.compile(r"incorporating\s+all\s+amendments\s+up\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.I),
    re.compile(r"\bas\s+at\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.I),
    re.compile(r"reprint(?:ed)?[^\n]{0,40}?(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.I),
)


class ParseError(Exception):
    pass


def pdf_to_text(pdf: Path) -> str:
    """Run poppler's pdftotext in layout mode; page breaks stay as form feeds."""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", str(pdf), "-"], check=True, capture_output=True, timeout=300
        )
    except FileNotFoundError as err:
        raise ParseError("pdftotext not found (install poppler-utils)") from err
    except subprocess.CalledProcessError as err:
        raise ParseError(f"pdftotext failed with code {err.returncode}") from err
    return out.stdout.decode("utf-8", "replace")


# ---------------------------------------------------------------------------- cleaning
def _shape(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def strip_page_furniture(text: str) -> list[str]:
    """Return lines with page headers/footers removed (form feeds become nothing)."""
    pages = [p.splitlines() for p in text.split("\f")]
    shapes: Counter = Counter()
    for lines in pages:
        nonblank = [ln for ln in lines if ln.strip()]
        for ln in nonblank[:2] + nonblank[-2:]:
            shapes[_shape(ln)] += 1
        # count each shape once per page
    repeated = {s for s, n in shapes.items() if n >= 3 and s and len(s) < 90 and not SECTION_RE.match(s)}
    out: list[str] = []
    for lines in pages:
        nonblank_idx = [i for i, ln in enumerate(lines) if ln.strip()]
        edge = set(nonblank_idx[:2] + nonblank_idx[-2:])
        for i, ln in enumerate(lines):
            if not ln.strip():
                out.append("")
                continue
            if HEADER_RE.match(ln) or (i in edge and (PAGE_NO_RE.match(ln) or _shape(ln) in repeated)):
                continue
            out.append(ln.rstrip())
        out.append("")
    return out


def _to_iso(date_text: str) -> str | None:
    for fmt in ("%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(re.sub(r"\s+", " ", date_text.strip()), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def detect_meta(text: str) -> dict:
    """Act number, title and reprint date from the cover / first lines (before ENACTED)."""
    head = text
    m = ENACTED_RE.search(text)
    if m:
        head = text[: m.start()]
    meta: dict = {"act_no": None, "title": None, "reprint_date": None}
    lines = [ln.strip() for ln in head.splitlines() if ln.strip()]
    for i, ln in enumerate(lines):
        am = re.match(r"^(?:laws\s+of\s+malaysia\s+)?act\s+(\d{1,4})$", ln, re.I)
        if am and meta["act_no"] is None:
            meta["act_no"] = int(am.group(1))
            for cand in lines[i + 1 : i + 6]:
                if not re.match(r"^(reprint|incorporating|as at|published|laws of malaysia)", cand, re.I):
                    meta["title"] = cand.title() if cand.isupper() else cand
                    break
    for rx in DATE_RES:
        dm = rx.search(head)
        if dm:
            meta["reprint_date"] = _to_iso(dm.group(1))
            if meta["reprint_date"]:
                break
    return meta


# ---------------------------------------------------------------------------- sections
def _is_heading_block(block: list[str]) -> bool:
    if not block or len(block) > 3:
        return False
    for ln in block:
        s = ln.strip()
        if len(s) > 140 or (len(ln) - len(ln.lstrip())) > 8:
            return False
        if s[0] in "([" or s[0].islower() or s.endswith((".", ";", ":", ",")):
            return False
        if re.match(r"^(Illustrations?|Explanations?)\b", s):
            return False
    return True


def _pop_trailing_heading(buf: list[str]) -> str:
    """Remove and return the heading-like block after the last blank line of buf."""
    while buf and not buf[-1].strip():
        buf.pop()
    idx = len(buf)
    while idx > 0 and buf[idx - 1].strip():
        idx -= 1
    block = buf[idx:]
    if _is_heading_block(block):
        del buf[idx:]
        return " ".join(s.strip() for s in block)
    return ""


def split_sections(lines: list[str]) -> tuple[list[dict], dict]:
    """Return (sections, stats). Each section: num, suffix, heading, part, lines."""
    start = 0
    for i, ln in enumerate(lines):
        if ENACTED_RE.search(ln):
            start = i + 1
            for k in range(i, min(i + 4, len(lines))):
                if "follows" in lines[k].lower():
                    start = k + 1
                    break
            break
    else:
        # no enacting line: take the last place where section 1 starts
        firsts = [i for i, ln in enumerate(lines) if re.match(r"^ {0,6}1\.\s+\S", ln)]
        start = firsts[-1] - 1 if firsts else 0
        start = max(start, 0)

    sections: list[dict] = []
    cur: dict | None = None
    pre: list[str] = []
    part = ""
    last_key = (0, "")
    stats = {"skipped_repealed": 0, "rejected_numbering": 0}
    i = start
    n = len(lines)
    while i < n:
        ln = lines[i]
        if STOP_RE.match(ln) and sections:
            break
        sm = STRUCT_RE.match(ln)
        if sm:
            title = [ln.strip()]
            j = i + 1
            while j < n and lines[j].strip() and len(title) < 3 and not SECTION_RE.match(lines[j]):
                title.append(lines[j].strip())
                j += 1
            part = " - ".join(title)
            cur = None
            pre = []
            i = j
            continue
        m = SECTION_RE.match(ln) or SECTION_ONLY_RE.match(ln)
        if m:
            num, suf = int(m.group(1)), m.group(2)
            key = (num, suf)
            rest = m.group(3) if m.lastindex and m.lastindex >= 3 else ""
            if key > last_key:
                buf = cur["lines"] if cur else pre
                heading = _pop_trailing_heading(buf)
                cur = {"num": num, "suffix": suf, "heading": heading, "part": part, "lines": [rest] if rest else []}
                sections.append(cur)
                pre = []
                last_key = key
                i += 1
                continue
            stats["rejected_numbering"] += 1
        (cur["lines"] if cur else pre).append(ln)
        i += 1
    return sections, stats


def _join_body(lines: list[str]) -> str:
    """Join wrapped lines into paragraphs; subsections/illustrations start a new line."""
    paras: list[str] = []
    for raw in lines:
        s = re.sub(r"\s+", " ", raw).strip()
        if not s:
            continue
        if not paras or SUB_START_RE.match(s):
            paras.append(s)
        else:
            paras[-1] += " " + s
    return "\n".join(paras)


def split_chunks(prefix: str, body: str, limit: int = MAX_CHUNK) -> list[str]:
    """Split body into pieces so that len(prefix + piece) <= limit (paragraph, sentence, word)."""
    budget = max(limit - len(prefix), 200)
    if len(body) <= budget:
        return [body]
    units: list[str] = []
    for para in body.split("\n"):
        if len(para) <= budget:
            units.append(para)
            continue
        for sent in re.split(r"(?<=[.;:])\s+", para):
            if len(sent) <= budget:
                units.append(sent)
                continue
            words, cur = sent.split(" "), ""
            for w in words:
                if cur and len(cur) + 1 + len(w) > budget:
                    units.append(cur)
                    cur = w
                else:
                    cur = f"{cur} {w}".strip()
            if cur:
                units.append(cur)
    chunks: list[str] = []
    cur = ""
    for u in units:
        if cur and len(cur) + 1 + len(u) > budget:
            chunks.append(cur)
            cur = u
        else:
            cur = f"{cur}\n{u}" if cur else u
    if cur:
        chunks.append(cur)
    return chunks


def section_rows(sections: list[dict], *, act_no, title: str, source_url: str | None,
                 reprint_date: str | None, stats: dict | None = None) -> list[dict]:
    rows: list[dict] = []
    for sec in sections:
        body = _join_body(sec["lines"])
        if not body or REPEALED_RE.match(body):
            if stats is not None:
                stats["skipped_repealed"] = stats.get("skipped_repealed", 0) + 1
            continue
        no = f"{sec['num']}{sec['suffix']}"
        art = f"{sec['num']}-{sec['suffix'].lower()}" if sec["suffix"] else str(sec["num"])
        label = f"Section {no}"
        heading = sec["heading"]
        prefix = f"{label} {title}: {heading} — " if heading else f"{label} {title}: "
        pieces = split_chunks(prefix, body)
        for idx, piece in enumerate(pieces):
            rows.append({
                "law_name": title,
                "law_type": "STATUTE",
                "act_no": act_no,
                "article_no": art,
                "article_label": label if idx == 0 else f"{label} (part {idx + 1})",
                "section_no": no,
                "heading": heading,
                "part": sec["part"],
                "text": prefix + piece,
                "approval_date": reprint_date,
                "reprint_date": reprint_date,
                "status": "VALID",
                "is_active": True,
                "source_url": source_url,
                "source_tier": "official",
                "source": SOURCE_LABEL,
                "chunk_index": idx,
                "chunk_count": len(pieces),
            })
    return rows


def parse_text(text: str, *, act_no=None, title: str | None = None, source_url: str | None = None,
               reprint_date: str | None = None) -> tuple[list[dict], dict]:
    meta = detect_meta(text)
    act_no = act_no or meta["act_no"]
    title = title or meta["title"]
    if not title:
        raise ParseError("Act title not found; pass --title")
    lines = strip_page_furniture(text)
    sections, stats = split_sections(lines)
    if not sections:
        raise ParseError("no sections found (layout not recognised)")
    rows = section_rows(sections, act_no=act_no, title=title, source_url=source_url,
                        reprint_date=reprint_date or meta["reprint_date"], stats=stats)
    stats.update(sections=len(sections), rows=len(rows), reprint_date=reprint_date or meta["reprint_date"])
    return rows, stats


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pdf", type=Path, help="one PDF (use with --title/--act-no/--source-url)")
    ap.add_argument("--text", type=Path, help="already extracted text instead of --pdf")
    ap.add_argument("--manifest", type=Path, default=DEFAULT_RAW / "manifest.json",
                    help="fetch manifest: parse every PDF listed in it")
    ap.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW)
    ap.add_argument("--out", type=Path, default=DEFAULT_PARSED / "my_law_sections.jsonl")
    ap.add_argument("--title")
    ap.add_argument("--act-no", type=int)
    ap.add_argument("--source-url")
    ap.add_argument("--reprint-date", help="ISO date; overrides the one found in the cover")
    args = ap.parse_args(argv)

    jobs: list[dict] = []
    if args.pdf or args.text:
        jobs.append({"path": args.pdf, "text": args.text, "title": args.title, "act_no": args.act_no,
                     "source_url": args.source_url})
    else:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        for name, ent in sorted(manifest["files"].items()):
            jobs.append({"path": args.raw_dir / name, "text": None, "title": ent["title"],
                         "act_no": ent["act_no"], "source_url": ent["source_url"]})
    all_rows: list[dict] = []
    for job in jobs:
        text = job["text"].read_text(encoding="utf-8") if job["text"] else pdf_to_text(job["path"])
        try:
            rows, stats = parse_text(text, act_no=job["act_no"], title=job["title"],
                                     source_url=job["source_url"], reprint_date=args.reprint_date)
        except ParseError as err:
            print(f"FAILED {job['title'] or job['path']}: {err}", file=sys.stderr)
            return 1
        print(f"{job['title']}: sections={stats['sections']} rows={stats['rows']} "
              f"repealed_skipped={stats['skipped_repealed']} rejected_numbering={stats['rejected_numbering']} "
              f"reprint_date={stats['reprint_date']}")
        all_rows.extend(rows)
    write_jsonl(args.out, all_rows)
    print(f"wrote {len(all_rows)} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
