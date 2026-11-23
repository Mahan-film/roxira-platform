"""Symmetric Persian normalisation with verbatim display and normalised search fields (T237).

Single source of truth used at both index time and query time:
- ``text_display``: verbatim original text (used in citations and answers).
- ``text_search_norm``: symmetrically normalised text for search/indexing.

Pure stdlib, no I/O, no network.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Mapping

_CHAR_MAP = str.maketrans(
    {
        "\u064a": "\u06cc",  # Arabic yeh (ي) -> Persian yeh (ی)
        "\u0649": "\u06cc",  # alef maksura (ى) -> Persian yeh (ی)
        "\u0626": "\u06cc",  # yeh with hamza (ئ) -> Persian yeh (ی)
        "\u0643": "\u06a9",  # Arabic kaf (ك) -> Persian keheh (ک)
        "\u0629": "\u0647",  # teh marbuta (ة) -> heh (ه)
        "\u06c0": "\u0647",  # heh with yeh above (ۀ) -> heh (ه)
        "\u0623": "\u0627",  # alef with hamza above (أ) -> alef (ا)
        "\u0625": "\u0627",  # alef with hamza below (إ) -> alef (ا)
        "\u0622": "\u0627",  # alef with madda (آ) -> alef (ا)
        "\u0671": "\u0627",  # alef wasla (ٱ) -> alef (ا)
        "\u0624": "\u0648",  # waw with hamza (ؤ) -> waw (و)
    }
)

_DIGIT_MAP = str.maketrans(
    "\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9"
    "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669",
    "01234567890123456789",
)

# Arabic/Persian harakat, tanwin, shadda, sukun, superscript alef, tatweel
_HARAKAT_AND_TATWEEL_RE = re.compile(r"[\u064b-\u065f\u0670\u0640]")

# Bidi control marks, ALM, soft hyphen, BOM, ZWJ
_BIDI_AND_INVISIBLE_RE = re.compile(
    r"[\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u00ad\ufeff]"
)

# Collapse multiple ZWNJ into a single ZWNJ
_MULTI_ZWNJ_RE = re.compile(r"\u200c{2,}")

# Strip ZWNJ adjacent to whitespace or common punctuation
_EDGE_ZWNJ_RE = re.compile(r"(?:\s*\u200c\s*(?=[.,;:!?؟،؛()\[\]{}«»\-/\\]|$)|(?<=^)\u200c+|(?<=[.,;:!?؟،؛()\[\]{}«»\-/\\])\u200c+|\s+\u200c+|\u200c+\s+)")

# Collapse whitespace runs to a single ASCII space
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_persian_search(text: object) -> str:
    """Normalise Persian/Arabic text symmetrically for index and query time.

    Rules:
    - Unicode NFC normalisation.
    - Arabic ي/ى/ئ -> ی, ك -> ک, ة/ۀ -> ه, hamza-alef (أ/إ/آ/ٱ) -> ا, ؤ -> و.
    - Persian (۰-۹) and Arabic-Indic (٠-٩) digits -> ASCII 0-9.
    - Strip harakat/diacritics, tatweel (ـ), and bidi/invisible marks.
    - Collapse repeated ZWNJ and strip ZWNJ at whitespace/punctuation boundaries.
    - Collapse whitespace runs and strip leading/trailing whitespace.
    """
    if text is None:
        return ""
    value = unicodedata.normalize("NFC", str(text))
    value = _BIDI_AND_INVISIBLE_RE.sub("", value)
    value = _HARAKAT_AND_TATWEEL_RE.sub("", value)
    value = value.translate(_CHAR_MAP).translate(_DIGIT_MAP)
    value = _MULTI_ZWNJ_RE.sub("\u200c", value)
    # Remove ZWNJ touching spaces or punctuation while preserving intra-word ZWNJ
    value = re.sub(r"\s+\u200c+", " ", value)
    value = re.sub(r"\u200c+\s+", " ", value)
    value = re.sub(r"^\u200c+|\u200c+$", "", value)
    value = re.sub(r"\u200c+(?=[.,;:!?؟،؛()\[\]{}«»\-/\\])", "", value)
    value = re.sub(r"(?<=[.,;:!?؟،؛()\[\]{}«»\-/\\])\u200c+", "", value)
    value = _WHITESPACE_RE.sub(" ", value).strip()
    return value


def build_chunk_text_fields(text: object) -> dict[str, str]:
    """Return both verbatim ``text_display`` and normalised ``text_search_norm``."""
    verbatim = "" if text is None else str(text)
    return {
        "text_display": verbatim,
        "text_search_norm": normalize_persian_search(verbatim),
    }


def display_text_from_payload(payload: Mapping[str, Any] | None) -> str:
    """Return the verbatim display text for citations/answers, never the normalised form."""
    if not payload:
        return ""
    for key in ("text_display", "text", "summary", "content"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val
    return ""
