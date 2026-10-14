"""Parse a qavanin.ir "print version" (PrintText) into staged article rows.

qavanin.ir is the official consolidated-law portal of the Presidency legal deputy.  The owner saves
print versions as PDF; this tool turns the text layer into JSONL rows that follow the schema of
scripts/legal/fetch_nezamat_wp.py (data/legal/staged/coverage_nezamat_*.jsonl), with
source="qavanin", source_tier="official", staging_status="proposed".

Input handling (untrusted data, no network, nothing executed):
  * ``.pdf``  -> ``pdftotext`` (plain mode, which keeps Persian logical order) into memory.
  * ``.txt``  -> read as is.
  Page chrome (browser header/footer, URL, timestamp, "Page n of m") is removed.  Arabic
  presentation forms are folded with NFKC.

Recognised article headers (after NFKC; bidi garbling of the PDF is tolerated):
  ``ماده N -``, ``ماده N (اصلاحي dd/mm/yyyy)-``, ``ماده ) Nاصلاحي -(date)`` (what the PDF yields),
  ``(الحاقي ...)``, ``(منسوخه ...)``, ``ماده N مکرر``.  تبصره lines (also with notes) stay attached to
  their article.  A repealed article goes to the ``.repealed.jsonl`` side file; a repealed تبصره is
  removed from the active text and kept in ``repealed_parts``.

Duplicate numbering: some laws contain two sequences (e.g. the 1347 joint-stock bill articles 1-300
inserted inside the 1311 commercial law).  Every row carries a ``section`` key (None when the law has
a single sequence) and uniqueness is ``(section, article_label)``.  Sections are switched by lines that
match ``--section REGEX=KEY`` (repeatable) or the ``sections`` entry of a LAWS config.

Usage:
  python3 -I scripts/legal/parse_qavanin_print.py \
      --job ecommerce=/path/print.pdf --job direct_tax=/path/other.pdf \
      --out data/legal/staged/qavanin_2026-10-13.jsonl
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

SOURCE_LABEL = "قوانین و مقررات کشور (qavanin.ir) - معاونت حقوقی ریاست جمهوری - نسخه چاپی"

LAWS: dict[str, dict] = {
    "ecommerce": {
        "law_id": "qavanin_ecommerce_1382",
        "law_name": "قانون تجارت الکترونیکی",
        "law_type": "COMMERCIAL",
        "category": "E_COMMERCE",
        "scope_tags": ["e-commerce", "consumer"],
        "approval_date": "1382-10-17",
        "sections": [],
    },
    "direct_tax": {
        "law_id": "qavanin_direct_tax_1366",
        "law_name": "قانون مالیات\u200cهای مستقیم",
        "law_type": "TAX",
        "category": "TAX",
        "scope_tags": ["tax"],
        "approval_date": "1366-12-03",
        "sections": [],
    },
    "third_party_insurance": {
        "law_id": "qavanin_third_party_insurance_1395",
        "law_name": "قانون بیمه اجباری خسارات وارد شده به شخص ثالث در اثر حوادث ناشی از وسایل نقلیه",
        "law_type": "INSURANCE",
        "category": "INSURANCE",
        "scope_tags": ["insurance", "traffic"],
        "approval_date": "1395-02-20",
        "sections": [],
    },
    "industrial_property": {
        "law_id": "qavanin_industrial_property_1403",
        "law_name": "قانون حمایت از مالکیت صنعتی",
        "law_type": "COMMERCIAL",
        "category": "INTELLECTUAL_PROPERTY",
        "scope_tags": ["intellectual-property", "patent", "trademark"],
        "approval_date": "1403-03-01",
        "sections": [],
    },
    "insurance_1316": {
        "law_id": "qavanin_insurance_1316",
        "law_name": "قانون بیمه",
        "law_type": "INSURANCE",
        "category": "INSURANCE",
        "scope_tags": ["insurance"],
        "approval_date": "1316-02-07",
        "sections": [],
    },
}

# ----------------------------------------------------------------------------- normalisation
_BIDI_RE = re.compile("[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]")
_DIAC_RE = re.compile("[\u064b-\u065f\u0670]")
_TRANS = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يكھۀ",
    "01234567890123456789یکهه",
)
_DIGITS_ONLY = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def clean_pdf_text(raw: str) -> str:
    """NFKC (Arabic presentation forms -> letters), drop bidi controls, ASCII digits. Keeps Arabic yeh/kaf."""
    t = unicodedata.normalize("NFKC", raw)
    t = _BIDI_RE.sub("", t)
    return t.translate(_DIGITS_ONLY).replace("\u06be", "\u0647")  # ھ (font artefact) -> ه


def normalise_text(raw: str) -> str:
    """House style used by the corpus: Persian yeh/kaf, ASCII digits, no bidi marks/diacritics, tidy spaces."""
    t = _BIDI_RE.sub("", unicodedata.normalize("NFKC", raw))
    t = _DIAC_RE.sub("", t).translate(_TRANS)
    t = re.sub(r"[ \t\u00a0]+", " ", t)
    t = re.sub(r" +([،؛:.؟!])", r"\1", t)
    t = re.sub(r"([،؛])(?=[^\s\d])", r"\1 ", t)
    t = re.sub(r"(?<=\d)(?=[آ-ی])|(?<=[آ-ی])(?=\d)", " ", t)  # "825.000.000ریال" -> "825.000.000 ریال"
    t = re.sub(r"»([^«»]*)«", r"«\1»", t)  # the PDF mirrors guillemets
    t = re.sub(r"(?m)^(\S{1,3}) «\s*-\s*", r"\1 - «", t)  # "الف « -x»" -> "الف - «x»"
    t = re.sub(r"\) ?:\(([A-Za-z][A-Za-z ]*)(?=[^A-Za-z ]|$)", r" (\1): ", t)
    t = re.sub(r"(?<=\S)  +", " ", t)  # ") :(Data Message" -> "(Data Message):"
    t = re.sub(r"(?<=\S) (ها|های)(?=[\s،؛:.؟!)»]|$)", "\u200c\\1", t)  # "واسط های" -> "واسط‌های"
    t = re.sub(r"(?<![آ-ی])(نمی|می) (?=[آ-ی])", "\\1\u200c", t)  # "می شود" -> "می‌شود"
    return "\n".join(ln.strip() for ln in t.split("\n")).strip()


def search_form(raw: str) -> str:
    """Search field: normalised text, ZWNJ/tatweel folded, punctuation light, single spaces."""
    t = normalise_text(raw).replace("\u200c", " ").replace("\u0640", "")
    t = re.sub(r"[«»\"'()\[\]{}:؛؟،,.;!?\-–—_]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ----------------------------------------------------------------------------- page chrome
_TS_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4},\s*\d{1,2}:\d{2}\s*[AP]M$")
_URL_RE = re.compile(r"^=?https?://qavanin\.ir/\S*$")
_PAGE_RE = re.compile(r"^Page\s+\d+\s+of\s+\d+$")
_IDS_RE = re.compile(r"IDS=(\d+)")
_END_RE = re.compile(r"^(قانون فوق مشتمل|رئیس مجلس|معاونت تدوین|مصوب جلسه علنی|اصلاحات و الحاقات)")


def strip_chrome(text: str) -> tuple[list[str], str | None]:
    """Return (content lines, qavanin IDS) with browser header/footer lines removed."""
    ids = None
    out: list[str] = []
    pages_all = text.split("\f")
    seen: dict[str, int] = {}
    for page in pages_all:
        for ln in {x.strip() for x in page.split("\n") if len(x.strip()) > 10}:
            seen[ln] = seen.get(ln, 0) + 1
    repeated = {ln for ln, c in seen.items() if c >= max(3, len(pages_all) // 2)}  # running page title
    for page in pages_all:
        lines = [ln.strip() for ln in page.split("\n")]
        nonempty = [i for i, ln in enumerate(lines) if ln]
        if len(nonempty) >= 2:
            first, second = nonempty[0], nonempty[1]
            if _URL_RE.match(lines[second]) or _TS_RE.match(lines[second]):
                lines[first] = ""  # garbled page title, e.g. the print-view heading
        for ln in lines:
            m = _IDS_RE.search(ln)
            if m and ids is None:
                ids = m.group(1)
            if _TS_RE.match(ln) or _URL_RE.match(ln) or _PAGE_RE.match(ln) or ln in repeated:
                continue
            out.append(ln)
    return out, ids


# ----------------------------------------------------------------------------- line classifiers
_KW = r"(اصلاحي|اصلاحی|الحاقي|الحاقی|منسوخه|منسوخ|جایگزین)"
_DATE = r"(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})"
_NOTE_RE = re.compile(rf"^[\s\-–()]*{_KW}[\s\-–()]*(?:{_DATE})?[\s\-–()]*")
_ART_RE = re.compile(r"^م?اده\s*([\s\-–)(»«]*?)\s*(\d+)(\s*مکرر)?\s*(.*)$")
_TBS_RE = re.compile(r"^تبصره\s*(.*)$")
_HEAD_RE = re.compile(r"^(باب|مبحث|فصل|بخش|قسمت)\s+\S+(?:\s+\S+)?\s*[-–—:]\s*\S.{0,100}$")
_ITEM_RE = re.compile(r"^(?:[آ-ی\u0640]{1,3}\s*[»«]?\s*[-–]|[-–]\s*\d+|\d+\s*[-–])")
_LEVEL = {"باب": 0, "قسمت": 0, "بخش": 0, "مبحث": 1, "فصل": 2}

_REF_RUN_RE = re.compile(r"\)\s*\(\d+(?:\)\s*،\s*\(\d+)*\s*و\s*\)?\s*\(\d+")
_REF_ONE_RE = re.compile(r"\)\s*\((\d+)(?=[^\d\s)،])")


def parse_notes(rest: str) -> tuple[list[dict], str]:
    """Consume leading ``(اصلاحي date)`` style notes; return (notes, remaining text)."""
    notes: list[dict] = []
    while True:
        m = _NOTE_RE.match(rest)
        if not m:
            break
        kind = {"اصلاحي": "اصلاحی", "الحاقي": "الحاقی"}.get(m.group(1), m.group(1))
        date = f"{int(m.group(2)):04d}-{int(m.group(3)):02d}-{int(m.group(4)):02d}" if m.group(2) else None
        notes.append({"kind": kind, "date": date})
        rest = rest[m.end() :]
    return notes, rest.lstrip(" -–)")


def repair_refs(text: str) -> tuple[str, bool]:
    """pdftotext emits bidi-reversed parenthesised article refs: ``) (36) ،(35) ،(33و ) (37``.
    Restore them to ``(33)، (35)، (36) و (37)``.  Returns (text, changed)."""
    changed = False

    def run(m: re.Match) -> str:
        nums = re.findall(r"\d+", m.group(0))
        head = [f"({n})" for n in reversed(nums[:-1])]
        return "، ".join(head) + f" و ({nums[-1]}) "

    new = _REF_RUN_RE.sub(run, text)
    changed |= new != text
    one = _REF_ONE_RE.sub(lambda m: f"({m.group(1)}) ", new)
    changed |= one != new
    return re.sub(r" {2,}", " ", one).strip(), changed


# ----------------------------------------------------------------------------- parser
def _new_article(no, label_suffix, notes, section, chapter):
    return {
        "no": no + (" مکرر" if label_suffix else ""),
        "notes": notes,
        "section": section,
        "chapter": chapter,
        "paras": [],
    }


def _new_para(kind: str, num: str | None = None, notes=None, text: str = "") -> dict:
    return {"kind": kind, "num": num, "notes": notes or [], "text": text}


def split_articles(lines: list[str], sections: list[tuple[str, str]]) -> list[dict]:
    """Walk the content lines and group them into articles with paragraphs."""
    arts: list[dict] = []
    cur: dict | None = None
    para: dict | None = None
    heads: dict[int, str] = {}
    section = None
    for ln in lines:
        if not ln:
            continue
        if arts and _END_RE.match(ln):
            break
        for rx, key in sections:
            if re.search(rx, ln):
                section = key
        m = _ART_RE.match(ln)
        if m:
            rest = m.group(4)
            notes, body = parse_notes(rest)
            if notes or re.search(r"[-–]", m.group(1)) or rest.lstrip().startswith(("-", "–")):
                body = body.lstrip(" -–")
                if "»" in m.group(1) and not notes:
                    body = "»" + body  # opening guillemet got glued to the header by the bidi mirroring
                chapter = " / ".join(heads[k] for k in sorted(heads))
                cur = _new_article(m.group(2), m.group(3), notes, section, chapter or None)
                arts.append(cur)
                para = _new_para("body", text=body)
                cur["paras"].append(para)
                continue
        if cur is None:
            hm = _HEAD_RE.match(ln)
            if hm:
                heads[_LEVEL[hm.group(1)]] = normalise_text(ln)
            continue
        hm = _HEAD_RE.match(ln)
        if hm and len(ln) < 110:
            lvl = _LEVEL[hm.group(1)]
            heads = {k: v for k, v in heads.items() if k < lvl}
            heads[lvl] = normalise_text(ln)
            para = None
            continue
        tm = _TBS_RE.match(ln)
        if tm:
            notes, rest = parse_notes(tm.group(1))
            nm = re.match(r"^\s*(?:[-–]\s*)?(\d+)?\s*[-–]?\s*(.*)$", rest)
            para = _new_para("tabsare", nm.group(1), notes, nm.group(2))
            cur["paras"].append(para)
            continue
        if para is not None and not _ITEM_RE.match(ln):
            para["text"] = f"{para['text']} {ln}".strip()
        else:
            para = _new_para("item", text=ln)
            cur["paras"].append(para)
    return arts


def _fmt_note(n: dict) -> str:
    d = n["date"].replace("-", "/") if n["date"] else ""
    return f"[{n['kind']} {d}]".replace(" ]", "]")


def build_rows(law: dict, arts: list[dict], source_url: str, ids: str | None, fetched_at: str):
    rows: list[dict] = []
    repealed: list[dict] = []
    for art in arts:
        notes = list(art["notes"])
        no = art["no"]
        label = f"ماده {no}"
        parts, repealed_parts = [], []
        flagged = glitch = False
        for p in art["paras"]:
            body, ch = repair_refs(p["text"])
            flagged |= ch
            glitch |= bool(re.search(r"\d\.\d{3} \d{3}(?!\d)", body))
            is_rep = any(n["kind"] in ("منسوخه", "منسوخ") for n in p["notes"])
            notes += [n for n in p["notes"] if p["kind"] == "tabsare"]
            if p["kind"] == "tabsare":
                lead = f"تبصره {p['num']}-" if p["num"] else "تبصره-"
                body = f"{lead} {body}"
            if is_rep and p["kind"] == "tabsare":
                dt = next((n["date"] for n in p["notes"] if n["date"]), None)
                repealed_parts.append({"kind": "tabsare", "num": p["num"], "date": dt, "text": normalise_text(body)})
                continue
            if body:
                parts.append(body)
        art_repealed = any(n["kind"] in ("منسوخه", "منسوخ") for n in art["notes"])
        original = "\n\n".join(parts)
        text_body = normalise_text(original)
        note_strs = [_fmt_note(n) for n in notes if n["kind"] not in ("منسوخه", "منسوخ")]
        text = f"{label} {law['law_name']}: {text_body}"
        if note_strs:
            text += "\n\n" + "\n".join(dict.fromkeys(note_strs))
        dates = sorted(n["date"] for n in notes if n["date"] and n["kind"] != "منسوخه")
        row = {
            "law_id": law["law_id"],
            "law_name": law["law_name"],
            "law_type": law["law_type"],
            "article_no": no,
            "article_label": label,
            "section": art["section"],
            "chapter": normalise_text(art["chapter"]) if art["chapter"] else None,
            "amended_on": dates[-1] if dates else None,
            "approval_date": law["approval_date"],
            "status": "REPEALED" if art_repealed else "VALID",
            "is_active": not art_repealed,
            "source_url": source_url,
            "source": "qavanin",
            "source_tier": "official",
            "source_label": SOURCE_LABEL,
            "qavanin_ids": ids,
            "content_hash": hashlib.md5(text.encode("utf-8")).hexdigest(),
            "chunk_index": 0,
            "text": text,
            "text_original": f"{label}: {original}",
            "text_search": search_form(f"{label} {law['law_name']} {text_body}"),
            "title": f"{law['law_name']} - {label}",
            "category": law["category"],
            "scope_tags": law["scope_tags"],
            "amendment_notes": [{"kind": n["kind"], "date": n["date"]} for n in notes],
            "repealed_parts": repealed_parts,
            "needs_review": flagged or glitch,
            "review_reasons": (["pdf_bidi_reference_repair"] if flagged else [])
            + (["suspicious_number_in_source"] if glitch else []),
            "fetched_at": fetched_at,
            "staging_status": "proposed",
        }
        (repealed if art_repealed else rows).append(row)
    for target in (rows, repealed):
        for i, r in enumerate(target):
            r["chunk_index"] = i
    return rows, repealed


def find_duplicates(rows: list[dict]) -> list[str]:
    seen: set[tuple] = set()
    dup: list[str] = []
    for r in rows:
        k = (r["section"], r["article_label"])
        if k in seen:
            dup.append(f"{r['section']}|{r['article_label']}")
        seen.add(k)
    return dup


def load_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        res = subprocess.run(
            ["pdftotext", str(path), "-"], capture_output=True, check=True, timeout=300
        )
        return res.stdout.decode("utf-8", "replace")
    return path.read_text(encoding="utf-8")


def parse_law(key: str, raw: str, source_url: str | None = None, fetched_at: str | None = None,
              extra_sections: list[tuple[str, str]] | None = None):
    """Parse one law's print text -> (rows, repealed_rows, report)."""
    law = LAWS[key]
    lines, ids = strip_chrome(clean_pdf_text(raw))
    sections = [(rx, k) for rx, k in law.get("sections", [])] + (extra_sections or [])
    arts = split_articles(lines, sections)
    url = source_url or (f"https://qavanin.ir/Law/PrintText/?IDS={ids}" if ids else "https://qavanin.ir/")
    fetched_at = fetched_at or datetime.now(UTC).isoformat(timespec="seconds")
    rows, repealed = build_rows(law, arts, url, ids, fetched_at)
    report = {"rows": len(rows), "repealed_rows": len(repealed), "qavanin_ids": ids,
              "duplicate_keys": find_duplicates(rows + repealed),
              "needs_review": sum(r["needs_review"] for r in rows)}
    if not arts:
        report["error"] = "no_articles_found (PDF has no text layer for the law body?)"
    return rows, repealed, report


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--job", action="append", required=True, metavar="LAW=PATH",
                    help=f"law key ({', '.join(LAWS)}) = .pdf/.txt print version; repeatable")
    ap.add_argument("--section", action="append", default=[], metavar="REGEX=KEY",
                    help="line regex that switches the numbering section (repeatable)")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)
    if args.out.exists():
        print(f"refusing to overwrite {args.out}", file=sys.stderr)
        return 2
    extra = [tuple(s.rsplit("=", 1)) for s in args.section]
    all_rows, all_rep, report = [], [], {}
    for job in args.job:
        key, _, path = job.partition("=")
        if key not in LAWS:
            print(f"unknown law key {key}", file=sys.stderr)
            return 2
        rows, rep, rpt = parse_law(key, load_text(Path(path)), extra_sections=extra)
        report[key] = rpt
        all_rows += rows
        all_rep += rep
    for r in (all_rows, all_rep):
        for i, row in enumerate(r):
            row["chunk_index"] = i
    _write(args.out, all_rows)
    _write(args.out.with_suffix(".repealed.jsonl"), all_rep)
    args.out.with_name(args.out.stem + "_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 3 if any(r.get("error") or r["duplicate_keys"] for r in report.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
