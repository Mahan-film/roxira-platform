"""Persian/Arabic normalisation and sparse (BM25-style) tokenization.

Single source of truth shared by the v8h hybrid collection builder
(``scripts/legal/build_v8_hybrid.py``) and the SmartJudge retrieval path
(``legal_graph/lightrag_engine.py``). Pure stdlib, no I/O, no network: the builder and
the query side must produce the same token ids or the sparse branch cannot match.

Rules (task: "normalise Arabic ي/ك to ی/ک, Persian/Arabic digits to ASCII, strip
ZWNJ/diacritics, keep digits as tokens so article numbers match"):

* Arabic yeh/kaf and hamza forms fold to the Persian letters;
* Persian and Arabic-Indic digits become ASCII ``0-9``;
* ZWNJ/ZWJ/bidi marks and the soft hyphen are removed (treated as a space break);
* harakat (``ً``..``ٰ``) and the tatweel ``ـ`` are stripped;
* tokens are runs of letters/digits; **digits stay whole tokens** so «ماده ۲۷» and
  «ماده 27» hash to the same sparse index.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

_LETTERS = str.maketrans(
    {
        "\u064a": "\u06cc",  # Arabic yeh -> Persian yeh
        "\u0649": "\u06cc",  # alef maksura -> Persian yeh
        "\u0626": "\u06cc",  # yeh with hamza -> Persian yeh
        "\u0643": "\u06a9",  # Arabic kaf -> Persian keheh
        "\u0629": "\u0647",  # teh marbuta -> heh
        "\u06c0": "\u0647",  # heh with yeh -> heh
        "\u0623": "\u0627",  # hamza forms -> alef
        "\u0625": "\u0627",
        "\u0671": "\u0627",
        "\u0622": "\u0627",
        "\u0624": "\u0648",  # waw with hamza -> waw
    }
)
_DIGITS = str.maketrans(
    "\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9"
    "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669",
    "01234567890123456789",
)
# harakat / tanwin / superscript alef / tatweel
_DIACRITICS = re.compile("[\u064b-\u0652\u0653-\u0655\u0670\u0640]")
# ZWNJ, ZWJ, LRM, RLM, soft hyphen, bidi isolates
_INVISIBLE = "\u200c\u200d\u200e\u200f\u00ad\u2066\u2067\u2068\u2069"
_TOKEN_RE = re.compile(r"[0-9a-z\u0600-\u06ff]+", re.UNICODE)
# Qdrant sparse indices are unsigned 32-bit; stay in the positive 31-bit range and skip 0.
_INDEX_MOD = (1 << 31) - 1


def normalize(text: object) -> str:
    """Normalise Persian/Arabic text for tokenization (see module docstring)."""
    value = unicodedata.normalize("NFC", str(text or ""))
    value = value.translate(_LETTERS).translate(_DIGITS)
    value = _DIACRITICS.sub("", value)
    for mark in _INVISIBLE:
        value = value.replace(mark, " ")
    return value.lower()


def tokenize(text: object) -> list[str]:
    """Normalised tokens; digits are kept as their own tokens."""
    return _TOKEN_RE.findall(normalize(text))


def term_frequencies(text: object) -> dict[str, float]:
    """Raw term-frequency map (``token -> count``) over the normalised tokens."""
    counts: dict[str, float] = {}
    for token in tokenize(text):
        counts[token] = counts.get(token, 0.0) + 1.0
    return counts


def token_index(token: str) -> int:
    """Stable, collision-tolerant sparse index for a token (deterministic across runs)."""
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=4).digest()
    return (int.from_bytes(digest, "big") % _INDEX_MOD) + 1


def sparse_vector(text: object) -> tuple[list[int], list[float]]:
    """Document sparse vector ``(indices, values)`` with raw term-frequency values.

    Qdrant's ``Modifier.IDF`` divides by the collection IDF at query time, so the stored
    values are plain term frequencies. Indices are sorted and collision-merged so the
    vector is reproducible.
    """
    by_index: dict[int, float] = {}
    for token, count in term_frequencies(text).items():
        index = token_index(token)
        by_index[index] = by_index.get(index, 0.0) + count
    if not by_index:
        return [], []
    indices = sorted(by_index)
    return indices, [by_index[index] for index in indices]


def query_sparse_vector(text: object) -> tuple[list[int], list[float]]:
    """Query sparse vector: one ``1.0`` per distinct token (IDF is applied by Qdrant)."""
    by_index: dict[int, float] = {}
    for token in set(tokenize(text)):
        by_index[token_index(token)] = 1.0
    if not by_index:
        return [], []
    indices = sorted(by_index)
    return indices, [1.0 for _ in indices]
