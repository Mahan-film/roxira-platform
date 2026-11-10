"""Tests for Persian Legal Embedding A/B evaluation suite (T16).

Verifies:
  - Dataset validity and completeness (50 questions, all required metadata).
  - Metric calculation accuracy (Recall@1, Recall@5, MRR).
  - Benchmark profile consistency and artifact generation.
"""
from __future__ import annotations

import json

from output_apps.generated_modules.smartjudge.eval import eval_embedding_ab as eval_mod


def test_persian_legal_dataset_contains_fifty_unique_queries():
    dataset = eval_mod.load_dataset(eval_mod.DATASET_PATH)
    assert len(dataset) == 50, f"Expected 50 queries, found {len(dataset)}"

    ids = [q["id"] for q in dataset]
    assert len(set(ids)) == 50, "Query IDs must be unique"

    for item in dataset:
        assert "id" in item
        assert "domain" in item
        assert "question" in item and len(item["question"].strip()) > 10
        assert "expected_law" in item
        assert "expected_article" in item


def test_calculate_metrics_correctness():
    # 5 queries: rank 1, rank 2, rank 5, rank 10, not found (None)
    hits_rank = [1, 2, 5, 10, None]
    metrics = eval_mod.calculate_metrics(hits_rank, k=5)

    assert metrics["recall_at_1"] == 0.2  # 1 out of 5
    assert metrics["recall_at_5"] == 0.6  # 3 out of 5 (1, 2, 5)
    # MRR: (1/1 + 1/2 + 1/5 + 1/10 + 0) / 5 = (1.0 + 0.5 + 0.2 + 0.1) / 5 = 1.8 / 5 = 0.36
    assert metrics["mrr"] == 0.36


def test_calculate_metrics_empty():
    metrics = eval_mod.calculate_metrics([])
    assert metrics["recall_at_1"] == 0.0
    assert metrics["recall_at_5"] == 0.0
    assert metrics["mrr"] == 0.0


def test_benchmark_profiles_completeness():
    profiles = eval_mod.BENCHMARK_PROFILES
    assert "bge-m3" in profiles
    assert "hakim" in profiles
    assert "hakim-small" in profiles

    for _name, p in profiles.items():
        assert p.params_m > 0
        assert p.dim in [384, 768, 1024]
        assert p.ram_inference_mb > 0
        assert p.latency_mean_ms > 0
        assert 0.0 < p.recall_at_5 <= 1.0
        assert 0.0 < p.mrr <= 1.0


def test_benchmark_artifacts_exist_and_are_valid():
    assert eval_mod.RESULTS_JSON_PATH.exists()
    assert eval_mod.RESULTS_MD_PATH.exists()

    with eval_mod.RESULTS_JSON_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    assert data["benchmark"] == "Persian Legal Embedding A/B"
    assert data["dataset"]["total_queries"] == 50
    assert "bge-m3" in data["models"]
    assert "hakim" in data["models"]
    assert "hakim-small" in data["models"]
    assert data["summary"]["winner"] == "MCINext/Hakim"

    md_content = eval_mod.RESULTS_MD_PATH.read_text(encoding="utf-8")
    assert "MCINext/Hakim" in md_content
    assert "BAAI/bge-m3" in md_content
    assert "Recall@5" in md_content
    assert "620 MB" in md_content
