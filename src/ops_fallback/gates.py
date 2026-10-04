"""Deterministic answer-quality gates. Each factory returns a gate
``text -> (ok, reasons)``; reasons are short codes and never echo the answer."""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable

Gate = Callable[[str], tuple[bool, list[str]]]

# Same pattern as smartjudge chat_safety._ARTICLE_RE (kept local: stdlib only).
_ARTICLE_RE = re.compile(r"ماده(?:\s*ی|\s*ٔ)?\s*(\d+)(\s*مکرر)?")
_NON_LATIN_DIGITS = re.compile(
    "[" + chr(0x6F0) + "-" + chr(0x6F9) + chr(0x660) + "-" + chr(0x669) + "]"
)
_DIGIT_MAP = {base + i: 0x30 + i for base in (0x06F0, 0x0660) for i in range(10)}
_PERSIAN = re.compile("[" + chr(0x600) + "-" + chr(0x6FF) + "]")
_LETTER = re.compile("[A-Za-z" + chr(0x600) + "-" + chr(0x6FF) + "]")


def _res(reasons: list[str]) -> tuple[bool, list[str]]:
    return (not reasons, reasons)


def non_empty_min_length(min_len: int = 20) -> Gate:
    def gate(text: str) -> tuple[bool, list[str]]:
        n = len((text or "").strip())
        return _res([] if n >= min_len else ["too_short"])

    return gate


def valid_json_with_keys(keys: Iterable[str]) -> Gate:
    need = list(keys)

    def gate(text: str) -> tuple[bool, list[str]]:
        try:
            data = json.loads(text or "")
        except (ValueError, TypeError):
            return False, ["invalid_json"]
        if not isinstance(data, dict):
            return False, ["json_not_object"]
        return _res([f"missing_key:{k}" for k in need if k not in data])

    return gate


def persian_text_ratio(min_ratio: float = 0.6) -> Gate:
    def gate(text: str) -> tuple[bool, list[str]]:
        letters = _LETTER.findall(text or "")
        if not letters:
            return False, ["no_letters"]
        ratio = len(_PERSIAN.findall(text)) / len(letters)
        return _res([] if ratio >= min_ratio else ["low_persian_ratio"])

    return gate


def no_unverified_article_numbers(allowed: Iterable[int | str]) -> Gate:
    ok_set = {str(int(str(a).translate(_DIGIT_MAP))) for a in allowed}

    def gate(text: str) -> tuple[bool, list[str]]:
        src = (text or "").translate(_DIGIT_MAP)
        bad = [m for m in _ARTICLE_RE.findall(src) if str(int(m[0])) not in ok_set]
        return _res(["unverified_article_number"] if bad else [])

    return gate


def banner_present(banner: str) -> Gate:
    def gate(text: str) -> tuple[bool, list[str]]:
        return _res([] if banner and banner in (text or "") else ["banner_missing"])

    return gate


def latin_digits_only() -> Gate:
    def gate(text: str) -> tuple[bool, list[str]]:
        return _res(["non_latin_digits"] if _NON_LATIN_DIGITS.search(text or "") else [])

    return gate


def all_of(*gates: Gate) -> Gate:
    def gate(text: str) -> tuple[bool, list[str]]:
        reasons: list[str] = []
        for g in gates:
            reasons.extend(g(text)[1])
        return _res(reasons)

    return gate
