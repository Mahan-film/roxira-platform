from __future__ import annotations

import re
from pathlib import Path

from scripts.eval.persian_golden_set import (
    DEFAULT_SOURCE,
    FakeQdrantRetriever,
    evaluate_recall_at_k,
    generate_golden_sets,
    load_source_questions,
)


def test_generate_200_dev_and_sealed_hashes(tmp_path: Path) -> None:
    dev_out = tmp_path / "dev_200.jsonl"
    sealed_out = tmp_path / "sealed_hashes.json"

    dev_set, manifest = generate_golden_sets(
        source_path=DEFAULT_SOURCE,
        dev_out=dev_out,
        sealed_out=sealed_out,
        target_dev_count=200,
        seed=42,
    )

    assert len(dev_set) == 200
    assert dev_out.exists()
    assert sealed_out.exists()
    assert manifest["dev_count"] == 200
    assert manifest["sealed_count"] > 0
    for h in manifest["sealed_sha256"]:
        assert re.fullmatch(r"[0-9a-f]{64}", h)


def test_recall_at_5_and_p95_offline_harness(tmp_path: Path) -> None:
    dev_out = tmp_path / "dev_200.jsonl"
    sealed_out = tmp_path / "sealed_hashes.json"
    dev_set, _ = generate_golden_sets(
        source_path=DEFAULT_SOURCE,
        dev_out=dev_out,
        sealed_out=sealed_out,
        target_dev_count=200,
        seed=42,
    )

    base = load_source_questions(DEFAULT_SOURCE)
    corpus = [
        {
            "id": r["id"],
            "law": r["expected_law"],
            "article": r["expected_article"],
            "text": f"{r['question']} {r['expected_law']} ماده {r['expected_article']}",
        }
        for r in base
    ]

    metrics = evaluate_recall_at_k(dev_set, FakeQdrantRetriever(corpus), top_k=5)
    assert metrics.total == 200
    assert metrics.recall_at_k >= 0.85
    assert metrics.p95_ms >= 0.0
