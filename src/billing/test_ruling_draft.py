"""Tests for the pure draft-ruling core. Sync fakes only; no network."""

import ast
import json
import re
from pathlib import Path

import pytest

from output_apps.generated_modules.smartjudge import ruling_draft as rd
from output_apps.generated_modules.smartjudge.ruling_draft import (
    BANNER,
    RulingCase,
    generate_ruling_draft,
)

ARTICLES = [
    {"law_name": "قانون مدنی", "article_no": "219", "text": "عقودی که بر طبق قانون واقع شده باشد لازم‌الاتباع است."},
    {"law_name": "قانون مدنی", "article_no": "220", "text": "عقود نه تنها متعاملین را ملزم می‌نماید."},
]
PENAL = [{"law_name": "قانون مجازات اسلامی", "article_no": "18", "text": "مجازات‌ها..."}]
FORBIDDEN = ("APPROVED", "FINAL", "قوه قضائیه")


def make_case(court_type="civil", **kw):
    base = dict(
        court_type=court_type,
        claimant="الف",
        respondent="ب",
        facts="شرح وقایع",
        claims="مطالبه وجه",
        evidence=[{"title": "قرارداد", "text": "متن قرارداد"}],
        jurisdiction="تهران",
    )
    base.update(kw)
    return RulingCase(**base)


def llm_json(articles=None, operative="حکم به پرداخت", **over):
    if articles is None:
        articles = [{"law_name": "قانون مدنی", "article_no": "219"}]
    data = {
        "facts_summary": "خلاصه",
        "claims_summary": "خواسته",
        "evidence_review": ["قرارداد"],
        "issues": ["الزام"],
        "legal_reasoning": [{"issue": "الزام", "articles": articles, "reasoning": "به دلیل ماده"}],
        "proposed_operative_part": operative,
        "uncertainties": [],
        "missing_information": [],
    }
    data.update(over)
    return json.dumps(data, ensure_ascii=False)


def verifier(accept=None):
    """Fake validator accepting the given (law, article) pairs; None = accept all cited."""

    def verify(text):
        m = re.match(r"(.+) ماده (.+)$", text)
        law, art = m.group(1), m.group(2)
        if accept is None or (law, art) in accept:
            return {"validated_articles": [{"law_name": law, "article_no": art}]}
        return {"validated_articles": []}

    return verify


def run(case, response, rows=ARTICLES, verify=None):
    prompts = []

    def llm(prompt):
        prompts.append(prompt)
        if isinstance(response, Exception):
            raise response
        return response

    out = generate_ruling_draft(
        case, retrieve=lambda c: rows, call_llm=llm, verify_citations=verify or verifier()
    )
    out["_prompts"] = prompts
    return out


def assert_invariants(out):
    assert out["status"] in ("AI_DRAFT_UNVERIFIED", "INSUFFICIENT_BASIS")
    assert out["requires_human_review"] is True
    assert out["banner"] == BANNER
    blob = json.dumps({k: v for k, v in out.items() if k != "_prompts"}, ensure_ascii=False)
    for word in FORBIDDEN:
        assert word not in blob


def test_happy_civil_two_articles():
    resp = llm_json(
        articles=[
            {"law_name": "قانون مدنی", "article_no": "219"},
            {"law_name": "قانون مدنی", "article_no": "۲۲۰"},
        ]
    )
    out = run(make_case(), resp)
    assert out["status"] == "AI_DRAFT_UNVERIFIED"
    assert len(out["legal_reasoning"][0]["articles"]) == 2
    assert out["removed_citations"] == []
    assert out["proposed_operative_part"] == "حکم به پرداخت"
    assert_invariants(out)


def test_prompt_contains_only_retrieved_articles_and_caps():
    rows = [
        {"law_name": "قانون " + str(i), "article_no": str(i), "text": "x" * 3000} for i in range(20)
    ]
    out = run(make_case(), llm_json(articles=[{"law_name": "قانون 0", "article_no": "0"}]), rows=rows)
    prompt = out["_prompts"][0]
    assert "قانون 11 ماده 11" in prompt
    assert "قانون 12 ماده 12" not in prompt
    assert "x" * 1501 not in prompt
    assert "اطلاعات کافی نیست" in prompt


def test_hallucinated_article_removed_and_reported():
    resp = llm_json(
        articles=[
            {"law_name": "قانون مدنی", "article_no": "219"},
            {"law_name": "قانون مدنی", "article_no": "999"},
        ]
    )
    out = run(make_case(), resp)
    assert out["status"] == "AI_DRAFT_UNVERIFIED"
    assert out["legal_reasoning"][0]["articles"] == [{"law_name": "قانون مدنی", "article_no": "219"}]
    assert out["removed_citations"] == [
        {"law_name": "قانون مدنی", "article_no": "999", "reason": "not_in_retrieved_set"}
    ]


def test_retrieved_but_rejected_by_verifier_removed():
    resp = llm_json(
        articles=[
            {"law_name": "قانون مدنی", "article_no": "219"},
            {"law_name": "قانون مدنی", "article_no": "220"},
        ]
    )
    out = run(make_case(), resp, verify=verifier({("قانون مدنی", "219")}))
    assert out["legal_reasoning"][0]["articles"] == [{"law_name": "قانون مدنی", "article_no": "219"}]
    assert out["removed_citations"][0]["reason"] == "rejected_by_verify_citations"


def test_verifier_accepts_repo_handler_shape():
    def verify(text):
        return {"validated_articles": [{"law": "قانون مدنی", "article": "۲۱۹"}]}

    out = run(make_case(), llm_json(), verify=verify)
    assert out["status"] == "AI_DRAFT_UNVERIFIED"


def test_verifier_exception_removes_citation():
    def verify(text):
        raise RuntimeError("boom")

    out = run(make_case(), llm_json(), verify=verify)
    assert out["status"] == "INSUFFICIENT_BASIS"
    assert out["removed_citations"]


def test_all_removed_is_insufficient():
    out = run(make_case(), llm_json(articles=[{"law_name": "قانون ساختگی", "article_no": "1"}]))
    assert out["status"] == "INSUFFICIENT_BASIS"
    assert out["proposed_operative_part"] == ""
    assert len(out["removed_citations"]) == 1
    assert out["missing_information"]
    assert_invariants(out)


def test_empty_retrieval():
    out = run(make_case(), llm_json(), rows=[])
    assert out["status"] == "INSUFFICIENT_BASIS"
    assert out["proposed_operative_part"] == ""
    assert out["removed_citations"] == []
    assert out["_prompts"] == []
    assert_invariants(out)


def test_retrieve_exception_generic():
    def bad(case):
        raise RuntimeError("secret facts")

    out = generate_ruling_draft(make_case(), retrieve=bad, call_llm=lambda p: "", verify_citations=verifier())
    assert out["status"] == "INSUFFICIENT_BASIS"
    assert "secret" not in json.dumps(out, ensure_ascii=False)


def test_criminal_prefix_and_punishment_stripped_without_penal_article():
    out = run(make_case("criminal"), llm_json(operative="حبس به مدت ۲ سال"))
    assert out["proposed_operative_part"] == "پیشنهاد (غیرقطعی): مجازات توسط مرجع صالح تعیین می‌شود"
    assert_invariants(out)


def test_criminal_punishment_kept_with_penal_article():
    resp = llm_json(
        articles=[{"law_name": "قانون مجازات اسلامی", "article_no": "18"}],
        operative="حبس به مدت 2 سال",
    )
    out = run(make_case("criminal"), resp, rows=PENAL)
    assert out["proposed_operative_part"] == "پیشنهاد (غیرقطعی): حبس به مدت 2 سال"


def test_criminal_nonpunitive_text_gets_prefix_once():
    out = run(make_case("criminal"), llm_json(operative="پیشنهاد (غیرقطعی): ارجاع به کارشناس"))
    assert out["proposed_operative_part"] == "پیشنهاد (غیرقطعی): ارجاع به کارشناس"


def test_civil_has_no_prefix():
    out = run(make_case(), llm_json())
    assert not out["proposed_operative_part"].startswith("پیشنهاد")


@pytest.mark.parametrize("raw", ["not json", "", "[1, 2]", '"str"', "null", "42", None, 5])
def test_malformed_or_non_dict_is_insufficient(raw):
    out = run(make_case(), raw)
    assert out["status"] == "INSUFFICIENT_BASIS"
    assert_invariants(out)


def test_llm_exception_generic_message():
    out = run(make_case(), RuntimeError("facts leak"))
    assert out["status"] == "INSUFFICIENT_BASIS"
    assert "leak" not in json.dumps(out, ensure_ascii=False)


def test_wrong_types_replaced_and_noted():
    data = {
        "facts_summary": 5,
        "claims_summary": ["x"],
        "evidence_review": "not a list",
        "issues": [1, "ok"],
        "legal_reasoning": [
            "junk",
            {"issue": "a", "articles": ["junk", None, {"law_name": 1, "article_no": None}], "reasoning": "r"},
            {"issue": "b", "articles": [{"law_name": "قانون مدنی", "article_no": 219}], "reasoning": 7},
        ],
        "proposed_operative_part": None,
    }
    out = run(make_case(), json.dumps(data, ensure_ascii=False))
    assert out["status"] == "AI_DRAFT_UNVERIFIED"
    assert out["facts_summary"] == "" and out["claims_summary"] == ""
    assert out["evidence_review"] == [] and out["issues"] == ["ok"]
    assert out["uncertainties"] == []
    assert out["proposed_operative_part"] == ""
    assert out["legal_reasoning"][0]["reasoning"] == ""
    assert out["missing_information"]
    assert_invariants(out)


def test_legal_reasoning_wrong_type_insufficient():
    out = run(make_case(), llm_json(legal_reasoning="x"))
    assert out["status"] == "INSUFFICIENT_BASIS"


def test_fenced_json():
    out = run(make_case(), "```json\n" + llm_json() + "\n```")
    assert out["status"] == "AI_DRAFT_UNVERIFIED"


def test_forbidden_words_scrubbed_from_model_text():
    out = run(make_case(), llm_json(operative="APPROVED final قوه قضائیه حکم"))
    assert_invariants(out)


def test_evidence_limits():
    with pytest.raises(ValueError):
        make_case(evidence=[{"title": "t", "text": "x"}] * 21)
    make_case(evidence=[{"title": "t", "text": "x" * 5000}])
    make_case(evidence=[{"title": "t", "text": "x"}] * 20)
    with pytest.raises(ValueError):
        make_case(evidence=[{"title": "t" * 201, "text": "x"}])
    with pytest.raises(ValueError):
        make_case(evidence=[{"title": "t", "text": "x" * 6001}])


def test_other_length_and_type_validation():
    with pytest.raises(ValueError):
        make_case(facts="x" * 12001)
    with pytest.raises(ValueError):
        make_case(claims="x" * 6001)
    with pytest.raises(ValueError):
        make_case(claimant="")
    with pytest.raises(ValueError):
        make_case(respondent="x" * 301)
    with pytest.raises(ValueError):
        make_case(jurisdiction="x" * 301)


def test_invalid_court_type():
    with pytest.raises(ValueError):
        make_case("tax")  # administrative is now a valid court type


def test_validation_error_does_not_leak_content():
    with pytest.raises(ValueError) as exc:
        make_case(facts="راز" * 5000)
    assert "راز" not in str(exc.value)


def test_module_is_valid_python_311():
    src = Path(rd.__file__).read_text(encoding="utf-8")
    ast.parse(src, feature_version=(3, 11))
