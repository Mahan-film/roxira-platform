#!/usr/bin/env python3
"""Build the hybrid collection ``iran_laws_v8h`` from ``iran_laws_v6`` (dense + BM25 sparse).

The v8h experiment adds a Qdrant **sparse** vector named ``bm25`` next to the existing
dense ``BAAI/bge-m3`` vector, so the retrieval path can fuse both with RRF (Query API
prefetch + ``FusionQuery``). The dense vectors are **copied as-is** (scroll
``with_vector=true``): no re-embedding, no cost, no model load.

The sparse values are plain term frequencies produced by the shared stdlib tokenizer
``output_apps/generated_modules/smartjudge/legal_tokenize.py`` (same file the retrieval
side uses, so a query and its document hash to the same indices). The collection is
created with ``sparse_vectors: {"bm25": {"modifier": "idf"}}``; Qdrant applies the IDF at
query time.

Safety:
  * the source collection is only **read** (scroll) and is never modified or deleted;
  * the target must be a NEW collection and is refused when it already exists, equals the
    source, or is a protected collection (``iran_laws_v2``);
  * ``--apply`` is required to write anything; the default is a dry run that prints counts
    only and writes nothing to Qdrant;
  * no law text is printed — reports are counts and collection names only.

  build_v8_hybrid.py --src iran_laws_v6 --dst iran_laws_v8h --dry-run
  build_v8_hybrid.py --src iran_laws_v6 --dst iran_laws_v8h --apply
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]

DEFAULT_SRC = "iran_laws_v6"
DEFAULT_DST = "iran_laws_v8h"
SPARSE_NAME = "bm25"
DEFAULT_BATCH = 128


def _load(name: str, rel: str):
    """Import a sibling script under scripts/legal/ once (same pattern as build_v7)."""
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    path = ROOT / rel
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_tokenizer():
    """Load the shared tokenizer by path (single source with the retrieval side)."""
    existing = sys.modules.get("legal_tokenize")
    if existing is not None:
        return existing
    path = ROOT / "output_apps" / "generated_modules" / "smartjudge" / "legal_tokenize.py"
    spec = importlib.util.spec_from_file_location("legal_tokenize", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["legal_tokenize"] = mod
    spec.loader.exec_module(mod)
    return mod


ip = _load("ingest_pipeline", "scripts/legal/ingest_pipeline.py")
lt = _load_tokenizer()
Refusal = ip.Refusal


# ----------------------------------------------------------------------------- helpers
def point_text(payload: dict) -> str:
    """Text used for the sparse vector (full text; the dense side is copied, not rebuilt)."""
    return str(payload.get("text") or payload.get("summary") or "").strip()


def sparse_point_vector(payload: dict) -> dict | None:
    """Qdrant sparse vector for one payload, or ``None`` when there is nothing to index."""
    indices, values = lt.sparse_vector(point_text(payload))
    if not indices:
        return None
    return {"indices": indices, "values": values}


def _source_vector_config(info: dict) -> tuple[int, str]:
    """(size, distance) of the source's unnamed dense vector; refuse named/unknown vectors."""
    vectors = ((info.get("result") or {}).get("config") or {}).get("params", {}).get("vectors")
    if isinstance(vectors, dict) and isinstance(vectors.get("size"), int):
        return vectors["size"], str(vectors.get("distance") or "Cosine")
    raise Refusal("source collection has named/unknown vectors; refused (expected one dense vector)")


def _create_collection_body(size: int, distance: str) -> dict:
    """Collection config: one unnamed dense vector plus the named sparse ``bm25`` (IDF)."""
    return {
        "vectors": {"size": size, "distance": distance},
        "sparse_vectors": {SPARSE_NAME: {"modifier": "idf"}},
    }


def scroll_points(http, base: str, name: str, batch: int):
    """Yield read-only point batches (id, dense vector, payload) from the source."""
    offset = None
    while True:
        body = {"limit": batch, "with_payload": True, "with_vector": True}
        if offset is not None:
            body["offset"] = offset
        status, data = http(
            "POST", f"{base}/collections/{quote(name, safe='')}/points/scroll", body
        )
        if status != 200:
            raise Refusal(f"scroll failed: HTTP {status}")
        result = data.get("result") or {}
        points = result.get("points") or []
        if points:
            yield points
        offset = result.get("next_page_offset")
        if offset is None:
            return


def points_count(http, base: str, collection: str) -> int | None:
    status, data = http("GET", f"{base}/collections/{collection}", None)
    if status != 200:
        return None
    return (data.get("result") or {}).get("points_count")


# ----------------------------------------------------------------------------- build
def build(
    src: str = DEFAULT_SRC,
    dst: str = DEFAULT_DST,
    qdrant: str = ip.DEFAULT_QDRANT,
    *,
    batch: int = DEFAULT_BATCH,
    dry_run: bool = True,
    http=None,
) -> dict:
    """Copy ``src`` into a NEW hybrid collection ``dst`` (dense + sparse ``bm25``)."""
    http = http or ip.default_http
    base = ip.assert_local(qdrant)
    for name in (src, dst):
        if not name or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise Refusal("refused: invalid collection name")
    if src == dst:
        raise Refusal("refused: source and target are the same collection")
    if dst == ip.PROTECTED_COLLECTION:
        raise Refusal(f"refused: {ip.PROTECTED_COLLECTION} is protected")
    status, info = http("GET", f"{base}/collections/{quote(src, safe='')}", None)
    if status != 200:
        raise Refusal(f"source collection {src!r} not found (HTTP {status})")
    size, distance = _source_vector_config(info)
    if ip.collection_exists(http, base, dst):
        raise Refusal(f"refused: target {dst!r} already exists (never modified or deleted)")

    scanned = 0
    with_text = 0
    total_tokens = 0
    created = False
    written = 0
    for points in scroll_points(http, base, src, batch):
        out: list[dict] = []
        for point in points:
            scanned += 1
            vector = point.get("vector")
            if not isinstance(vector, list) or len(vector) != size:
                raise Refusal("unexpected dense vector shape in source point; refused")
            payload = point.get("payload") or {}
            sparse = sparse_point_vector(payload)
            if sparse is not None:
                with_text += 1
                total_tokens += len(sparse["indices"])
            vector_body: dict = {"": vector}
            if sparse is not None:
                vector_body[SPARSE_NAME] = sparse
            out.append({"id": point["id"], "vector": vector_body, "payload": payload})
        if dry_run or not out:
            continue
        if not created:
            status, _ = http(
                "PUT",
                f"{base}/collections/{quote(dst, safe='')}",
                _create_collection_body(size, distance),
            )
            if status != 200:
                raise Refusal(f"create collection failed: HTTP {status}")
            created = True
        status, _ = http(
            "PUT", f"{base}/collections/{quote(dst, safe='')}/points?wait=true", {"points": out}
        )
        if status != 200:
            raise Refusal(f"upsert failed: HTTP {status} after {written} points")
        written += len(out)

    result = {
        "src": src,
        "dst": dst,
        "dry_run": dry_run,
        "sparse_vector": SPARSE_NAME,
        "dense_size": size,
        "dense_distance": distance,
        "points_scanned": scanned,
        "points_with_sparse": with_text,
        "sparse_tokens_total": total_tokens,
        "sparse_tokens_avg": round(total_tokens / with_text, 2) if with_text else 0.0,
        "points_written": written,
        "created": created,
    }
    if not dry_run:
        actual = points_count(http, base, dst)
        result["points_count_verified"] = actual
        if actual != written:
            raise Refusal(
                f"point count mismatch: {actual} in {dst}, expected {written}; collection is PARTIAL"
            )
    return result


# ----------------------------------------------------------------------------- CLI
def main(argv: list[str] | None = None, *, http=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--src", default=DEFAULT_SRC, help="source collection (read-only)")
    ap.add_argument("--dst", default=DEFAULT_DST, help="NEW hybrid target collection")
    ap.add_argument("--qdrant", default=ip.DEFAULT_QDRANT)
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    ap.add_argument("--apply", action="store_true", help="write the new collection")
    ap.add_argument("--dry-run", action="store_true", help="default; write nothing to Qdrant")
    args = ap.parse_args(argv)
    if args.apply and args.dry_run:
        print("--apply and --dry-run are mutually exclusive", file=sys.stderr)
        return 2
    try:
        result = build(
            args.src,
            args.dst,
            args.qdrant,
            batch=args.batch,
            dry_run=not args.apply,
            http=http,
        )
    except Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
