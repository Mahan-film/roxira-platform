from src.automation.local_reranker import LocalReranker


def test_reranks_limited_truncated_documents_and_honors_top_n():
    seen = []

    def scorer(query, docs):
        seen.extend(docs)
        return [sum(word in doc for word in query.split()) for doc in docs]

    documents = ["alpha", "alpha beta", "x" * 3000] + ["other"] * 14
    result = LocalReranker(scorer=scorer).rerank("alpha beta", documents, top_n=2)

    assert result["status"] == "SUCCESS"
    assert [item["index"] for item in result["results"]] == [1, 0]
    assert len(seen) == 15
    assert len(seen[2]) == 2048


def test_scorer_error_uses_deterministic_original_order():
    def scorer(query, docs):
        raise RuntimeError("unavailable")

    result = LocalReranker(scorer=scorer).rerank("q", ["first", "second"], top_n=1)

    assert result["status"] == "FALLBACK"
    assert result["results"] == [{"index": 0, "score": 1.0, "document": "first"}]


def test_deadline_exceeded_uses_fallback():
    ticks = iter([0.0, 31.0])
    result = LocalReranker(scorer=lambda query, docs: [1.0], clock=lambda: next(ticks)).rerank(
        "q", ["first"]
    )

    assert result["status"] == "FALLBACK"
    assert [item["document"] for item in result["results"]] == ["first"]
