#!/usr/bin/env python3
"""Copy a Qdrant collection (vectors + payloads, NO re-embedding) into a NEW collection.

Used to build `iran_laws_v3` from `iran_laws_v2` before the new laws are added with
`ingest_pipeline.py apply --allow-existing` (docs/legal/CORPUS_AUDIT_2026-10-11.md). The source
is only read (scroll). The target must not exist and must differ from the source. Both URLs must be
local (the script runs ON the server where Qdrant listens on 127.0.0.1:6333). Prints counts only.

  build_collection.py --src iran_laws_v2 --dst iran_laws_v3 --dry-run
  build_collection.py --src iran_laws_v2 --dst iran_laws_v3 \\
      --drop-law "قانون روابط موجر و مستاجر ۱۳۷۶" --drop-source-url-contains way2law.ir

`--drop-law` removes points whose payload law_name equals the given name (after the pipeline's name
normalisation); `--drop-source-url-contains` removes points whose source_url contains the text. Use
them to leave out rows that a newer staged file replaces or that are known bad; nothing is deleted
from the source. Stdlib only.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]


def _load_ingest():
    existing = sys.modules.get("ingest_pipeline")
    if existing is not None:
        return existing
    path = ROOT / "scripts/legal/ingest_pipeline.py"
    spec = importlib.util.spec_from_file_location("ingest_pipeline", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ingest_pipeline"] = mod
    spec.loader.exec_module(mod)
    return mod


ip = _load_ingest()
Refusal = ip.Refusal


def should_drop(payload: dict, drop_laws: set[str], url_parts: list[str]) -> str | None:
    """Return the drop reason or None."""
    if ip.norm_name(payload.get("law_name", "")) in drop_laws:
        return "law"
    url = str(payload.get("source_url") or "")
    if any(part and part in url for part in url_parts):
        return "source_url"
    return None


def scroll(http, base: str, name: str, batch: int):
    """Yield point batches (id, vector, payload). Read-only."""
    offset = None
    while True:
        body = {"limit": batch, "with_payload": True, "with_vector": True}
        if offset is not None:
            body["offset"] = offset
        status, data = http("POST", f"{base}/collections/{quote(name, safe='')}/points/scroll", body)
        if status != 200:
            raise Refusal(f"scroll failed: HTTP {status}")
        res = data.get("result") or {}
        pts = res.get("points") or []
        if pts:
            yield pts
        offset = res.get("next_page_offset")
        if offset is None:
            return


def build(
    src: str,
    dst: str,
    qdrant: str,
    *,
    drop_laws=(),
    drop_source_url_contains=(),
    batch: int = 128,
    dry_run: bool = False,
    http=None,
) -> dict:
    http = http or ip.default_http
    base = ip.assert_local(qdrant)
    for n in (src, dst):
        if not n or not __import__("re").fullmatch(r"[A-Za-z0-9_.-]+", n):
            raise Refusal("refused: invalid collection name")
    if src == dst:
        raise Refusal("refused: source and target are the same collection")
    status, info = http("GET", f"{base}/collections/{quote(src, safe='')}", None)
    if status != 200:
        raise Refusal(f"source collection {src!r} not found (HTTP {status})")
    vec = ((info.get("result") or {}).get("config") or {}).get("params", {}).get("vectors") or {}
    size, dist = vec.get("size"), vec.get("distance", "Cosine")
    if not isinstance(size, int):
        raise Refusal("source collection has named/unknown vectors; refused")
    if ip.collection_exists(http, base, dst):
        raise Refusal(f"refused: target {dst!r} already exists")
    drop_laws_n = {ip.norm_name(x) for x in drop_laws}
    url_parts = list(drop_source_url_contains)
    kept = dropped = 0
    dropped_by: dict[str, int] = {}
    created = False
    for pts in scroll(http, base, src, batch):
        out = []
        for p in pts:
            reason = should_drop(p.get("payload") or {}, drop_laws_n, url_parts)
            if reason:
                dropped += 1
                key = f"{reason}:{(p.get('payload') or {}).get('law_name', '')}"
                dropped_by[key] = dropped_by.get(key, 0) + 1
                continue
            vector = p.get("vector")
            if not isinstance(vector, list) or len(vector) != size:
                raise Refusal("unexpected vector shape in source point; refused")
            out.append({"id": p["id"], "vector": vector, "payload": p.get("payload") or {}})
        kept += len(out)
        if dry_run or not out:
            continue
        if not created:
            status, _ = http(
                "PUT",
                f"{base}/collections/{quote(dst, safe='')}",
                {"vectors": {"size": size, "distance": dist}},
            )
            if status != 200:
                raise Refusal(f"create collection failed: HTTP {status}")
            created = True
        status, _ = http(
            "PUT", f"{base}/collections/{quote(dst, safe='')}/points?wait=true", {"points": out}
        )
        if status != 200:
            raise Refusal(f"upsert failed: HTTP {status} after {kept - len(out)} points")
    return {
        "src": src,
        "dst": dst,
        "dry_run": dry_run,
        "points_kept": kept,
        "points_dropped": dropped,
        "dropped_by": dropped_by,
        "created": created,
    }


def main(argv=None, *, http=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--qdrant", default=ip.DEFAULT_QDRANT)
    ap.add_argument("--drop-law", action="append", default=[])
    ap.add_argument("--drop-source-url-contains", action="append", default=[])
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    try:
        res = build(
            a.src,
            a.dst,
            a.qdrant,
            drop_laws=a.drop_law,
            drop_source_url_contains=a.drop_source_url_contains,
            batch=a.batch,
            dry_run=a.dry_run,
            http=http,
        )
    except Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(res, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
