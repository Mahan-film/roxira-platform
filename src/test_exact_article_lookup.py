"""Offline tests for the W25-1 exact-article pre-step.

Covers ``exact_article_lookup`` / ``recognize_law_name`` / ``_parse_article_query``
in ``output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py``.
The live check (2026-09-30) showed «ماده ۱۰ قانون مدنی» returning article 1010
because vector similarity is not exact; the pre-step must resolve the article by
a payload filter (``law_name`` + ``article_no`` + ``is_active``) before any
vector search, and fall back untouched when nothing matches.

No network, no Qdrant, no Postgres, no LLM keys — the Qdrant boundary
(``_scroll_by_point_filter``) is replaced by a fake client that records the
filter it received.
"""
from __future__ import annotations

import asyncio

import pytest

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as le


KNOWN_LAWS = [
    "قانون مدنی",
    "قانون مجازات اسلامی",
    "قانون آیین دادرسی کیفری",
    "قانون آیین دادرسی مدنی",
    "قانون تجارت",
    "لایحه اصلاحی قانون تجارت",
    "قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲",
    "قانون صدور چک (اصلاحی ۱۳۹۷)",
]


@pytest.fixture(autouse=True)
def _offline_law_names(monkeypatch):
    monkeypatch.setattr(le, "_known_law_names", lambda: list(KNOWN_LAWS))


# ── نمونه‌های فیک payload (شکل ``iran_laws_v2``) ──────────────────────────────
CIVIL_10 = {
    "law_name": "قانون مدنی",
    "law_type": "CIVIL",
    "article_no": "10",
    "article_label": "ماده 10",
    "is_active": True,
    "category": "CIVIL",
    "title": "قانون مدنی - ماده 10",
    "text": "ماده 10 قانون مدنی: ماده 10 ـ رسیدگی نخستین ...",
}
CIVIL_1010 = {
    "law_name": "قانون مدنی",
    "law_type": "CIVIL",
    "article_no": "1010",
    "article_label": "ماده 1010",
    "is_active": True,
    "category": "CIVIL",
    "title": "قانون مدنی - ماده 1010",
    "text": "ماده 1010 قانون مدنی: ماده 1010 ـ مرکز اصلی شرکت ...",
}
CRIMINAL_10 = {
    "law_name": "قانون مجازات اسلامی",
    "article_no": "10",
    "article_label": "ماده 10",
    "is_active": True,
    "category": "CRIMINAL",
    "title": "قانون مجازات اسلامی - ماده 10",
    "text": "ماده 10 قانون مجازات اسلامی: ماده 10 ...",
}
COMMERCIAL_10 = {
    "law_name": "قانون تجارت",
    "article_no": "10",
    "article_label": "ماده 10",
    "is_active": True,
    "category": "COMMERCIAL",
    "title": "قانون تجارت - ماده 10",
    "text": "ماده 10 قانون تجارت: ماده 10 ...",
}
REPEALED_CIVIL_10 = dict(CIVIL_10, is_active=False)


class FakeQdrant:
    """کلاینت جعلی: فیلتر دریافت‌شده را ثبت و payloadهای از پیش‌تعیین‌شده را برمی‌گرداند."""

    def __init__(self, payloads):
        self.payloads = payloads
        self.calls = []

    async def scroll(self, point_filter, limit):
        self.calls.append({"filter": point_filter, "limit": limit})
        return list(self.payloads)


def _install_fake(monkeypatch, payloads):
    fake = FakeQdrant(payloads)

    async def _fake_scroll(point_filter, limit):
        return await fake.scroll(point_filter, limit)

    monkeypatch.setattr(le, "_scroll_by_point_filter", _fake_scroll)
    return fake


def _find_condition(point_filter, key):
    for condition in point_filter.get("must", []):
        if condition.get("key") == key:
            return condition
    return None


class TestParseArticleQuery:
    def test_single_article_and_law(self) -> None:
        parsed = le._parse_article_query("ماده ۱۰ قانون مدنی")
        assert parsed is not None
        assert parsed["article_nos"] == ["10"]
        assert parsed["law_name"] == "قانون مدنی"

    def test_ascii_digits(self) -> None:
        parsed = le._parse_article_query("ماده 208 قانون تجارت")
        assert parsed is not None
        assert parsed["article_nos"] == ["208"]
        assert parsed["law_name"] == "قانون تجارت"

    def test_plural_articles(self) -> None:
        parsed = le._parse_article_query("مواد ۱۰ و ۱۲ قانون مدنی")
        assert parsed is not None
        assert parsed["article_nos"] == ["10", "12"]
        assert parsed["law_name"] == "قانون مدنی"

    def test_no_article_pattern_returns_none(self) -> None:
        assert le._parse_article_query("مهلت تجدیدنظرخواهی چند روز است؟") is None


class TestRecognizeLawName:
    def test_full_name(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون مدنی") == "قانون مدنی"

    def test_civil_code_alias(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ ق.م") == "قانون مدنی"
        assert le.recognize_law_name("ماده ۱۰ مدنی") is None

    def test_civil_procedure_alias(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ ق.آ.د.م") == "قانون آیین دادرسی مدنی"
        assert le.recognize_law_name("ماده ۱۰ آیین دادرسی مدنی") == "قانون آیین دادرسی مدنی"

    def test_longest_match_wins_for_medani(self) -> None:
        # «مدنی» alone maps to Civil Code, but the full Civil Procedure name
        # must win when it is the one actually typed.
        assert (
            le.recognize_law_name("ماده ۱۰ قانون آیین دادرسی مدنی")
            == "قانون آیین دادرسی مدنی"
        )

    def test_criminal_alias(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ مجازات اسلامی") == "قانون مجازات اسلامی"

    def test_cheque_alias(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون صدور چک") == "قانون صدور چک (اصلاحی ۱۳۹۷)"
        assert le.recognize_law_name("ماده ۱۰ چک") is None

    def test_unknown_law_returns_none(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون ناشناخته") is None


class TestExactArticlePointFilter:
    def test_law_and_article_and_active(self) -> None:
        point_filter = le._exact_article_point_filter("قانون مدنی", "10")
        assert _find_condition(point_filter, "law_name") == {
            "key": "law_name",
            "match": {"value": "قانون مدنی"},
        }
        assert _find_condition(point_filter, "article_no") == {
            "key": "article_no",
            "match": {"any": ["10"]},
        }
        # is_active guard is carried over from active_point_filter.
        assert "must" in point_filter and len(point_filter["must"]) == 3

    def test_mokarrar_adds_variant(self) -> None:
        point_filter = le._exact_article_point_filter("قانون مدنی", "3", mokarrar=True)
        assert _find_condition(point_filter, "article_no")["match"]["any"] == [
            "3",
            "3-mokarrar",
        ]

    def test_no_law_omits_law_condition(self) -> None:
        point_filter = le._exact_article_point_filter(None, "10")
        assert _find_condition(point_filter, "law_name") is None


class TestExactArticleLookup:
    def test_law_named_returns_exact_article(self, monkeypatch) -> None:
        # A fake client that would only ever return article 10 for that filter;
        # the deterministic fix means 1010 is never a candidate.
        fake = _install_fake(monkeypatch, [CIVIL_10])
        rows = asyncio.run(le.exact_article_lookup("ماده ۱۰ قانون مدنی", limit=3))
        assert rows is not None
        assert rows[0]["article_no"] == "10"
        assert rows[0]["law_name"] == "قانون مدنی"
        assert rows[0]["match_level"] == "QDRANT_EXACT"
        law_condition = _find_condition(fake.calls[0]["filter"], "law_name")
        assert law_condition["match"]["value"] == "قانون مدنی"
        article_condition = _find_condition(fake.calls[0]["filter"], "article_no")
        assert article_condition["match"]["any"] == ["10"]

    def test_no_law_returns_up_to_three_different_laws(self, monkeypatch) -> None:
        _install_fake(
            monkeypatch, [CIVIL_10, CRIMINAL_10, COMMERCIAL_10, dict(CIVIL_10, article_no="10")]
        )
        rows = asyncio.run(le.exact_article_lookup("ماده ۱۰", limit=5))
        assert rows is not None
        assert len(rows) == 3
        assert {r["law_name"] for r in rows} == {
            "قانون مدنی",
            "قانون مجازات اسلامی",
            "قانون تجارت",
        }

    def test_repealed_article_is_dropped(self, monkeypatch) -> None:
        _install_fake(monkeypatch, [REPEALED_CIVIL_10])
        assert asyncio.run(le.exact_article_lookup("ماده ۱۰ قانون مدنی")) is None

    def test_returns_none_when_nothing_matches(self, monkeypatch) -> None:
        _install_fake(monkeypatch, [])
        assert asyncio.run(le.exact_article_lookup("ماده ۱۰ قانون مدنی")) is None

    def test_returns_none_without_article_pattern(self, monkeypatch) -> None:
        _install_fake(monkeypatch, [CIVIL_10])
        assert asyncio.run(le.exact_article_lookup("قانون مدنی چیست؟")) is None


class TestQdrantFallbackUsesExactPreStep:
    def test_exact_hit_comes_first_then_vector_fill(self, monkeypatch) -> None:
        monkeypatch.setattr(le, "_qdrant_probe_suppressed", lambda: False)

        async def _exact(*_args, **_kwargs):
            return [le._payload_to_row(CIVIL_10, match_level="QDRANT_EXACT")]

        async def _fail_if_called(*_args, **_kwargs):
            return [CIVIL_1010]

        monkeypatch.setattr(le, "exact_article_lookup", _exact)
        monkeypatch.setattr(le, "_try_vector_search", _fail_if_called)

        rows = asyncio.run(le.qdrant_fallback_laws("ماده ۱۰ قانون مدنی", limit=5))
        assert [r["article_no"] for r in rows] == ["10", "1010"]

    def test_miss_falls_back_to_vector_search(self, monkeypatch) -> None:
        monkeypatch.setattr(le, "_qdrant_probe_suppressed", lambda: False)

        async def _exact_none(*_args, **_kwargs):
            return None

        async def _vector(*_args, **_kwargs):
            return [CIVIL_1010]

        monkeypatch.setattr(le, "exact_article_lookup", _exact_none)
        monkeypatch.setattr(le, "_try_vector_search", _vector)

        rows = asyncio.run(le.qdrant_fallback_laws("ماده ۱۰ قانون مدنی", limit=5))
        assert rows and rows[0]["article_no"] == "1010"


TRADE_BILL_5 = {
    "law_name": "لایحه اصلاحی قانون تجارت",
    "article_no": "5",
    "article_label": "ماده 5",
    "is_active": True,
    "title": "لایحه اصلاحی قانون تجارت - ماده 5",
    "text": "ماده 5 ...",
}
COMMERCIAL_5 = dict(COMMERCIAL_10, article_no="5", title="قانون تجارت - ماده 5")


class TestAliasFragments:
    def test_tort_law_not_civil_code(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون مسئولیت مدنی") is None

    def test_ecommerce_law_not_trade_code(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون تجارت الکترونیکی") is None

    def test_execution_law_unrecognised(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون اجرای احکام مدنی") is None

    def test_abbreviation_only_as_whole_token(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ ق.م") == "قانون مدنی"
        assert le.recognize_law_name("ماده ۱۰ ق.مخصوص") is None
        assert le.recognize_law_name("ماده ۱۰ اق.م") is None

    def test_trailing_question_word_still_matches(self) -> None:
        assert le.recognize_law_name("ماده ۱۰ قانون مدنی چیست؟") == "قانون مدنی"


class TestUnrecognisedLawFallsThrough:
    def test_named_but_unknown_law_returns_none(self, monkeypatch) -> None:
        fake = _install_fake(monkeypatch, [CIVIL_10, CRIMINAL_10])
        for q in (
            "ماده ۱۰ قانون مسئولیت مدنی",
            "ماده ۱۰ قانون تجارت الکترونیکی",
            "ماده ۱۰ قانون اجرای احکام مدنی",
            "ماده ۱۰ لایحه ناشناخته",
        ):
            assert asyncio.run(le.exact_article_lookup(q)) is None
        assert fake.calls == []

    def test_no_law_mentioned_uses_article_only(self, monkeypatch) -> None:
        _install_fake(monkeypatch, [CIVIL_10])
        assert asyncio.run(le.exact_article_lookup("ماده ۱۰")) is not None


class TestMergeWithVectorPath:
    def _setup(self, monkeypatch, exact, vector):
        monkeypatch.setattr(le, "_qdrant_probe_suppressed", lambda: False)

        async def _exact(*_a, **_k):
            return exact

        async def _vec(*_a, **_k):
            return vector

        monkeypatch.setattr(le, "exact_article_lookup", _exact)
        monkeypatch.setattr(le, "_try_vector_search", _vec)

    def test_exact_first_then_vector_deduped(self, monkeypatch) -> None:
        exact = [le._payload_to_row(CIVIL_10, match_level="QDRANT_EXACT")]
        self._setup(monkeypatch, exact, [CIVIL_1010, CIVIL_10, CRIMINAL_10])
        rows = asyncio.run(le.qdrant_fallback_laws("ماده ۱۰ قانون مدنی", limit=3))
        keys = [(r["law_name"], r["article_no"]) for r in rows]
        assert keys == [
            ("قانون مدنی", "10"),
            ("قانون مدنی", "1010"),
            ("قانون مجازات اسلامی", "10"),
        ]
        assert rows[0]["match_level"] == "QDRANT_EXACT"

    def test_limit_respected(self, monkeypatch) -> None:
        exact = [le._payload_to_row(CIVIL_10, match_level="QDRANT_EXACT")]
        self._setup(monkeypatch, exact, [CIVIL_1010, CRIMINAL_10])
        rows = asyncio.run(le.qdrant_fallback_laws("ماده ۱۰ قانون مدنی", limit=2))
        assert len(rows) == 2 and rows[0]["article_no"] == "10"

    def test_no_exact_rows_unchanged(self, monkeypatch) -> None:
        self._setup(monkeypatch, None, [CIVIL_1010])
        rows = asyncio.run(le.qdrant_fallback_laws("ماده ۱۰ قانون مدنی", limit=5))
        assert [r["article_no"] for r in rows] == ["1010"]


class TestIsBill:
    def test_flag(self) -> None:
        for enacted_name in (
            "لایحه اصلاحی قانون تجارت",
            "لایحه قانونی اصلاح قسمتی از قانون تجارت",
            "لایحه قانونی استقلال کانون وکلای دادگستری",
        ):
            assert le._payload_to_row(
                {**TRADE_BILL_5, "law_name": enacted_name}
            )["is_bill"] is False
        assert le._payload_to_row(COMMERCIAL_5)["is_bill"] is False
        assert le._payload_to_row(
            {**TRADE_BILL_5, "law_name": "لایحه آزمایشی"}
        )["is_bill"] is True

    def test_trade_code_not_bill(self) -> None:
        assert le.recognize_law_name("ماده ۵ قانون تجارت") == "قانون تجارت"

    def test_explicit_bill(self) -> None:
        assert (
            le.recognize_law_name("ماده ۵ لایحه اصلاحی قانون تجارت")
            == "لایحه اصلاحی قانون تجارت"
        )

    def test_lookup_uses_trade_code_filter(self, monkeypatch) -> None:
        fake = _install_fake(monkeypatch, [COMMERCIAL_5])
        rows = asyncio.run(le.exact_article_lookup("ماده ۵ قانون تجارت"))
        assert rows[0]["law_name"] == "قانون تجارت" and rows[0]["is_bill"] is False
        assert _find_condition(fake.calls[0]["filter"], "law_name")["match"]["value"] == "قانون تجارت"


class TestPluralArticles:
    def test_all_numbers_capped_at_five(self) -> None:
        parsed = le._parse_article_query("مواد ۱ و ۲ و ۳ و ۴ و ۵ و ۶ قانون مدنی")
        assert parsed["article_nos"] == ["1", "2", "3", "4", "5"]

    def test_year_after_mosavab_ignored(self) -> None:
        parsed = le._parse_article_query("مواد ۱۰ و ۱۲ قانون مصوب ۱۳۹۲")
        assert parsed["article_nos"] == ["10", "12"]

    def test_four_digit_article_kept_without_mosavab(self) -> None:
        parsed = le._parse_article_query("مواد ۱۰ و ۱۰۱۰ قانون مدنی")
        assert parsed["article_nos"] == ["10", "1010"]

    def test_lookup_returns_every_article(self, monkeypatch) -> None:
        c12 = dict(CIVIL_10, article_no="12", title="قانون مدنی - ماده 12")
        fake = _install_fake(monkeypatch, [c12, CIVIL_10])
        rows = asyncio.run(le.exact_article_lookup("مواد ۱۰ و ۱۲ قانون مدنی", limit=1))
        assert [r["article_no"] for r in rows] == ["10", "12"]
        cond = _find_condition(fake.calls[0]["filter"], "article_no")
        assert cond["match"]["any"] == ["10", "12"]
