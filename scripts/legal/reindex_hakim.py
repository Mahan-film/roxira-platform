#!/usr/bin/env python3
"""Re-index Iranian laws corpus with MCINext/Hakim embedding model into Qdrant.

Implements Task 32 from Issue #592 Wave 2 (following benchmark #661 showing
MCINext/Hakim 92% Recall@5 >= 86% bge-m3, 768-dim, 4.6x faster, 76.6% less RAM).

Sources supported:
  1. Staged legal JSONL files (--input / path to jsonl or directory)
  2. Scroll from an existing Qdrant collection (--source-collection, e.g. iran_laws_v2)

Safety rules (mirroring scripts/legal/ingest_pipeline.py):
  * Only talks to local Qdrant (localhost / 127.0.0.1 / ::1).
  * Target collection defaults to 'iran_laws_hakim_v1' (dimension 768, Cosine).
  * Never touches protected 'iran_laws_v2' (preserves the bge-m3 baseline).
  * Injectable HTTP and embed function for clean, fast unit tests.

Usage:
  python3 scripts/legal/reindex_hakim.py --dry-run
  python3 scripts/legal/reindex_hakim.py --input data/legal/staged/ --target-collection iran_laws_hakim_v1
  python3 scripts/legal/reindex_hakim.py --source-collection iran_laws_v2 --target-collection iran_laws_hakim_v1
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_QDRANT = "http://127.0.0.1:6333"
DEFAULT_HAKIM_MODEL = "MCINext/Hakim"
DEFAULT_HAKIM_COLLECTION = "iran_laws_hakim_v1"
PROTECTED_COLLECTION = "iran_laws_v2"
HAKIM_DIM = 768
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
NAMESPACE = uuid.UUID("b3a1f0d2-5c7e-4a8b-9d61-0e4f2a7c9b15")

HttpFn = Callable[[str, str, dict[str, Any] | None], tuple[int, dict[str, Any]]]
EmbedFn = Callable[[list[str]], list[list[float]]]


class Refusal(RuntimeError):
    """Refusal on safety or validation failure."""


def assert_local(url: str) -> str:
    """Ensure Qdrant URL points to local host only."""
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise Refusal(f"refused: invalid Qdrant URL {url!r}")
    host = parsed.hostname or ""
    if host.lower() not in LOCAL_HOSTS:
        raise Refusal(f"refused: non-local Qdrant host {host!r} is prohibited")
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def default_http(method: str, url: str, payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    """Standard HTTP request helper with json serialization."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8")
        try:
            return err.code, json.loads(body) if body else {}
        except Exception:
            return err.code, {"error": body}


def default_embed_hakim(texts: list[str], model_name: str = DEFAULT_HAKIM_MODEL) -> list[list[float]]:
    """Embed texts using SentenceTransformer with L2-normalized vectors."""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise Refusal(
            "sentence_transformers is not installed; install it or pass an injectable embed function"
        ) from exc
    model = SentenceTransformer(model_name)
    vectors = model.encode(texts, normalize_embeddings=True)
    return [[float(x) for x in v] for v in vectors]


def collection_exists(http: HttpFn, base: str, name: str) -> bool:
    """Check if Qdrant collection exists."""
    status, _ = http("GET", f"{base}/collections/{quote(name, safe='')}", None)
    return status == 200


def get_collection_info(http: HttpFn, base: str, name: str) -> dict[str, Any]:
    """Retrieve collection info and vector parameters."""
    status, body = http("GET", f"{base}/collections/{quote(name, safe='')}", None)
    if status != 200:
        return {}
    return body.get("result", {})


def load_rows_from_jsonl(path: str | Path) -> list[dict[str, Any]]:
    """Load legal rows from a single JSONL file or directory of JSONL files."""
    p = Path(path)
    files: list[Path] = []
    if p.is_dir():
        files = sorted(p.glob("*.jsonl"))
    elif p.is_file():
        files = [p]
    else:
        # Check glob pattern
        matches = [Path(m) for m in glob.glob(str(path))]
        if matches:
            files = sorted(matches)
        else:
            raise Refusal(f"refused: input path not found: {path}")

    rows: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for file_path in files:
        with open(file_path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                raw = line.strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except Exception as exc:
                    continue

                # Normalise required fields
                law_name = str(data.get("law_name") or "").strip()
                article_no = str(data.get("article_no") or "").strip()
                text = str(data.get("text") or "").strip()

                if not law_name or not text:
                    continue

                dedup_key = f"{law_name}:{article_no}:{text[:80]}"
                if dedup_key in seen_keys:
                    continue
                seen_keys.add(dedup_key)

                rows.append({
                    "law_name": law_name,
                    "article_no": article_no,
                    "article_label": data.get("article_label") or f"ماده {article_no}",
                    "text": text,
                    "source_tier": data.get("source_tier", "official"),
                    "is_active": data.get("is_active", True),
                    "status": data.get("status", "ENACTED"),
                    "source_id": data.get("id"),
                })

    return rows


def scroll_rows_from_qdrant(
    http: HttpFn,
    base: str,
    source_collection: str,
    *,
    limit: int | None = None,
    batch_size: int = 250,
) -> list[dict[str, Any]]:
    """Scroll all existing points and payloads from a Qdrant collection."""
    if not collection_exists(http, base, source_collection):
        raise Refusal(f"refused: source collection {source_collection!r} does not exist on {base}")

    rows: list[dict[str, Any]] = []
    next_page_offset: Any = None

    while True:
        payload: dict[str, Any] = {
            "limit": batch_size,
            "with_payload": True,
            "with_vector": False,
        }
        if next_page_offset is not None:
            payload["offset"] = next_page_offset

        status, body = http(
            "POST",
            f"{base}/collections/{quote(source_collection, safe='')}/points/scroll",
            payload,
        )
        if status != 200:
            raise Refusal(f"scroll failed on collection {source_collection!r}: HTTP {status} {body}")

        result = body.get("result", {})
        points = result.get("points", [])
        if not points:
            break

        for pt in points:
            p = pt.get("payload", {})
            text = str(p.get("text") or p.get("content") or "").strip()
            law_name = str(p.get("law_name") or p.get("title") or "").strip()
            article_no = str(p.get("article_no") or "").strip()

            if not text:
                continue

            rows.append({
                "point_id": pt.get("id"),
                "law_name": law_name,
                "article_no": article_no,
                "article_label": p.get("article_label") or f"ماده {article_no}",
                "text": text,
                "source_tier": p.get("source_tier", "official"),
                "is_active": p.get("is_active", True),
                "status": p.get("status", "ENACTED"),
            })

            if limit and len(rows) >= limit:
                return rows[:limit]

        next_page_offset = result.get("next_page_offset")
        if not next_page_offset:
            break

    return rows


def reindex_hakim(
    rows: list[dict[str, Any]],
    qdrant_url: str = DEFAULT_QDRANT,
    target_collection: str = DEFAULT_HAKIM_COLLECTION,
    model_name: str = DEFAULT_HAKIM_MODEL,
    *,
    batch_size: int = 32,
    allow_existing: bool = False,
    dry_run: bool = False,
    http: HttpFn = default_http,
    embed: EmbedFn | None = None,
) -> dict[str, Any]:
    """Re-index rows into Qdrant collection with Hakim embeddings."""
    base = assert_local(qdrant_url)

    if not target_collection or not re.fullmatch(r"[A-Za-z0-9_.-]+", target_collection):
        raise Refusal(f"refused: invalid target collection name {target_collection!r}")

    if target_collection == PROTECTED_COLLECTION:
        raise Refusal(f"refused: {PROTECTED_COLLECTION!r} is the protected bge-m3 baseline and cannot be overwritten")

    if not rows:
        return {
            "ok": True,
            "target_collection": target_collection,
            "points_indexed": 0,
            "dry_run": dry_run,
            "message": "No rows to index",
        }

    embed_fn = embed or (lambda texts: default_embed_hakim(texts, model_name))

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "target_collection": target_collection,
            "model": model_name,
            "rows_count": len(rows),
            "sample_point_id": str(uuid.uuid5(NAMESPACE, f"{rows[0]['law_name']}:{rows[0]['article_no']}")),
            "first_law": rows[0].get("law_name"),
            "first_article": rows[0].get("article_no"),
        }

    exists = collection_exists(http, base, target_collection)
    if exists and not allow_existing:
        raise Refusal(
            f"refused: target collection {target_collection!r} already exists; pass --allow-existing to update"
        )

    # Compute first batch to detect vector dimension
    first_chunk = rows[: min(len(rows), batch_size)]
    first_vectors = embed_fn([str(r["text"]) for r in first_chunk])
    vector_dim = len(first_vectors[0])

    if not exists:
        status, resp = http(
            "PUT",
            f"{base}/collections/{quote(target_collection, safe='')}",
            {
                "vectors": {
                    "size": vector_dim,
                    "distance": "Cosine",
                }
            },
        )
        if status not in (200, 201):
            raise Refusal(f"failed to create collection {target_collection!r}: HTTP {status} {resp}")

    total_indexed = 0

    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        if start == 0:
            vectors = first_vectors
        else:
            vectors = embed_fn([str(r["text"]) for r in chunk])

        points = []
        for row, vec in zip(chunk, vectors):
            pt_id = row.get("point_id") or str(
                uuid.uuid5(NAMESPACE, f"{row['law_name']}:{row['article_no']}:{row['text'][:40]}")
            )
            payload = {
                "law_name": row.get("law_name"),
                "article_no": row.get("article_no"),
                "article_label": row.get("article_label"),
                "text": row.get("text"),
                "source_tier": row.get("source_tier", "official"),
                "is_active": row.get("is_active", True),
                "status": row.get("status", "ENACTED"),
                "embedding_model": model_name,
                "reindexed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            points.append({
                "id": pt_id,
                "vector": vec,
                "payload": payload,
            })

        status, resp = http(
            "PUT",
            f"{base}/collections/{quote(target_collection, safe='')}/points?wait=true",
            {"points": points},
        )
        if status != 200:
            raise Refusal(f"failed to upsert points batch at offset {start}: HTTP {status} {resp}")

        total_indexed += len(points)

    return {
        "ok": True,
        "target_collection": target_collection,
        "model": model_name,
        "vector_dim": vector_dim,
        "points_indexed": total_indexed,
        "dry_run": False,
    }


def verify_hakim_collection(
    http: HttpFn,
    base: str,
    collection: str,
    expected_dim: int = HAKIM_DIM,
) -> dict[str, Any]:
    """Verifies that the collection exists, has matching vector dimension and points."""
    info = get_collection_info(http, base, collection)
    if not info:
        return {"ok": False, "error": f"Collection {collection} not found"}

    config = info.get("config", {}).get("params", {}).get("vectors", {})
    size = config.get("size")
    points_count = info.get("points_count", 0)

    dim_ok = size == expected_dim
    return {
        "ok": dim_ok and points_count > 0,
        "collection": collection,
        "points_count": points_count,
        "vector_size": size,
        "expected_dim": expected_dim,
        "dimension_match": dim_ok,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--qdrant", default=DEFAULT_QDRANT, help="Local Qdrant base URL (default: %(default)s)")
    parser.add_argument("--model", default=DEFAULT_HAKIM_MODEL, help="Embedding model ID (default: %(default)s)")
    parser.add_argument(
        "--target-collection",
        default=DEFAULT_HAKIM_COLLECTION,
        help="Target Qdrant collection name (default: %(default)s)",
    )
    parser.add_argument("--input", "-i", help="Path to staged legal JSONL file or directory")
    parser.add_argument(
        "--source-collection",
        "-s",
        help="Source Qdrant collection to scroll points from (e.g. iran_laws_v2)",
    )
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size (default: %(default)s)")
    parser.add_argument("--limit", type=int, help="Limit number of articles to re-index")
    parser.add_argument("--allow-existing", action="store_true", help="Allow upsert into existing target collection")
    parser.add_argument("--dry-run", action="store_true", help="Simulate re-indexing without writing to Qdrant")
    parser.add_argument("--verify", action="store_true", help="Verify target collection integrity after re-indexing")

    args = parser.parse_args(argv)

    try:
        base = assert_local(args.qdrant)

        # Load rows
        rows: list[dict[str, Any]] = []
        if args.source_collection:
            print(f"[REINDEX] Scrolling rows from source collection: {args.source_collection} ...")
            rows = scroll_rows_from_qdrant(default_http, base, args.source_collection, limit=args.limit)
        elif args.input:
            print(f"[REINDEX] Loading rows from input path: {args.input} ...")
            rows = load_rows_from_jsonl(args.input)
            if args.limit:
                rows = rows[: args.limit]
        else:
            # Default fallback: check data/legal/staged/*.jsonl
            default_staged = ROOT / "data" / "legal" / "staged"
            if default_staged.exists():
                print(f"[REINDEX] Loading rows from default staged path: {default_staged} ...")
                rows = load_rows_from_jsonl(default_staged)
                if args.limit:
                    rows = rows[: args.limit]
            else:
                parser.error("Must specify either --input <jsonl_path> or --source-collection <collection_name>")

        print(f"[REINDEX] Loaded {len(rows)} articles. Model: {args.model}. Target: {args.target_collection}")

        res = reindex_hakim(
            rows,
            qdrant_url=args.qdrant,
            target_collection=args.target_collection,
            model_name=args.model,
            batch_size=args.batch_size,
            allow_existing=args.allow_existing,
            dry_run=args.dry_run,
        )

        print(json.dumps(res, indent=2, ensure_ascii=False))

        if args.verify and not args.dry_run:
            print("[REINDEX] Verifying collection integrity ...")
            v_res = verify_hakim_collection(default_http, base, args.target_collection)
            print(json.dumps(v_res, indent=2, ensure_ascii=False))
            if not v_res["ok"]:
                return 1

        return 0

    except Refusal as err:
        print(f"Error: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
