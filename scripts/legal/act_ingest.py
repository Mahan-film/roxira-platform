#!/usr/bin/env python3
"""Split an English-language Act (PDF / HTML / plain text) into cited section rows.

Jurisdiction-agnostic: the layout rules (section headings, subsections, page noise, how a
citation is written) live in a ``Profile``. ``malaysia`` is the first profile (Laws of Malaysia
reprints from the AGC portal); another common-law jurisdiction is a new ``Profile`` entry, not a
new parser.

  act_ingest.py parse ACT.pdf --profile malaysia --law-name "Contracts Act 1950" \
      --act-no "Act 136" --source-url https://lom.agc.gov.my/... \
      --out data/legal/staged/my_act136_<date>.jsonl
  act_ingest.py parse ACT.html ... --dry-run   # counts per section; nothing is written
  act_ingest.py pilot                           # the 20 pilot Acts (config/legal_allowlist_my.json)

Output rows use the data/legal/phase1_canonical.jsonl schema that
``ingest_pipeline.py validate|plan|apply`` reads (law_name, article_no, article_label, text,
source_tier, is_active, status), plus ``jurisdiction``, ``act_no``, ``section``, ``subsection``,
``section_title``, ``part`` and ``citation``. One row per subsection (or per section when it has
none); long chunks are split on sentence boundaries (``chunk_index``).

This script reads LOCAL files only and never downloads. Reuse of AGC text is gated: see
docs/research/global/MALAYSIA_AGC_TERMS_2026-10-22.md. Rows are marked ``authentic: false``
because the portal's online versions are not the authentic reprint. Stdlib only (PDF text via
``pdftotext`` when the input is a PDF); law text is never printed.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MY_ALLOWLIST = ROOT / "config" / "legal_allowlist_my.json"
DEFAULT_MAX_CHARS = 3000


@dataclass(frozen=True)
class Profile:
    """Layout and citation rules of one jurisdiction's official Act texts."""

    jurisdiction: str
    # "10. (1) Text" / "17A. Text" at line start; ``num`` is the section number, ``rest`` the
    # text on the same line.
    section_re: re.Pattern
    # "(1) Text" / "(2A) Text" at line start.
    subsection_re: re.Pattern
    # Lines dropped everywhere (page numbers, running headers).
    noise_res: tuple[re.Pattern, ...]
    # "PART II" / "CHAPTER 3": a structural heading; the next line is its title.
    part_re: re.Pattern
    # Where the operative text begins (after the cover and the arrangement of sections).
    enacting_re: re.Pattern
    # A line that ends the sections (schedules are out of scope for now).
    schedule_re: re.Pattern
    # Section body of a deleted/repealed section.
    repealed_re: re.Pattern
    citation: Callable[[str, str, str, str], str]
    source_tier_hosts: tuple[str, ...] = field(default_factory=tuple)


def _my_citation(law_name: str, act_no: str, section: str, subsection: str) -> str:
    """Malaysian style: ``Contracts Act 1950 [Act 136], s. 10(1)``."""
    act = f" [{act_no}]" if act_no else ""
    return f"{law_name}{act}, s. {section}{subsection}"


PROFILES: dict[str, Profile] = {
    "malaysia": Profile(
        jurisdiction="MY",
        section_re=re.compile(r"^(?P<num>\d{1,4}[A-Z]{0,3})\.(?:\s+(?P<rest>\S.*))?$"),
        subsection_re=re.compile(r"^\((?P<num>\d{1,3}[A-Z]{0,3})\)\s+"),
        noise_res=(
            re.compile(r"^\d{1,4}$"),
            re.compile(r"^laws of malaysia(\s+act\s+\d+[a-z]?)?$", re.I),
            re.compile(r"^act\s+\d+[a-z]?$", re.I),
            re.compile(r"^online version of updated text of reprint$", re.I),
            re.compile(r"^(this )?text is not an authentic text.*$", re.I),
        ),
        part_re=re.compile(r"^(PART|CHAPTER|DIVISION)\s+[IVXLC\d]+[A-Z]?$"),
        enacting_re=re.compile(r"^(BE IT ENACTED|ENACTED by)\b", re.I),
        schedule_re=re.compile(r"^(FIRST |SECOND |THIRD |FOURTH |FIFTH )?SCHEDULE\b"),
        repealed_re=re.compile(r"^\(?\s*(deleted|repealed|omitted)\b", re.I),
        citation=_my_citation,
        source_tier_hosts=("lom.agc.gov.my",),
    ),
}


# ----------------------------------------------------------------------------- input → lines
class _TextFromHTML(HTMLParser):
    """Visible text with a newline at every block element; scripts and styles are dropped."""

    BLOCK = frozenset(
        {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "table"}
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _TextFromHTML()
    p.feed(html)
    return "".join(p.parts)


def pdf_to_text(
    path: Path, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run
) -> str:
    """Text of a PDF via poppler's ``pdftotext`` (reading order, not ``-layout``)."""
    if runner is subprocess.run and not shutil.which("pdftotext"):
        raise SystemExit("pdftotext (poppler-utils) is required for PDF input")
    res = runner(
        ["pdftotext", "-enc", "UTF-8", str(path), "-"], capture_output=True, text=True, check=True
    )
    return res.stdout


def read_source(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return pdf_to_text(path)
    raw = path.read_text(encoding="utf-8", errors="replace")
    return html_to_text(raw) if suffix in (".html", ".htm") else raw


def clean_lines(text: str, profile: Profile) -> list[str]:
    """Strip page noise: profile patterns plus short lines repeated as running headers."""
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.replace("\f", "\n").splitlines()]
    lines = [ln for ln in lines if ln]
    counts = Counter(lines)
    out = []
    for ln in lines:
        if any(r.match(ln) for r in profile.noise_res):
            continue
        # A short line seen 3+ times that is not a heading is a running header ("Contracts").
        if (
            counts[ln] >= 3
            and len(ln) <= 40
            and not profile.section_re.match(ln)
            and not profile.part_re.match(ln)
        ):
            continue
        out.append(ln)
    return out


# ----------------------------------------------------------------------------- lines → sections
def _num_key(num: str) -> tuple[int, str]:
    m = re.match(r"(\d+)([A-Z]*)", num)
    return (int(m.group(1)), m.group(2)) if m else (0, "")


def _body_start(lines: list[str], profile: Profile) -> int:
    """Index of the first operative line: after the enacting formula, else at the last "1." heading.

    Reprints open with an arrangement of sections ("1. Short title", "2. Interpretation", ...),
    so the first "1." is usually the table of contents, not the Act.
    """
    for i, ln in enumerate(lines):
        if profile.enacting_re.match(ln):
            return i + 1
    ones = [
        i
        for i, ln in enumerate(lines)
        if (m := profile.section_re.match(ln)) and m.group("num") == "1"
    ]
    if not ones:
        return 0
    has_arrangement = any(
        ln.upper().startswith("ARRANGEMENT OF SECTIONS") for ln in lines[: ones[0]]
    )
    # Keep the marginal note just above "1." (e.g. "Short title") in the operative text.
    first = ones[1] if has_arrangement and len(ones) > 1 else ones[0]
    return first - 1 if first > 0 and _looks_like_title(lines[first - 1], profile) else first


def _looks_like_title(line: str, profile: Profile) -> bool:
    return (
        len(line) <= 120
        and not line.endswith((".", ";", ":", ",", "—", "-"))
        and not profile.section_re.match(line)
        and not profile.subsection_re.match(line)
        and not line.startswith("(")
    )


def split_sections(text: str, profile: Profile) -> list[dict]:
    """Return [{'num', 'title', 'part', 'body'}] for the operative sections, in order.

    A heading is accepted only if its number does not go backwards and does not jump ahead by
    more than ``10``, so numbered lists inside a section ("1. the buyer ...") are not taken for
    headings. The short line just before a heading is its marginal note (title).
    """
    lines = clean_lines(text, profile)
    start = _body_start(lines, profile)
    sections: list[dict] = []
    preamble: list[str] = []
    part = ""
    pending_part = False
    prev: tuple[int, str] | None = None
    for ln in lines[start:]:
        if profile.schedule_re.match(ln):
            break
        if profile.part_re.match(ln):
            part, pending_part = ln, True
            continue
        if pending_part:
            part, pending_part = f"{part} — {ln}", False
            continue
        m = profile.section_re.match(ln)
        if m:
            key = _num_key(m.group("num"))
            if prev is None or (prev <= key and key[0] - prev[0] <= 10 and key != prev):
                title = ""
                above = sections[-1]["body"] if sections else preamble
                if above and _looks_like_title(above[-1], profile):
                    title = above.pop()
                sections.append(
                    {
                        "num": m.group("num"),
                        "title": title,
                        "part": part,
                        "body": [m.group("rest") or ""],
                    }
                )
                prev = key
                continue
        (sections[-1]["body"] if sections else preamble).append(ln)
    for s in sections:
        s["body"] = "\n".join(s["body"]).strip()
    return sections


def split_subsections(body: str, profile: Profile) -> list[tuple[str, str]]:
    """[(label, text)]: ``("(1)", ...)`` per subsection, or ``[("", body)]`` when there are none.

    Paragraphs ("(a)", "(i)") stay inside their subsection. Text before the first "(1)" is kept
    as an unnumbered lead-in chunk. Numbers must run in order ("(1)", "(2)", "(2A)", "(3)"), so a
    wrapped line that happens to start with "(2)" in a cross-reference is not taken for a
    subsection.
    """
    out: list[tuple[str, str]] = []
    cur_label, cur = "", []
    last: tuple[int, str] | None = None
    for ln in body.split("\n"):
        m = profile.subsection_re.match(ln)
        key = _num_key(m.group("num")) if m else None
        if key and (
            (last is None and key == (1, ""))
            or (
                last is not None
                and (key[0] == last[0] + 1 or (key[0] == last[0] and key[1] > last[1]))
            )
        ):
            last = key
            if cur and any(c.strip() for c in cur):
                out.append((cur_label, " ".join(cur).strip()))
            cur_label, cur = f"({m.group('num')})", [ln[m.end() :]]
        else:
            cur.append(ln)
    if cur and any(c.strip() for c in cur):
        out.append((cur_label, " ".join(cur).strip()))
    return out or [("", body.strip())]


def _split_long(text: str, max_chars: int) -> list[str]:
    """Split on sentence boundaries so no chunk exceeds ``max_chars`` (hard cut as last resort)."""
    if len(text) <= max_chars:
        return [text]
    pieces = re.split(r"(?<=[.;:])\s+(?=\(?[A-Za-z0-9])", text)
    chunks, cur = [], ""
    for p in pieces:
        while len(p) > max_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(p[:max_chars])
            p = p[max_chars:]
        if cur and len(cur) + 1 + len(p) > max_chars:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        chunks.append(cur)
    return chunks


def _article_no(section: str) -> str:
    """``17A`` → ``17-a`` (ingest_pipeline.ARTICLE_NO_RE accepts ``\\d+(-[a-z]+)?``)."""
    n, suffix = _num_key(section)
    return f"{n}-{suffix.lower()}" if suffix else str(n)


def build_rows(
    text: str,
    profile: Profile,
    *,
    law_name: str,
    act_no: str = "",
    source_url: str = "",
    as_at: str | None = None,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[dict]:
    """Map an Act's text to staged rows (see the module docstring for the schema)."""
    host = re.sub(r"^https?://([^/]+).*$", r"\1", source_url or "").lower()
    tier = "official" if host and host in profile.source_tier_hosts else "unofficial"
    year = re.search(r"\b(1[89]\d\d|20\d\d)\b", law_name)
    rows: list[dict] = []
    for sec in split_sections(text, profile):
        repealed = bool(profile.repealed_re.match(sec["body"]))
        for sub_label, sub_text in split_subsections(sec["body"], profile):
            citation = profile.citation(law_name, act_no, sec["num"], sub_label)
            label = f"Section {sec['num']}{sub_label}"
            head = f"{citation} — {sec['title']}" if sec["title"] else citation
            for idx, chunk in enumerate(_split_long(sub_text, max_chars)):
                rows.append(
                    {
                        "jurisdiction": profile.jurisdiction,
                        "law_name": law_name,
                        "act_no": act_no,
                        "law_type": "STATUTE",
                        "article_no": _article_no(sec["num"]),
                        "article_label": label if idx == 0 else f"{label} [part {idx + 1}]",
                        "section": sec["num"],
                        "subsection": sub_label,
                        "section_title": sec["title"],
                        "part": sec["part"],
                        "citation": citation,
                        "approval_date": year.group(1) if year else None,
                        "as_at": as_at,
                        "status": "REPEALED" if repealed else "VALID",
                        "is_active": not repealed,
                        "authentic": False,
                        "source_url": source_url or None,
                        "source_tier": tier,
                        "source": f"{profile.jurisdiction} act_ingest",
                        "chunk_index": idx,
                        "text": f"{head}: {chunk}",
                    }
                )
    return rows


def load_pilot(path: Path = MY_ALLOWLIST) -> list[dict]:
    return json.loads(Path(path).read_text(encoding="utf-8")).get("laws", [])


# ----------------------------------------------------------------------------- CLI
def _parse(args: argparse.Namespace) -> int:
    profile = PROFILES[args.profile]
    text = read_source(args.input)
    rows = build_rows(
        text,
        profile,
        law_name=args.law_name,
        act_no=args.act_no,
        source_url=args.source_url,
        as_at=args.as_at,
        max_chars=args.max_chars,
    )
    sections = Counter(r["section"] for r in rows)
    report = {
        "input": str(args.input),
        "law_name": args.law_name,
        "rows": len(rows),
        "sections": len(sections),
        "repealed_rows": sum(1 for r in rows if not r["is_active"]),
        "source_tier": rows[0]["source_tier"] if rows else None,
    }
    if not rows:
        print(json.dumps({**report, "error": "no sections found"}), file=sys.stderr)
        return 1
    if args.dry_run or not args.out:
        print(json.dumps({**report, "dry_run": True}, ensure_ascii=False))
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({**report, "out": str(args.out)}, ensure_ascii=False))
    return 0


def _pilot(_args: argparse.Namespace) -> int:
    for i, law in enumerate(load_pilot(), start=1):
        print(f"{i:2d}. {law['name']} [{law['act_no']}] — {law['practice_area']} ({law['status']})")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    pp = sub.add_parser("parse", help="split one local Act file into staged JSONL rows")
    pp.add_argument("input", type=Path)
    pp.add_argument("--profile", choices=sorted(PROFILES), default="malaysia")
    pp.add_argument("--law-name", required=True)
    pp.add_argument("--act-no", default="")
    pp.add_argument("--source-url", default="")
    pp.add_argument("--as-at", default=None, help="date the online text is updated to (cover page)")
    pp.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    pp.add_argument("--out", type=Path)
    pp.add_argument("--dry-run", action="store_true")
    pp.set_defaults(func=_parse)
    sub.add_parser("pilot", help="list the 20 pilot Acts").set_defaults(func=_pilot)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
