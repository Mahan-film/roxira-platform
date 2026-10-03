"""Regression tests for issue #453: an AI-written draft must never look like an
official, approved court document (no judiciary header, no approval status, no
fake verification hash)."""

import asyncio

from output_apps.generated_modules.smartjudge import smartjudge_module as mod

FORBIDDEN = ("قوه قضائیه", "APPROVED_FOR_COURT", "GH-")


def run(coro):
    return asyncio.run(coro)


def test_generate_official_document_is_labelled_ai_draft():
    result = run(
        mod.generate_official_document(
            {
                "case_title": "لایحه دفاعیه",
                "client_name": "موکل",
                "defense_text": "متن دفاع",
                "statutory_articles": ["ماده ۱"],
            }
        )
    )
    doc = result["document"]
    assert doc["header"] == mod.AI_DRAFT_HEADER
    assert doc["status"] == mod.AI_DRAFT_STATUS
    assert doc["disclaimer"] == mod.AI_DRAFT_DISCLAIMER
    assert doc["requires_human_review"] is True
    assert doc["draft_id"]
    assert doc["content_sha256"] == mod.content_sha256("متن دفاع")
    # کلیدهایی که رابط کاربری می‌خواند حفظ شده‌اند.
    assert doc["document_type"] == "لایحه دفاعیه"
    assert doc["applicant"] == "موکل"
    assert doc["statutory_basis"] == ["ماده ۱"]
    assert doc["content"] == "متن دفاع"
    blob = str(result)
    for token in FORBIDDEN:
        assert token not in blob


def test_export_defense_document_starts_with_disclaimer():
    result = run(
        mod.export_defense_document({"case_title": "دفاعیه", "draft_text": "متن"})
    )
    text = result["formatted_text"]
    assert text.startswith(mod.AI_DRAFT_DISCLAIMER)
    assert result["requires_human_review"] is True
    assert result["disclaimer"] == mod.AI_DRAFT_DISCLAIMER
    for token in FORBIDDEN:
        assert token not in text
        assert token not in str(result)


def test_draft_template_text_starts_with_disclaimer():
    result = run(
        mod.draft_template(
            {
                "template_type": "LAYEHE_DEFEE",
                "khahan": "الف",
                "khankhah": "ب",
                "moghaddame": "مقدمه",
                "defa_shakli": "شکلی",
                "defa_mahavi": "ماهوی",
                "taghaza_rad": "رد",
            },
            concise=True,
            verify_citations=False,
        )
    )
    assert result["rendered_text"].startswith(mod.AI_DRAFT_DISCLAIMER)
    assert result["requires_human_review"] is True
    assert result["disclaimer"] == mod.AI_DRAFT_DISCLAIMER


def test_disclaimer_helper_is_idempotent():
    once = mod.with_ai_draft_disclaimer("متن")
    assert once.startswith(mod.AI_DRAFT_DISCLAIMER)
    assert mod.with_ai_draft_disclaimer(once) == once


def test_content_sha256_is_real_hash_not_verification():
    meta = mod.build_ai_draft_metadata("abc")
    assert meta["content_sha256"] == mod.content_sha256("abc")
    assert len(meta["content_sha256"]) == 64
    assert meta["content_sha256"] != mod.content_sha256("abcd")
