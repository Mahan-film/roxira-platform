#!/usr/bin/env python3
"""Ingest the staged regulation files (deregulation-board resolutions + CBI circulars + ekhtebar.ir rows) into a
NEW LOCAL Qdrant collection (e.g. iran_regulations_v3 = the v2 inputs + the new staged files).

  ingest_regulations.py validate FILE.jsonl [FILE2.jsonl ...]           gates (ingest_pipeline.validate_rows), counts only
  ingest_regulations.py apply    FILE.jsonl [...] --collection NAME [--qdrant URL] [--dry-run]

`apply --dry-run` prints a per-file report - ``accepted`` / ``duplicate`` / ``rejected`` counts (see
``scan_files``) - before the plan JSON, and writes nothing. Files are read lowest-priority first, so the
first occurrence of a document wins: a row is a ``duplicate`` when its whole document (same issuer + number
+ date, or the same normalised title) was already seen in an earlier file, and ``rejected`` when the line is
blank/unparsable or a relay row below MIN_RELAY_TEXT_CHARS.

One point per resolution item / circular chunk / relay document. Besides the owner-uploaded CBI schema
(doc_type/subject/chunk_index), it accepts the scripts/legal/iran_relay.py row schema (source taxreg/dotic/rcmajlis
with url/title/number/date/issuer/text) and the ekhtebar.ir staged rows written by scripts/legal/ekhtebar_api.py
(source ekhtebar / source_label ekhtebar.ir with law_name/law_id/article_no/article_label/authority/approval_date);
relay rows whose text is shorter than MIN_RELAY_TEXT_CHARS are skipped and
logged. The embedded text (`text`) is a digest: title + subject + body
(clipped), because a document can be long; the complete source text travels in the payload as `full_text`. Vectors:
BAAI/bge-m3, normalised, cosine, like iran_laws_v3 / iran_rulings_v1 (ingest_pipeline.default_embed). Point ids are
deterministic (ingest_pipeline.point_id over law + chunk index + doc id) so a rerun is idempotent. All safety rules of
ingest_pipeline apply: LOCAL Qdrant only, never into an existing collection (unless --allow-existing), blocked by the
gates. The pseudo "law" names below make the rows pass the allowlist gate without touching config/legal_allowlist.json.
Stdlib only (+ sentence_transformers at embed time).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAW_BOARD = "مصوبات هیئت مقررات‌زدایی و بهبود محیط کسب و کار"
LAW_CIRCULAR = "بخشنامه‌های بانک مرکزی جمهوری اسلامی ایران"
EMBED_CHARS = 2000
DASH = "\u2014"
# Rows produced by scripts/legal/iran_relay.py carry this ``source`` and a different schema than the
# owner-uploaded CBI circulars (url/doc_type/title/number/date/issuer/text instead of subject/chunk_index).
RELAY_SOURCES = frozenset({"taxreg", "dotic", "rcmajlis"})
# Relay drafts (e.g. dotic.ir stubs) can carry only a headline; anything shorter is not worth serving chat.
MIN_RELAY_TEXT_CHARS = 200
# Relay rows get a law name per source, so a tax directive is never filed under the deregulation board.
RELAY_LAWS = {
    "taxreg": "بخشنامه‌ها و نظرات پایگاه قوانین و مقررات مالیاتی",
    "dotic": "مصوبات و مقررات دولتی (پایگاه ملی قوانین و مقررات)",
    "rcmajlis": "قوانین و مقررات مرکز پژوهش‌های مجلس",
}
# Rows staged by scripts/legal/ekhtebar_api.py (ekhtebar.ir, the owner-approved UNOFFICIAL source):
# law_name (the post title), law_id, article_no/article_label, authority (issuer), document_number
# and approval_date, instead of the owner-uploaded CBI / relay fields.
EKHTEBAR_SOURCE = "ekhtebar"
EKHTEBAR_LABEL = "ekhtebar.ir"
# Used only when an ekhtebar row has no law_name (should not happen); per-post titles are
# allowlisted.
LAW_EKHTEBAR = "مقررات پایگاه اختبار (ekhtebar.ir)"
_INTERNAL_KEYS = frozenset({"ingest_pipeline", "content_hash"})

logger = logging.getLogger("ingest_regulations")


def _ip():
    mod = sys.modules.get("ingest_pipeline")
    if mod is None:
        spec = importlib.util.spec_from_file_location("ingest_pipeline", ROOT / "scripts/legal/ingest_pipeline.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ingest_pipeline"] = mod
        spec.loader.exec_module(mod)
    return mod


def is_relay_row(row: dict) -> bool:
    """True for a row from scripts/legal/iran_relay.py (source taxreg/dotic/rcmajlis)."""
    return str(row.get("source") or "") in RELAY_SOURCES


def is_ekhtebar_row(row: dict) -> bool:
    """True for a row staged by scripts/legal/ekhtebar_api.py (source ekhtebar / source_label ekhtebar.ir)."""
    return (
        str(row.get("source") or "") == EKHTEBAR_SOURCE
        or str(row.get("source_label") or "") == EKHTEBAR_LABEL
    )


def regulation_title(row: dict) -> str:
    """The relay ``title`` when present, else «{issuer} - {subject}» (em dash separates issuer from subject)."""
    title = " ".join(str(row.get("title") or "").split())
    if title:
        return title
    issuer = " ".join(str(row.get("issuer") or "").split())
    subject = " ".join(str(row.get("subject") or "").split())
    if issuer and subject:
        return f"{issuer} {DASH} {subject}"
    return issuer or subject


def regulation_ref(row: dict) -> str:
    """The circular number when there is one, else «جلسه {session} بند {item_no}» for a board resolution."""
    number = row.get("number")
    if number in (None, ""):
        number = row.get("document_number")
    if number not in (None, ""):
        return str(number)
    session = row.get("session")
    ref = f"جلسه {session}" if session not in (None, "") else ""
    item_no = row.get("item_no")
    if item_no not in (None, ""):
        ref = f"{ref} بند {item_no}".strip()
    return ref


def embed_text(row: dict) -> str:
    """Digest that gets embedded: title + subject + body."""
    parts = [regulation_title(row), row.get("subject", ""), row.get("text", "")]
    seen: list[str] = []
    for p in parts:
        p = " ".join(str(p or "").split())
        if p and p not in seen and not any(p in q for q in seen):
            seen.append(p)
    return "\n".join(seen)[:EMBED_CHARS]


def to_ingest_row(row: dict) -> dict:
    """Map a source resolution/chunk/relay/ekhtebar row onto the ingest gates, keeping every source field."""
    if is_ekhtebar_row(row):
        return ekhtebar_ingest_row(row)
    doc_type = str(row.get("doc_type") or "")
    law = RELAY_LAWS.get(str(row.get("source") or "")) or (LAW_CIRCULAR if doc_type == "circular" else LAW_BOARD)
    out = {k: v for k, v in row.items() if not str(k).startswith("_") and k not in _INTERNAL_KEYS}
    out.update({
        "law_name": law,
        "article_no": str(row.get("chunk_index") or 0),
        "article_label": str(row.get("doc_id") or ""),
        "title": regulation_title(row),
        "ref": regulation_ref(row),
        "full_text": row.get("text", ""),
        "text": embed_text(row),
        "law_type": "REGULATION",
        "source_tier": row.get("source_tier") or ("official" if doc_type != "circular" else "unofficial"),
        "approval_date": row.get("approved_on") or row.get("date") or row.get("meeting_date"),
        # the relay schema has ``staging_status`` instead of ``status``; the old CBI/board rows keep their own.
        "status": row.get("status") or row.get("staging_status") or "proposed",
        "is_active": True,
    })
    if row.get("url") and not out.get("source_url"):
        out["source_url"] = row["url"]
    return out


def ekhtebar_ingest_row(row: dict) -> dict:
    """Map an ekhtebar_api.py row (post title + article) onto the ingest gates.

    The post title stays the ``law_name`` so distinct circulars do not collide on the point id; the caller adds
    those names to the allowlist (``allowlist(rows)``). ``authority``/``document_number``/``approval_date`` keep the
    issuer, number and date used by dedupe.
    """
    out = {k: v for k, v in row.items() if not str(k).startswith("_") and k not in _INTERNAL_KEYS}
    out.update({
        "law_name": str(row.get("law_name") or "").strip() or LAW_EKHTEBAR,
        "law_type": "REGULATION",
        "article_no": str(row.get("article_no") or row.get("chunk_index") or 0),
        "article_label": str(
            row.get("article_label") or row.get("law_id") or row.get("doc_id") or ""
        ),
        "title": regulation_title(row),
        "ref": regulation_ref(row),
        "full_text": row.get("text", ""),
        "text": embed_text(row),
        "source_tier": row.get("source_tier") or "unofficial",
        "approval_date": row.get("approval_date") or row.get("date"),
        "status": row.get("status") or row.get("staging_status") or "proposed",
        "is_active": row.get("is_active") is not False,
    })
    if not out.get("source_url"):
        out["source_url"] = row.get("url")
    return out


def load_ingest_rows(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for p in paths:
        for lineno, ln in enumerate(Path(p).read_text(encoding="utf-8").splitlines(), start=1):
            if not ln.strip():
                continue
            row = json.loads(ln)
            text_len = len(str(row.get("text") or "").strip())
            if is_relay_row(row) and text_len < MIN_RELAY_TEXT_CHARS:
                logger.warning(
                    "skip %s:%d %s: relay text is %d chars (< %d)",
                    p, lineno, row.get("doc_id") or "", text_len, MIN_RELAY_TEXT_CHARS,
                )
                continue
            rows.append(to_ingest_row(row))
    return rows


def dedupe_key(row: dict) -> str:
    """Document identity used to dedupe new rows against items already seen in an EARLIER file.

    Issuer + number + date when all three are present, else the normalised title. All the chunks of one document
    share this key, so a document repeated by a later file is dropped as a whole while the chunks of the file that
    introduces it are kept.
    """
    ip = _ip()
    issuer = ip.norm_name(row.get("issuer") or row.get("authority") or "")
    number = ip.norm_name(row.get("number") or row.get("document_number") or "")
    date = ip.norm_name(row.get("date") or row.get("approval_date") or row.get("approved_on") or "")
    if issuer and number and date:
        return f"{issuer}|{number}|{date}"
    return ip.norm_name(row.get("law_name") or "") or ip.norm_name(regulation_title(row))


def scan_files(paths: list[Path]) -> tuple[list[dict], list[dict]]:
    """Read files lowest-priority first and drop documents already seen in an earlier file.

    Returns (mapped ingest rows, per-file report). Each report entry is
    ``{"file", "accepted", "duplicate", "rejected"}``: rejected lines are blank/unparsable or relay rows below
    MIN_RELAY_TEXT_CHARS, a duplicate is a row whose whole document (``dedupe_key``) already appeared in an earlier
    file, and accepted rows are mapped by ``to_ingest_row``. The chunks of one document inside a single file are all
    accepted.
    """
    seen: set[str] = set()
    mapped: list[dict] = []
    report: list[dict] = []
    for p in paths:
        accepted = duplicate = rejected = 0
        file_docs: set[str] = set()
        for lineno, ln in enumerate(Path(p).read_text(encoding="utf-8").splitlines(), start=1):
            if not ln.strip():
                continue
            try:
                row = json.loads(ln)
            except json.JSONDecodeError:
                rejected += 1
                logger.warning("skip %s:%d: invalid JSON", p, lineno)
                continue
            if not isinstance(row, dict):
                rejected += 1
                logger.warning("skip %s:%d: not a JSON object", p, lineno)
                continue
            text_len = len(str(row.get("text") or "").strip())
            if is_relay_row(row) and text_len < MIN_RELAY_TEXT_CHARS:
                rejected += 1
                logger.warning(
                    "skip %s:%d %s: relay text is %d chars (< %d)",
                    p, lineno, row.get("doc_id") or "", text_len, MIN_RELAY_TEXT_CHARS,
                )
                continue
            key = dedupe_key(row)
            if key and key in seen:
                duplicate += 1
                continue
            if key:
                file_docs.add(key)
            mapped.append(to_ingest_row(row))
            accepted += 1
        seen |= file_docs
        report.append(
            {"file": str(p), "accepted": accepted, "duplicate": duplicate, "rejected": rejected}
        )
    return mapped, report


def allowlist(rows: list[dict] | None = None) -> dict[str, bool]:
    """Normalised allowlist: the fixed law names plus every ekhtebar post title present in ``rows``."""
    ip = _ip()
    names = {LAW_BOARD, LAW_CIRCULAR, *RELAY_LAWS.values()}
    for row in rows or []:
        if is_ekhtebar_row(row) and row.get("law_name"):
            names.add(str(row["law_name"]))
    return {ip.norm_name(name): True for name in names}


def main(argv: list[str] | None = None, *, http=None, embed=None) -> int:
    ip = _ip()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("validate", "apply"):
        p = sub.add_parser(name)
        p.add_argument("files", type=Path, nargs="+")
        if name == "apply":
            p.add_argument("--collection", required=True)
            p.add_argument("--qdrant", default=ip.DEFAULT_QDRANT)
            p.add_argument("--batch", type=int, default=32)
            p.add_argument("--allow-existing", action="store_true")
            p.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    rows, per_file = scan_files(args.files)
    try:
        if args.cmd == "validate":
            rep = ip.validate_rows(rows, allowlist(rows))
            rep["rows_per_law"] = dict(rep["rows_per_law"])
            print(json.dumps(rep, ensure_ascii=False, indent=2, sort_keys=True))
            return 0 if rep["ok"] else 3
        res = ip.apply_rows(
            rows, args.qdrant, args.collection, allowlist=allowlist(rows), batch=args.batch,
            allow_existing=args.allow_existing, dry_run=args.dry_run,
            http=http or ip.default_http, embed=embed or ip.default_embed,
        )
        if args.dry_run:
            res["files"] = per_file
        print(json.dumps(res, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except ip.Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 3 if str(exc).startswith("blocked") else 2


if __name__ == "__main__":
    sys.exit(main())
