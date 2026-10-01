from __future__ import annotations

from src.factory_pipeline.proposal import PROPOSAL_MARKER, format_proposal_comment


def _brief_result(**overrides):
    base = {
        "idea": "Persian legal voice assistant",
        "status": "SUCCESS",
        "total_cost_usd": 0.1234,
        "layers": [
            {
                "layer": "backend",
                "label_fa": "بک‌اند",
                "label_en": "Backend",
                "status": "SUCCESS",
                "alternatives": [
                    {
                        "name": "NestJS",
                        "adoption_score": 8,
                        "monthly_cost_usd_estimate": "$20",
                        "risks": ["ecosystem lock-in"],
                    },
                    {
                        "name": "FastAPI",
                        "adoption_score": 7,
                        "monthly_cost_usd_estimate": "$15",
                        "risks": [],
                    },
                ],
                "recommended": "NestJS",
                "recommendation_reason": "matches existing stack",
            }
        ],
        "final": {
            "executive_summary": "خلاصه مدیریتی نمونه.",
            "total_monthly_cost_usd_estimate": "$100-150",
            "cross_layer_risks": ["ریسک مشترک بین لایه‌ها"],
            "open_questions_for_owner": ["آیا بودجه ماهانه ثابت است؟"],
        },
    }
    base.update(overrides)
    return base


def test_includes_idea_and_status():
    text = format_proposal_comment(_brief_result())
    assert "Persian legal voice assistant" in text
    assert "SUCCESS" in text


def test_heading_uses_only_subject_title():
    text = format_proposal_comment(_brief_result(idea="عنوان کوتاه — متن کامل موضوع"))
    assert "## پیشنهاد فناوری برای: عنوان کوتاه" in text
    assert "## پیشنهاد فناوری برای: عنوان کوتاه — متن کامل موضوع" not in text


def test_starts_with_hidden_proposal_marker():
    text = format_proposal_comment(_brief_result())
    assert text.startswith(PROPOSAL_MARKER)


def test_includes_layer_options_with_scores_and_cost():
    text = format_proposal_comment(_brief_result())
    assert "NestJS" in text
    assert "FastAPI" in text
    assert "8/10" in text
    assert "$20" in text


def test_marks_recommended_option():
    text = format_proposal_comment(_brief_result())
    assert "⭐ **NestJS**" in text


def test_includes_executive_summary_and_total_cost():
    text = format_proposal_comment(_brief_result())
    assert "خلاصه مدیریتی نمونه." in text
    assert "$100-150" in text


def test_includes_cross_layer_risks_and_open_questions():
    text = format_proposal_comment(_brief_result())
    assert "ریسک مشترک بین لایه‌ها" in text
    assert "آیا بودجه ماهانه ثابت است؟" in text


def test_includes_approve_instructions():
    text = format_proposal_comment(_brief_result())
    assert "/approve" in text


def test_layer_with_no_alternatives_reports_not_found():
    layer = {
        "layer": "ai_models",
        "label_fa": "هوش مصنوعی",
        "status": "DEGRADED",
        "alternatives": [],
    }
    text = format_proposal_comment(_brief_result(layers=[layer]))
    assert "گزینه‌ای یافت نشد." in text
    assert "DEGRADED" in text


def test_output_never_exceeds_github_comment_limit():
    huge_layers = [
        {
            "layer": f"layer{i}",
            "label_fa": "لایه" * 50,
            "label_en": f"Layer {i}",
            "status": "SUCCESS",
            "alternatives": [
                {"name": f"Option{i}-{j}", "adoption_score": j, "monthly_cost_usd_estimate": "$10",
                 "risks": ["ریسک نمونه بلند " * 200]}
                for j in range(3)
            ],
            "recommended": f"Option{i}-0",
        }
        for i in range(300)
    ]
    text = format_proposal_comment(_brief_result(layers=huge_layers), char_budget=60000)
    assert len(text) <= 65536
    assert "خلاصه به دلیل محدودیت طول کامنت کوتاه شد" in text
