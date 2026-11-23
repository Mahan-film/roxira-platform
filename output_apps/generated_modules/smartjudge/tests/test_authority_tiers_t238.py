"""T238 (#977): Authority tiers, legislative status tagging, and 20 adversarial gate tests."""

from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge.abstention_gate import (
    evaluate_abstention_gate,
)
from output_apps.generated_modules.smartjudge.authority_tiers import (
    AUTHORITY_TIER_1,
    AUTHORITY_TIER_2,
    AUTHORITY_TIER_3,
    BILL_NOT_YET_LAW_SENTENCE,
    NON_BINDING_LABEL,
    STATUS_AMENDED,
    STATUS_BILL_UNENACTED,
    STATUS_ENACTED,
    STATUS_REPEALED,
    classify_authority_tier,
    classify_chunk_status,
    tag_chunk_authority,
)
from output_apps.generated_modules.smartjudge.legal_graph.law_ingester_pipeline import (
    LawArticle,
)


def test_classify_authority_tiers_and_non_binding():
    # Tier 1: constitution, Majlis laws, unification rulings
    assert classify_authority_tier(law_name="قانون اساسی جمهوری اسلامی ایران") == (AUTHORITY_TIER_1, False)
    assert classify_authority_tier(law_name="قانون مدنی") == (AUTHORITY_TIER_1, False)
    assert classify_authority_tier(law_name="رأی وحدت رویه شماره ۸۱۲ هیئت عمومی دیوان عالی کشور") == (AUTHORITY_TIER_1, False)

    # Tier 2: regulations, circulars, advisory opinions (non-binding)
    assert classify_authority_tier(law_name="آیین‌نامه اجرایی قانون صدور چک") == (AUTHORITY_TIER_2, False)
    assert classify_authority_tier(law_name="بخشنامه سازمان امور مالیاتی") == (AUTHORITY_TIER_2, False)
    assert classify_authority_tier(law_name="نظریه مشورتی شماره ۷/۱۴۰۲/۱۲۳ اداره کل حقوقی قوه قضاییه") == (AUTHORITY_TIER_2, True)

    # Tier 3: single-branch rulings, commentary, FAQ, unknown (fail closed)
    assert classify_authority_tier(law_name="رأی شعبه ۱۲ دادگاه تجدیدنظر تهران") == (AUTHORITY_TIER_3, False)
    assert classify_authority_tier(law_name="شرح و تفسیر قانون تجارت") == (AUTHORITY_TIER_3, False)
    assert classify_authority_tier(law_name="پرسش و پاسخ حقوقی درباره چک") == (AUTHORITY_TIER_3, False)
    assert classify_authority_tier(law_name="یادداشت نامشخص") == (AUTHORITY_TIER_3, False)


def test_classify_chunk_statuses():
    assert classify_chunk_status(law_name="قانون مدنی", text="ماده ۱۰ قراردادهای خصوصی نافذ است.") == STATUS_ENACTED
    assert classify_chunk_status(law_name="قانون صدور چک اصلاحی ۱۴۰۰", text="ماده ۳ اصلاحیه...") == STATUS_AMENDED
    assert classify_chunk_status(law_name="قانون قدیم", text="این ماده به موجب قانون جدید منسوخ گردید.") == STATUS_REPEALED
    assert classify_chunk_status(law_name="لایحه جامع وکالت", text="ماده ۱ طرح قانونی در دست بررسی مجلس") == STATUS_BILL_UNENACTED


def test_ingestion_pipeline_tags_authority_tier_and_status():
    a_tier1 = LawArticle(law_name="قانون صدور چک", article_no=1, text="انواع چک عبارت است از...").finalize()
    p1 = a_tier1.payload()
    assert p1["authority_tier"] == AUTHORITY_TIER_1
    assert p1["non_binding"] is False
    assert p1["authority_status"] == STATUS_ENACTED
    assert p1["source_tier"] == "official"

    a_advisory = LawArticle(
        law_name="نظریه مشورتی شماره ۷/۱۴۰۰/۵۰",
        article_no=1,
        text="به نظر اداره کل حقوقی قوه قضاییه...",
    ).finalize()
    p2 = a_advisory.payload()
    assert p2["authority_tier"] == AUTHORITY_TIER_2
    assert p2["non_binding"] is True
    assert p2["source_tier"] == "secondary"

    a_bill = LawArticle(
        law_name="لایحه تجارت الکترونیک جدید",
        article_no=5,
        text="پیش‌نویس قانون در دست بررسی مجلس",
    ).finalize()
    p_bill = a_bill.payload()
    assert p_bill["authority_status"] == STATUS_BILL_UNENACTED

    tagged = tag_chunk_authority({"law_name": "نظریه مشورتی شماره ۱", "text": "پاسخ مشورتی"})
    assert tagged["authority_tier"] == AUTHORITY_TIER_2
    assert tagged["non_binding"] is True
    assert tagged["authority_label"] == NON_BINDING_LABEL


def test_tier_1_2_fallback_rescues_tier_3_only_top5():
    tier3_only = [
        {"law_name": "رأی شعبه ۵ دادگاه بدوی", "article_no": "1", "authority_tier": 3, "status": "enacted"},
        {"law_name": "شرح و تفسیر ماده ۱۰", "article_no": "10", "authority_tier": 3, "status": "enacted"},
    ]
    calls: list[str] = []

    def fallback_search(q: str):
        calls.append(q)
        return [
            {"law_name": "قانون مدنی", "article_no": "10", "authority_tier": 1, "status": "enacted"},
        ]

    decision = evaluate_abstention_gate(
        "اعتبار قرارداد خصوصی چیست؟",
        tier3_only,
        rerank_score=0.85,
        tier_1_2_fallback=fallback_search,
    )
    assert decision.should_abstain is False
    assert len(calls) == 1
    assert decision.details.get("fallback_used") is True


def test_tier_1_2_fallback_still_empty_abstains():
    tier3_only = [
        {"law_name": "پرسش و پاسخ حقوقی", "article_no": "1", "authority_tier": 3, "status": "enacted"},
    ]
    calls: list[str] = []

    def empty_fallback(q: str):
        calls.append(q)
        return [
            # Returning another tier-3 chunk must NOT satisfy the Tier 1-2 fallback
            {"law_name": "مقاله حقوقی", "article_no": "2", "authority_tier": 3, "status": "enacted"},
        ]

    decision = evaluate_abstention_gate(
        "حکم مهریه چیست؟",
        tier3_only,
        rerank_score=0.85,
        tier_1_2_fallback=empty_fallback,
    )
    assert decision.should_abstain is True
    assert decision.reason == "unofficial_only"
    assert len(calls) == 1


def test_bill_paired_with_enacted_law_attaches_fixed_sentence():
    mixed = [
        {"law_name": "قانون مدنی", "article_no": "10", "authority_tier": 1, "status": "enacted"},
        {"law_name": "لایحه اصلاح قانون مدنی", "article_no": "10", "authority_tier": 1, "status": "bill_unenacted"},
    ]
    decision = evaluate_abstention_gate("وضعیت اصلاح ماده ۱۰ مدنی چیست؟", mixed, rerank_score=0.9)
    assert decision.should_abstain is False
    assert BILL_NOT_YET_LAW_SENTENCE in decision.notices


# ---------------------------------------------------------------------------
# 20 Adversarial Cases (8 tier-3-only, 6 bill_unenacted, 6 repealed)
# Done when: 20 adversarial tests pass; abstention precision >= 95% on them.
# ---------------------------------------------------------------------------

ADVERSARIAL_CASES = [
    # 8 Tier-3-only cases
    ("tier3_1", "حکم تخلیه مغازه چیست؟", [{"law_name": "رأی شعبه ۳ دادگاه بدوی", "article_no": "1", "authority_tier": 3}], "unofficial_only"),
    ("tier3_2", "آیا وکیل می‌تواند استعفا دهد؟", [{"law_name": "شرح و تفسیر آیین دادرسی", "article_no": "39", "authority_tier": 3}], "unofficial_only"),
    ("tier3_3", "شرایط اعسار از هزینه دادرسی چیست؟", [{"law_name": "پرسش و پاسخ حقوقی", "article_no": "1", "authority_tier": 3}], "unofficial_only"),
    ("tier3_4", "تفاوت چک و سفته چیست؟", [{"law_name": "مقاله حقوقی اسناد تجاری", "article_no": "2", "source_tier": "unofficial"}], "unofficial_only"),
    ("tier3_5", "نحوه محاسبه خسارت تاخیر تادیه", [{"law_name": "یادداشت حقوقی", "article_no": "522"}], "unofficial_only"),
    ("tier3_6", "شرایط فسخ اجاره چیست؟", [{"law_name": "دادنامه شعبه ۱۴ تجدیدنظر", "article_no": "1"}], "unofficial_only"),
    ("tier3_7", "تکلیف نفقه زوجه چیست؟", [{"law_name": "سوالات متداول خانواده", "article_no": "1"}], "unofficial_only"),
    ("tier3_8", "حدود مسئولیت مدیرعامل چیست؟", [{"law_name": "تفسیر حقوقدان", "article_no": "125", "authority_tier": 3}], "unofficial_only"),
    # 6 Bill (bill_unenacted) cases
    ("bill_1", "مفاد لایحه جامع داوری چیست؟", [{"law_name": "لایحه جامع داوری", "article_no": "1", "status": "bill_unenacted"}], "bill_unenacted"),
    ("bill_2", "مجازات جرم در طرح قانونی جدید چیست؟", [{"law_name": "طرح قانونی مبارزه با جرایم", "article_no": "4", "status": "bill_unenacted"}], "bill_unenacted"),
    ("bill_3", "تکلیف مالیات در لایحه بودجه ۱۴۰۵ چیست؟", [{"law_name": "لایحه بودجه پیشنهادی", "article_no": "2", "authority_status": "bill_unenacted"}], "bill_unenacted"),
    ("bill_4", "آیا پیش‌نویس قانون کار جدید لازم‌الاجراست؟", [{"law_name": "پیش‌نویس قانون کار", "article_no": "7", "text": "در دست بررسی مجلس"}], "bill_unenacted"),
    ("bill_5", "قواعد لایحه حمایت از مالکیت فکری چیست؟", [{"law_name": "لایحه حمایت از مالکیت فکری", "article_no": "12"}], "bill_unenacted"),
    ("bill_6", "ضمانت اجرای طرح قانونی صیانت چیست؟", [{"law_name": "طرح قانونی فضای مجازی", "article_no": "9", "status": "bill_unenacted"}], "bill_unenacted"),
    # 6 Repealed-only cases
    ("rep_1", "حکم ماده منسوخ قانون چک چیست؟", [{"law_name": "قانون صدور چک قدیم", "article_no": "18", "status": "repealed"}], "repealed_only"),
    ("rep_2", "مقررات قانون روابط موجر و مستاجر ۱۳۵۶ منسوخ شده؟", [{"law_name": "قانون اجاره قدیم", "article_no": "5", "status": "REPEALED", "is_active": False}], "repealed_only"),
    ("rep_3", "ماده ملغی شده قانون مالیات چیست؟", [{"law_name": "قانون مالیات قدیم", "article_no": "104", "text": "این ماده به موجب اصلاحیه ملغی گردید."}], "repealed_only"),
    ("rep_4", "قانون مجازات عمومی قدیم چه می‌گوید؟", [{"law_name": "قانون مجازات عمومی", "article_no": "170", "text": "نسخ صریح به موجب قانون جدید"}], "repealed_only"),
    ("rep_5", "حکم ماده لغو شده آیین دادرسی چیست؟", [{"law_name": "آیین دادرسی قدیم", "article_no": "20", "authority_status": "repealed"}], "repealed_only"),
    ("rep_6", "مفاد قانون باطل شده چیست؟", [{"law_name": "قانون قدیم", "article_no": "3", "text": "این قانون لغو شده است."}], "repealed_only"),
]


@pytest.mark.parametrize("case_id,query,chunks,expected_reason", ADVERSARIAL_CASES)
def test_20_adversarial_cases_abstain(case_id, query, chunks, expected_reason):
    decision = evaluate_abstention_gate(query, chunks, rerank_score=0.90)
    assert decision.should_abstain is True, f"{case_id} should abstain"
    assert decision.reason == expected_reason, f"{case_id}: expected {expected_reason}, got {decision.reason}"
    if expected_reason == "bill_unenacted":
        assert BILL_NOT_YET_LAW_SENTENCE in (decision.message or "")
        assert BILL_NOT_YET_LAW_SENTENCE in decision.notices


def test_adversarial_abstention_precision_at_least_95_percent():
    assert len(ADVERSARIAL_CASES) == 20

    valid_cases = [
        ("اعتبار قرارداد خصوصی چیست؟", [{"law_name": "قانون مدنی", "article_no": "10", "authority_tier": 1, "status": "enacted"}]),
        ("مفاد رأی وحدت رویه چیست؟", [{"law_name": "رأی وحدت رویه ۸۱۲", "article_no": "1", "authority_tier": 1, "status": "enacted"}]),
        ("بخشنامه مالیاتی چه می‌گوید؟", [{"law_name": "بخشنامه مالیاتی", "article_no": "2", "authority_tier": 2, "status": "enacted"}]),
        ("نظریه مشورتی درباره چک چیست؟", [{"law_name": "نظریه مشورتی ۷/۱۴۰۰/۱", "article_no": "1", "authority_tier": 2, "non_binding": True, "status": "enacted"}]),
        ("ماده اصلاحی قانون چک چیست؟", [{"law_name": "قانون صدور چک", "article_no": "6", "authority_tier": 1, "status": "amended"}]),
    ]

    tp = 0
    fp = 0
    for _, query, chunks, _ in ADVERSARIAL_CASES:
        if evaluate_abstention_gate(query, chunks, rerank_score=0.90).should_abstain:
            tp += 1
    for query, chunks in valid_cases:
        if evaluate_abstention_gate(query, chunks, rerank_score=0.90).should_abstain:
            fp += 1

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    assert tp == 20
    assert fp == 0
    assert precision >= 0.95
