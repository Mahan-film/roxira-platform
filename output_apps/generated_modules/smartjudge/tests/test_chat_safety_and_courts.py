"""Offline tests: chat safety helpers, digits, extra court types. No network."""

import json

import pytest

from output_apps.generated_modules.smartjudge import chat_safety as cs
from output_apps.generated_modules.smartjudge import ruling_draft as rd


def test_to_latin_digits():
    assert cs.to_latin_digits("ماده ۱۰۸۲ و ٣٤ و 5") == "ماده 1082 و 34 و 5"
    assert cs.to_latin_digits(None) is None


def test_is_grounded_ignores_fallback_rows():
    assert not cs.is_grounded([], [])
    assert not cs.is_grounded([{"match_level": "FALLBACK"}], [{"match_level": "FALLBACK"}])
    assert cs.is_grounded([{"title": "x"}], [])


def test_unverified_articles_stripped_verified_kept():
    out = cs.strip_unverified_articles(
        "طبق ماده ۱۰ و ماده 99 قانون", [{"law": "قانون مدنی", "article": "10"}]
    )
    assert "ماده 10" in out
    assert "99" not in out
    assert cs.UNVERIFIED_ARTICLE_MARK in out


def test_general_knowledge_answer_has_notice_and_disclaimer():
    out = cs.finalize_general_knowledge_answer("طبق ماده ۱۲۳ حکم است", [])
    assert out.startswith(cs.GENERAL_KNOWLEDGE_NOTICE)
    assert out.endswith(cs.CHAT_DISCLAIMER)
    assert "123" not in out


def _case(court_type):
    return rd.RulingCase(court_type, "الف", "ب", "وقایع", "خواسته", [])


def _run(court_type, operative):
    llm = {
        "facts_summary": "سال ۱۴۰۲",
        "claims_summary": "c",
        "evidence_review": [],
        "issues": [],
        "legal_reasoning": [
            {
                "issue": "i",
                "articles": [{"law_name": "قانون کار", "article_no": "۲۷"}],
                "reasoning": "r",
            }
        ],
        "proposed_operative_part": operative,
        "uncertainties": [],
        "missing_information": [],
    }
    prompts = []

    def call(prompt):
        prompts.append(prompt)
        return json.dumps(llm, ensure_ascii=False)

    out = rd.generate_ruling_draft(
        _case(court_type),
        retrieve=lambda c: [{"law_name": "قانون کار", "article_no": "27", "text": "t"}],
        call_llm=call,
        verify_citations=lambda t: {"validated_articles": [{"law": "قانون کار", "article": "27"}]},
    )
    return out, prompts[0]


@pytest.mark.parametrize("ct", rd.NONFINAL_COURT_TYPES)
def test_new_court_types_nonfinal_and_latin_digits(ct):
    out, prompt = _run(ct, "محکومیت به پرداخت ۵۰۰ میلیون ریال")
    assert out["status"] == rd.STATUS_DRAFT
    assert out["banner"] == rd.BANNER
    assert out["proposed_operative_part"].startswith("پیشنهاد (غیرقطعی)")
    assert "500" in out["proposed_operative_part"]
    assert out["facts_summary"] == "سال 1402"
    assert rd.COURT_TYPES[ct]["name"] in prompt
    assert rd.COURT_TYPES[ct]["checklist"] in prompt


def test_civil_has_no_prefix_and_criminal_rules_stay_criminal_only():
    out, _ = _run("civil", "حکم به حبس")
    assert out["proposed_operative_part"] == "حکم به حبس"
    out, _ = _run("labor", "حبس")
    assert "حبس" in out["proposed_operative_part"]
    out, _ = _run("criminal", "حبس")
    assert out["proposed_operative_part"].endswith(rd.PUNISHMENT_PLACEHOLDER)


def test_insufficient_basis_applies_to_new_courts():
    out = rd.generate_ruling_draft(
        _case("family"),
        retrieve=lambda c: [],
        call_llm=lambda p: "",
        verify_citations=lambda t: {},
    )
    assert out["status"] == rd.STATUS_INSUFFICIENT
