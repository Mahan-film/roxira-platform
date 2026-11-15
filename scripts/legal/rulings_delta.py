#!/usr/bin/env python3
"""law_watch staged records -> NEW court-ruling rows for iran_rulings_v1 (delta since the last full crawl). No network, no LLM.

law_watch.py (owner's Mac, every 6 h) stages every ekhtebar post it sees; unity rulings arrive as `record_type=law_change`,
`change_type=unity_ruling` records, first as a short version and later (page edits) as a long one. This tool turns those
records into rows in the exact corpus schema of fetch_unity_rulings.py, minus everything the corpus already has:

  rulings_delta.py [--staged-dir DIR] [--extra FILE.jsonl ...] [--date YYYY-MM-DD] [--out-dir DIR] [--dry-run]

  * selects unity_ruling records of the Supreme Court (unity_supreme_court) and, best effort, of the Administrative Court
    General Board (admin_court_unity; needs a «شماره دادنامه» header, otherwise it is reported as skipped);
  * keeps the NEWEST modified_at version per post (older versions are only consulted for a bare holding when the newest
    one is truncated before its «ج) رأی» section: law_watch caps text at ~12000 chars);
  * Persian/Arabic digits -> ASCII in every field; number + date are parsed from the «رأی وحدت رویه شماره N - تاریخ» heading;
  * holding = text after the «ج) رأی وحدت رویه شماره N» heading; else the bare ruling text of a short version; else the
    excerpt (then `needs_review: true`; confident rows are `needs_review: false`, the corpus has all rows true);
  * dedupes by (issuing body, ruling type, number) against data/legal/staged/unity_rulings_*.jsonl and
    admin_court_board_rulings_*.jsonl (digits normalised there too; the output file itself is not counted, so reruns are idempotent);
  * writes data/legal/staged/unity_rulings_delta_<date>.jsonl (<date> = newest modified_at among the rows unless --date).

News posts that merely announce a ruling (no number in title or text) cannot become rows; they are listed in the summary so
a human knows a ruling is pending. Upsert: scripts/legal/upsert_rulings_delta_on_server.sh.
"""

# ruff: noqa: RUF001, RUF002
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGED = ROOT / "data/legal/staged"
CORPUS_GLOBS = ("unity_rulings_*.jsonl", "admin_court_board_rulings_*.jsonl")
ROW_KEYS = (
    "ruling_id", "ruling_type", "issuing_body", "number", "number_raw", "date", "date_iso", "case_number", "title", "subject",
    "holding", "text", "related_provisions_chars", "laws_referenced", "source", "source_url", "source_url_decoded", "post_id",
    "wp_date", "wp_modified", "source_tier", "needs_review", "is_active", "status", "fetched_at",
)  # fmt: skip


def _fu():
    name = "fetch_unity_rulings"
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/legal/fetch_unity_rulings.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


# ----------------------------------------------------------------------------- text helpers
def flat(text: str) -> str:
    """ASCII digits, unified letters, single spaces (comparison + storage form for delta rows)."""
    return re.sub(r"\s+", " ", _fu().norm(text)).strip()


def body_key(body: str) -> str:
    return flat(body).replace("هیئت", "هیات")


_SC_BODY = r"(?:هیات|هیئت)\s+عمومی\s+دیوان\s+عالی\s+کشور"
_SC_HEAD_RE = re.compile(
    rf"(?<!\) )رای\s+وحدت\s+رویه(?:\s+قضایی)?\s*(?:شماره)?\s*(?P<num>\d{{1,4}})\s*[-–—]?\s*(?P<date>\d{{4}}/\d{{1,2}}/\d{{1,2}})?\s*{_SC_BODY}"
)
_SC_TITLE_NUM_RE = re.compile(r"رای\s+وحدت\s+رویه(?:\s+قضایی)?\s*(?:شماره)?\s*(?P<num>\d{1,4})")
_SECTION_C_RE = re.compile(
    rf"(?<![\w])ج\)\s*رای\s+وحدت\s+رویه(?:\s+قضایی)?\s*(?:شماره)?\s*\d{{1,4}}\s*[-–—]?\s*(?:\d{{4}}/\d{{1,2}}/\d{{1,2}})?\s*{_SC_BODY}?"
)
_TRAILING_SIGNATURE_RE = re.compile(rf"\s*{_SC_BODY}\s*$")


def _strip_signature(holding: str) -> str:
    return _TRAILING_SIGNATURE_RE.sub("", holding).strip()


def extract_holding(text: str, excerpt: str = "") -> tuple[str, str, str]:
    """(holding, body_after_heading, how). `text` is the flattened law_watch text.
    how: 'section_c' (after «ج) رأی وحدت رویه ...»), 'bare' (the version is the bare ruling), 'excerpt' (low confidence),
    'truncated' (full version cut before its ruling section and no excerpt help), '' (nothing)."""
    t = flat(text)
    head = _SC_HEAD_RE.search(t)
    if not head:
        return "", "", ""
    body = t[head.end():].strip()
    if not body.startswith("مقدمه"):
        return _strip_signature(body), "", "bare"
    sections = [m for m in _SECTION_C_RE.finditer(t) if m.start() > head.end()]
    if sections:
        holding = _strip_signature(t[sections[-1].end():].strip())
        if len(holding) >= 40:
            return holding, t[head.end():sections[-1].start()].strip(), "section_c"
    return "", body, "truncated"


# ----------------------------------------------------------------------------- loading
def load_watch_records(paths: list[Path]) -> list[dict]:
    out = []
    for p in sorted(paths):
        for ln in p.read_text(encoding="utf-8").splitlines():
            if not ln.strip():
                continue
            try:
                rec = json.loads(ln)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict) and rec.get("record_type") == "law_change" and rec.get("change_type") == "unity_ruling":
                out.append(rec)
    return out


def group_versions(records: list[dict]) -> dict[str, list[dict]]:
    """change_id -> versions, newest modified_at first (ties: longer text first, deterministic)."""
    groups: dict[str, list[dict]] = {}
    for r in records:
        groups.setdefault(str(r.get("change_id")), []).append(r)
    for g in groups.values():
        g.sort(key=lambda r: (str(r.get("modified_at") or ""), len(r.get("text") or "")), reverse=True)
    return groups


def _post_id(change_id: str):
    m = re.search(r"(\d+)$", change_id)
    return int(m[1]) if m else None


def _classify(versions: list[dict]) -> str:
    newest = versions[0]
    ident = " ".join(str(newest.get(k) or "") for k in ("title", "issuer")) + " " + str(newest.get("text") or "")[:300]
    ident = flat(ident)
    if "دیوان عدالت اداری" in ident and "دیوان عالی کشور" not in ident:
        return "admin"
    return "sc"


def build_sc_row(change_id: str, versions: list[dict]) -> tuple[dict | None, str]:
    """(row | None, skip reason). `versions` newest first."""
    fu = _fu()
    newest = versions[0]
    holding = body = how = ""
    head = None
    for v in versions:  # newest first; number/date from the newest version that has the heading
        t = flat(v.get("text") or "")
        h = _SC_HEAD_RE.search(t)
        if h is None:
            continue
        head = head or h
        got, b, hw = extract_holding(t)
        if not body and b:
            body = b
        if got:  # the newest version that carries the holding itself wins
            holding, how = got, hw
            break
    if head is None:
        m = _SC_TITLE_NUM_RE.search(flat(newest.get("title") or ""))
        if not m:
            return None, "no_number"  # news / announcement without a ruling number
        number, date = m["num"], ""
    else:
        number, date = head["num"], head["date"] or ""
    date = fu.clean_date(date) or fu.clean_date(str(newest.get("approval_date") or ""))
    number = str(int(number))
    if not date:
        return None, "no_date"
    confident = bool(holding)
    if not holding:
        ex = flat(newest.get("excerpt") or "")
        eh = _SC_HEAD_RE.search(ex)
        holding = (ex[eh.end():] if eh else ex).strip().rstrip("…").strip()
        how = "excerpt"
        if not holding:
            return None, "no_holding"
    title = f"رای وحدت رویه شماره {number} – {date} {fu.BODY_SC}"
    text = title + "\n\n" + holding + (("\n\n" + body) if body and body != holding and how != "excerpt" else "")
    row = {
        "ruling_id": f"sc-unity-{number}-{fu.jalali_to_iso(date)}", "ruling_type": fu.TYPE_SC_UNITY, "issuing_body": fu.BODY_SC,
        "number": number, "number_raw": number, "date": date, "date_iso": fu.jalali_to_iso(date), "case_number": "",
        "title": title, "subject": fu.first_sentence(holding, 220), "holding": holding, "text": text,
        "related_provisions_chars": 0, "laws_referenced": fu.extract_law_refs(text),
        "source": fu.SOURCE, "source_url": newest.get("source_url", ""),
        "source_url_decoded": urllib.parse.unquote(newest.get("source_url", "")), "post_id": _post_id(change_id),
        "wp_date": newest.get("published_at"), "wp_modified": newest.get("modified_at"), "source_tier": "unofficial",
        "needs_review": not confident, "is_active": True, "status": "ACTIVE", "fetched_at": newest.get("modified_at"),
    }  # fmt: skip
    return {k: row[k] for k in ROW_KEYS}, "ok"


def build_admin_row(change_id: str, versions: list[dict]) -> tuple[dict | None, str]:
    fu = _fu()
    newest = versions[0]
    post = {"title": {"rendered": newest.get("title") or ""}}
    parsed = fu.parse_admin(post, newest.get("text") or "")
    if not parsed or parsed["ruling_type"] != fu.TYPE_ADMIN_UNITY:
        return None, "admin_not_a_board_unity_ruling"
    fake = {"link": newest.get("source_url", ""), "id": _post_id(change_id), "date": newest.get("published_at"), "modified": newest.get("modified_at")}
    row = fu.build_row(fake, parsed, newest.get("modified_at"))
    for k in ("title", "subject", "holding", "text"):
        row[k] = flat(row[k]) if k != "text" else row[k]
    row["needs_review"] = True
    row["is_active"], row["status"] = True, "ACTIVE"
    for extra in ("plaintiff", "defendant"):
        row.pop(extra, None)
    return {k: row[k] for k in ROW_KEYS}, "ok"


# ----------------------------------------------------------------------------- corpus dedupe
def row_key(row: dict) -> tuple[str, str, str]:
    num = re.search(r"\d+", flat(str(row.get("number") or "")))
    return (body_key(row.get("issuing_body", "")), str(row.get("ruling_type", "")), str(int(num[0])) if num else "")


def corpus_keys(staged: Path, exclude: Path | None) -> set[tuple[str, str, str]]:
    keys: set[tuple[str, str, str]] = set()
    for pat in CORPUS_GLOBS:
        for p in sorted(staged.glob(pat)):
            if exclude is not None and p.resolve() == exclude.resolve():
                continue
            for ln in p.read_text(encoding="utf-8").splitlines():
                if ln.strip():
                    try:
                        keys.add(row_key(json.loads(ln)))
                    except json.JSONDecodeError:
                        continue
    keys.discard(("", "", ""))
    return keys


def load_extra(paths: list[Path]) -> list[dict]:
    rows = []
    for p in paths:
        for ln in Path(p).read_text(encoding="utf-8").splitlines():
            if ln.strip():
                r = json.loads(ln)
                r["number"] = str(int(re.search(r"\d+", flat(str(r["number"])))[0]))
                rows.append(r)
    return rows


# ----------------------------------------------------------------------------- main logic
def compute(staged: Path, extra: list[Path], date: str | None, out_dir: Path) -> dict:
    watch_files = sorted(staged.glob("law_watch_*.jsonl"))
    groups = group_versions(load_watch_records(watch_files))
    skipped: dict[str, list[str]] = {}
    cand: dict[tuple, dict] = {}
    for cid in sorted(groups):
        versions = groups[cid]
        builder = build_admin_row if _classify(versions) == "admin" else build_sc_row
        row, why = builder(cid, versions)
        if row is None:
            skipped.setdefault(why, []).append(f"{cid} {flat(versions[0].get('title') or '')[:70]}")
            continue
        k = row_key(row)
        prev = cand.get(k)
        if prev is None or (len(row["text"]), -(row["post_id"] or 0)) > (len(prev["text"]), -(prev["post_id"] or 0)):
            cand[k] = row
    for row in load_extra(extra):  # explicit extras beat law_watch rows for the same key
        cand[row_key(row)] = row
    out_name = lambda d: out_dir / f"unity_rulings_delta_{d}.jsonl"  # noqa: E731
    rows_all = sorted(cand.values(), key=lambda r: (r.get("date_iso") or "", int(r["number"])))
    stamp = date or max((str(r.get("wp_modified") or "")[:10] for r in rows_all), default="") or "none"
    corpus = corpus_keys(staged, exclude=out_name(stamp))
    rows = [r for r in rows_all if row_key(r) not in corpus]
    already = [r["number"] for r in rows_all if row_key(r) in corpus]
    if not date and rows:
        stamp = max(str(r.get("wp_modified") or "")[:10] for r in rows)
        corpus = corpus_keys(staged, exclude=out_name(stamp))
        rows = [r for r in rows_all if row_key(r) not in corpus]
    return {
        "watch_files": len(watch_files), "posts_seen": len(groups), "rows": rows, "out": out_name(stamp), "already_in_corpus": already,
        "skipped": skipped,
    }  # fmt: skip


def write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def summary(res: dict) -> str:
    rows = res["rows"]
    lines = [
        f"law_watch files: {res['watch_files']}, unity_ruling posts seen: {res['posts_seen']}",
        f"already in corpus (skipped): {sorted(set(res['already_in_corpus']), key=int)}",
        f"delta rows: {len(rows)} -> {res['out'].name}",
    ]
    for r in rows:
        lines.append(f"  {r['ruling_type']} #{r['number']} {r['date']} needs_review={r['needs_review']} holding_chars={len(r['holding'])} post={r['post_id']}")
    for why, items in sorted(res["skipped"].items()):
        lines.append(f"skipped ({why}): {len(items)}")
        lines += [f"  {i}" for i in items]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--staged-dir", type=Path, default=STAGED)
    ap.add_argument("--out-dir", type=Path, default=None, help="default: --staged-dir")
    ap.add_argument("--extra", type=Path, action="append", default=[], help="extra jsonl in corpus schema (repeatable)")
    ap.add_argument("--date", default=None, help="output file date (default: newest modified date among the delta rows)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    res = compute(args.staged_dir, args.extra, args.date, args.out_dir or args.staged_dir)
    print(summary(res))
    if args.dry_run:
        print("[dry-run] nothing written")
        return 0
    if not res["rows"]:
        print("nothing new; no file written")
        return 0
    write_rows(res["out"], res["rows"])
    print(f"wrote {res['out']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
