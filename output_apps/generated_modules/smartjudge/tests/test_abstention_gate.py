"""Tests for SmartJudge Hard Abstention Gate, As-Of Temporal Filter, and Deterministic Citation Check."""

import pytest
from output_apps.generated_modules.smartjudge.abstention_gate import (
    DEFAULT_RERANK_THRESHOLD,
    AbstentionDecision,
    deterministic_citation_check,
    evaluate_abstention_gate,
    filter_by_as_of,
)


def test_as_of_temporal_filter_with_valid_dates():
    chunks = [
        {"law_name": "قانون مالیات", "article_no": "100", "valid_from": "1400-01-01", "valid_to": "1403-12-29"},
        {"law_name": "قانون مالیات", "article_no": "100", "valid_from": "1404-01-01", "valid_to": None},
        {"law_name": "قانون تجارت", "article_no": "1", "status": "active"},
        {"law_name": "قانون قدیم", "article_no": "5", "status": "repealed"},
    ]

    # As of 1402: first chunk is valid, second is in the future
    res_1402 = filter_by_as_of(chunks, as_of_date="1402-06-15")
    assert len(res_1402) == 2  # first chunk + قانون تجارت
    assert res_1402[0]["valid_from"] == "1400-01-01"

    # As of 1405: second chunk is valid, first is in the past
    res_1405 = filter_by_as_of(chunks, as_of_date="1405-02-01")
    assert len(res_1405) == 2  # second chunk + قانون تجارت
    assert res_1405[0]["valid_from"] == "1404-01-01"

    # No date: active/unrepealed chunks
    res_none = filter_by_as_of(chunks, as_of_date=None)
    assert len(res_none) == 3
    assert all(c["status"] != "repealed" for c in res_none if "status" in c)


def test_abstention_gate_low_score():
    chunks = [{"law_name": "قانون کار", "article_no": "10"}]
    # Score below threshold -> abstains
    decision = evaluate_abstention_gate("حقوق کارگران چیست؟", chunks, rerank_score=0.20, rerank_threshold=0.35)
    assert decision.should_abstain is True
    assert decision.reason == "low_score"
    assert "پایین‌تر از آستانه" in decision.message

    # Empty chunks -> abstains
    decision_empty = evaluate_abstention_gate("سوال نامربوط", [])
    assert decision_empty.should_abstain is True
    assert decision_empty.reason == "low_score"


def test_abstention_gate_version_conflict():
    chunks = [
        {"law_name": "قانون صدور چک", "article_no": "12", "status": "active"},
        {"law_name": "قانون صدور چک", "article_no": "12", "status": "amended"},
    ]
    # No as-of date provided when conflicting active and amended versions exist
    decision = evaluate_abstention_gate("چک تضمین شده چیست؟", chunks, rerank_score=0.8)
    assert decision.should_abstain is True
    assert decision.reason == "version_conflict"
    assert "تعارض" in decision.message


def test_abstention_gate_out_of_scope():
    chunks = [{"law_name": "قانون مدنی", "article_no": "10"}]
    query = "چگونه با پایتون و react یک وبسایت بنویسیم؟"
    decision = evaluate_abstention_gate(query, chunks, rerank_score=0.8)
    assert decision.should_abstain is True
    assert decision.reason == "out_of_scope"
    assert "خارج از پیکره" in decision.message


def test_abstention_gate_false_premise():
    chunks = [{"law_name": "قانون کار", "article_no": "51"}]
    query = "طبق کدام ماده قانون کار، ساعت کار هفتگی ۶۰ ساعت است؟"
    decision = evaluate_abstention_gate(query, chunks, rerank_score=0.85)
    assert decision.should_abstain is True
    assert decision.reason == "false_premise"
    assert "فرضیه" in decision.message


def test_abstention_gate_pass_valid_query():
    chunks = [
        {"law_name": "قانون مدنی", "article_no": "10", "status": "active", "source_tier": "official"}
    ]
    decision = evaluate_abstention_gate("آیا قراردادهای خصوصی معتبر هستند؟", chunks, rerank_score=0.9)
    assert decision.should_abstain is False
    assert decision.reason is None


def test_deterministic_citation_check():
    retrieved = [
        {"law_name": "قانون مجازات اسلامی", "article_no": "618", "source_tier": "official"},
        {"law_name": "قانون مدنی", "article_no": "10", "source_tier": "unofficial"},
    ]

    model_citations = [
        {"law_name": "قانون مجازات اسلامی", "article_no": "618", "source_tier": "official"},
        {"law_name": "قانون تجارت", "article_no": "310", "source_tier": "official"},  # NOT in retrieved
    ]

    valid, dropped, unofficial_alone = deterministic_citation_check(model_citations, retrieved)
    assert len(valid) == 1
    assert valid[0]["article_no"] == "618"
    assert len(dropped) == 1
    assert dropped[0]["article_no"] == "310"
    assert unofficial_alone is False


def test_deterministic_citation_check_unofficial_standing_alone():
    retrieved = [
        {"law_name": "بخشنامه مالیاتی", "article_no": "5", "source_tier": "unofficial"},
    ]
    model_citations = [
        {"law_name": "بخشنامه مالیاتی", "article_no": "5", "source_tier": "unofficial"},
    ]
    valid, dropped, unofficial_alone = deterministic_citation_check(model_citations, retrieved)
    assert len(valid) == 1
    assert len(dropped) == 0
    # An unofficial source never stands alone without official/secondary
    assert unofficial_alone is True
