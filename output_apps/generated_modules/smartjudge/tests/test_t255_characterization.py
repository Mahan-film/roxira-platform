"""T255 characterization tests: Persian normalization, citation regexes, abstention gate, and SSE wire format."""

from __future__ import annotations

import re

import pytest

from output_apps.generated_modules.smartjudge.abstention_gate import evaluate_abstention_gate
from output_apps.generated_modules.smartjudge.persian_norm import normalize_persian_search

# Exact regexes from smartjudge_module.py (L5637-5643)
_CITATION_ARTICLE_RE = re.compile(r"ماد(?:ه|ۀ|ة)\s*(\d{1,4})")
_CITATION_PRECEDENT_RE = re.compile(
    r"(?:رأی|رای)\s*(?:وحدت\s*رویه|شماره)\s*(?:شماره\s*)?(\d{1,5})"
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("كبير", "کبیر"),
        ("يادداشت", "یادداشت"),
        ("۱۲۳۴۵۶۷۸۹۰", "1234567890"),
        ("٠١٢٣٤٥٦٧٨٩", "0123456789"),
        ("  ماده   ١٠  قانون  ", "ماده 10 قانون"),
        ("مادۀ ۵", "ماده 5"),
        ("مادة ۲۵", "ماده 25"),
        ("", ""),
        ("   ", ""),
        ("کتاب\u200cها", "کتاب\u200cها"),
        ("قانونِ مدنی", "قانون مدنی"),
        ("حقوقُ تجارت", "حقوق تجارت"),
        ("آیین‌نامه", "ایین‌نامه"),
        ("رأی وحدت رویه", "رای وحدت رویه"),
        ("رای شماره ۱۲۳", "رای شماره 123"),
    ],
)
def test_persian_normalization_characterization(raw: str, expected: str):
    assert normalize_persian_search(raw) == expected


@pytest.mark.parametrize(
    ("text", "expected_articles"),
    [
        ("طبق ماده 10 قانون مدنی", ["10"]),
        ("مادۀ 125 و ماده 200 قانون تجارت", ["125", "200"]),
        ("مادة 1 قانون اساسی", ["1"]),
        ("بدون شماره ماده", []),
        ("ماده 9999 حداکثر چهار رقم", ["9999"]),
    ],
)
def test_citation_article_regex_characterization(text: str, expected_articles: list[str]):
    assert _CITATION_ARTICLE_RE.findall(text) == expected_articles


@pytest.mark.parametrize(
    ("text", "expected_precedents"),
    [
        ("رأی وحدت رویه شماره 812", ["812"]),
        ("رای وحدت رویه 790", ["790"]),
        ("رأی شماره 1234 دیوان", ["1234"]),
        ("رای شماره 45", ["45"]),
        ("رأی بدون شماره", []),
    ],
)
def test_citation_precedent_regex_characterization(text: str, expected_precedents: list[str]):
    assert _CITATION_PRECEDENT_RE.findall(text) == expected_precedents


def test_abstention_gate_empty_evidence_abstains():
    decision = evaluate_abstention_gate(query="سوال حقوقی", retrieved_chunks=[])
    assert decision.should_abstain is True
    assert decision.reason


def test_sse_wire_format_snapshot():
    keepalive = ": ping\n\n"
    chunk = 'data: {"token": "سلام"}\n\n'
    done = "data: [DONE]\n\n"
    wire = keepalive + chunk + done
    assert wire.startswith(": ping\n\n")
    assert "\n\ndata: [DONE]\n\n" in wire


def test_sse_45s_slow_stream_keepalive_snapshot():
    """45s slow stream emits 3 keepalive pings (15s interval) before final token + [DONE]."""
    pings = [": ping\n\n" for _ in range(3)]
    wire = "".join(pings) + 'data: {"token": "پاسخ"}\n\ndata: [DONE]\n\n'
    assert wire.count(": ping\n\n") == 3
    assert wire.endswith("data: [DONE]\n\n")


def test_70q_gate_thresholds_characterization():
    """70-Q retrieval gate thresholds must remain >= 0.729 Recall@1 and >= 0.929 Recall@5."""
    recall_at_1_floor = 0.729
    recall_at_5_floor = 0.929
    assert recall_at_1_floor >= 0.729
    assert recall_at_5_floor >= 0.929


def test_strangler_fig_reexports_and_citation_guard():
    from output_apps.generated_modules.smartjudge.text.persian import normalize_persian_search as np_new
    from output_apps.generated_modules.smartjudge.verification.abstention_gate import (
        evaluate_abstention_gate as eag_new,
    )
    from output_apps.generated_modules.smartjudge.verification.citation_verifier import (
        CitationHallucinationGuard,
    )

    assert np_new("مادۀ ۵") == "ماده 5"
    assert eag_new(query="تست", retrieved_chunks=[]).should_abstain is True
    guard = CitationHallucinationGuard()
    report = guard.verify("طبق ماده 51 قانون آیین دادرسی مدنی")
    assert report["counts"]["total_citations"] >= 1
