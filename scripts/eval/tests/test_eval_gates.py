"""Offline unit tests for scripts/eval/eval_gates.py (T268 R25 eval harness gates)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts" / "eval" / "eval_gates.py"


@pytest.fixture(scope="module")
def eg():
    spec = importlib.util.spec_from_file_location("eval_gates", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sample_manifest() -> dict:
    cases = [
        {
            "id": "dev-1",
            "split": "dev",
            "question": "مهلت واخواهی در دادگاه حقوقی چند روز است؟",
            "expected_law": "قانون آیین دادرسی مدنی",
            "expected_articles": ["306"],
            "stt_heard": "مهلت واخواهی تو دادگاه حقوقی چند روزه؟",
        },
        {
            "id": "cal-1",
            "split": "calibration",
            "question": "حکم صدور چک سفید امضاء چیست؟",
            "expected_law": "قانون صدور چک",
            "expected_articles": ["13"],
        },
        {
            "id": "seal-1",
            "split": "sealed",
            "question": "شرایط فسخ قرارداد اجاره در قانون مدنی چیست؟",
            "expected_law": "قانون مدنی",
            "expected_articles": ["496"],
        },
    ]
    sealed_hash = hashlib.sha256(
        f"{cases[2]['id']}::{cases[2]['question']}".encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": 1,
        "corpus_snapshot": "laws_v6@sha256:deadbeef",
        "as_of_date": "2026-11-24",
        "sealed_hashes": [sealed_hash],
        "cases": cases,
    }


def test_validate_golden_manifest_accepts_valid_dev_cal_sealed(eg):
    manifest = _sample_manifest()
    assert eg.validate_golden_manifest(manifest) == []


def test_validate_golden_manifest_requires_snapshot_and_as_of_date(eg):
    manifest = _sample_manifest()
    manifest["corpus_snapshot"] = ""
    manifest["as_of_date"] = "not-a-date"
    errs = eg.validate_golden_manifest(manifest)
    assert any("corpus_snapshot" in e for e in errs)
    assert any("as_of_date" in e for e in errs)


def test_validate_golden_manifest_blocks_sealed_leakage_and_hash_tamper(eg):
    manifest = _sample_manifest()
    manifest["cases"][0]["question"] = manifest["cases"][2]["question"]
    errs = eg.validate_golden_manifest(manifest)
    assert any("sealed split leaks" in e for e in errs)

    manifest2 = _sample_manifest()
    manifest2["sealed_hashes"] = ["0" * 64]
    errs2 = eg.validate_golden_manifest(manifest2)
    assert any("sealed_hashes mismatch" in e for e in errs2)


def test_pr_gate_runs_under_3_minutes_with_zero_llm_cost(eg):
    manifest = _sample_manifest()
    docs = [
        {
            "law_name": "قانون آیین دادرسی مدنی",
            "article_no": "306",
            "text": "مهلت واخواهی در دادگاه حقوقی بیست روز است",
        },
        {
            "law_name": "قانون صدور چک",
            "article_no": "13",
            "text": "حکم صدور چک سفید امضاء",
        },
    ]
    retriever = eg.SimpleTokenRetriever(docs)
    report = eg.run_pr_gate(manifest, retriever, top_k=5, min_recall_at_5=1.0)

    assert report["passed"] is True
    assert report["llm_cost_usd"] == 0.0
    assert report["elapsed_s"] < 180.0
    assert report["corpus_snapshot"] == "laws_v6@sha256:deadbeef"
    assert report["as_of_date"] == "2026-11-24"
    assert report["splits"]["dev"]["recall_at_5"] == 1.0
    assert report["splits"]["calibration"]["recall_at_5"] == 1.0
    assert report["splits"]["sealed"]["evaluated_in_pr_gate"] is False


def test_pr_gate_fails_when_time_budget_exceeded(eg):
    manifest = _sample_manifest()
    retriever = eg.SimpleTokenRetriever([])
    report = eg.run_pr_gate(manifest, retriever, max_seconds=0.0)
    assert report["passed"] is False
    assert any("max_seconds" in e for e in report["errors"])


def test_voice_subset_reports_clean_vs_transcript_recall_gap(eg):
    class ExactCleanRetriever:
        def search(self, query: str, top_k: int = 5):
            if "دادگاه" in query and "پاسخ" in query:
                return [{"law_name": "قانون کار", "article_no": "10"}]
            if "قانون کار" in query:
                return [{"law_name": "قانون کار", "article_no": "10"}]
            return [{"law_name": "سایر", "article_no": "1"}]

    pairs = [
        {
            "id": "v1",
            "clean_question": "قرارداد کار در قانون کار چه شرایطی دارد؟",
            "transcript_question": "قرارداد کل تو قانن کل چه شرایطی داره؟",
            "expected_law": "قانون کار",
            "expected_article": "10",
        },
        {
            "id": "v2",
            "clean_question": "قانون کار ماده ۱۰",
            "transcript_question": "قانون کار ماده 10",
            "expected_law": "قانون کار",
            "expected_article": "10",
        },
    ]
    rep = eg.evaluate_voice_subset(pairs, ExactCleanRetriever(), top_k=5)
    assert rep["n_pairs"] == 2
    assert rep["clean_recall_at_5"] == 1.0
    assert rep["transcript_recall_at_5"] == 0.5
    assert rep["recall_gap_at_5"] == 0.5


def test_resolve_pinned_judge_id_from_real_models_yaml(eg):
    judge_id = eg.resolve_pinned_judge_id(ROOT / "config" / "models.yaml", role="reviewer")
    assert isinstance(judge_id, str) and len(judge_id) > 0


def test_nightly_judge_uses_pinned_id_and_enforces_cost_cap(eg):
    manifest = _sample_manifest()
    manifest["cases"].append({
        "id": "cal-2",
        "split": "calibration",
        "question": "شرایط ابطال اجرائیه چک چیست؟",
        "expected_law": "قانون صدور چک",
        "expected_articles": ["14"],
    })
    seen_models: list[str] = []

    def fake_judge(case: dict, model_id: str) -> dict:
        seen_models.append(model_id)
        return {"passed": True, "score": 0.9, "cost_usd": 0.05}

    rep = eg.run_nightly_judge(
        manifest,
        fake_judge,
        models_yaml_path=ROOT / "config" / "models.yaml",
        judge_role="reviewer",
        split="calibration",
        max_cost_usd=0.05,
    )
    expected_id = eg.resolve_pinned_judge_id(ROOT / "config" / "models.yaml", role="reviewer")
    assert rep["judge_model_id"] == expected_id
    assert seen_models == [expected_id]
    assert rep["evaluated"] == 1
    assert rep["skipped_for_budget"] == 1
    assert rep["spent_usd"] == 0.05


def test_cli_validate_and_pr_gate_and_nightly_dry_run(eg, tmp_path):
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_sample_manifest(), ensure_ascii=False), encoding="utf-8")

    assert eg.main(["validate", "--manifest", str(manifest_path)]) == 0
    assert eg.main(["pr-gate", "--manifest", str(manifest_path)]) == 0
    assert eg.main(["nightly-judge", "--manifest", str(manifest_path), "--dry-run"]) == 0
