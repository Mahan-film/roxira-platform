"""Core-articles-by-claim-type matcher and the ruling prompt rules. Fakes only: no network, no LLM."""

import asyncio

import pytest

from output_apps.generated_modules.smartjudge import drafting_core_articles as dca
from output_apps.generated_modules.smartjudge import ruling_draft as rd

LOAN_CLAIMS = "خواهان ۲۰۰ میلیون ریال قرض داده؛ خواسته: اصل وجه، خسارت تأخیر تأدیه، هزینه دادرسی"
LOAN_FACTS = "قرارداد و رسید بانکی پیوست است و خوانده در سررسید نپرداخته است"


def pairs(text):
    return {(t["law_names"][0], t["article_no"]) for t in dca.core_targets(text)}


def test_yaml_loads_and_every_rule_is_valid():
    rules = dca.load_rules()
    ids = [r["id"] for r in rules]
    assert len(ids) == len(set(ids)) and "loan" in ids
    assert {r["status"] for r in rules} <= {"confirmed", "needs_lawyer"}


def test_loan_claim_selects_the_governing_articles():
    got = pairs(LOAN_CLAIMS + "\n" + LOAN_FACTS)
    cpc = "قانون آیین دادرسی مدنی"
    assert {(cpc, "198"), (cpc, "515"), (cpc, "519"), (cpc, "522"), ("قانون مدنی", "648")} <= got


def test_needs_lawyer_rules_are_never_selected():
    got = pairs("مطالبه اجرت المثل و تخلیه و خسارت تاخیر تادیه و قرض")
    assert ("قانون مدنی", "336") not in got and ("قانون مدنی", "652") not in got
    assert all(t["rule_id"] not in ("ujrat_ol_mesl", "eviction_lease", "loan_grace") for t in dca.core_targets("اجرت المثل تخلیه قرض"))


def test_normalisation_and_whole_word_triggers():
    assert ("قانون مدنی", "648") in pairs("قرض‌الحسنه")  # ZWNJ, prefix match
    assert any(t["rule_id"] == "delay_damages" for t in dca.core_targets("خسارت تاخیر تادیه"))
    assert any(t["rule_id"] == "delay_damages" for t in dca.core_targets("خسارت تأخیر تأدیه"))  # hamza forms
    # «رسید» must not fire on «رسیدگی»
    assert not any(t["rule_id"] == "documentary_evidence" for t in dca.core_targets("رسیدگی به دعوا"))
    assert any(t["rule_id"] == "documentary_evidence" for t in dca.core_targets("رسید بانکی"))


def test_unrelated_or_empty_text_selects_nothing_and_cap_holds():
    assert dca.core_targets("") == [] and dca.core_targets(None) == []
    assert dca.core_targets("طلاق توافقی و حضانت فرزند") == []
    assert len(dca.core_targets(LOAN_CLAIMS + LOAN_FACTS, limit=3)) == 3
    assert len(dca.core_targets(LOAN_CLAIMS + LOAN_FACTS)) <= dca.MAX_CORE_ARTICLES


def test_fetch_returns_only_rows_the_lookup_really_returns():
    async def fetch(law_names, article_no):
        if article_no == "648":
            return {"law_name": "قانون مدنی", "article_no": "648", "summary": "قرض عقدی است"}
        if article_no == "198":  # wrong article returned -> must be dropped
            return {"law_name": "قانون مدنی", "article_no": "199", "summary": "x"}
        if article_no == "519":  # wrong law -> dropped
            return {"law_name": "قانون تجارت", "article_no": "519", "summary": "x"}
        if article_no == "522":
            raise RuntimeError("down")
        return None

    rows = asyncio.run(dca.fetch_core_articles(LOAN_CLAIMS, fetch))
    assert rows == [{"law_name": "قانون مدنی", "article_no": "648", "text": "قرض عقدی است"}]


def test_merge_puts_core_first_and_dedupes():
    core = [{"law_name": "قانون مدنی", "article_no": "648", "text": "a"}]
    vec = [
        {"law_name": "قانون مدنی", "article_no": "۶۴۸".translate(rd._DIGIT_TRANS), "text": "dup"},
        {"law_name": "قانون مدنی", "article_no": "10", "text": "b"},
    ]
    merged = dca.merge_articles(core, vec, 12)
    assert [m["article_no"] for m in merged] == ["648", "10"] and merged[0]["text"] == "a"
    assert len(dca.merge_articles(core, vec, 1)) == 1


@pytest.mark.parametrize("raw,ok", [('{"a": 1}', True), ('```json\n{"a": 1}\n```', True), ("[1]", False), ("hi", False), (None, False)])
def test_is_parseable_draft(raw, ok):
    assert rd.is_parseable_draft(raw) is ok


def test_prompt_demands_an_operative_part_when_supported_and_is_per_claim():
    case = rd.RulingCase(
        court_type="civil", claimant="الف", respondent="ب", facts=LOAN_FACTS, claims=LOAN_CLAIMS,
        evidence=[{"title": "رسید", "text": "واریز"}],
    )
    prompt = rd._build_prompt(case, [{"law_name": "قانون مدنی", "article_no": "648", "text": "قرض"}])
    assert rd.OPERATIVE_PART_RULES in prompt
    assert "حتماً نتیجهٔ پیشنهادی" in prompt
    assert "فقط برای خواسته‌ای" in prompt and "نه برای کل پرونده" in prompt
    assert "خسارت تأخیر تأدیه" in prompt  # the per-claim example for index-dependent damages
