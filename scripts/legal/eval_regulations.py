#!/usr/bin/env python3
"""Retrieval-only recall@5 eval for a regulations Qdrant collection (no LLM, no cost).

    python3 scripts/legal/eval_regulations.py COLLECTION --set scripts/legal/eval/regulations_golden_2026-10-15.json

Needs Qdrant + the query embedder: with EMBEDDING_URL set the vector comes from the shared TEI service (the same
service the build uses), otherwise a local BAAI/bge-m3 must be installed. Read-only (points/search only). The build
script runs it inside the app image against the collection it just built (step 4):
    scripts/legal/build_regulations_collection_on_server.sh [--rebuild]

A case passes when any of the top-K payloads has a matching ``ref``/``number`` or ``doc_id`` (or a payload title
containing the expected title). Questions paraphrase the staged CBI circulars and the relay taxreg rows; every
``must_include`` quote is a verbatim substring of the staged text (cases carry ``status: text_verified``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SET = ROOT / "scripts" / "legal" / "eval" / "regulations_golden_2026-10-15.json"
DEFAULT_TOP_K = 5
_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def norm(text: object) -> str:
    """Collapse whitespace, unify Persian/Arabic digits and drop ZWNJ for stable comparison."""
    return " ".join(str(text or "").translate(_TRANS).replace("\u200c", " ").split())


def load_cases(path: Path) -> list[dict]:
    return json.loads(Path(path).read_text(encoding="utf-8")).get("cases", [])


def _wanted(case: dict) -> tuple[set[str], set[str], list[str]]:
    refs = {norm(x) for x in case.get("number_any", []) if str(x).strip()}
    if str(case.get("number") or "").strip():
        refs.add(norm(case["number"]))
    ids = {norm(x) for x in case.get("doc_id_any", []) if str(x).strip()}
    if str(case.get("doc_id") or "").strip():
        ids.add(norm(case["doc_id"]))
    titles = [norm(x) for x in case.get("title_any", []) if str(x).strip()]
    if str(case.get("title") or "").strip():
        titles.append(norm(case["title"]))
    return refs, ids, titles


def case_hit(case: dict, payload: dict) -> bool:
    """True when a retrieved payload is the expected document (ref/number, doc_id, or title)."""
    refs, ids, titles = _wanted(case)
    row_ref = norm(payload.get("ref") or payload.get("number"))
    row_id = norm(payload.get("doc_id"))
    row_title = norm(payload.get("title"))
    if refs and row_ref in refs:
        return True
    if ids and row_id in ids:
        return True
    return any(t and t in row_title for t in titles)


def _label(payload: dict) -> str:
    return norm(payload.get("ref") or payload.get("number") or payload.get("doc_id") or payload.get("title"))


async def run(collection: str, set_path: Path, top_k: int) -> int:
    sys.path.insert(0, str(ROOT))
    from output_apps.generated_modules.smartjudge import regulations_retrieval as reg
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

    cases = load_cases(set_path)
    embedder = eng.QDRANT_EMBED_MODEL_NAME
    print(f"collection={collection} embedder={embedder} top_k={top_k}")
    if embedder != reg.EXPECTED_EMBEDDER:
        print(
            f"WARNING: {collection} holds {reg.EXPECTED_EMBEDDER} vectors but the query embedder is {embedder}; "
            "scores are noise",
            file=sys.stderr,
        )
    if not cases:
        print(f"no cases in {set_path}", file=sys.stderr)
        return 2
    hits = scored = 0
    print(f"{'case':<36}{'result':<8}{'matched':<16}top-{top_k} refs")
    for case in cases:
        vector = await asyncio.to_thread(eng._embed_query_sync, str(case.get("question") or ""))
        payloads = await eng._qdrant_vector_search_httpx(vector, collection, top_k, False) if vector else None
        payloads = [p for p in (payloads or []) if isinstance(p, dict)]
        winner = next((p for p in payloads if case_hit(case, p)), None)
        scored += 1
        hits += winner is not None
        matched = _label(winner) if winner else "-"
        refs = ", ".join(_label(p) for p in payloads) or "(none)"
        print(f"{str(case.get('id') or '?'):<36}{'PASS' if winner else 'FAIL':<8}{matched:<16}{refs}")
    ratio = hits / scored if scored else 0.0
    print(f"\nretrieval recall@{top_k}: {hits}/{scored} = {ratio:.3f}")
    return 0 if hits == scored else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("collection", help="Qdrant collection to score, e.g. iran_regulations_v2")
    ap.add_argument("--set", default=str(DEFAULT_SET), help="golden JSON (default: %(default)s)")
    ap.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    args = ap.parse_args(argv)
    return asyncio.run(run(args.collection, Path(args.set), max(1, args.top_k)))


if __name__ == "__main__":
    sys.exit(main())
