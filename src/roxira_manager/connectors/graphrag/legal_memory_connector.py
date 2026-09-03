from __future__ import annotations

from output_apps.smart_judge.src.graphrag.retrievers.hybrid_retriever import HybridRetriever


class LegalMemoryConnector:


    def __init__(self):

        self.retriever = HybridRetriever()


    def search(self, query: str):

        try:
            return self.retriever.retrieve(query)

        except Exception as e:

            return {
                "error": str(e),
                "results": []
            }
