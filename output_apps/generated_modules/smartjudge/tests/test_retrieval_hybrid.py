"""Offline tests for hybrid legal retrieval (normalisation, RRF, cutoff, keyword boosts)."""
import asyncio

from output_apps.generated_modules.smartjudge import source_filter
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
from output_apps.generated_modules.smartjudge.legal_graph import retrieval_boost as rb

Q = "مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی چقدر است؟"
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


def test_normalize_unifies_arabic_persian_digits_and_zwnj():
    assert rb.normalize_text("ماده ۳۳۶ كتاب ي") == "ماده 336 کتاب ی"
    assert rb.normalize_text("رأی") == rb.normalize_text("رای")
    assert rb.normalize_text("تجدید نظر") == rb.normalize_text("تجدید‌نظر")


def test_tokens_drop_stopwords_and_overlap_handles_compound():
    assert "است" not in rb.tokens(Q) and "از" not in rb.tokens(Q)
    # "تجدیدنظرخواهی" in the question vs "تجدیدنظر" in the article
    assert rb.lexical_overlap(Q, ART_336["text"]) >= 2


def test_rrf_merge_prefers_items_ranked_high_in_several_lists():
    order = rb.rrf_merge([(1.0, ["a", "b", "c"]), (1.0, ["c", "a"])])
    assert order[0] == "a" and set(order) == {"a", "b", "c"}
    assert rb.rrf_merge([(1.0, ["x"]), (3.0, ["y"])])[0] == "y"


def test_cutoff_keeps_strong_vector_hit_and_trusted_levels():
    assert rb.is_relevant({"score": 1, "vector_score": 0.7}, 2)
    assert not rb.is_relevant({"score": 1, "vector_score": 0.2}, 2)
    assert rb.is_relevant({"score": 0, "match_level": "KEYWORD_BOOST"}, 2)
    assert rb.is_relevant({"score": 0, "match_level": "QDRANT_EXACT"}, 2)
    assert rb.is_relevant({"title": "sql row, no score"}, 2)
    assert not rb.is_relevant({"score": 1}, 2)


def test_source_filter_uses_vector_score_but_still_drops_doctrine_and_weak():
    rows = [
        {"title": "a", "score": 1, "vector_score": 0.7},
        {"title": "b", "score": 1, "vector_score": 0.1},
        {"title": "c", "score": 0, "match_level": "KEYWORD_BOOST"},
        {"title": "d", "match_level": "HIGH_DOCTRINE"},
    ]
    assert [r["title"] for r in source_filter.filter_relevant(rows, 2)] == ["a", "c"]


def test_keyword_rules_fire_on_common_topics():
    names = lambda q: {r.name for r in rb.keyword_targets(q)}  # noqa: E731
    assert "appeal" in names(Q)
    assert "appeal" in names("مهلت تجدید نظر چند روز است")
    assert "default-judgment-objection" in names("مهلت واخواهی چقدر است")
    assert "cheque" in names("چک برگشت خورد")
    assert "lease" in names("تخلیه مستأجر")
    assert "custody" in names("حضانت فرزند")
    assert "inheritance" in names("سهم الارث دختر")
    assert "fraud" in names("مجازات کلاهبرداری")
    assert names("سلام حالتان چطور است") == set()
    appeal = next(r for r in rb.keyword_targets(Q) if r.name == "appeal")
    assert 336 in appeal.articles


def test_rank_payloads_fuses_vector_and_lexical_and_carries_vector_score():
    weak = {**ART_12, "_vector_score": 0.62}
    strong = {**ART_336, "_vector_score": 0.61}
    rows = eng._rank_payloads([weak, strong], Q, 2)
    by_no = {r["article_no"]: r for r in rows}
    assert set(by_no) == {"12", "336"}
    assert by_no["336"]["score"] >= 2 and by_no["12"]["score"] == 0
    assert by_no["336"]["vector_score"] == 0.61


def test_collection_embedder_pairing_substitutes_mismatched_collection(monkeypatch):
    monkeypatch.delenv("LIGHTRAG_QDRANT_ALLOW_EMBED_MISMATCH", raising=False)
    assert eng._resolve_collection("iran_laws_mistral_v1", "BAAI/bge-m3") == "iran_laws_v2"
    assert eng._resolve_collection("", "BAAI/bge-m3") == "iran_laws_v2"
    assert eng._resolve_collection("iran_laws_bge_m3", "BAAI/bge-m3") == "iran_laws_bge_m3"
    monkeypatch.setenv("LIGHTRAG_QDRANT_ALLOW_EMBED_MISMATCH", "1")
    assert eng._resolve_collection("iran_laws_mistral_v1", "BAAI/bge-m3") == "iran_laws_mistral_v1"


def test_keyword_boost_and_merge_surface_article_336_when_vector_misses(monkeypatch):
    other = {**ART_12, "_vector_score": 0.58}

    async def fake_scroll(point_filter, limit):
        return [dict(ART_336), dict(ART_12)]

    async def fake_vec(text, desired, active_only):
        return eng._rank_payloads([other], text, desired)

    async def fake_exact(*a, **k):
        return None

    monkeypatch.setattr(eng, "_scroll_by_point_filter", fake_scroll)
    monkeypatch.setattr(eng, "_qdrant_vector_or_scroll_laws", fake_vec)
    monkeypatch.setattr(eng, "exact_article_lookup", fake_exact)
    monkeypatch.setattr(eng, "_qdrant_probe_suppressed", lambda: False)
    rows = asyncio.run(eng.qdrant_fallback_laws(Q, limit=5))
    keys = [(r["law_name"], r["article_no"]) for r in rows]
    assert ("قانون آیین دادرسی مدنی", "336") in keys
    boosted = next(r for r in rows if r["article_no"] == "336")
    assert boosted["match_level"] == "KEYWORD_BOOST"
    assert source_filter.filter_relevant(rows)[0]["article_no"] in {"336", "12"}
    assert any(r["article_no"] == "336" for r in source_filter.filter_relevant(rows))


def test_eval_retrieval_hit_matches_law_and_article():
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[4] / "scripts" / "eval_chat_golden.py"
    spec = importlib.util.spec_from_file_location("eval_chat_golden_t", path)
    mod = importlib.util.module_from_spec(spec)
    import sys

    sys.modules["eval_chat_golden_t"] = mod
    spec.loader.exec_module(mod)
    case = {"law_any": ["آیین دادرسی مدنی"], "articles": [336]}
    assert mod.retrieval_hit(case, [{"law_name": "قانون آیین دادرسی مدنی", "article_no": "336"}])
    assert not mod.retrieval_hit(case, [{"law_name": "قانون شوراهای حل اختلاف", "article_no": "336"}])
    assert not mod.retrieval_hit(case, [{"law_name": "قانون آیین دادرسی مدنی", "article_no": "337"}])


def test_boost_priority_article_wins_over_higher_overlap_neighbour(monkeypatch):
    noisy = {**ART_336, "article_no": "339", "text": "ماده 339: مهلت تجدیدنظر رای دادگاه حقوقی مقیم خارج"}
    plain = {**ART_336, "text": "ماده 336: بیست روز"}

    async def fake_scroll(point_filter, limit):
        return [dict(noisy), dict(plain)]

    monkeypatch.setattr(eng, "_scroll_by_point_filter", fake_scroll)
    rows = asyncio.run(eng.keyword_boost_laws(Q))
    assert rows[0]["article_no"] == "336"
    assert all(r["match_level"] == "KEYWORD_BOOST" for r in rows)
