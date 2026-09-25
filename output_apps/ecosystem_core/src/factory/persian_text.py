"""Persian sentence splitting for streaming TTS (W7, docs/W7_voice_latency.md).

Splits Persian LLM output into sentences on ``.  ؟  !  ۔`` and newline, while
NOT splitting on:

- Decimal numbers, Persian or Latin digits either side of the dot (``۱۲.۵``,
  ``12.5``).
- A short list of common Persian legal-writing abbreviations that themselves
  contain a dot (``ه.ش``, ``ه.ق``, ...).

Pure, offline, no network/IO -- safe to unit test and to call on every LLM
delta while streaming (VOICE_STREAM_TTS).
"""

from __future__ import annotations

import re

_PERSIAN_DIGITS = "۰-۹"  # ۰-۹
_ASCII_DIGITS = "0-9"
_DIGITS = _ASCII_DIGITS + _PERSIAN_DIGITS
_DECIMAL_RE = re.compile(rf"(?<=[{_DIGITS}])\.(?=[{_DIGITS}])")

# Common Persian legal/administrative abbreviations that contain a literal dot.
# Extend this list as real transcripts surface more (see docs/W7_voice_latency.md).
ABBREVIATIONS: tuple[str, ...] = (
    "ه.ش",  # هجری شمسی
    "ه.ق",  # هجری قمری
    "ج.ا.ا",  # جمهوری اسلامی ایران
    "ب.ت",  # به‌تاریخ (لوایح رایج)
    "ص.ق",  # صفحه قانون
    "ق.م",  # قانون مدنی
    "ق.آ.د.م",  # قانون آیین دادرسی مدنی
    "ق.م.ا",  # قانون مجازات اسلامی
)

_ENDER_RE = re.compile(r"([.؟!۔]+|\n+)")  # .  ؟  !  ۔  or newline run

_PLACEHOLDER = "\x00"


def split_persian_sentences(text: str) -> list[str]:
    """Split `text` into a list of trimmed, non-empty sentences.

    Returns an empty list for empty/whitespace-only input. The delimiter is
    kept as part of the sentence it ends (e.g. "سلام." not "سلام" + ".").
    """
    if not text or not text.strip():
        return []

    protected = _DECIMAL_RE.sub(_PLACEHOLDER, text)
    for abbr in ABBREVIATIONS:
        if "." in abbr:
            protected = protected.replace(abbr, abbr.replace(".", _PLACEHOLDER))

    parts = _ENDER_RE.split(protected)

    sentences: list[str] = []
    buf = ""
    for part in parts:
        if part == "":
            continue
        if _ENDER_RE.fullmatch(part):
            buf += part
            stripped = buf.strip()
            if stripped:
                sentences.append(stripped)
            buf = ""
        else:
            buf += part
    if buf.strip():
        sentences.append(buf.strip())

    return [s.replace(_PLACEHOLDER, ".") for s in sentences]
