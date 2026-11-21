#!/usr/bin/env python3
"""Backfill ``text_display`` (verbatim) and ``text_search_norm`` on Qdrant chunks (T237).

Usage:
    python3 scripts/smartjudge/backfill_text_norm.py --collection roxira_laws_v8h --dry-run
    python3 scripts/smartjudge/backfill_text_norm.py --collection roxira_laws_v8h --batch-size 200
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Mapping, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from output_apps.generated_modules.smartjudge.persian_norm import (  # noqa: E402
    build_chunk_text_fields,
    display_text_from_payload,
)


def compute_payload_update(payload: Mapping[str, Any] | None) -> Optional[dict[str, str]]:
    """Return ``{text_display, text_search_norm}`` if the payload needs updating, else None."""
    if not payload:
        return None
    raw = display_text_from_payload(payload)
    if not raw:
        return None
    fields = build_chunk_text_fields(raw)
    if (
        payload.get("text_display") == fields["text_display"]
        and payload.get("text_search_norm") == fields["text_search_norm"]
    ):
        return None
    return fields


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill text_display and text_search_norm in Qdrant.")
    parser.add_argument("--collection", required=True, help="Qdrant collection name")
    parser.add_argument("--qdrant-url", default=os.environ.get("QDRANT_URL", "http://127.0.0.1:6333"))
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--dry-run", action="store_true", help="Report counts without writing to Qdrant")
    args = parser.parse_args(argv)

    from qdrant_client import QdrantClient  # local import so pure helper tests need no qdrant_client

    client = QdrantClient(url=args.qdrant_url)
    offset = None
    scanned = 0
    updated = 0
    while True:
        points, offset = client.scroll(
            collection_name=args.collection,
            limit=args.batch_size,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        if not points:
            break
        for pt in points:
            scanned += 1
            patch = compute_payload_update(pt.payload or {})
            if patch is None:
                continue
            updated += 1
            if not args.dry_run:
                client.set_payload(
                    collection_name=args.collection,
                    payload=patch,
                    points=[pt.id],
                )
        if offset is None:
            break

    mode = "DRY-RUN" if args.dry_run else "APPLIED"
    print(f"[{mode}] collection={args.collection} scanned={scanned} updated={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
