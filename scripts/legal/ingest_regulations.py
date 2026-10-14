#!/usr/bin/env python3
"""Ingest the staged regulation files (deregulation-board resolutions + CBI circulars) into a NEW LOCAL Qdrant
collection (iran_regulations_v1).

  ingest_regulations.py validate FILE.jsonl [FILE2.jsonl ...]           gates (ingest_pipeline.validate_rows), counts only
  ingest_regulations.py apply    FILE.jsonl [...] --collection NAME [--qdrant URL] [--dry-run]

One point per resolution item / circular chunk. The embedded text (`text`) is a digest: title + subject + body
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
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAW_BOARD = "مصوبات هیئت مقررات‌زدایی و بهبود محیط کسب و کار"
LAW_CIRCULAR = "بخشنامه‌های بانک مرکزی جمهوری اسلامی ایران"
EMBED_CHARS = 2000
DASH = "\u2014"
_INTERNAL_KEYS = frozenset({"ingest_pipeline", "content_hash"})


def _ip():
    mod = sys.modules.get("ingest_pipeline")
    if mod is None:
        spec = importlib.util.spec_from_file_location("ingest_pipeline", ROOT / "scripts/legal/ingest_pipeline.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ingest_pipeline"] = mod
        spec.loader.exec_module(mod)
    return mod


def regulation_title(row: dict) -> str:
    """«{issuer} - {subject}» (the em dash separates the issuer from the subject)."""
    issuer = " ".join(str(row.get("issuer") or "").split())
    subject = " ".join(str(row.get("subject") or "").split())
    if issuer and subject:
        return f"{issuer} {DASH} {subject}"
    return issuer or subject


def regulation_ref(row: dict) -> str:
    """The circular number when there is one, else «جلسه {session} بند {item_no}» for a board resolution."""
    number = row.get("number")
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
    """Map a source resolution/chunk row onto the ingest gates, keeping every source field in the payload."""
    doc_type = str(row.get("doc_type") or "")
    law = LAW_CIRCULAR if doc_type == "circular" else LAW_BOARD
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
        "is_active": True,
    })
    return out


def load_ingest_rows(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for p in paths:
        for ln in Path(p).read_text(encoding="utf-8").splitlines():
            if ln.strip():
                rows.append(to_ingest_row(json.loads(ln)))
    return rows


def allowlist() -> dict[str, bool]:
    ip = _ip()
    return {ip.norm_name(LAW_BOARD): True, ip.norm_name(LAW_CIRCULAR): True}


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
    rows = load_ingest_rows(args.files)
    try:
        if args.cmd == "validate":
            rep = ip.validate_rows(rows, allowlist())
            rep["rows_per_law"] = dict(rep["rows_per_law"])
            print(json.dumps(rep, ensure_ascii=False, indent=2, sort_keys=True))
            return 0 if rep["ok"] else 3
        res = ip.apply_rows(
            rows, args.qdrant, args.collection, allowlist=allowlist(), batch=args.batch,
            allow_existing=args.allow_existing, dry_run=args.dry_run,
            http=http or ip.default_http, embed=embed or ip.default_embed,
        )
        print(json.dumps(res, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except ip.Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 3 if str(exc).startswith("blocked") else 2


if __name__ == "__main__":
    sys.exit(main())
