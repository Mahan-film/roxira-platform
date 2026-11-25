"""Unit tests for Persian Spoken Normaliser & Clause-Level Streaming Flusher (T251).

Tests 40+ cases covering:
1. Digits & numbers (units, teens, tens, hundreds, thousands, millions, billions)
2. Negative numbers & decimals
3. Persian & Arabic-Indic digit inputs
4. Ordinal numbers & suffix ordinals
5. Jalali dates (YMD, DMY, boundary months and days)
6. Legal articles, statutes & structural numbers
7. Legal abbreviations (ق.م., ق.م.ا., ق.آ.د.م., etc.)
8. Currencies and percentages
9. StreamingClauseFlusher clause-level buffering & sentence flushing
"""

from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge.persian_spoken_normaliser import (
    StreamingClauseFlusher,
    expand_legal_abbreviations,
    jalali_date_to_words,
    normalize_jalali_dates,
    normalize_persian_speech,
    number_to_persian_words,
)


# ---------------------------------------------------------------------------
# 1. Number to Persian Words
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "val,expected",
    [
        (0, "صفر"),
        (1, "یک"),
        (5, "پنج"),
        (10, "ده"),
        (11, "یازده"),
        (12, "دوازده"),
        (15, "پانزده"),
        (19, "نوزده"),
        (20, "بیست"),
        (25, "بیست و پنج"),
        (99, "نود و نه"),
        (100, "صد"),
        (105, "صد و پنج"),
        (313, "سیصد و سیزده"),
        (999, "نهصد و نود و نه"),
        (1000, "هزار"),
        (1403, "هزار و چهارصد و سه"),
        (2000, "دو هزار"),
        (2026, "دو هزار و بیست و شش"),
        (1000000, "یک میلیون"),
        (1500000, "یک میلیون و پانصد هزار"),
        (2000000000, "دو میلیارد"),
        (-5, "منفی پنج"),
        (-120, "منفی صد و بیست"),
        ("12.5", "دوازده ممیز پنج"),
        ("0.75", "صفر ممیز هفت پنج"),
        ("۱۲", "دوازده"),
        ("۱۴۰۴", "هزار و چهارصد و چهار"),
        ("١٢٣", "صد و بیست و سه"),
    ],
)
def test_number_to_persian_words_cardinal(val, expected):
    assert number_to_persian_words(val) == expected


@pytest.mark.parametrize(
    "val,expected",
    [
        (1, "یکم"),
        (2, "دوم"),
        (3, "سوم"),
        (4, "چهارم"),
        (10, "دهم"),
        (12, "دوازدهم"),
        (20, "بیستم"),
        (21, "بیست و یکم"),
        (23, "بیست و سوم"),
        (30, "سی‌ام"),
        (31, "سی و یکم"),
        (100, "صدم"),
    ],
)
def test_number_to_persian_words_ordinal(val, expected):
    assert number_to_persian_words(val, ordinal=True) == expected


# ---------------------------------------------------------------------------
# 2. Jalali Dates
# ---------------------------------------------------------------------------


def test_jalali_date_to_words_direct():
    assert (
        jalali_date_to_words(1403, 8, 15)
        == "پانزدهم آبان هزار و چهارصد و سه"
    )
    assert (
        jalali_date_to_words(1402, 1, 1)
        == "یکم فروردین هزار و چهارصد و دو"
    )
    assert (
        jalali_date_to_words(1399, 12, 29)
        == "بیست و نهم اسفند هزار و سیصد و نود و نه"
    )


@pytest.mark.parametrize(
    "text,expected",
    [
        (
            "در تاریخ 1403/08/15 ابلاغ گردید.",
            "در تاریخ پانزدهم آبان هزار و چهارصد و سه ابلاغ گردید.",
        ),
        (
            "جلسه مورخ ۱۴۰۲/۰۱/۰۱ تشکیل شد.",
            "جلسه مورخ یکم فروردین هزار و چهارصد و دو تشکیل شد.",
        ),
        (
            "مهلت تا 31/06/1404 تعیین شد.",
            "مهلت تا سی و یکم شهریور هزار و چهارصد و چهار تعیین شد.",
        ),
        (
            "تاریخ ثبت: 1400-05-10 است.",
            "تاریخ ثبت: دهم مرداد هزار و چهارصد است.",
        ),
    ],
)
def test_normalize_jalali_dates_in_text(text, expected):
    assert normalize_jalali_dates(text) == expected


# ---------------------------------------------------------------------------
# 3. Legal Abbreviations
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("مطابق ق.م. عمل شود.", "مطابق قانون مدنی عمل شود."),
        ("بر اساس ق.م.ا. حکم صادر شد.", "بر اساس قانون مجازات اسلامی حکم صادر شد."),
        ("طبق ق.آ.د.م. دادخواست رد شد.", "طبق قانون آیین دادرسی مدنی دادخواست رد شد."),
        ("مستند به ق.آ.د.ک. احضار گردید.", "مستند به قانون آیین دادرسی کیفری احضار گردید."),
        ("بر طبق ق.ت. شرکت منحل شد.", "بر طبق قانون تجارت شرکت منحل شد."),
        ("بر اساس ق.م.م. مالیات محاسبه شد.", "بر اساس قانون مالیات‌های مستقیم مالیات محاسبه شد."),
        ("طبق ق.ع.ح. مزایده برگزار گردید.", "طبق قانون اجرای احکام مدنی مزایده برگزار گردید."),
        ("ر.و. شماره ۸۰۰ دیوان.", "رأی وحدت رویه شماره ۸۰۰ دیوان."),
        ("تایید شده در د.ع.ک.", "تایید شده در دیوان عالی کشور"),
        ("شکایت در د.ع.ا. ثبت شد.", "شکایت در دیوان عدالت اداری ثبت شد."),
        ("پرونده در ش.ح.ا. رسیدگی شد.", "پرونده در شورای حل اختلاف رسیدگی شد."),
    ],
)
def test_expand_legal_abbreviations(raw, expected):
    assert expand_legal_abbreviations(raw) == expected


# ---------------------------------------------------------------------------
# 4. Statutes, Articles & Currency
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("ماده ۱۲ قانون مدنی", "ماده دوازده قانون مدنی"),
        ("ماده ۱۱۰۶ قانون مدنی", "ماده هزار و صد و شش قانون مدنی"),
        ("ماده ۲۱۸ مکرر قانون مدنی", "ماده دویست و هجده مکرر قانون مدنی"),
        ("اصل ۴۴ قانون اساسی", "اصل چهل و چهار قانون اساسی"),
        ("بند ۲ تبصره ۱ ماده ۳", "بند دو تبصره یک ماده سه"),
        ("شعبه ۱۲ دادگاه صلح", "شعبه دوازده دادگاه صلح"),
        ("فصل ۳ و بخش ۲", "فصل سوم و بخش دوم"),
        ("مرحله ۱۲ام دادرسی", "مرحله دوازدهم دادرسی"),
        ("۲مین بار اخطار شد", "دومین بار اخطار شد"),
        ("مبلغ ۵۰۰۰۰ ریال و ۱۰۰۰۰۰ تومان", "مبلغ پنجاه هزار ریال و صد هزار تومان"),
        ("نرخ سود ۲۵٪ و جریمه 10% است", "نرخ سود بیست و پنج درصد و جریمه ده درصد است"),
    ],
)
def test_normalize_statutes_and_labels(raw, expected):
    assert normalize_persian_speech(raw) == expected


# ---------------------------------------------------------------------------
# 5. Full Normalisation Pipeline
# ---------------------------------------------------------------------------


def test_full_pipeline_mixed_legal_sentence():
    raw = (
        "طبق ماده ۱۰ ق.م. و دادنامه شماره ۴۵ مورخ ۱۴۰۳/۰۲/۱۵، "
        "مستاجر مکلف به پرداخت ۵۰۰۰۰۰۰۰ ریال با خسارت ۲.۵٪ گردید."
    )
    normalized = normalize_persian_speech(raw)
    assert "طبق ماده ده قانون مدنی" in normalized
    assert "دادنامه شماره چهل و پنج" in normalized
    assert "پانزدهم اردیبهشت هزار و چهارصد و سه" in normalized
    assert "پنجاه میلیون ریال" in normalized
    assert "دو ممیز پنج درصد" in normalized


# ---------------------------------------------------------------------------
# 6. Clause-Level Streaming Flusher
# ---------------------------------------------------------------------------


def test_streaming_clause_flusher_word_threshold():
    flusher = StreamingClauseFlusher(min_clause_words=6)

    # 1. Short phrase with comma (< 6 words): must not flush yet
    out1 = flusher.push("به علاوه، ")
    assert out1 == []

    # 2. Add more words leading to another comma (now total >= 6 words): must flush
    out2 = flusher.push("با عنایت به مفاد ماده ۱۰ قانون مدنی، ")
    assert len(out2) == 1
    assert "به علاوه، با عنایت به مفاد ماده ده قانون مدنی،" in out2[0]

    # 3. Next sentence fragment terminated with a period: must flush immediately
    out3 = flusher.push("حکم دادگاه قطعی است.")
    assert len(out3) == 1
    assert out3[0] == "حکم دادگاه قطعی است."

    # 4. Final remaining words without ending punct: flushed by flush()
    out4 = flusher.push("موفق باشید")
    assert out4 == []
    out5 = flusher.flush()
    assert len(out5) == 1
    assert out5[0] == "موفق باشید"


def test_streaming_clause_flusher_semicolon_and_colon():
    flusher = StreamingClauseFlusher(min_clause_words=6)

    # Semicolon after 7 words: flushes
    res = flusher.push("خواهان دلیلی بر پرداخت ارائه نکرده است؛ ")
    assert len(res) == 1
    assert "خواهان دلیلی بر پرداخت ارائه نکرده است؛" in res[0]

    # Colon after 3 words: held back
    res2 = flusher.push("نتیجه دادرسی: ")
    assert res2 == []

    # Then sentence end: flushes
    res3 = flusher.push("دعوا محکوم به بطلان است!")
    assert len(res3) == 1
    assert "نتیجه دادرسی: دعوا محکوم به بطلان است!" in res3[0]
