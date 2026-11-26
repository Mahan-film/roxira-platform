"""Edge-case unit tests for T237 symmetric Persian normalisation (25+ cases)."""
from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge.persian_norm import (
    build_chunk_text_fields,
    display_text_from_payload,
    normalize_persian_search,
)
from scripts.smartjudge.backfill_text_norm import compute_payload_update


@pytest.mark.parametrize(
    "raw,expected",
    [
        # 1-5: Arabic letter folding
        ("قانون مدني", "قانون مدنی"),
        ("رأى وحدت رويه", "رای وحدت رویه"),
        ("مسئوليت مدنى", "مسیولیت مدنی"),
        ("كتاب قانون تجارت", "کتاب قانون تجارت"),
        ("مادة 10 قانون آيين دادرسي", "ماده 10 قانون ایین دادرسی"),
        # 6-9: Hamza-alef & heh-yeh & waw-hamza
        ("آیین دادرسی مدنی", "ایین دادرسی مدنی"),
        ("أحکام إجرایی ٱسلامی", "احکام اجرایی اسلامی"),
        ("تبصرۀ ۱ ماده ۵۲۲", "تبصره 1 ماده 522"),
        ("مؤجر و مستأجر", "موجر و مستاجر"),
        # 10-13: Digits (Persian, Arabic-Indic, mixed, ASCII)
        ("ماده ۱۲۳۴۵۶۷۸۹۰", "ماده 1234567890"),
        ("ماده ١٢٣٤٥٦٧٨٩٠", "ماده 1234567890"),
        ("ماده ۵۲۲ و بند ٣ و جزء 4", "ماده 522 و بند 3 و جزء 4"),
        ("ماده ۱۰۴۵ مکرر", "ماده 1045 مکرر"),
        # 14-17: Harakat & tatweel
        ("مُجازاتِ اِسلامی", "مجازات اسلامی"),
        ("تَـبْـصِـرَه‌ٔ ۱", "تبصره 1"),
        ("قــــانون کــــار", "قانون کار"),
        ("حُکمِ قَطعیّت یافته", "حکم قطعیت یافته"),
        # 18-21: Bidi marks, BOM, soft hyphen, ZWJ
        ("\u200fماده\u200e ۱۲\u202a", "ماده 12"),
        ("\ufeff\u2066قانون\u2069\u061c کار", "قانون کار"),
        ("حق\u00adالتحریر", "حقالتحریر"),
        ("می\u200dشود", "میشود"),
        # 22-26: ZWNJ collapse & boundary hygiene
        ("می\u200c\u200cشود", "می\u200cشود"),
        ("می\u200c\u200c\u200cتواند", "می\u200cتواند"),
        ("\u200cقانون\u200c", "قانون"),
        ("ماده \u200c ۵۲۲", "ماده 522"),
        ("تبصره\u200c، ماده ۵۲۲", "تبصره، ماده 522"),
        # 27-28: Empty / None / whitespace collapse
        ("", ""),
        ("   ماده   ۱۲   تبصره   ۲   ", "ماده 12 تبصره 2"),
    ],
)
def test_normalize_persian_search_edge_cases(raw: str, expected: str):
    assert normalize_persian_search(raw) == expected


def test_normalize_none_returns_empty():
    assert normalize_persian_search(None) == ""


def test_symmetry_index_and_query_match():
    indexed = "مادّة ۵۲۲ آیین دادرسی مدني — تبصرۀ ۱"
    query = "ماده 522 ایین دادرسی مدنی — تبصره ١"
    assert normalize_persian_search(indexed) == normalize_persian_search(query)


def test_idempotency():
    sample = "تبصرۀ ۲ مادّة ۱۰۴۵ مُکرّر می\u200c\u200cشود\u200f"
    once = normalize_persian_search(sample)
    twice = normalize_persian_search(once)
    assert once == twice


def test_build_chunk_text_fields_preserves_verbatim_display():
    raw = "ماده ۵۲۲ قانون آیین دادرسی مدنی — تبصرهٔ ۱"
    fields = build_chunk_text_fields(raw)
    assert fields["text_display"] == raw
    assert fields["text_search_norm"] == "ماده 522 قانون ایین دادرسی مدنی — تبصره 1"


def test_display_text_from_payload_prefers_text_display():
    payload = {
        "text_display": "ماده ۵۲۲ قانون آیین دادرسی مدنی",
        "text_search_norm": "ماده 522 قانون ایین دادرسی مدنی",
        "text": "legacy text",
    }
    assert display_text_from_payload(payload) == "ماده ۵۲۲ قانون آیین دادرسی مدنی"


def test_display_text_from_payload_falls_back_for_legacy_chunks():
    assert display_text_from_payload({"summary": "متن قدیم"}) == "متن قدیم"
    assert display_text_from_payload({}) == ""
    assert display_text_from_payload(None) == ""


def test_backfill_compute_payload_update():
    legacy = {"text": "مادّة ۵۲۲ تبصرۀ ۱"}
    patch = compute_payload_update(legacy)
    assert patch == {
        "text_display": "مادّة ۵۲۲ تبصرۀ ۱",
        "text_search_norm": "ماده 522 تبصره 1",
    }
    already_done = {**legacy, **patch}
    assert compute_payload_update(already_done) is None


@pytest.mark.parametrize(
    "indexed,query",
    [
        # Arabic yeh/kaf, Persian/Arabic-Indic/ASCII digits
        ("مادّة ۵۲۲ آیین دادرسی مدني", "ماده 522 ایین دادرسی مدنی"),
        ("كتاب قانون كار ماده ١٠", "کتاب قانون کار ماده 10"),
        # RTL/bidi marks U+200F, U+202B, U+202C, BOM
        ("\u200f\u202bماده\u202c ۱۰۸۲ قانون مدنی", "ماده 1082 قانون مدنی"),
        # Phone spelling / hamza / decomposed hamza variants (تأمین / تامین، رئیس / رییس)
        ("تأمین خواسته در دادگاه", "تامین خواسته در دادگاه"),
        ("تا\u0654مین اجتماعی", "تامین اجتماعی"),
        ("رئیس قوه قضائیه", "رییس قوه قضاییه"),
        # Heh goal / heh doachashmee variants
        ("تبصرہ ۱ مادھ ۱۰", "تبصره 1 ماده 10"),
        # ZWNJ vs OCR split spaces in sparse tokenization
        ("پرداخت خسارت می\u200cشود", "پرداخت خسارت می شود"),
        # NBSP and multiple whitespace runs + ASCII case parity
        ("ماده\u00a0\u00a0ABC123  قانون", "ماده abc123 قانون"),
    ],
)
def test_index_and_query_paths_map_all_variants_identically(indexed: str, query: str):
    from output_apps.generated_modules.smartjudge import legal_tokenize
    from output_apps.generated_modules.smartjudge.legal_graph import law_ingester_pipeline

    assert legal_tokenize.normalize(indexed) == legal_tokenize.normalize(query)
    assert legal_tokenize.sparse_vector(indexed) == legal_tokenize.sparse_vector(query)
    assert law_ingester_pipeline.normalize_text(indexed) == legal_tokenize.normalize(query)
