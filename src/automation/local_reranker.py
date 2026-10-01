"""Lazy local document reranking with a deterministic no-model fallback."""

import importlib.util
import time
from typing import Callable


class LocalReranker:
    MAX_DOCS = 15
    MAX_CHARS = 2048
    DEADLINE_S = 30.0

    def __init__(self, scorer=None, clock=time.monotonic):
        self.scorer = scorer
        self.clock = clock

    @property
    def configured(self):
        return self.scorer is not None or importlib.util.find_spec("sentence_transformers") is not None

    def _scorer(self):
        if self.scorer is not None:
            return self.scorer
        from sentence_transformers import CrossEncoder

        model = CrossEncoder("BAAI/bge-reranker-v2-m3")
        return lambda query, docs: model.predict([(query, doc) for doc in docs]).tolist()

    def _fallback(self, documents, top_n):
        return {
            "status": "FALLBACK",
            "provider": "local-bge",
            "results": [
                {"index": index, "score": 1.0 - index * 0.01, "document": document}
                for index, document in enumerate(documents[:top_n])
            ],
        }

    def rerank(self, query: str, documents: list[str], top_n: int | None = None) -> dict:
        limit = len(documents) if top_n is None else max(0, top_n)
        candidates = documents[: self.MAX_DOCS]
        truncated = [document[: self.MAX_CHARS] for document in candidates]
        started = self.clock()
        try:
            scores = self._scorer()(query, truncated)
            if self.clock() - started > self.DEADLINE_S:
                return self._fallback(candidates, limit)
            results = [
                {"index": index, "score": float(score), "document": document}
                for index, (document, score) in enumerate(zip(candidates, scores))
            ]
            results.sort(key=lambda result: result["score"], reverse=True)
            return {"status": "SUCCESS", "provider": "local-bge", "results": results[:limit]}
        except Exception:
            return self._fallback(candidates, limit)
