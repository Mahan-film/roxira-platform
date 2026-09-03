from __future__ import annotations

from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer


class VectorRetriever:
    def __init__(self):
        self.client = QdrantClient(
            host="localhost",
            port=6333
        )

        self.collection = "roxira_legal_memory"

        self.model = SentenceTransformer(
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        )


    def search(self, query: str, limit: int = 5):

        vector = self.model.encode(query).tolist()

        results = self.client.query_points(
    collection_name=self.collection,
    query=vector,
    limit=limit
).points

        return [
            {
                "id": item.id,
                "score": item.score,
                "payload": item.payload
            }
            for item in results
        ]


if __name__ == "__main__":

    retriever = VectorRetriever()

    result = retriever.search(
        "تاخیر در تحویل آپارتمان و خسارت قراردادی"
    )

    print(result)