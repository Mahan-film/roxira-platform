"""Persian Spoken Normaliser for Text-to-Speech (TTS) and Voice Agents (T251).

Transforms written Persian text (digits, Jalali dates, statutory article numbers,
legal abbreviations, percentages, currencies) into fully-articulated spoken words
optimized for speech synthesis (sherpa-onnx, Piper, edge-tts).
Includes a streaming clause flusher (، : ؛ after >= 6 words) for low-latency streaming TTS.
"""

from __future__ import annotations

import re
from typing import Generator, Iterable, Iterator, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Character Maps & Digit Conversion
# ---------------------------------------------------------------------------

_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_LATIN_DIGITS = "0123456789"

_DIGIT_MAP = str.maketrans(_PERSIAN_DIGITS + _ARABIC_DIGITS, _LATIN_DIGITS * 2)


def to_latin_digits(text: str) -> str:
    """Normalize Persian and Eastern Arabic digits to ASCII digits."""
    return text.translate(_DIGIT_MAP)


# ---------------------------------------------------------------------------
# Cardinal & Ordinal Persian Numbers
# ---------------------------------------------------------------------------

_UNITS = [
    "",
    "یک",
    "دو",
    "سه",
    "چهار",
    "پنج",
    "شش",
    "هفت",
    "هشت",
    "نه",
]

_TEENS = [
    "ده",
    "یازده",
    "دوازده",
    "سیزده",
    "چهارده",
    "پانزده",
    "شانزده",
    "هفده",
    "هجده",
    "نوزده",
]

_TENS = [
    "",
    "ده",
    "بیست",
    "سی",
    "چهل",
    "پنجاه",
    "شصت",
    "هفتاد",
    "هشتاد",
    "نود",
]

_HUNDREDS = [
    "",
    "صد",
    "دویست",
    "سیصد",
    "چهارصد",
    "پانصد",
    "ششصد",
    "هفتصد",
    "هشتصد",
    "نهصد",
]

_SCALES = [
    "",
    "هزار",
    "میلیون",
    "میلیارد",
    "تریلیون",
    "کوادریلیون",
]

_SPECIAL_ORDINALS = {
    1: "یکم",
    2: "دوم",
    3: "سوم",
    4: "چهارم",
    5: "پنجم",
    6: "ششم",
    7: "هفتم",
    8: "هشتم",
    9: "نهم",
    10: "دهم",
    11: "یازدهم",
    12: "دوازدهم",
    13: "سیزدهم",
    14: "چهاردهم",
    15: "پانزدهم",
    16: "شانزدهم",
    17: "هفدهم",
    18: "هجدهم",
    19: "نوزدهم",
    20: "بیستم",
    23: "بیست و سوم",
    30: "سی‌ام",
    33: "سی و سوم",
    100: "صدم",
    1000: "هزارم",
    1000000: "یک میلیونم",
}


def _chunk3_to_words(n: int) -> List[str]:
    """Convert an integer 0 <= n < 1000 to Persian words list."""
    words: List[str] = []
    if n >= 100:
        h = n // 100
        words.append(_HUNDREDS[h])
        n %= 100
    if 10 <= n < 20:
        words.append(_TEENS[n - 10])
    else:
        if n >= 20:
            t = n // 10
            words.append(_TENS[t])
            n %= 10
        if 0 < n < 10:
            words.append(_UNITS[n])
    return words


def number_to_persian_words(n_val: int | float | str, ordinal: bool = False) -> str:
    """Convert a numeric value to spoken Persian words.

    Examples:
        0 -> "صفر"
        12 -> "دوازده"
        1403 -> "هزار و چهارصد و سه"
        -5 -> "منفی پنج"
        12.5 -> "دوازده ممیز پنج"
        ordinal=True: 1 -> "یکم", 2 -> "دوم", 23 -> "بیست و سوم", 12 -> "دوازدهم"
    """
    if isinstance(n_val, str):
        cleaned = to_latin_digits(n_val.strip())
        if not cleaned:
            return ""
        if "." in cleaned or "/" in cleaned:
            parts = re.split(r"[./]", cleaned, maxsplit=1)
            try:
                int_part = int(parts[0])
                dec_part = parts[1]
                dec_words = " ".join(_UNITS[int(d)] if d != "0" else "صفر" for d in dec_part)
                base = f"{number_to_persian_words(int_part)} ممیز {dec_words}"
                return base
            except ValueError:
                pass
        try:
            n = int(cleaned)
        except ValueError:
            return n_val
    else:
        if isinstance(n_val, float):
            int_p = int(n_val)
            dec_p = round(abs(n_val - int_p), 6)
            if dec_p > 0:
                dec_str = str(dec_p).split(".")[1]
                dec_words = " ".join(_UNITS[int(d)] if d != "0" else "صفر" for d in dec_str)
                return f"{number_to_persian_words(int_p)} ممیز {dec_words}"
            n = int_p
        else:
            n = int(n_val)

    if n == 0:
        return "صفرم" if ordinal else "صفر"

    is_negative = n < 0
    n = abs(n)

    if ordinal and n in _SPECIAL_ORDINALS:
        res = _SPECIAL_ORDINALS[n]
        return f"منفی {res}" if is_negative else res

    chunks: List[int] = []
    temp = n
    while temp > 0:
        chunks.append(temp % 1000)
        temp //= 1000

    parts: List[str] = []
    for i in range(len(chunks) - 1, -1, -1):
        chunk = chunks[i]
        if chunk == 0:
            continue
        c_words = _chunk3_to_words(chunk)
        chunk_str = " و ".join(c_words)
        scale = _SCALES[i] if i < len(_SCALES) else ""
        if scale:
            # In Persian, 1000 is spoken as "هزار", not "یک هزار"
            if i == 1 and chunk == 1:
                parts.append("هزار")
            else:
                parts.append(f"{chunk_str} {scale}")
        else:
            parts.append(chunk_str)

    result = " و ".join(parts) if parts else "صفر"

    if ordinal:
        if result.endswith("سه"):
            result = result[:-2] + "سوم"
        elif result.endswith("ی"):
            result = result + "‌ام"
        elif result.endswith("ه"):
            result = result[:-1] + "هم"
        else:
            result = result + "م"

    if is_negative:
        result = f"منفی {result}"

    return result


# ---------------------------------------------------------------------------
# Jalali Calendar Months & Date Normalisation
# ---------------------------------------------------------------------------

JALALI_MONTHS = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
]


def jalali_date_to_words(year: int, month: int, day: int) -> str:
    """Format year, month, day into fully articulated spoken Persian words.

    Example:
        1403, 8, 15 -> "پانزدهم آبان هزار و چهارصد و سه"
        1402, 1, 1  -> "یکم فروردین هزار و چهارصد و دو"
    """
    if month < 1 or month > 12 or day < 1 or day > 31:
        return f"{day}/{month}/{year}"

    day_word = number_to_persian_words(day, ordinal=True)
    month_name = JALALI_MONTHS[month - 1]
    year_word = number_to_persian_words(year)
    return f"{day_word} {month_name} {year_word}"


_DATE_YMD_RE = re.compile(
    r"(?<!\d)(?:(?:1[34]\d{2})|[۱۳۴][۰-۹]{3})[/\-\.](?:(?:0?[1-9]|1[0-2])|[۰-۹]{1,2})[/\-\.](?:(?:0?[1-9]|[12]\d|3[01])|[۰-۹]{1,2})(?!\d)"
)
_DATE_DMY_RE = re.compile(
    r"(?<!\d)(?:(?:0?[1-9]|[12]\d|3[01])|[۰-۹]{1,2})[/\-\.](?:(?:0?[1-9]|1[0-2])|[۰-۹]{1,2})[/\-\.](?:(?:1[34]\d{2})|[۱۳۴][۰-۹]{3})(?!\d)"
)


def normalize_jalali_dates(text: str) -> str:
    """Detect and convert Jalali dates in YYYY/MM/DD or DD/MM/YYYY format to words."""

    def _replace_ymd(m: re.Match) -> str:
        s = to_latin_digits(m.group(0))
        parts = re.split(r"[/\-\.]", s)
        try:
            y, mo, d = int(parts[0]), int(parts[1]), int(parts[2])
            if 1300 <= y <= 1499 and 1 <= mo <= 12 and 1 <= d <= 31:
                return jalali_date_to_words(y, mo, d)
        except (ValueError, IndexError):
            pass
        return m.group(0)

    def _replace_dmy(m: re.Match) -> str:
        s = to_latin_digits(m.group(0))
        parts = re.split(r"[/\-\.]", s)
        try:
            d, mo, y = int(parts[0]), int(parts[1]), int(parts[2])
            if 1300 <= y <= 1499 and 1 <= mo <= 12 and 1 <= d <= 31:
                return jalali_date_to_words(y, mo, d)
        except (ValueError, IndexError):
            pass
        return m.group(0)

    res = _DATE_YMD_RE.sub(_replace_ymd, text)
    res = _DATE_DMY_RE.sub(_replace_dmy, res)
    return res


# ---------------------------------------------------------------------------
# Legal Abbreviations & Statutes
# ---------------------------------------------------------------------------

_LEGAL_ABBREVIATIONS = [
    # قوانین اصلی و پرکاربرد (با مصرف نقطهٔ پایانی)
    (r"\bق\.آ\.د\.م\.?", "قانون آیین دادرسی مدنی"),
    (r"\bق\.آ\.د\.ک\.?", "قانون آیین دادرسی کیفری"),
    (r"\bق\.م\.ا\.?", "قانون مجازات اسلامی"),
    (r"\bق\.م\.م\.?", "قانون مالیات‌های مستقیم"),
    (r"\bق\.ع\.ح\.?", "قانون اجرای احکام مدنی"),
    (r"\bق\.ت\.ع\.?", "قانون تعزیرات"),
    (r"\bق\.ت\.?", "قانون تجارت"),
    (r"\bق\.م\.?", "قانون مدنی"),
    (r"\bق\.ک\.?", "قانون کار"),
    (r"\bق\.ب\.?", "قانون بیمه"),
    # مراجع و اصطلاحات
    (r"\bر\.و\.?", "رأی وحدت رویه"),
    (r"\bد\.ع\.ک\.?", "دیوان عالی کشور"),
    (r"\bد\.ع\.ا\.?", "دیوان عدالت اداری"),
    (r"\bش\.ح\.ا\.?", "شورای حل اختلاف"),
    (r"\bک\.م\.?", "کد ملی"),
    # پیشوندهای استناد قانونی پیش از عدد
    (r"\bم\.\s*(?=[0-9۰-۹])", "ماده "),
    (r"\bتب\.\s*(?=[0-9۰-۹])", "تبصره "),
    (r"\bش\.\s*(?=[0-9۰-۹])", "شماره "),
    (r"\bص\.\s*(?=[0-9۰-۹])", "صفحه "),
]

_COMPILED_ABBRS = [(re.compile(pat), repl) for pat, repl in _LEGAL_ABBREVIATIONS]


def expand_legal_abbreviations(text: str) -> str:
    """Expand standard legal abbreviations to spoken words."""
    res = text
    for pat, repl in _COMPILED_ABBRS:
        res = pat.sub(repl, res)
    return res


# ---------------------------------------------------------------------------
# Legal Articles, Statutes & Structural Labels
# ---------------------------------------------------------------------------

_LEGAL_STATUTE_RE = re.compile(
    r"\b(ماده|اصل|تبصره|بند|شعبه|ردیف|جلسه|دادنامه|شماره)\s+([0-9۰-۹]+)(?:\s+(مکرر))?\b"
)
_ORDINAL_STRUCT_RE = re.compile(
    r"\b(فصل|بخش|پارت|قسمت|طبقه)\s+([0-9۰-۹]+)\b"
)

_NUMERIC_ORDINAL_SUFFIX_RE = re.compile(
    r"\b([0-9۰-۹]+)\s*[-ـ]?\s*(ام|اُم|مین)\b"
)

_CURRENCY_RE = re.compile(
    r"\b([0-9۰-۹]+(?:[.,/][0-9۰-۹]+)?)\s*(ریال|تومان)\b"
)

# Percentages without ASCII-only word boundaries for Unicode ٪
_PERCENT_RE = re.compile(
    r"(?<![a-zA-Z0-9۰-۹])([0-9۰-۹]+(?:[.,/][0-9۰-۹]+)?)\s*[%٪]"
)


def normalize_statutes_and_labels(text: str) -> str:
    """Convert legal statutes, articles, ordinals and numbers in phrases."""

    def _replace_statute(m: re.Match) -> str:
        prefix = m.group(1)
        num_str = to_latin_digits(m.group(2))
        mokarrar = m.group(3)
        words = number_to_persian_words(int(num_str))
        res = f"{prefix} {words}"
        if mokarrar:
            res += " مکرر"
        return res

    def _replace_ordinal_struct(m: re.Match) -> str:
        prefix = m.group(1)
        num_str = to_latin_digits(m.group(2))
        words = number_to_persian_words(int(num_str), ordinal=True)
        return f"{prefix} {words}"

    def _replace_ordinal_suffix(m: re.Match) -> str:
        num_str = to_latin_digits(m.group(1))
        suffix = m.group(2)
        ord_word = number_to_persian_words(int(num_str), ordinal=True)
        if suffix == "مین":
            return f"{ord_word}ین"
        return ord_word

    def _replace_currency(m: re.Match) -> str:
        num_str = to_latin_digits(m.group(1).replace(",", ""))
        unit = m.group(2)
        words = number_to_persian_words(num_str)
        return f"{words} {unit}"

    def _replace_percent(m: re.Match) -> str:
        num_str = to_latin_digits(m.group(1).replace(",", ""))
        words = number_to_persian_words(num_str)
        return f"{words} درصد"

    t = _CURRENCY_RE.sub(_replace_currency, text)
    t = _PERCENT_RE.sub(_replace_percent, t)
    t = _NUMERIC_ORDINAL_SUFFIX_RE.sub(_replace_ordinal_suffix, t)
    t = _LEGAL_STATUTE_RE.sub(_replace_statute, t)
    t = _ORDINAL_STRUCT_RE.sub(_replace_ordinal_struct, t)
    return t


_STANDALONE_NUMBER_RE = re.compile(
    r"(?<![a-zA-Z0-9۰-۹_])(?:-?[0-9۰-۹]+(?:[.,/][0-9۰-۹]+)?)(?![a-zA-Z0-9۰-۹_])"
)


def normalize_standalone_numbers(text: str) -> str:
    """Convert remaining standalone numbers to Persian words."""

    def _replace_num(m: re.Match) -> str:
        raw = m.group(0)
        return number_to_persian_words(raw)

    return _STANDALONE_NUMBER_RE.sub(_replace_num, text)


# ---------------------------------------------------------------------------
# Complete Pipeline Normalisation
# ---------------------------------------------------------------------------


def normalize_persian_speech(text: str) -> str:
    """Full normalization pipeline from written text to spoken Persian.

    Pipeline stages:
    1. Expand legal abbreviations (ق.م. -> قانون مدنی)
    2. Convert Jalali calendar dates (1403/08/15 -> پانزدهم آبان هزار و چهارصد و سه)
    3. Normalize statutory and structural numbers (ماده ۱۲, اصل ۴۴, بند ۲, ۲۵٪, ۵۰۰ ریال)
    4. Convert remaining numbers and digits to words
    5. Clean excess whitespace
    """
    if not text:
        return ""

    s = text
    s = expand_legal_abbreviations(s)
    s = normalize_jalali_dates(s)
    s = normalize_statutes_and_labels(s)
    s = normalize_standalone_numbers(s)

    # Clean double spaces
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


# ---------------------------------------------------------------------------
# Clause-Level Streaming Flusher (T251)
# ---------------------------------------------------------------------------


class StreamingClauseFlusher:
    """Buffers streamed tokens into spoken clauses or sentences.

    Flushing rules:
    - Sentence terminators (. ! ؟ ? \\n): Flush immediately if buffer is non-empty.
    - Clause terminators (، ؛ :): Flush IF accumulated words in current clause >= min_clause_words (default 6).
    - Unpunctuated runaway buffers (> max_clause_chars): Flush at whitespace or comma.
    - flush(): Flush any remaining text at end-of-stream.
    """

    def __init__(self, min_clause_words: int = 6, max_clause_chars: int = 150):
        self.min_clause_words = min_clause_words
        self.max_clause_chars = max_clause_chars
        self._buf = ""

    def _word_count(self, s: str) -> int:
        return len(re.findall(r"\S+", s))

    def push(self, token: str) -> List[str]:
        """Add streamed text token and return any completed clauses."""
        self._buf += token
        out: List[str] = []

        delim_pattern = re.compile(r"([.!?؟\n]+|[،؛:]+)")

        while self._buf:
            matches = list(delim_pattern.finditer(self._buf))
            if not matches:
                if len(self._buf) > self.max_clause_chars:
                    ws_idx = self._buf.rfind(" ", 40, self.max_clause_chars)
                    if ws_idx > 0:
                        candidate = self._buf[:ws_idx].strip()
                        self._buf = self._buf[ws_idx + 1:]
                        if candidate:
                            norm = normalize_persian_speech(candidate)
                            if norm:
                                out.append(norm)
                        continue
                break

            handled = False
            for m in matches:
                delim = m.group(1)
                end_idx = m.end()
                candidate = self._buf[:end_idx].strip()
                is_sentence_end = any(c in ".!?؟\n" for c in delim)

                if is_sentence_end:
                    if candidate:
                        normalized = normalize_persian_speech(candidate)
                        if normalized:
                            out.append(normalized)
                    self._buf = self._buf[end_idx:]
                    handled = True
                    break
                else:
                    words = self._word_count(candidate)
                    if words >= self.min_clause_words:
                        normalized = normalize_persian_speech(candidate)
                        if normalized:
                            out.append(normalized)
                        self._buf = self._buf[end_idx:]
                        handled = True
                        break

            if not handled:
                if len(self._buf) > self.max_clause_chars:
                    first_m = matches[0]
                    end_idx = first_m.end()
                    candidate = self._buf[:end_idx].strip()
                    self._buf = self._buf[end_idx:]
                    if candidate:
                        norm = normalize_persian_speech(candidate)
                        if norm:
                            out.append(norm)
                    continue
                break

        return out

    def flush(self) -> List[str]:
        """Flush any remaining buffered text."""
        out: List[str] = []
        rem = self._buf.strip()
        self._buf = ""
        if rem:
            norm = normalize_persian_speech(rem)
            if norm:
                out.append(norm)
        return out
