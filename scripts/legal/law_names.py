#!/usr/bin/env python3
# ruff: noqa: RUF001
"""Law-name normalisation and alias folding for the legal corpus builds (``build_v7.py``).

The same law reaches the corpus under several spellings: Arabic «ي»/«ك», ZWNJ or a space or
nothing between word parts («آیین‌نامه» / «آیین نامه» / «آییننامه»), «آئین» for «آیین», Persian
or Arabic-Indic digits, diacritics and tatweel, «خسارات وارده» / «خسارت وارد شده به», a year in
parentheses or a trailing «مصوب ...» / «با اصلاحات بعدی». v7 was not switched because such
duplicates split a law in two and pushed the v6 rows down the gate ranks (r@1 72.9 -> 67.1%).

:func:`canonical_law_key` folds all of that to one compact key. Two names merge when their keys
are equal, or when the keys are close (``difflib`` ratio >= threshold) AND they carry the same
distinguishing tokens (digit runs such as years or plan numbers, ordinal words such as «پنجم»,
and an amendment marker «اصلاح»/«اصلاحی»), so «قانون بودجه سال 1402» never merges with 1403,
«برنامه پنجم» never with «برنامه ششم», and «قانون نظام صنفی کشور (اصلاحی 1392)» (the relabelled
guild amendment, see ``split_rc_law_articles.py``) never with «قانون نظام صنفی کشور».

Everything is deterministic: input order does not matter (names are sorted, ties are broken by
row count, then length, then the name itself). Stdlib only.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable

DEFAULT_RATIO = 0.90

_CHAR_MAP = str.maketrans(
    {
        "ي": "ی",  # Arabic yeh
        "ى": "ی",  # alef maksura
        "ی": "ی",
        "ك": "ک",  # Arabic kaf
        "أ": "ا",
        "إ": "ا",
        "آ": "ا",  # alef madda: «آیین» == «ایین»
        "ٱ": "ا",
        "ؤ": "و",
        "ئ": "ی",  # «آئین» == «آیین», «مسائل» == «مسایل»
        "ة": "ه",
        "ۀ": "ه",  # heh with yeh above («ۀ»)
        "ہ": "ه",
        "ە": "ه",
        "ـ": "",  # tatweel
        "‌": " ",  # ZWNJ
        "‍": "",
        "‎": "",
        "‏": "",
        "﻿": "",
        " ": " ",
        "（": "(",
        "）": ")",
        **{chr(0x06F0 + i): str(i) for i in range(10)},  # Persian digits
        **{chr(0x0660 + i): str(i) for i in range(10)},  # Arabic-Indic digits
    }
)
_DIACRITICS_RE = re.compile("[ً-ٰٟ]")
_PAREN_RE = re.compile(r"\(([^()]*)\)")
_YEAR_RE = re.compile(r"1[2-4]\d\d")
_MASOOB_RE = re.compile(r"\s*\bمصوب\b.*$")
_WITH_AMENDMENTS_RE = re.compile(
    r"\s*\bبا\s+(?:کلیه\s+|اخرین\s+)?اصلاحات(?:\s+و\s+الحاقات)?(?:\s+بعدی)?\s*$"
)
# «وارده» / «وارد شده» / «واردشده» / «وارد», each with or without a following «به», -> «وارد»
_WAREDE_RE = re.compile(r"\bوارد(?:ه|\s*شده)?(?:\s+به)?\b")
_ORDINAL_RE = re.compile(r"\b(اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\b")
_DIGITS_RE = re.compile(r"\d+")
_AMEND_MARK = "اصلاح"


def normalise_chars(name: str) -> str:
    """Character-level normalisation: letters, digits, ZWNJ/NBSP, diacritics, tatweel, spaces."""
    text = unicodedata.normalize("NFC", str(name or "")).translate(_CHAR_MAP)
    text = _DIACRITICS_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def _fold(name: str) -> str:
    """Spaced, folded name (before compaction): see the module docstring for the folds."""
    text = normalise_chars(name)
    amend_years: list[str] = []

    def _paren(m: re.Match) -> str:
        inner = m.group(1)
        if "اصلاحی" in inner:  # «(اصلاحی 1392)»: an amended text, kept as a distinct law
            year = _YEAR_RE.search(inner)
            amend_years.append(year.group(0) if year else "")
            return " "
        if "اصلاحات" in inner or _DIGITS_RE.search(inner):  # «(1395)», «(با اصلاحات بعدی)»
            return " "
        return m.group(0)

    text = _PAREN_RE.sub(_paren, text)
    text = _MASOOB_RE.sub("", text)
    text = _WITH_AMENDMENTS_RE.sub("", text)
    text = _WAREDE_RE.sub("وارد", text)
    for year in amend_years:
        text += f" اصلاحی {year}".rstrip()
    return re.sub(r"\s+", " ", text).strip()


def canonical_law_key(name: str) -> str:
    """Compact comparison key: the folded name with every non letter/digit removed."""
    return "".join(ch for ch in _fold(name) if unicodedata.category(ch)[0] in ("L", "N"))


def distinguishers(name: str) -> tuple[tuple[str, ...], tuple[str, ...], bool]:
    """Tokens two names must share before a fuzzy (non-equal key) merge is allowed."""
    folded = _fold(name)
    return (
        tuple(_DIGITS_RE.findall(folded)),
        tuple(sorted(set(_ORDINAL_RE.findall(folded)))),
        _AMEND_MARK in folded,
    )


def key_ratio(a: str, b: str) -> float:
    """``difflib`` ratio of two canonical keys."""
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _same_name(a: str, b: str) -> bool:
    return " ".join(a.split()) == " ".join(b.split())


def _representative(names: Iterable[str], counts: Counter) -> str:
    """Most rows wins, then the shorter name, then the lexicographically smaller one."""
    return min(names, key=lambda n: (-counts[n], len(n), n))


class _KeyIndex:
    """Canonical key -> representative name, with a deterministic fuzzy lookup."""

    def __init__(self) -> None:
        self.rep: dict[str, str] = {}
        self.dist: dict[str, tuple] = {}

    def add(self, key: str, name: str) -> None:
        self.rep[key] = name
        self.dist[key] = distinguishers(name)

    def lookup(self, key: str, name: str, threshold: float) -> tuple[str, str, float] | None:
        """(target, kind, ratio) for an equal key, else the best guarded fuzzy key, else None."""
        if key in self.rep:
            return self.rep[key], "key", 1.0
        want = distinguishers(name)
        best: tuple[float, str] | None = None
        for other in sorted(self.rep):
            if self.dist[other] != want:
                continue
            matcher = difflib.SequenceMatcher(None, key, other)
            if matcher.real_quick_ratio() < threshold or matcher.quick_ratio() < threshold:
                continue
            ratio = matcher.ratio()
            if ratio >= threshold and (best is None or ratio > best[0]):
                best = (ratio, other)
        if best is None:
            return None
        return self.rep[best[1]], "fuzzy", round(best[0], 4)


def _index(names: Counter) -> _KeyIndex:
    by_key: dict[str, list[str]] = {}
    for name in sorted(names):
        key = canonical_law_key(name)
        if key:
            by_key.setdefault(key, []).append(name)
    index = _KeyIndex()
    for key in sorted(by_key):
        index.add(key, _representative(by_key[key], names))
    return index


def alias_to_base(
    staged_names: Iterable[str], base_names: Iterable[str], *, threshold: float = DEFAULT_RATIO
) -> list[dict]:
    """Merges of staged law names onto an existing (v6) law name.

    Returns ``[{"from", "to", "kind": "v6_key"|"v6_fuzzy", "ratio", "rows"}]`` sorted by name.
    Names that are already the v6 name (up to whitespace) are not listed.
    """
    staged, base = Counter(n for n in staged_names if n), Counter(n for n in base_names if n)
    index = _index(base)
    merges: list[dict] = []
    for name in sorted(staged):
        key = canonical_law_key(name)
        hit = index.lookup(key, name, threshold) if key else None
        if hit is None or _same_name(hit[0], name):
            continue
        target, kind, ratio = hit
        merges.append(
            {"from": name, "to": target, "kind": f"v6_{kind}", "ratio": ratio, "rows": staged[name]}
        )
    return merges


def merge_staged(staged_names: Iterable[str], *, threshold: float = DEFAULT_RATIO) -> list[dict]:
    """Merges among staged law names that have no v6 counterpart (two sources, two spellings).

    Names are grouped by equal canonical key; groups are then visited by row count (largest
    first) and folded into an earlier group's representative when the guarded fuzzy ratio is
    at/above ``threshold``. Returns ``[{"from", "to", "kind": "staged_key"|"staged_fuzzy",
    "ratio", "rows"}]`` sorted by name.
    """
    counts = Counter(n for n in staged_names if n)
    by_key: dict[str, list[str]] = {}
    for name in sorted(counts):
        key = canonical_law_key(name)
        if key:
            by_key.setdefault(key, []).append(name)
    groups = sorted(
        ((key, _representative(names, counts), names) for key, names in by_key.items()),
        key=lambda g: (-sum(counts[n] for n in g[2]), g[1]),
    )
    index = _KeyIndex()
    merges: list[dict] = []
    for key, rep, names in groups:
        hit = index.lookup(key, rep, threshold) if index.rep else None
        if hit is None:
            index.add(key, rep)
            target, kind, ratio = rep, "key", 1.0
        else:
            target, kind, ratio = hit
        for name in names:
            if not _same_name(name, target):
                merges.append(
                    {
                        "from": name,
                        "to": target,
                        "kind": f"staged_{kind}",
                        "ratio": ratio,
                        "rows": counts[name],
                    }
                )
    return sorted(merges, key=lambda m: m["from"])


def merges_markdown(merges: list[dict]) -> str:
    """Review table of merged law names (names and counts only, no law text)."""
    lines = [
        "# iran_laws_v7 law-name merges",
        "",
        "Staged law names rewritten before dedupe. `v6_*` = mapped onto an existing v6 name,",
        "`staged_*` = two staged spellings of a law v6 does not have. `*_key` = equal canonical",
        "key (character/spelling folds only), `*_fuzzy` = close key with the same years, ordinals",
        "and amendment marker. Check every `fuzzy` row before the build is switched.",
        "",
    ]
    if not merges:
        lines.append("No merges.")
        return "\n".join(lines) + "\n"
    lines += [
        f"Merged names: {len(merges)} ({sum(m['rows'] for m in merges)} rows)",
        "",
        "| from | to | kind | ratio | rows |",
        "|---|---|---|---|---|",
    ]
    for m in sorted(merges, key=lambda m: (m["kind"], m["to"], m["from"])):
        lines.append(f"| {m['from']} | {m['to']} | {m['kind']} | {m['ratio']} | {m['rows']} |")
    return "\n".join(lines) + "\n"
