"""Unit tests for output_apps/ecosystem_core/src/factory/persian_text.py (W7).

That module lives under output_apps/, outside pytest's `testpaths = ["src"]`
(see pyproject.toml) and outside the repo-root package graph pytest normally
walks, so it is loaded dynamically by path -- same pattern as
src/test_model_registry.py uses for model_registry.py, and for the same
reason: keep a src/test_*.py file's module-level footprint to stdlib only.

Pure function, no network/IO/LLM calls -- safe to run in CI.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

split_persian_sentences = None  # populated by the fixture before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_persian_text():
    global split_persian_sentences
    if split_persian_sentences is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "persian_text.py"
        )
        spec = importlib.util.spec_from_file_location("persian_text", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        split_persian_sentences = module.split_persian_sentences


def test_empty_input_returns_empty_list():
    assert split_persian_sentences("") == []
    assert split_persian_sentences("   \n  ") == []


def test_single_sentence_no_delimiter():
    assert split_persian_sentences("سلام دنیا") == ["سلام دنیا"]


def test_splits_on_period():
    result = split_persian_sentences("جمله اول. جمله دوم.")
    assert result == ["جمله اول.", "جمله دوم."]


def test_splits_on_question_and_exclamation_and_arabic_full_stop():
    result = split_persian_sentences("این چیست؟ چه جالب! پایان یافت۔")
    assert result == ["این چیست؟", "چه جالب!", "پایان یافت۔"]


def test_splits_on_newline():
    result = split_persian_sentences("خط اول\nخط دوم")
    assert result == ["خط اول", "خط دوم"]


def test_does_not_split_persian_decimal_number():
    result = split_persian_sentences("مبلغ خسارت ۱۲.۵ میلیون تومان است.")
    assert result == ["مبلغ خسارت ۱۲.۵ میلیون تومان است."]


def test_does_not_split_ascii_decimal_number():
    result = split_persian_sentences("نرخ سود 12.5 درصد اعلام شد.")
    assert result == ["نرخ سود 12.5 درصد اعلام شد."]


def test_does_not_split_known_abbreviation():
    result = split_persian_sentences("مطابق ماده ۱۰ ق.م تعهدات طرفین الزامی است.")
    assert result == ["مطابق ماده ۱۰ ق.م تعهدات طرفین الزامی است."]


def test_abbreviation_followed_by_real_sentence_boundary():
    result = split_persian_sentences("طبق ه.ش سال ۱۴۰۵ اعلام شد. این جمله دوم است.")
    assert result == ["طبق ه.ش سال ۱۴۰۵ اعلام شد.", "این جمله دوم است."]


def test_multiple_consecutive_delimiters_collapse_to_one_boundary():
    result = split_persian_sentences("واقعا؟! عجب چیزی بود.")
    assert result == ["واقعا؟!", "عجب چیزی بود."]


def test_trailing_incomplete_sentence_is_kept():
    result = split_persian_sentences("جمله کامل. جمله ناقص بدون نقطه")
    assert result == ["جمله کامل.", "جمله ناقص بدون نقطه"]


def test_whitespace_around_sentences_is_trimmed():
    result = split_persian_sentences("  جمله اول.   جمله دوم.  ")
    assert result == ["جمله اول.", "جمله دوم."]
