"""Stage the owner's 2026-10-13 legal batch: deregulation-board resolutions + CBI circulars (+ one OCR'd law).

Offline, untrusted input (PDF text extracted with ``pdftotext`` / ``tesseract`` beforehand by the caller;
this module only reads text files, so it can be unit-tested with inline fixtures).

Subcommands
  deregulation  --out F  TXT...     qavanin print versions of هیئت مقررات‌زدایی resolutions (pdftotext plain)
  circulars     --out F  --manifest M   M is a TSV: ocr_txt<TAB>header_txt<TAB>original_file_name
  ocr-law       --key K  --out F  OCR_TXT   qavanin print rendered as an image (no usable text layer)

Output rows are ``status = "proposed"``; nothing is written to a database.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

_PQ_PATH = Path(__file__).with_name("parse_qavanin_print.py")
_spec = importlib.util.spec_from_file_location("parse_qavanin_print", _PQ_PATH)
pq = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("parse_qavanin_print", pq)
_spec.loader.exec_module(pq)

CHUNK_CHARS = 1500
CBI = "بانک مرکزی جمهوری اسلامی ایران"
SESSIONS = {"نود و یکمین": 91, "نود و دومین": 92, "نود و سومین": 93, "نود و چهارمین": 94}
_LETTERS = "الف|ب|پ|ت|ث|ج|چ|ح|خ|د|ذ|ر|ز|ژ|س|ش|ص|ض|ط|ظ|ع|غ|ف|ق|ک|گ|ل|م|ن|و|ه|ی"
_HEAD_RE = re.compile(rf"^({_LETTERS})\s*[-–—]\s*(\S.*)$")
_ITEM_RE = re.compile(r"^\.\s*(\d+)\s*(.*)$")
_DATE_RE = re.compile(r"(?<!\d)(1[34]\d\d)/(\d{1,2})/(\d{1,2})(?!\d)")


def _iso(m: re.Match) -> str:
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


# ----------------------------------------------------------------------------- group B
def parse_deregulation(raw: str, source_file: str) -> tuple[list[dict], dict]:
    """One row per numbered resolution item (.N) under its lettered heading (الف - ..)."""
    lines, ids = pq.strip_chrome(pq.clean_pdf_text(raw))
    lines = [pq.normalise_text(ln) for ln in lines if ln.strip()]
    title = next((ln for ln in lines if ln.startswith("مصوبات")), "")
    session = next((n for k, n in SESSIONS.items() if k in title), None)
    approved = _DATE_RE.search(title)
    meeting = re.search(r"جلسه\s*مورخ\s*(1[34]\d\d)/(\d{1,2})/(\d{1,2})", " ".join(lines[:30]))
    items: list[dict] = []
    heading_letter = heading = None
    cur: dict | None = None
    head_item: dict | None = None  # body text that follows a heading with no numbered items (a whole-heading resolution)
    pending_heading = False
    started = False

    def drop_empty_head() -> None:
        nonlocal head_item
        if head_item is not None and not head_item["text"]:
            items.remove(head_item)
        head_item = None

    for ln in lines:
        if ln.startswith("معاونت تدوین") or "Qavanin.ir" in ln:
            break
        hm = _HEAD_RE.match(ln)
        im = _ITEM_RE.match(ln)
        if hm and not im and len(ln) < 140:
            drop_empty_head()
            heading_letter, heading = hm.group(1), hm.group(2)
            pending_heading, started = True, True
            head_item = cur = {"heading_letter": heading_letter, "subject": heading, "item_no": 0, "text": "", "flags": set()}
            items.append(cur)
            continue
        if not started and not im:
            continue
        if im:
            started = True
            num, body = int(im.group(1)), im.group(2)
            sub = (
                cur is not None
                and cur is not head_item
                and len(ln) < 70
                and re.search(r"ذیل|زیر|شرح", cur["text"])
                and not re.search(r"مکلف|می‌شود|می شود|رسید", ln)
            )
            if sub:
                cur["text"] += f" {num}. {body}".rstrip()
                cur["flags"].add("sublist_merged")
                continue
            drop_empty_head()
            pending_heading = False
            cur = {"heading_letter": heading_letter, "subject": heading, "item_no": num, "text": body, "flags": set()}
            items.append(cur)
            continue
        if pending_heading and head_item is not None and len(ln) <= 60 and not ln.startswith("پیرو"):
            head_item["subject"] = f"{head_item['subject']} {ln}"
            heading = head_item["subject"]
            continue
        pending_heading = False
        if cur is not None:
            cur["text"] = f"{cur['text']} {ln}".strip()
    drop_empty_head()
    rows: list[dict] = []
    seen: dict[tuple, int] = {}
    for it in items:
        key = (it["heading_letter"], it["item_no"])
        seen[key] = seen.get(key, 0) + 1
    for i, it in enumerate(items):
        subject = it["subject"]
        rows.append(
            {
                "doc_id": f"deregulation_board_session_{session}",
                "doc_type": "board_resolution",
                "issuer": "هیئت مقررات‌زدایی و بهبود محیط کسب و کار",
                "session": session,
                "session_title": title.split(" -")[0].strip() if title else None,
                "approved_on": _iso(approved) if approved else None,
                "meeting_date": f"{meeting.group(1)}-{int(meeting.group(2)):02d}-{int(meeting.group(3)):02d}"
                if meeting
                else None,
                "heading_letter": it["heading_letter"],
                "subject": subject,
                "item_no": str(it["item_no"]) if it["item_no"] else None,
                "item_label": (f"بند {it['heading_letter']} - {it['item_no']}" if it["item_no"] else f"بند {it['heading_letter']}")
                if it["heading_letter"]
                else str(it["item_no"]),
                "chunk_index": i,
                "text": it["text"],
                "source": "qavanin",
                "source_tier": "official",
                "source_label": pq.SOURCE_LABEL,
                "qavanin_ids": ids,
                "source_file": source_file,
                "needs_review": bool(it["flags"]) or seen[(it["heading_letter"], it["item_no"])] > 1,
                "review_reasons": sorted(it["flags"])
                + (["duplicate_item_number_under_heading"] if seen[(it["heading_letter"], it["item_no"])] > 1 else []),
                "status": "proposed",
            }
        )
    return rows, {"session": session, "items": len(rows), "approved_on": rows[0]["approved_on"] if rows else None}


# ----------------------------------------------------------------------------- group C
_NOISE_RE = re.compile(r"^[^آ-ی]*$")


def _letter_ratio(s: str) -> float:
    core = re.sub(r"\s", "", s)
    return len(re.findall(r"[آ-ی]", core)) / len(core) if core else 0.0


def header_meta(header_text: str) -> dict:
    """Number/date from the (reliable) text layer of page 1 of a CBI circular."""
    t = pq.clean_pdf_text(header_text.split("\f")[0])
    head = "\n".join(t.split("\n")[:60])
    num = re.search(r"(?<![\d/])(\d{2}/\d{3,8})(?![\d/])", head)
    dm = _DATE_RE.search(head)
    return {"number": num.group(1) if num else None, "date": _iso(dm) if dm else None}


def circular_body(ocr_text: str) -> str:
    text = ocr_text.replace("\f", "\n")
    lines = [ln.strip() for ln in text.split("\n")]
    start = next((i for i, ln in enumerate(lines) if re.match(r"^با ?س(?:ال|ل)ام", ln)), None)
    if start is None:
        start = next((i for i, ln in enumerate(lines) if "ارسال می" in ln and "شود" in ln), -1)
    lines = lines[start + 1 :] if start is not None else lines
    for i in range(len(lines) - 1, max(len(lines) - 12, -1), -1):
        if lines[i].startswith("اداره مطالعات و مقررات"):
            lines = lines[:i]
            break
    keep = [ln for ln in lines if ln and not (len(ln) < 40 and _letter_ratio(ln) < 0.5)]
    return "\n".join(keep)


def subject_of(body: str) -> str:
    head = " ".join(body.split("\n"))[:600]
    m = re.search(r"ابلاغ\s*[«»\"']+\s*([^«»\"']{6,160}?)\s*[«»\"']", head)
    if m:
        return pq.normalise_text(m.group(1))
    head = re.sub(r"^\s*(با ?س(?:ال|ل)ام\s*[؛;]?\s*)?(احتر\S*\s*[؛;]?\s*)?", "", pq.normalise_text(head))
    out = ""
    for sent in re.split(r"(?<=[.؛])\s", head):
        out = f"{out} {sent}".strip()
        if len(out) >= 40:
            break
    return out[:200]


_BLOCK_START = re.compile(r"^(ماده|تبصره|بند|فصل|مبحث)\b|^\(?\d+(?:[-–.]\d+)*\s*[-–.)]|^[آ-ی]{1,3}\s*[-–)]\s")


def chunk_text(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Pack paragraphs (a new one starts at ماده/تبصره/بند/numbered lines) into chunks of at most ``size`` chars."""
    blocks: list[str] = []
    for ln in text.split("\n"):
        ln = ln.strip()
        if not ln:
            continue
        if not blocks or _BLOCK_START.match(ln):
            blocks.append(ln)
        else:
            blocks[-1] = f"{blocks[-1]} {ln}"
    pieces: list[str] = []
    for b in blocks:
        while len(b) > size:
            cut = max(b.rfind(". ", 0, size), b.rfind("؛ ", 0, size), b.rfind(" ", 0, size))
            cut = cut + 1 if cut > size // 3 else size
            pieces.append(b[:cut].strip())
            b = b[cut:].strip()
        if b:
            pieces.append(b)
    chunks: list[str] = []
    for p in pieces:
        if chunks and len(chunks[-1]) + 1 + len(p) <= size:
            chunks[-1] = f"{chunks[-1]}\n{p}"
        else:
            chunks.append(p)
    return chunks


def circular_rows(ocr_text: str, header_text: str, source_file: str) -> tuple[list[dict], dict]:
    meta = header_meta(header_text)
    body = pq.normalise_text(circular_body(ocr_text))
    chunks = chunk_text(body)
    subject = subject_of(body)
    doc_id = "cbi_" + (meta["number"] or "unknown").replace("/", "_")
    rows = [
        {
            "doc_id": doc_id,
            "doc_type": "circular",
            "issuer": CBI,
            "number": meta["number"],
            "date": meta["date"],
            "subject": subject,
            "chunk_index": i,
            "chunk_count": len(chunks),
            "text": c,
            "source_file": source_file,
            "source": "owner_upload_cbi_circular",
            "text_extraction": "ocr_tesseract_fas",
            "needs_review": True,
            "review_reasons": ["ocr_source", "subject_heuristic"],
            "status": "proposed",
        }
        for i, c in enumerate(chunks)
    ]
    return rows, {**meta, "doc_id": doc_id, "chunks": len(chunks), "chars": len(body), "subject": subject}


# ----------------------------------------------------------------------------- OCR'd law
def ocr_law_rows(key: str, ocr_text: str, source_file: str):
    """qavanin print rendered as an image: drop OCR'd page chrome and the closing paragraph, then parse."""
    kept = []
    for ln in ocr_text.replace("\f", "\n").split("\n"):
        if re.match(r"^\d{1,3}\s*,\s*\d{1,2}/\d{1,2}/\d{2,4}", ln.strip()):
            continue
        if re.match(r"^این قانون که مشتمل", ln.strip()) and kept:
            break
        kept.append(ln)
    rows, rep, report = pq.parse_law(key, "\n".join(kept), source_url=f"owner_upload:{source_file}")
    for r in rows + rep:
        r["needs_review"] = True
        r["review_reasons"] = [*r["review_reasons"], "ocr_source"]
        r["source_label"] = pq.SOURCE_LABEL + " (OCR)"
    return rows, rep, report


# ----------------------------------------------------------------------------- CLI
def _write(path: Path, rows: list[dict]) -> None:
    if path.exists():
        raise SystemExit(f"refusing to overwrite {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("deregulation")
    d.add_argument("--out", type=Path, required=True)
    d.add_argument("txt", nargs="+", help="path[=original name]")
    c = sub.add_parser("circulars")
    c.add_argument("--out", type=Path, required=True)
    c.add_argument("--manifest", type=Path, required=True)
    o = sub.add_parser("ocr-law")
    o.add_argument("--key", required=True)
    o.add_argument("--out", type=Path, required=True)
    o.add_argument("--source-name", required=True)
    o.add_argument("txt", type=Path)
    args = ap.parse_args(argv)
    if args.cmd == "deregulation":
        allrows, reports = [], []
        for spec in args.txt:
            path, _, name = spec.partition("=")
            rows, rpt = parse_deregulation(Path(path).read_text(encoding="utf-8"), name or Path(path).name)
            allrows += rows
            reports.append(rpt)
        _write(args.out, allrows)
        print(json.dumps(reports, ensure_ascii=False))
    elif args.cmd == "circulars":
        allrows, reports = [], []
        for ln in args.manifest.read_text(encoding="utf-8").splitlines():
            ocr, header, name = ln.split("\t")
            rows, rpt = circular_rows(Path(ocr).read_text(encoding="utf-8"), Path(header).read_text(encoding="utf-8"), name)
            allrows += rows
            reports.append({**rpt, "source_file": name})
        _write(args.out, allrows)
        print(json.dumps(reports, ensure_ascii=False))
    else:
        rows, rep, report = ocr_law_rows(args.key, args.txt.read_text(encoding="utf-8"), args.source_name)
        _write(args.out, rows + rep)
        print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
