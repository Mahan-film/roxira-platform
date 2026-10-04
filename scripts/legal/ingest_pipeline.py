#!/usr/bin/env python3
"""Safe, repeatable ingest pipeline for staged official legal JSONL (LOCAL Qdrant only).

Subcommands (see docs/ops/LEGAL_INGEST.md):
  validate <jsonl>                 counts-only quality report
  plan <jsonl> --batch N           deterministic point ids and batches, no writes
  apply <jsonl> --qdrant URL --collection NAME
                                   write to a LOCAL Qdrant, into a NEW collection
  eval <collection> [--qdrant URL] retrieval scoring via scripts/eval_legal_rag.py

Hard safety rules enforced in code:
  * any Qdrant URL whose host is not localhost / 127.0.0.1 / ::1 is refused (every
    subcommand that talks to Qdrant); production ingestion is a separate, owner-approved
    step and is NOT implemented here;
  * apply writes only into a collection that does not exist yet and is not
    ``iran_laws_v2`` unless ``--allow-existing`` is given;
  * apply is blocked by the gates (missing/invalid source_tier, repealed rows, duplicate
    keys, bills when an enacted law exists, laws outside config/legal_allowlist.json,
    missing required fields, bad article_no);
  * law text is never printed; reports contain counts, law names and line numbers only.

Stdlib only. Network and embedding are injectable (``http`` and ``embed`` parameters) so
tests run offline.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ALLOWLIST = ROOT / "config" / "legal_allowlist.json"
DEFAULT_QDRANT = "http://127.0.0.1:6333"
PROTECTED_COLLECTION = "iran_laws_v2"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
VALID_TIERS = frozenset({"official", "secondary", "unofficial"})
REQUIRED_FIELDS = (
    "law_name",
    "article_no",
    "article_label",
    "text",
    "source_tier",
    "is_active",
    "status",
)
# Embedding setup mirrors the app's Qdrant vector path (legal_graph/lightrag_engine.py):
# env LIGHTRAG_QDRANT_EMBED_MODEL, default BAAI/bge-m3, normalised, unnamed cosine vector.
EMBED_MODEL_ENV = "LIGHTRAG_QDRANT_EMBED_MODEL"
DEFAULT_EMBED_MODEL = "BAAI/bge-m3"
NAMESPACE = uuid.UUID("b3a1f0d2-5c7e-4a8b-9d61-0e4f2a7c9b15")
ARTICLE_NO_RE = re.compile(r"^\d+(-[a-z]+)?$")
REPEALED_STATUSES = frozenset({"REPEALED", "INVALID", "ABROGATED", "CANCELLED", "CANCELED"})
BILL_STATUSES = frozenset({"BILL", "DRAFT"})

HttpFn = Callable[[str, str, dict | None], tuple[int, dict]]
EmbedFn = Callable[[list[str]], list[list[float]]]


class Refusal(Exception):
    """A safety rule refused the operation (exit code 2)."""


# ----------------------------------------------------------------------------- helpers
_TRANS = str.maketrans(
    {
        "\u064a": "\u06cc",  # Arabic yeh -> Persian yeh
        "\u0643": "\u06a9",  # Arabic kaf -> Persian keheh
        "\u0623": "\u0627",  # hamza forms -> alef
        "\u0625": "\u0627",
        "\u0624": "\u0648",
        "\u0629": "\u0647",
        "\u200c": " ",  # ZWNJ
        "\u200f": "",
        "\u200e": "",
        **{chr(0x06F0 + i): str(i) for i in range(10)},  # Persian digits
        **{chr(0x0660 + i): str(i) for i in range(10)},  # Arabic-Indic digits
    }
)


def norm_name(name: str) -> str:
    """Normalise a law name for comparison (ZWNJ, Arabic letters/digits, hamza, spaces)."""
    return re.sub(r"\s+", " ", str(name or "").translate(_TRANS)).strip()


def assert_local(url: str) -> str:
    """Return the URL without trailing slash or raise Refusal if it is not a local Qdrant."""
    parsed = urlparse(str(url))
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        raise Refusal(f"refused: unsupported Qdrant URL {url!r}")
    host = (parsed.hostname or "").lower()
    if host not in LOCAL_HOSTS:
        raise Refusal(
            f"refused: Qdrant host {host!r} is not localhost/127.0.0.1/[::1]. "
            "Production ingestion is a separate owner-approved step (docs/ops/LEGAL_INGEST.md)."
        )
    return str(url).rstrip("/")


def point_id(row: dict) -> str:
    """Deterministic uuid5 over law + article + label (re-runs are idempotent)."""
    key = "\x1f".join(
        norm_name(row.get(k, "")) for k in ("law_name", "article_no", "article_label")
    )
    return str(uuid.uuid5(NAMESPACE, key))


def load_rows(path: Path) -> tuple[list[dict], int]:
    """Return (rows, unparsable_line_count). Non-object lines count as unparsable."""
    rows: list[dict] = []
    bad = 0
    with Path(path).open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                continue
            if isinstance(obj, dict):
                rows.append(obj)
            else:
                bad += 1
    return rows, bad


def load_allowlist(path: Path = DEFAULT_ALLOWLIST) -> dict[str, bool]:
    """Map normalised law name -> enacted flag."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return {
        norm_name(item["name"]): bool(item.get("enacted", True)) for item in data.get("laws", [])
    }


def _is_repealed(row: dict) -> bool:
    return row.get("is_active") is False or str(row.get("status", "")).upper() in REPEALED_STATUSES


def _is_bill(row: dict) -> bool:
    return (
        row.get("is_bill") is True
        or str(row.get("status", "")).upper() in BILL_STATUSES
        or str(row.get("law_type", "")).upper() == "BILL"
    )


# ----------------------------------------------------------------------------- validate
GATES = (
    "missing_fields",
    "bad_article_no",
    "missing_source_tier",
    "invalid_source_tier",
    "repealed",
    "duplicates",
    "bill_with_enacted_law",
    "not_in_allowlist",
)


def validate_rows(rows: list[dict], allowlist: dict[str, bool]) -> dict[str, Any]:
    """Counts-only report. ``blocked_rows`` maps gate -> sorted 1-based row numbers."""
    blocked: dict[str, list[int]] = {g: [] for g in GATES}
    keys = [
        (
            norm_name(r.get("law_name", "")),
            norm_name(r.get("article_no", "")),
            norm_name(r.get("article_label", "")),
        )
        for r in rows
    ]
    key_counts = Counter(keys)
    enacted_in_file = {k[0] for r, k in zip(rows, keys, strict=True) if not _is_bill(r)}
    warnings: Counter = Counter()
    for i, (row, key) in enumerate(zip(rows, keys, strict=True), start=1):
        if (
            any(
                row.get(f) in (None, "")
                for f in REQUIRED_FIELDS
                if f not in ("source_tier", "is_active")
            )
            or "is_active" not in row
        ):
            blocked["missing_fields"].append(i)
        art = str(row.get("article_no", "") or "")
        if art and not ARTICLE_NO_RE.match(art):
            blocked["bad_article_no"].append(i)
        tier = row.get("source_tier")
        if tier in (None, ""):
            blocked["missing_source_tier"].append(i)
        elif tier not in VALID_TIERS:
            blocked["invalid_source_tier"].append(i)
        if _is_repealed(row):
            blocked["repealed"].append(i)
        if key_counts[key] > 1:
            blocked["duplicates"].append(i)
        if _is_bill(row) and (key[0] in enacted_in_file or allowlist.get(key[0], False)):
            blocked["bill_with_enacted_law"].append(i)
        if key[0] not in allowlist:
            blocked["not_in_allowlist"].append(i)
        if row.get("approval_date") in (None, ""):
            warnings["missing_approval_date"] += 1
        if "-" in art:
            warnings["suffixed_article_no"] += 1
    per_law = Counter(k[0] for k in keys)
    unlisted = sorted({k[0] for k in keys if k[0] not in allowlist})
    return {
        "rows": len(rows),
        "laws": len(per_law),
        "rows_per_law": dict(per_law),
        "tiers": dict(Counter(str(r.get("source_tier")) for r in rows)),
        "duplicate_keys": sum(1 for c in key_counts.values() if c > 1),
        "bills": sum(1 for r in rows if _is_bill(r)),
        "repealed": len(blocked["repealed"]),
        "warnings": dict(warnings),
        "gate_counts": {g: len(v) for g, v in blocked.items()},
        "blocked_rows": {g: v for g, v in blocked.items() if v},
        "laws_not_in_allowlist": unlisted,
        "ok": not any(blocked.values()),
    }


# ----------------------------------------------------------------------------- plan
def build_plan(rows: list[dict], batch: int) -> dict[str, Any]:
    if batch < 1:
        raise Refusal("refused: --batch must be >= 1")
    ids = [point_id(r) for r in rows]
    batches = []
    for n, start in enumerate(range(0, len(ids), batch), start=1):
        chunk = ids[start : start + batch]
        batches.append(
            {
                "batch": n,
                "first_row": start + 1,
                "rows": len(chunk),
                "ids_sha256": hashlib.sha256("\n".join(chunk).encode()).hexdigest(),
                "laws": dict(
                    Counter(norm_name(r.get("law_name", "")) for r in rows[start : start + batch])
                ),
            }
        )
    return {
        "rows": len(rows),
        "unique_point_ids": len(set(ids)),
        "batch_size": batch,
        "batches": batches,
        "plan_sha256": hashlib.sha256("\n".join(ids).encode()).hexdigest(),
    }


# ----------------------------------------------------------------------------- qdrant I/O
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def default_http(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except json.JSONDecodeError:
            return exc.code, {}


def default_embed(texts: list[str]) -> list[list[float]]:
    """Same model/normalisation as the app's Qdrant vector path (needs sentence_transformers)."""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise Refusal(
            "sentence_transformers is not installed; install it or inject an embed function"
        ) from exc
    model = SentenceTransformer(os.environ.get(EMBED_MODEL_ENV, DEFAULT_EMBED_MODEL))
    return [[float(x) for x in v] for v in model.encode(texts, normalize_embeddings=True)]


def collection_exists(http: HttpFn, base: str, name: str) -> bool:
    status, _ = http("GET", f"{base}/collections/{quote(name, safe='')}", None)
    return status == 200


def apply_rows(
    rows: list[dict],
    qdrant: str,
    collection: str,
    *,
    allowlist: dict[str, bool],
    batch: int = 64,
    allow_existing: bool = False,
    dry_run: bool = False,
    http: HttpFn = default_http,
    embed: EmbedFn = default_embed,
) -> dict[str, Any]:
    """Gate, then write to a local Qdrant. Raises Refusal on any safety violation."""
    base = assert_local(qdrant)
    if not collection or not re.fullmatch(r"[A-Za-z0-9_.-]+", collection):
        raise Refusal("refused: invalid collection name")
    if collection == PROTECTED_COLLECTION and not allow_existing:
        raise Refusal(
            f"refused: {PROTECTED_COLLECTION} is protected; "
            "use a new collection or --allow-existing"
        )
    report = validate_rows(rows, allowlist)
    if not report["ok"]:
        raise Refusal("blocked by gates: " + json.dumps(report["gate_counts"], sort_keys=True))
    plan = build_plan(rows, batch)
    if dry_run:
        return {"dry_run": True, "plan": plan}
    exists = collection_exists(http, base, collection)
    if exists and not allow_existing:
        raise Refusal(
            f"refused: collection {collection!r} already exists; "
            "pick a new name or pass --allow-existing"
        )
    written = 0
    created = False
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        vectors = embed([str(r["text"]) for r in chunk])
        if len(vectors) != len(chunk):
            raise Refusal("embed function returned a wrong number of vectors")
        if not exists and not created:
            status, _ = http(
                "PUT",
                f"{base}/collections/{quote(collection, safe='')}",
                {"vectors": {"size": len(vectors[0]), "distance": "Cosine"}},
            )
            if status != 200:
                raise Refusal(f"create collection failed: HTTP {status}")
            created = True
        points = [
            {
                "id": point_id(r),
                "vector": v,
                "payload": {**r, "ingest_pipeline": "ingest_pipeline.v1"},
            }
            for r, v in zip(chunk, vectors, strict=True)
        ]
        status, _ = http(
            "PUT",
            f"{base}/collections/{quote(collection, safe='')}/points?wait=true",
            {"points": points},
        )
        if status != 200:
            raise Refusal(f"upsert failed: HTTP {status} after {written} points")
        written += len(points)
    return {
        "collection": collection,
        "created": created,
        "points_written": written,
        "plan_sha256": plan["plan_sha256"],
    }


# ----------------------------------------------------------------------------- eval
def run_eval(
    collection: str, qdrant: str, *, http: HttpFn = default_http, runner: Callable | None = None
) -> dict:
    """Score retrieval against a LOCAL collection using scripts/eval_legal_rag.py."""
    base = assert_local(qdrant)
    if not collection_exists(http, base, collection):
        raise Refusal(f"refused: collection {collection!r} not found on {base}")
    parsed = urlparse(base)
    host = parsed.hostname or "127.0.0.1"
    # The app's retrieval reads these env vars (legal_graph/lightrag_engine.py).
    os.environ["QDRANT_HOST"] = host
    os.environ["QDRANT_PORT"] = str(parsed.port or 6333)
    os.environ["LIGHTRAG_QDRANT_COLLECTION"] = collection
    if runner is None:
        import asyncio

        sys.path.insert(0, str(ROOT))
        spec = importlib.util.spec_from_file_location(
            "eval_legal_rag", ROOT / "scripts" / "eval_legal_rag.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        rows = module.load_eval_set()
        return asyncio.run(module.run_eval(rows, collection=collection))
    return runner(collection)


EVAL_FALLBACK_CMD = (
    "QDRANT_HOST=127.0.0.1 QDRANT_PORT=6333 python3 scripts/eval_legal_rag.py --collection <name>"
)


# ----------------------------------------------------------------------------- CLI
def _emit(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True))


def main(
    argv: list[str] | None = None, *, http: HttpFn = default_http, embed: EmbedFn = default_embed
) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("validate", "plan", "apply"):
        p = sub.add_parser(name)
        p.add_argument("jsonl", type=Path)
        p.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
        if name in ("plan", "apply"):
            p.add_argument("--batch", type=int, default=64, help="rows per batch")
        if name == "apply":
            p.add_argument("--qdrant", default=DEFAULT_QDRANT)
            p.add_argument("--collection", required=True)
            p.add_argument("--allow-existing", action="store_true")
            p.add_argument("--dry-run", action="store_true")
    pe = sub.add_parser("eval")
    pe.add_argument("collection")
    pe.add_argument("--qdrant", default=DEFAULT_QDRANT)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "eval":
            try:
                _emit(run_eval(args.collection, args.qdrant, http=http))
            except Refusal:
                raise
            except Exception as exc:
                print(
                    f"eval could not run in-process ({type(exc).__name__}); "
                    f"run manually:\n  {EVAL_FALLBACK_CMD}",
                    file=sys.stderr,
                )
                return 1
            return 0
        rows, bad = load_rows(args.jsonl)
        allowlist = load_allowlist(args.allowlist)
        if args.cmd == "validate":
            report = validate_rows(rows, allowlist)
            report["unparsable_lines"] = bad
            report["ok"] = report["ok"] and bad == 0
            _emit(report)
            return 0 if report["ok"] else 3
        if args.cmd == "plan":
            _emit(build_plan(rows, args.batch))
            return 0
        if bad:
            raise Refusal(f"blocked: {bad} unparsable line(s) in input")
        _emit(
            apply_rows(
                rows,
                args.qdrant,
                args.collection,
                allowlist=allowlist,
                batch=args.batch,
                allow_existing=args.allow_existing,
                dry_run=args.dry_run,
                http=http,
                embed=embed,
            )
        )
        return 0
    except Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 3 if str(exc).startswith("blocked") else 2


if __name__ == "__main__":
    sys.exit(main())
