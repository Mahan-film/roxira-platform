"""Offline tests for the opt-in answer-quality retrieval flags (default OFF).

* ``SMARTJUDGE_MUSTCITE_BOOST``: the article/law named in the question ranks first.
* ``SMARTJUDGE_QUERY_REWRITE``: canonical Persian legal-term variants extend the search text.

No network, no Qdrant, no LLM: flags are read from the environment per call and the
retrieval branches are stubbed.
"""
import asyncio

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
from output_apps.generated_modules.smartjudge.legal_graph import retrieval_boost as rb

Q = "مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی چقدر است؟"
NAMED = "ماده 336 قانون آیین دادرسی مدنی"
ART_336 = {
    "law_name": "قانون آیین دادرسی مدنی",
    "article_no": "336",
    "title": "قانون آیین دادرسی مدنی - ماده 336",
    "text": "ماده 336: مهلت درخواست تجدیدنظر اصحاب دعوا برای اشخاص مقیم ایران بیست روز است.",
    "is_active": True,
}
ART_12 = {
    "law_name": "قانون شوراهای حل اختلاف",
    "article_no": "12",
    "title": "قانون شوراهای حل اختلاف - ماده 12",
    "text": "ماده 12: شورا موظف است به دعوا رسیدگی کند.",
    "is_active": True,
}


# ---- flags -----------------------------------------------------------------
def test_flags_default_off(monkeypatch):
    monkeypatch.delenv(rb.MUSTCITE_BOOST_ENV, raising=False)
    monkeypatch.delenv(rb.QUERY_REWRITE_ENV, raising=False)
    assert not rb.mustcite_boost_enabled()
    assert not rb.query_rewrite_enabled()
    assert not rb._flag_on("SMARTJUDGE_NOPE")


def test_flags_on_when_set(monkeypatch):
    monkeypatch.setenv(rb.MUSTCITE_BOOST_ENV, "1")
    monkeypatch.setenv(rb.QUERY_REWRITE_ENV, "true")
    assert rb.mustcite_boost_enabled() and rb.query_rewrite_enabled()


# ---- query rewrite ---------------------------------------------------------
def test_rewrite_query_appends_canonical_terms_and_preserves_the_original():
    out = rb.rewrite_query("مهلت تجدیدنظرخواهی چقدر است؟")
    assert out.startswith("مهلت تجدیدنظرخواهی چقدر است؟")
    assert rb.tokens("تجدیدنظر") <= rb.tokens(out)
    # already canonical / no trigger: byte-for-byte unchanged
    assert rb.rewrite_query("سلام خوبی؟") == "سلام خوبی؟"
    assert rb.rewrite_query("") == ""
    assert rb.rewrite_query(None) == ""


def test_rewrite_query_handles_zwnj_and_does_not_duplicate_terms():
    out = rb.rewrite_query("چک برگشتی را کجا شکایت کنم")
    assert rb.tokens("صدور چک") <= rb.tokens(out)
    assert out.count("صدور چک") == 1


# ---- must-cite boost -------------------------------------------------------
def test_mustcite_boost_off_keeps_the_vector_favourite(monkeypatch):
    weak_named = {**ART_336, "_vector_score": 0.40}
    strong_other = {**ART_12, "_vector_score": 0.90}
    monkeypatch.delenv(rb.MUSTCITE_BOOST_ENV, raising=False)
    rows = eng._rank_payloads([strong_other, weak_named], NAMED, 2)
    assert rows[0]["article_no"] == "12"


def test_mustcite_boost_on_puts_the_named_article_first(monkeypatch):
    weak_named = {**ART_336, "_vector_score": 0.40}
    strong_other = {**ART_12, "_vector_score": 0.90}
    monkeypatch.setenv(rb.MUSTCITE_BOOST_ENV, "1")
    rows = eng._rank_payloads([strong_other, weak_named], NAMED, 2)
    assert rows[0]["article_no"] == "336"


def test_mustcite_keys_only_for_named_targets():
    scored = [(0, 0, ART_336, ART_336["text"]), (0, -1, ART_12, ART_12["text"])]
    assert eng._mustcite_keys(NAMED, scored) == [id(ART_336)]
    assert eng._mustcite_keys(Q, scored) == []  # no article/law named


# ---- wiring ----------------------------------------------------------------
def test_query_rewrite_only_changes_the_vector_branch(monkeypatch):
    seen = {}

    async def fake_vec(text, desired, active_only):
        seen["vec"] = text
        return []

    async def fake_exact(q, limit=3, active_only=None):
        seen["exact"] = q
        return None

    async def fake_boost(text, active_only=None):
        return []

    monkeypatch.setattr(eng, "_qdrant_vector_or_scroll_laws", fake_vec)
    monkeypatch.setattr(eng, "exact_article_lookup", fake_exact)
    monkeypatch.setattr(eng, "keyword_boost_laws", fake_boost)
    monkeypatch.setattr(eng, "_qdrant_probe_suppressed", lambda: False)
    monkeypatch.delenv(rb.QUERY_REWRITE_ENV, raising=False)
    asyncio.run(eng._qdrant_fallback_laws_impl("مهلت تجدیدنظرخواهی", 5))
    assert seen["vec"] == "مهلت تجدیدنظرخواهی"
    monkeypatch.setenv(rb.QUERY_REWRITE_ENV, "1")
    asyncio.run(eng._qdrant_fallback_laws_impl("مهلت تجدیدنظرخواهی", 5))
    assert "تجدیدنظر" in seen["vec"] and len(seen["vec"]) > len("مهلت تجدیدنظرخواهی")
    assert seen["exact"] == "مهلت تجدیدنظرخواهی"  # exact lookup always sees the original