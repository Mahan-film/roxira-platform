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

from output_apps.generated_modules.smartjudge.persian_norm import normalize_persian_search

_TOKEN_RE = re.compile(r"[0-9a-z\u0600-\u06ff]+", re.UNICODE)
# Qdrant sparse indices are unsigned 32-bit; stay in the positive 31-bit range and skip 0.
_INDEX_MOD = (1 << 31) - 1


def normalize(text: object) -> str:
    """Normalise Persian/Arabic text for tokenization via shared ``persian_norm`` (ZWNJ -> space)."""
    return normalize_persian_search(text).replace("\u200c", " ").lower()


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
