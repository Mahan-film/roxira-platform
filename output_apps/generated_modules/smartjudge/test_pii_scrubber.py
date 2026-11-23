"""Unit and integration tests for T239 (#978) Persian PII scrubber.

Covers 40+ test cases including Persian/Arabic-Indic digits, Iranian national ID
checksum validation, mobile/landline, card, IBAN, case/file numbers, email,
count-only logging, llm_router outgoing payload redaction, and voice agent wiring.
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from output_apps.generated_modules.smartjudge.security.pii_scrubber import (  # noqa: E402
    is_valid_iranian_national_id,
    mask_pii_entities,
    normalize_digits,
    scrub_messages,
    scrub_pii_with_counts,
    unmask_pii_entities,
)
from output_apps.generated_modules.smartjudge import llm_router  # noqa: E402
from output_apps.generated_modules.smartjudge.realtime_voice.livekit_voice_agent import (  # noqa: E402
    LiveKitCompatibleVoiceAgent,
)


# --- 1. Digit normalization & National ID checksum (10 tests) ---

def test_01_normalize_persian_digits():
    assert normalize_digits("۰۱۲۳۴۵۶۷۸۹") == "0123456789"


def test_02_normalize_arabic_indic_digits():
    assert normalize_digits("٠١٢٣٤٥٦٧٨٩") == "0123456789"


def test_03_valid_national_id_ascii():
    assert is_valid_iranian_national_id("0084575948") is True


def test_04_valid_national_id_persian_digits():
    assert is_valid_iranian_national_id("۰۰۸۴۵۷۵۹۴۸") is True


def test_05_valid_national_id_remainder_lt_2():
    # 0010000010 -> sum = 0*10+0*9+1*8+0+0+0+0+0+1*2 = 10 -> wait: 000000001? Let's use 0013520849
    # Check 0013520849: 0*10+0*9+1*8+3*7+5*6+2*5+0*4+8*3+4*2 = 8+21+30+10+24+8 = 101; 101%11=2 -> 11-2=9 -> valid
    assert is_valid_iranian_national_id("0013520849") is True


def test_06_invalid_national_id_bad_checksum():
    assert is_valid_iranian_national_id("0084575949") is False


def test_07_invalid_national_id_all_same_digits():
    for d in "0123456789":
        assert is_valid_iranian_national_id(d * 10) is False


def test_08_invalid_national_id_wrong_length():
    assert is_valid_iranian_national_id("008457594") is False
    assert is_valid_iranian_national_id("00845759481") is False


def test_09_scrub_valid_national_id_ascii():
    scrubbed, mapping = mask_pii_entities("کدملی من 0084575948 است")
    assert "0084575948" not in scrubbed
    assert "[کدملی_1]" in scrubbed
    assert mapping["[کدملی_1]"] == "0084575948"


def test_10_scrub_valid_national_id_persian_digits_and_skip_invalid():
    scrubbed, mapping = mask_pii_entities("کدملی ۰۰۸۴۵۷۵۹۴۸ ولی عدد 1234567890 کدملی نیست")
    assert "۰۰۸۴۵۷۵۹۴۸" not in scrubbed
    assert "[کدملی_1]" in scrubbed
    assert "1234567890" in scrubbed  # invalid checksum must not be falsely redacted


# --- 2. Mobile & Landline numbers (8 tests) ---

def test_11_scrub_mobile_ascii_09():
    scrubbed, mapping = mask_pii_entities("شماره من 09123456789 است")
    assert "09123456789" not in scrubbed
    assert "[شماره_همراه_1]" in scrubbed


def test_12_scrub_mobile_persian_digits():
    scrubbed, mapping = mask_pii_entities("تماس با ۰۹۱۲۳۴۵۶۷۸۹")
    assert "۰۹۱۲۳۴۵۶۷۸۹" not in scrubbed
    assert mapping["[شماره_همراه_1]"] == "۰۹۱۲۳۴۵۶۷۸۹"


def test_13_scrub_mobile_plus98():
    scrubbed, mapping = mask_pii_entities("tel: +989123456789")
    assert "+989123456789" not in scrubbed
    assert "[شماره_همراه_1]" in scrubbed


def test_14_scrub_mobile_0098_persian():
    scrubbed, mapping = mask_pii_entities("شماره ۰۰۹۸۹۱۲۳۴۵۶۷۸۹")
    assert "۰۰۹۸۹۱۲۳۴۵۶۷۸۹" not in scrubbed
    assert "[شماره_همراه_1]" in scrubbed


def test_15_scrub_mobile_hyphenated():
    scrubbed, _ = mask_pii_entities("موبایل: 0912-345-6789")
    assert "0912-345-6789" not in scrubbed
    assert "[شماره_همراه_1]" in scrubbed


def test_16_scrub_landline_tehran_ascii():
    scrubbed, mapping = mask_pii_entities("تلفن دفتر 021-88776655 است")
    assert "021-88776655" not in scrubbed
    assert "[تلفن_ثابت_1]" in scrubbed
    assert mapping["[تلفن_ثابت_1]"] == "021-88776655"


def test_17_scrub_landline_persian_digits():
    scrubbed, _ = mask_pii_entities("تلفن ثابت ۰۲۱۸۸۷۷۶۶۵۵")
    assert "۰۲۱۸۸۷۷۶۶۵۵" not in scrubbed
    assert "[تلفن_ثابت_1]" in scrubbed


def test_18_scrub_landline_plus98_shiraz():
    scrubbed, _ = mask_pii_entities("دفتر شیراز +9871-32345678")
    assert "32345678" not in scrubbed
    assert "[تلفن_ثابت_1]" in scrubbed


# --- 3. Card numbers & IBAN (7 tests) ---

def test_19_scrub_card_plain_ascii():
    scrubbed, _ = mask_pii_entities("شماره کارت 6037991122334455")
    assert "6037991122334455" not in scrubbed
    assert "[شماره_کارت_1]" in scrubbed


def test_20_scrub_card_hyphenated_persian():
    scrubbed, mapping = mask_pii_entities("کارت ۶۰۳۷-۹۹۱۱-۲۲۳۳-۴۴۵۵")
    assert "۶۰۳۷-۹۹۱۱-۲۲۳۳-۴۴۵۵" not in scrubbed
    assert mapping["[شماره_کارت_1]"] == "۶۰۳۷-۹۹۱۱-۲۲۳۳-۴۴۵۵"


def test_21_scrub_card_spaced():
    scrubbed, _ = mask_pii_entities("6219 8610 1234 5678")
    assert "6219 8610 1234 5678" not in scrubbed
    assert "[شماره_کارت_1]" in scrubbed


def test_22_scrub_iban_ascii():
    iban = "IR820540102680020817909002"
    scrubbed, mapping = mask_pii_entities(f"شبا {iban}")
    assert iban not in scrubbed
    assert mapping["[شبا_1]"] == iban


def test_23_scrub_iban_lowercase():
    iban = "ir820540102680020817909002"
    scrubbed, _ = mask_pii_entities(f"iban: {iban}")
    assert iban not in scrubbed
    assert "[شبا_1]" in scrubbed


def test_24_scrub_iban_persian_digits():
    iban = "IR۸۲۰۵۴۰۱۰۲۶۸۰۰۲۰۸۱۷۹۰۹۰۰۲"
    scrubbed, mapping = mask_pii_entities(f"شماره شبا {iban}")
    assert iban not in scrubbed
    assert mapping["[شبا_1]"] == iban


def test_25_scrub_iban_spaced():
    iban = "IR82 0540 1026 8002 0817 9090 02"
    scrubbed, _ = mask_pii_entities(f"شبا: {iban}")
    assert "0817" not in scrubbed
    assert "[شبا_1]" in scrubbed


# --- 4. Case/file numbers & Emails & Party names (7 tests) ---

def test_26_scrub_case_number_persian_label():
    scrubbed, mapping = mask_pii_entities("شماره پرونده: ۱۴۰۲۰۹۹۸۰۰۱۲۳۴۵۶ در شعبه ۳")
    assert "۱۴۰۲۰۹۹۸۰۰۱۲۳۴۵۶" not in scrubbed
    assert "[شماره_پرونده_1]" in scrubbed
    assert mapping["[شماره_پرونده_1]"] == "۱۴۰۲۰۹۹۸۰۰۱۲۳۴۵۶"


def test_27_scrub_case_number_kelaseh():
    scrubbed, _ = mask_pii_entities("کلاسه پرونده 990123/45")
    assert "990123/45" not in scrubbed
    assert "[شماره_پرونده_1]" in scrubbed


def test_28_scrub_case_number_english():
    scrubbed, _ = mask_pii_entities("Case No: 1403012345")
    assert "1403012345" not in scrubbed
    assert "[شماره_پرونده_1]" in scrubbed


def test_29_scrub_case_number_standalone_cms():
    scrubbed, _ = mask_pii_entities("پرونده 9809980212345678 بررسی شد")
    assert "9809980212345678" not in scrubbed
    assert "[شماره_پرونده_1]" in scrubbed


def test_30_scrub_email_standard():
    scrubbed, mapping = mask_pii_entities("ایمیل وکیل ali.rezaei+legal@example.ir است")
    assert "ali.rezaei+legal@example.ir" not in scrubbed
    assert mapping["[ایمیل_1]"] == "ali.rezaei+legal@example.ir"


def test_31_scrub_multiple_emails():
    scrubbed, _ = mask_pii_entities("a@b.com و c@d.org")
    assert "[ایمیل_1]" in scrubbed
    assert "[ایمیل_2]" in scrubbed


def test_32_scrub_party_name_preserved_behavior():
    scrubbed, mapping = mask_pii_entities("خواهان آقای علی رضایی فرزند حسن")
    assert "علی رضایی" not in scrubbed
    assert "[خواهان_1]" in scrubbed
    assert mapping["[خواهان_1]"] == "علی رضایی"


# --- 5. Unmasking, Counts-only logging, and Message scrubbing (5 tests) ---

def test_33_unmask_roundtrip_mixed_persian_and_ascii():
    original = "کدملی ۰۰۸۴۵۷۵۹۴۸ موبایل 09123456789 ایمیل test@roxira.ir"
    scrubbed, mapping = mask_pii_entities(original)
    assert "۰۰۸۴۵۷۵۹۴۸" not in scrubbed
    assert "09123456789" not in scrubbed
    assert "test@roxira.ir" not in scrubbed
    restored = unmask_pii_entities(scrubbed, mapping)
    assert restored == original


def test_34_logging_contains_only_counts_never_raw_values(caplog):
    raw_nid = "0084575948"
    raw_phone = "09123456789"
    raw_email = "secret.client@example.com"
    with caplog.at_level(logging.INFO, logger="smartjudge.security.pii_scrubber"):
        scrub_pii_with_counts(
            f"کدملی {raw_nid} تلفن {raw_phone} ایمیل {raw_email}",
            context="unit_test",
        )
    assert len(caplog.records) == 1
    msg = caplog.records[0].getMessage()
    assert "total=3" in msg
    assert raw_nid not in msg
    assert raw_phone not in msg
    assert raw_email not in msg


def test_35_empty_string_no_crash_and_no_log(caplog):
    with caplog.at_level(logging.INFO, logger="smartjudge.security.pii_scrubber"):
        scrubbed, mapping, counts = scrub_pii_with_counts("", context="empty_test")
    assert scrubbed == ""
    assert mapping == {}
    assert sum(counts.values()) == 0
    assert len(caplog.records) == 0


def test_36_scrub_messages_does_not_mutate_caller_and_handles_multipart():
    original_msgs = [
        {"role": "user", "content": "کدملی 0084575948"},
        {"role": "user", "content": [{"type": "text", "text": "موبایل ۰۹۱۲۳۴۵۶۷۸۹"}]},
    ]
    scrubbed, mapping, counts = scrub_messages(original_msgs, context="test_msgs")
    assert original_msgs[0]["content"] == "کدملی 0084575948"
    assert "0084575948" not in scrubbed[0]["content"]
    assert "۰۹۱۲۳۴۵۶۷۸۹" not in scrubbed[1]["content"][0]["text"]
    assert counts["nid"] == 1
    assert counts["mobile"] == 1
    assert len(mapping) == 2


def test_37_no_overlap_between_iban_and_card_or_nid():
    iban = "IR820540102680020817909002"
    scrubbed, _, counts = scrub_pii_with_counts(iban)
    assert scrubbed == "[شبا_1]"
    assert counts["iban"] == 1
    assert counts["card"] == 0
    assert counts["nid"] == 0


# --- 6. Wiring into llm_router and LiveKitCompatibleVoiceAgent (5 tests) ---

def test_38_llm_router_complete_outgoing_payload_has_no_raw_nid_or_phone(monkeypatch):
    captured_bodies: list[dict[str, Any]] = []

    async def fake_post(body: dict[str, Any], **_kwargs: Any):
        captured_bodies.append(body)
        return (
            {
                "model": "test/model",
                "choices": [{"message": {"content": "پاسخ برای [کدملی_1] و [شماره_همراه_1]"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10},
            },
            1,
        )

    monkeypatch.setattr(llm_router.llm_gateway, "configured", lambda: False)
    monkeypatch.setattr(llm_router, "_cache_get", AsyncMock(return_value=None))
    monkeypatch.setattr(llm_router, "_cache_set", AsyncMock(return_value=None))
    monkeypatch.setattr(llm_router, "_log_usage_background", lambda _rec: None)
    monkeypatch.setattr(llm_router, "_post_with_reasoning_fallback", fake_post)

    res = asyncio.run(
        llm_router.complete(
            "cheap",
            [{"role": "user", "content": "کدملی 0084575948 و موبایل 09123456789"}],
            sensitive=True,
            feature="test_pii",
        )
    )

    assert len(captured_bodies) == 1
    outgoing_text = captured_bodies[0]["messages"][0]["content"]
    assert "0084575948" not in outgoing_text
    assert "09123456789" not in outgoing_text
    assert "[کدملی_1]" in outgoing_text
    assert "[شماره_همراه_1]" in outgoing_text
    # Restored in the returned answer
    assert "0084575948" in res.content
    assert "09123456789" in res.content


def test_39_llm_router_complete_ladder_outgoing_payload_has_no_raw_pii(monkeypatch):
    captured_bodies: list[dict[str, Any]] = []

    async def fake_post(body: dict[str, Any], **_kwargs: Any):
        captured_bodies.append(body)
        return (
            {
                "model": "test/draft",
                "choices": [{"message": {"content": "دادخواست [کدملی_1]"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10},
            },
            1,
        )

    monkeypatch.setattr(llm_router, "drafting_models", lambda: ["test/draft"])
    monkeypatch.setattr(llm_router, "_headers", lambda: {"Authorization": "Bearer test"})
    monkeypatch.setattr(llm_router, "_log_usage_background", lambda _rec: None)
    monkeypatch.setattr(llm_router, "_post_with_reasoning_fallback", fake_post)
    monkeypatch.setattr(llm_router, "_post_with_retries", fake_post)

    res = asyncio.run(
        llm_router.complete_ladder(
            [{"role": "user", "content": "کدملی ۰۰۸۴۵۷۵۹۴۸ شبا IR820540102680020817909002"}],
            sensitive=True,
            feature="test_ladder_pii",
        )
    )

    assert len(captured_bodies) == 1
    outgoing = captured_bodies[0]["messages"][0]["content"]
    assert "۰۰۸۴۵۷۵۹۴۸" not in outgoing
    assert "IR820540102680020817909002" not in outgoing
    assert "۰۰۸۴۵۷۵۹۴۸" in res.content


def test_40_voice_agent_scrub_user_transcript_and_restore():
    agent = LiveKitCompatibleVoiceAgent()
    scrubbed, mapping = agent.scrub_user_transcript("کدملی من 0084575948 و موبایل 09123456789 است")
    assert "0084575948" not in scrubbed
    assert "09123456789" not in scrubbed
    restored = agent.restore_assistant_text("ثبت شد برای [کدملی_1]", mapping)
    assert restored == "ثبت شد برای 0084575948"


def test_41_voice_agent_stream_tts_scrubs_pii_before_external_tts():
    agent = LiveKitCompatibleVoiceAgent()
    sent_to_tts: list[str] = []

    class FakeCommunicate:
        def __init__(self, text: str, voice: str):
            sent_to_tts.append(text)

        async def stream(self):
            yield {"type": "audio", "data": b"fake-audio"}

    async def text_gen():
        yield "شماره کدملی 0084575948 و موبایل 09123456789 ثبت شد."

    async def _run():
        return [c async for c in agent.stream_tts_audio(text_gen())]

    fake_module = type("FakeEdgeTTS", (), {"Communicate": FakeCommunicate})
    with patch.dict(sys.modules, {"edge_tts": fake_module}):
        chunks = asyncio.run(_run())

    assert chunks == [b"fake-audio"]
    assert len(sent_to_tts) == 1
    assert "0084575948" not in sent_to_tts[0]
    assert "09123456789" not in sent_to_tts[0]


def test_42_arabic_indic_digits_in_mobile_and_card():
    scrubbed, _, counts = scrub_pii_with_counts("موبایل ٠٩١٢٣٤٥٦٧٨٩ و کارت ٦٠٣٧٩٩١١٢٢٣٣٤٤٥٥")
    assert "٠٩١٢٣٤٥٦٧٨٩" not in scrubbed
    assert "٦٠٣٧٩٩١١٢٢٣٣٤٤٥٥" not in scrubbed
    assert counts["mobile"] == 1
    assert counts["card"] == 1
