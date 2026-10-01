from src.automation.web_intelligence import WebIntelligence


class Reranker:
    def __init__(self, response): self.response = response
    def rerank(self, *args, **kwargs): return self.response


class RaisingJina:
    def rerank(self, *args, **kwargs): raise AssertionError("Jina must not run")


def make(local, jina):
    return WebIntelligence(*(object(),) * 5, jina_reranker=jina, local_reranker=local, searxng=object(), ddgs=object())


def test_local_reranker_precedes_jina():
    result = make(Reranker({"status": "SUCCESS", "results": [{"index": 1, "score": .9}, {"index": 0, "score": .4}]}), RaisingJina()).rerank_documents("q", [{"content": "one"}, {"content": "two"}])
    assert result["provider"] == "local-bge"
    assert [item["document"]["content"] for item in result["results"]] == ["two", "one"]


def test_jina_runs_after_local_fallback():
    result = make(Reranker({"status": "FALLBACK", "results": []}), Reranker({"status": "SUCCESS", "results": [{"index": 1, "relevance_score": .9}]})).rerank_documents("q", [{"content": "one"}, {"content": "two"}])
    assert result["provider"] == "jina-reranker"
