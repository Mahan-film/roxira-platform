"""Offline tests for scripts/legal/law_names.py (fixture: fixtures/law_names/variants.json)."""

# ruff: noqa: RUF001
import importlib.util
import json
import random
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "law_names", ROOT / "scripts" / "legal" / "law_names.py"
)
ln = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ln)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "law_names" / "variants.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("group", FIXTURE["same_key"], ids=lambda g: g[0][:30])
def test_variant_spellings_share_one_canonical_key(group):
    keys = {ln.canonical_law_key(name) for name in group}
    assert len(keys) == 1, keys


@pytest.mark.parametrize("pair", FIXTURE["distinct"], ids=lambda p: p[1][:30])
def test_distinct_laws_never_merge(pair):
    a, b = pair
    assert ln.canonical_law_key(a) != ln.canonical_law_key(b)
    assert ln.alias_to_base([a], [b]) == []
    assert ln.merge_staged([a, b]) == []


@pytest.mark.parametrize("pair", FIXTURE["distinct"][:4], ids=lambda p: p[1][:30])
def test_years_ordinals_and_amendment_marker_block_even_a_loose_fuzzy_merge(pair):
    a, b = pair
    assert ln.distinguishers(a) != ln.distinguishers(b)
    assert ln.alias_to_base([a], [b], threshold=0.3) == []
    assert ln.merge_staged([a, b], threshold=0.3) == []


def test_normalise_chars_letters_digits_zwnj_diacritics_tatweel():
    raw = "قانونِ  مالياتهاي\u200cمستقيم ١٣٦٦ ۱۳۶۶"
    assert ln.normalise_chars(raw) == "قانون مالیاتهای مستقیم 1366 1366"
    assert ln.normalise_chars("نامهٔ ۀ ك ي ى") == "نامه ه ک ی ی"


def test_amendment_label_survives_masoub_and_is_distinct_from_base():
    key = ln.canonical_law_key("قانون نظام صنفی کشور (اصلاحی 1392) مصوب 1392/06/12")
    assert key == ln.canonical_law_key("قانون نظام صنفی کشور (اصلاحی 1392)")
    assert key.endswith("اصلاحی1392")


def test_alias_to_base_reports_kind_ratio_and_rows():
    v6 = "قانون بیمه اجباری خسارات وارده به شخص ثالث"
    staged = ["قانون بیمه اجباری خسارات وارد شده به شخص ثالث"] * 3 + [
        "قانون بیمه اجباری خسارت وارده به شخص ثالث"
    ]
    merges = ln.alias_to_base(staged, [v6])
    assert [(m["from"], m["to"], m["kind"], m["rows"]) for m in merges] == [
        ("قانون بیمه اجباری خسارات وارد شده به شخص ثالث", v6, "v6_key", 3),
        ("قانون بیمه اجباری خسارت وارده به شخص ثالث", v6, "v6_fuzzy", 1),
    ]
    assert merges[0]["ratio"] == 1.0 and 0.9 <= merges[1]["ratio"] < 1.0


def test_alias_to_base_skips_names_that_already_are_the_v6_name():
    assert ln.alias_to_base(["قانون  تجارت"], ["قانون تجارت"]) == []


def test_merge_staged_folds_new_law_spellings_onto_the_biggest_one():
    big = "قانون حمایت از خانواده"
    names = [big] * 5 + ["قانون حمايت از خانواده"] * 2 + ["قانون حمایت از خانواده (۱۳۹۱)"]
    merges = ln.merge_staged(names)
    assert {m["from"]: m["to"] for m in merges} == {
        "قانون حمايت از خانواده": big,
        "قانون حمایت از خانواده (۱۳۹۱)": big,
    }
    assert all(m["kind"] == "staged_key" for m in merges)


def test_alias_and_merge_are_order_independent():
    base = ["قانون تجارت", "قانون تجارت مصوب 1311", "قانون کار", "قانون مدنی"]
    staged = [
        "قانون تجارت (۱۳۱۱)",
        "قانون كار",
        "قانون مدني",
        "قانون جدید الف",
        "قانون جديد الف",
    ] * 2
    want_alias = ln.alias_to_base(staged, base)
    want_merge = ln.merge_staged(staged)
    rng = random.Random(7)
    for _ in range(20):
        s, b = staged[:], base[:]
        rng.shuffle(s)
        rng.shuffle(b)
        assert ln.alias_to_base(s, b) == want_alias
        assert ln.merge_staged(s) == want_merge
    # two v6 spellings of one key: the representative is fixed (shorter name), not scroll order
    assert {m["to"] for m in want_alias if m["from"] == "قانون تجارت (۱۳۱۱)"} == {"قانون تجارت"}


def test_merges_markdown_lists_names_without_text():
    md = ln.merges_markdown([{"from": "الف", "to": "ب", "kind": "v6_key", "ratio": 1.0, "rows": 2}])
    assert "| الف | ب | v6_key | 1.0 | 2 |" in md
    assert "No merges." in ln.merges_markdown([])


def test_tatweel_is_removed():
    assert ln.normalise_chars("قانـــون") == "قانون"
