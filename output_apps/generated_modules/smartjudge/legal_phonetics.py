"""
Legal Phonetic Repair Engine for Persian Speech-to-Text (SmartJudge).
Fixes common speech recognition distortions and phonetic misinterpretations
of Iranian legal and judicial terminology.
"""
from __future__ import annotations

import re

# نگاشت تحریف‌های آوایی رایج مدل‌های گفتاری به واژگان رسمی دادگستری
_PHONETIC_REPLACEMENTS = [
    # وحدت رویه
    (r"(?:آخرت|آخرین|اخرین)\s*(?:آرائه|ارائه|ارای|آرای)\s*(?:رای|رأی)?\s*(?:وقت\s*ویدیو|وقتت\s*رویه|وقتترابی|وقت\s*رویه|وسط\s*روی(?:ه)?)", "آخرین رأی وحدت رویه"),
    (r"(?:آرای|ارای|آراء)?\s*(?:رای|رأی)?\s*وسط\s*روی(?:ه)?", "رأی وحدت رویه"),
    (r"(?:آرای|ارای)\s+عدی\s+بستا\s+[سر]ویه", "آرای وحدت رویه"),
    (r"آده\s+رای\s+بحث\s+زدیه", "آرای وحدت رویه"),
    (r"از\s*ملورا\s*ملورا\s*دی", "آخرین رأی وحدت رویه دیوان"),
    (r"ملورا\s*دی", "وحدت رویه دیوان"),
    (r"وقت\s*ویدیو", "وحدت رویه"),
    (r"وقتت\s*رویه", "وحدت رویه"),
    (r"وقتترابی", "وحدت رویه"),
    (r"رئیم\s*باحتت", "رأی وحدت رویه"),
    (r"رای\s*وقت", "رأی وحدت"),
    (r"رویه\s*باحتت", "رویه وحدت"),

    # مراجع قضایی
    (r"(?:قول\s*به\s*قضاییه|قوه‌ی\s*قضاییه|قوهٔ\s*قضاییه|قول\s*به\s*قضایی)", "قوه قضاییه"),
    (r"دیوان\s*(?:آلی|الی|عالی)\s*اداره\s*کشور", "دیوان عالی کشور"),
    (r"دیوان\s*(?:آلی|الی)\s*کشور", "دیوان عالی کشور"),
    (r"دیوان\s*ادالت(?:\s*اداری)?", "دیوان عدالت اداری"),
    (r"دادگاه\s*(?:صلحا|سلح)", "دادگاه صلح"),
    (r"قو[به]\s*قضایی(?!\s*ه)", "قوه قضاییه"),
    (r"دیوان\s*عالیه", "دیوان عالی"),
    (r"دیوان\s*عدالت\s*اداریه", "دیوان عدالت اداری"),
    (r"شورای\s*حل\s*اختلافات", "شورای حل اختلاف"),
    (r"(?<![^\W\d_])قضاک(?![^\W\d_])", "قضات"),

    # اصطلاحات تخصصی دادرسی و مدنی
    (r"(?:موردان|مبارزان)\s+(?:برشویش|پولشویش|پول\s*شویی|پولشویی)", "مبارزه با پولشویی"),
    (r"(?<![^\W\d_])(?:برشویش|پولشویش)(?![^\W\d_])", "پولشویی"),
    (r"(?<![^\W\d_])تخلافات(?![^\W\d_])", "تخلفات"),
    (r"اعاده\s*داد\s*رسی", "اعاده دادرسی"),
    (r"تاخیر\s*تادیه", "تأخیر تأدیه"),
    (r"تاخیرتادیه", "تأخیر تأدیه"),
    (r"عند\s*المطالبه", "عندالمطالبه"),
    (r"عندالمطالبهی", "عندالمطالبه"),
    (r"عند\s*الاستطاعه", "عندالاستطاعه"),
    (r"مستحق\s*لل\s*غیر", "مستحق‌للغیر"),
    (r"مستحق\s*للغیر", "مستحق‌للغیر"),
    (r"خیانت\s*در\s*امانتدار", "خیانت در امانت"),
    (r"تصرف\s*عدوانیه", "تصرف عدوانی"),
    (r"خلع\s*یدک", "خلع ید"),
    (r"توقیف\s*اموالک", "توقیف اموال"),
    (r"اجراییه\s*ثبتی", "اجرائیه ثبتی"),
    (r"چک\s*صیادیه", "چک صیادی"),
    (r"سفته\s*بانکیه", "سفته بانکی"),
    (r"ماده\s*۴۷۴", "ماده ۴۷۴ قانون آیین دادرسی کیفری"),
    (r"ماده\s*۵۲۲", "ماده ۵۲۲ قانون آیین دادرسی مدنی"),
    (r"ماده\s*۱۰۸۲", "ماده ۱۰۸۲ قانون مدنی"),
]

_COMPILED_PATTERNS = [(re.compile(pat, re.IGNORECASE), repl) for pat, repl in _PHONETIC_REPLACEMENTS]


def repair_legal_phonetics(transcript: str) -> str:
    """
    ترمیم هوشمند تحریفات آوایی در گفتار حقوقی کاربر.
    برای نمونه: «آخرت آرائه رای وقت ویدیو بوده» -> «آخرین رأی وحدت رویه بوده»
    """
    if not transcript:
        return ""

    text = " " + transcript + " "
    for pattern, replacement in _COMPILED_PATTERNS:
        text = pattern.sub(replacement, text)

    return " ".join(text.split())


_PERSIAN_ONES = {
    "صفر": 0, "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5,
    "شش": 6, "شیش": 6, "هفت": 7, "هشت": 8, "نه": 9,
}
_PERSIAN_TEENS = {
    "ده": 10, "یازده": 11, "دوازده": 12, "سیزده": 13, "چهارده": 14,
    "پانزده": 15, "پونزده": 15, "شانزده": 16, "شونزده": 16,
    "هفده": 17, "هجده": 18, "نوزده": 19,
}
_PERSIAN_TENS = {
    "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50,
    "شصت": 60, "هفتاد": 70, "هشتاد": 80, "نود": 90,
}
_PERSIAN_HUNDREDS = {
    "صد": 100, "یکصد": 100, "دویست": 200, "سیصد": 300, "چهارصد": 400,
    "پانصد": 500, "پونصد": 500, "ششصد": 600, "هفتصد": 700,
    "هشتصد": 800, "نهصد": 900,
}
_ALL_NUMBER_WORDS = {**_PERSIAN_ONES, **_PERSIAN_TEENS, **_PERSIAN_TENS, **_PERSIAN_HUNDREDS}
_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def normalize_spoken_numbers(text: str) -> str:
    """Convert Persian spoken number phrases (e.g. 'ماده پانصد و بیست و دو') into ASCII digits."""
    if not text:
        return ""
    tokens = text.translate(_PERSIAN_DIGITS).split()
    out: list[str] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in _ALL_NUMBER_WORDS or tok == "هزار":
            total = 0
            current = 0
            consumed = False
            while i < len(tokens):
                w = tokens[i]
                if w == "و" and i + 1 < len(tokens) and (tokens[i + 1] in _ALL_NUMBER_WORDS or tokens[i + 1] == "هزار"):
                    i += 1
                    continue
                if w in _ALL_NUMBER_WORDS:
                    current += _ALL_NUMBER_WORDS[w]
                    consumed = True
                    i += 1
                elif w == "هزار":
                    total += (current if current > 0 else 1) * 1000
                    current = 0
                    consumed = True
                    i += 1
                else:
                    break
            if consumed:
                out.append(str(total + current))
                continue
        out.append(tok)
        i += 1
    return " ".join(out)


def fuzzy_match_statute(query: str, candidates: list[str]) -> str | None:
    """Return the best matching statute title from candidates using normalized token overlap."""
    if not query or not candidates:
        return None
    norm_q = normalize_spoken_numbers(repair_legal_phonetics(query)).strip()
    q_tokens = set(norm_q.split())
    best_cand: str | None = None
    best_score = 0.0
    for cand in candidates:
        norm_c = normalize_spoken_numbers(cand).strip()
        c_tokens = set(norm_c.split())
        if not c_tokens:
            continue
        overlap = len(q_tokens & c_tokens) / max(len(q_tokens | c_tokens), 1)
        if overlap > best_score and overlap >= 0.4:
            best_score = overlap
            best_cand = cand
    return best_cand
