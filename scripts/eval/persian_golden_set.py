#!/usr/bin/env python3
"""Persian golden set generator (200 dev questions + sealed hashes) and Recall@5 harness.

Usage (offline in CI):
    python3 scripts/eval/persian_golden_set.py generate
    python3 scripts/eval/persian_golden_set.py eval --top-k 5
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Protocol

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = REPO_ROOT / "data" / "eval" / "legal_rag_eval.jsonl"
DEFAULT_DEV_OUT = REPO_ROOT / "data" / "eval" / "legal_rag_dev_200.jsonl"
DEFAULT_SEALED_OUT = REPO_ROOT / "data" / "eval" / "legal_rag_sealed_hashes.json"

PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
ARABIC_INDIC_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
ASCII_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def variant_zwnj_drop(text: str) -> str:
    return text.replace("\u200c", "")


def variant_zwnj_add(text: str) -> str:
    out = text.replace("می ", "می\u200c").replace(" ها ", "\u200cها ")
    if out == text:
        out = out.replace("های ", "\u200cهای ")
    return out if out != text else f"{text}\u200c"


def variant_arabic_letters(text: str) -> str:
    return text.replace("ی", "ي").replace("ک", "ك")


def variant_digit_persian(text: str) -> str:
    return text.translate(PERSIAN_DIGITS)


def variant_digit_arabic_indic(text: str) -> str:
    return text.translate(ARABIC_INDIC_DIGITS)


def variant_rtl_marks(text: str) -> str:
    return f"\u200f\u202b{text}\u202c"


def variant_phone_style(text: str) -> str:
    return (
        text.replace("می‌شود", "میشه")
        .replace("می شود", "میشه")
        .replace("است؟", "هست؟")
        .replace(" را ", " رو ")
        .replace("\u200c", " ")
    )


VARIANT_TRANSFORMS: list[tuple[str, Callable[[str], str]]] = [
    ("zwnj_drop", variant_zwnj_drop),
    ("zwnj_add", variant_zwnj_add),
    ("arabic_letters", variant_arabic_letters),
    ("digit_persian", variant_digit_persian),
    ("digit_arabic_indic", variant_digit_arabic_indic),
    ("rtl_marks", variant_rtl_marks),
    ("phone_style", variant_phone_style),
]


def load_source_questions(path: Path = DEFAULT_SOURCE) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def generate_golden_sets(
    source_path: Path = DEFAULT_SOURCE,
    dev_out: Path = DEFAULT_DEV_OUT,
    sealed_out: Path = DEFAULT_SEALED_OUT,
    target_dev_count: int = 200,
    seed: int = 42,
) -> tuple[list[dict], dict]:
    base_rows = load_source_questions(source_path)
    rng = random.Random(seed)

    all_variants: list[dict] = []
    for row in base_rows:
        all_variants.append(
            {
                "id": f"{row['id']}_orig",
                "base_id": row["id"],
                "variant": "original",
                "domain": row["domain"],
                "question": row["question"],
                "expected_law": row["expected_law"],
                "expected_article": row["expected_article"],
            }
        )
        for v_name, fn in VARIANT_TRANSFORMS:
            all_variants.append(
                {
                    "id": f"{row['id']}_{v_name}",
                    "base_id": row["id"],
                    "variant": v_name,
                    "domain": row["domain"],
                    "question": fn(row["question"]),
                    "expected_law": row["expected_law"],
                    "expected_article": row["expected_article"],
                }
            )

    # Deterministic shuffle to split 200 dev + remaining sealed hashes
    rng.shuffle(all_variants)
    dev_set = all_variants[:target_dev_count]
    sealed_set = all_variants[target_dev_count:]

    dev_out.parent.mkdir(parents=True, exist_ok=True)
    with dev_out.open("w", encoding="utf-8") as f:
        for item in dev_set:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Sealed split: keep ONLY hashes, never gold ids or answers in public repo
    sealed_hashes = [
        hashlib.sha256(f"{item['id']}::{item['question']}".encode("utf-8")).hexdigest()
        for item in sealed_set
    ]
    sealed_manifest = {
        "seed": seed,
        "total_variants": len(all_variants),
        "dev_count": len(dev_set),
        "sealed_count": len(sealed_hashes),
        "sealed_sha256": sealed_hashes,
    }
    sealed_out.write_text(json.dumps(sealed_manifest, indent=2) + "\n", encoding="utf-8")
    return dev_set, sealed_manifest


class Retriever(Protocol):
    def search(self, query: str, top_k: int = 5) -> list[dict]:
        ...


def normalize_persian_query(text: str) -> str:
    return (
        text.replace("\u200c", "")
        .replace("\u200f", "")
        .replace("\u202b", "")
        .replace("\u202c", "")
        .replace("ي", "ی")
        .replace("ك", "ک")
        .translate(ASCII_DIGITS)
        .strip()
    )


class FakeQdrantRetriever:
    """Offline deterministic Qdrant-like retriever for CI Recall@5 and p95 tests."""

    def __init__(self, corpus_docs: Iterable[dict]) -> None:
        self.docs = list(corpus_docs)

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        norm_q = set(normalize_persian_query(query).split())
        scored: list[tuple[int, dict]] = []
        for doc in self.docs:
            doc_tokens = set(normalize_persian_query(doc["text"]).split())
            overlap = len(norm_q & doc_tokens)
            scored.append((overlap, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [doc for _, doc in scored[:top_k]]


@dataclass
class EvalMetrics:
    total: int
    hits_at_k: int
    recall_at_k: float
    p95_ms: float


def evaluate_recall_at_k(
    questions: list[dict],
    retriever: Retriever,
    top_k: int = 5,
) -> EvalMetrics:
    hits = 0
    latencies_ms: list[float] = []

    for q in questions:
        t0 = time.perf_counter()
        results = retriever.search(q["question"], top_k=top_k)
        latencies_ms.append((time.perf_counter() - t0) * 1000.0)

        matched = any(
            r.get("law") == q["expected_law"] and r.get("article") == q["expected_article"]
            for r in results
        )
        if matched:
            hits += 1

    latencies_ms.sort()
    p95_idx = max(0, math.ceil(0.95 * len(latencies_ms)) - 1) if latencies_ms else 0
    p95_ms = latencies_ms[p95_idx] if latencies_ms else 0.0
    total = len(questions)
    return EvalMetrics(
        total=total,
        hits_at_k=hits,
        recall_at_k=(hits / total) if total else 0.0,
        p95_ms=round(p95_ms, 3),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Persian golden set generator & Recall@5 harness")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("generate", help="Generate 200-question dev set and sealed hashes")
    eval_p = sub.add_parser("eval", help="Run offline Recall@5 and p95 harness")
    eval_p.add_argument("--top-k", type=int, default=5)

    args = parser.parse_args()
    if args.cmd == "generate":
        dev_set, manifest = generate_golden_sets()
        print(f"Generated dev={len(dev_set)} sealed={manifest['sealed_count']}")
    elif args.cmd == "eval":
        base = load_source_questions()
        corpus = [
            {
                "id": r["id"],
                "law": r["expected_law"],
                "article": r["expected_article"],
                "text": f"{r['question']} {r['expected_law']} ماده {r['expected_article']}",
            }
            for r in base
        ]
        dev_set = load_source_questions(DEFAULT_DEV_OUT)
        metrics = evaluate_recall_at_k(dev_set, FakeQdrantRetriever(corpus), top_k=args.top_k)
        print(
            f"Recall@{args.top_k}={metrics.recall_at_k:.3f} "
            f"({metrics.hits_at_k}/{metrics.total}), p95={metrics.p95_ms}ms"
        )


if __name__ == "__main__":
    main()
