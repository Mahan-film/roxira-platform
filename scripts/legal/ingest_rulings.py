#!/usr/bin/env python3
"""Ingest the staged ruling files (fetch_unity_rulings.py) into a NEW LOCAL Qdrant collection (iran_rulings_v1).

  ingest_rulings.py validate FILE.jsonl [FILE2.jsonl ...]           gates (ingest_pipeline.validate_rows), counts only
  ingest_rulings.py apply    FILE.jsonl [...] --collection NAME [--qdrant URL] [--dry-run]

One point per ruling. The embedded text (`text`) is a digest: title + subject + holding (clipped), because a ruling can be
tens of thousands of characters; the complete ruling travels in the payload as `full_text`. Vectors: BAAI/bge-m3, normalised,
cosine, like iran_laws_v3 (ingest_pipeline.default_embed). Point ids are deterministic (ingest_pipeline.point_id) so a rerun
is idempotent. All safety rules of ingest_pipeline apply: LOCAL Qdrant only, never into an existing collection (unless
--allow-existing), blocked by the gates. The pseudo "law" names below make the rows pass the allowlist gate without touching
config/legal_allowlist.json. Stdlib only (+ sentence_transformers at embed time).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAW_SC = "آرای وحدت رویه دیوان عالی کشور"
LAW_ADMIN = "آرای هیئت عمومی دیوان عدالت اداری"
EMBED_CHARS = 2000


def _ip():
    mod = sys.modules.get("ingest_pipeline")
    if mod is None:
        spec = importlib.util.spec_from_file_location("ingest_pipeline", ROOT / "scripts/legal/ingest_pipeline.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ingest_pipeline"] = mod
        spec.loader.exec_module(mod)
    return mod


def embed_text(row: dict) -> str:
    """Digest that gets embedded: title + subject + holding."""
    parts = [row.get("title", ""), row.get("subject", ""), row.get("holding", "")]
    seen: list[str] = []
    for p in parts:
        p = " ".join(str(p or "").split())
        if p and p not in seen and not any(p in q for q in seen):
            seen.append(p)
    return "\n".join(seen)[:EMBED_CHARS]


def to_ingest_row(row: dict) -> dict:
    law = LAW_SC if row["ruling_type"] == "unity_supreme_court" else LAW_ADMIN
    kind = "رأی وحدت رویه" if row["ruling_type"] in ("unity_supreme_court", "admin_court_unity") else "دادنامه"
    out = dict(row)
    out.update({
        "law_name": law,
        "article_no": str(row["number"]),
        "article_label": f"{kind} شماره {row['number']}" + (f" - {row['date']}" if row.get("date") else ""),
        "full_text": row["text"],
        "text": embed_text(row),
        "law_type": "RULING",
        "approval_date": row.get("date_iso") or row.get("date") or None,
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
    return {ip.norm_name(LAW_SC): True, ip.norm_name(LAW_ADMIN): True}


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
