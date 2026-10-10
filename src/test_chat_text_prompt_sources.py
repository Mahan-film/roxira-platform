"""Offline tests: text-chat prompt vs voice prompt, FALLBACK stripping, score cutoff, source cap. No network/LLM."""

import json
from pathlib import Path

from output_apps.generated_modules.smartjudge import prompt_library as pl
from output_apps.generated_modules.smartjudge import source_filter as sf

ROOT = Path(__file__).resolve().parent.parent


def _law(no, law="قانون صدور چک", score=None, level="QDRANT_FALLBACK"):
    row = {"title": f"{law} - ماده {no}", "article_no": str(no), "law_name": law,
           "match_level": level, "summary": "x"}
    if score is not None:
        row["score"] = score
    return row


def test_fallback_stripped_regardless_of_flag(monkeypatch):
    rows = [{"title": "ماده ۱۰۸۲ قانون مدنی", "match_level": "FALLBACK"}, _law(7, score=5)]
    for flag in ("0", "1"):
        monkeypatch.setenv(pl.ENV_FLAG, flag)
        out = sf.filter_relevant(rows)
        assert [r["article_no"] for r in out] == ["7"]


def test_score_cutoff_and_env(monkeypatch):
    monkeypatch.delenv(sf.ENV_MIN_SCORE, raising=False)
    rows = [_law(1, score=1), _law(2, score=2), _law(3), _law(4, level="HIGH_DOCTRINE")]
    assert [r["article_no"] for r in sf.filter_relevant(rows)] == ["2", "3"]
    monkeypatch.setenv(sf.ENV_MIN_SCORE, "4")
    assert [r["article_no"] for r in sf.filter_relevant(rows)] == ["3"]
    monkeypatch.setenv(sf.ENV_MIN_SCORE, "junk")
    assert sf.min_source_score() == sf.DEFAULT_MIN_SCORE


def test_cap_and_uncited_top3():
    laws = [_law(n) for n in range(1, 10)]
    shown, prec = sf.select_displayed("پاسخ بدون ارجاع", laws, [])
    assert len(shown) == 3 and prec == []
    shown, _ = sf.select_displayed("ماده 4 قانون صدور چک و ماده 5 قانون صدور چک و ماده 6 قانون صدور چک "
                                   "و ماده 7 قانون صدور چک و ماده 8 قانون صدور چک و ماده 9 قانون صدور چک", laws, [])
    assert len(shown) == sf.MAX_DISPLAYED_SOURCES


def test_cited_only_requires_article_and_law_name():
    laws = [_law(2), _law(3), _law(2, law="قانون مدنی")]
    shown, _ = sf.select_displayed("طبق ماده ۲ قانون صدور چک", laws, [])
    assert [(r["article_no"], r["law_name"]) for r in shown] == [("2", "قانون صدور چک")]


def test_text_prompt_differs_from_voice_and_has_grounding_rules(monkeypatch):
    monkeypatch.delenv(pl.ENV_FLAG, raising=False)
    assert pl.prompt_library_enabled() is True
    monkeypatch.setenv(pl.ENV_FLAG, "0")
    assert pl.prompt_library_enabled() is False
    text = pl.build_system_prompt([], True, "مهلت تجدیدنظر چقدر است")
    basic = pl.build_text_prompt_basic(True)
    for prompt in (text, basic):
        assert prompt != pl.VOICE_SYSTEM_PROMPT
        assert "۲۵ کلمه" not in prompt
        for needle in ("خلاصه پاسخ", "مبنای قانونی", "نکات عملی", "هشدار مشورتی",
                       "یافت نشد", "هرگز شمارهٔ ماده", "آخرین اصلاحیه"):
            assert needle in prompt
    assert "۲۵ کلمه" in pl.VOICE_SYSTEM_PROMPT


def test_golden_set_valid():
    data = json.loads((ROOT / "data/eval/chat_golden/golden_set.json").read_text(encoding="utf-8"))
    assert len(data["cases"]) >= 10
    assert all(m.get("verify") == "TO-VERIFY"
               for c in data["cases"] for m in c["must_mention"] + c["must_not_mention"])
