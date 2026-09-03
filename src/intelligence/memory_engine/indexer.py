from __future__ import annotations

import uuid
from typing import List, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http import models
from src.intelligence.memory_engine.embedder import TextEmbedder

class SemanticMemoryIndexer:
    COLLECTION_NAME = "roxira_knowledge_memory"

    def __init__(self, host: str = "127.0.0.1", port: int = 6333):
        self.client = QdrantClient(host=host, port=port)
        self.embedder = TextEmbedder()
        self._ensure_collection()

    def _ensure_collection(self):
        collections = [c.name for c in self.client.get_collections().collections]
        if self.COLLECTION_NAME not in collections:
            self.client.create_collection(
                collection_name=self.COLLECTION_NAME,
                vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
            )

    def add_document(self, text: str, metadata: Dict[str, Any]) -> str:
        vector = self.embedder.embed(text).tolist()
        doc_id = str(uuid.uuid4())
        self.client.upsert(
            collection_name=self.COLLECTION_NAME,
            points=[models.PointStruct(id=doc_id, vector=vector, payload={"text": text, **metadata})]
        )
        return doc_id

    def search(self, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        query_vector = self.embedder.embed(query).tolist()
        search_result = self.client.query_points(
            collection_name=self.COLLECTION_NAME,
            query=query_vector,
            limit=limit
        )
        return [
            {
                "score": round(hit.score, 4),
                "text": hit.payload.get("text"),
                "metadata": {k: v for k, v in hit.payload.items() if k != "text"}
            }
            for hit in search_result.points
        ]

if __name__ == "__main__":
    indexer = SemanticMemoryIndexer()
    indexer.add_document(
        text="ماده ۲۳ قانون صدور چک: امکان صدور اجرائیه مستقیم بدون دادرسی ماهوی را فراهم می‌کند.",
        metadata={"category": "COMMERCIAL", "source": "Iranian Check Law"}
    )
    indexer.add_document(
        text="حساب ۱۱۰۱ به عنوان حساب صندوق و بانک در دفاتر کل بدهکار می‌گردد.",
        metadata={"category": "ACCOUNTING", "source": "Ledger Standards"}
    )
    print("✅ QDRANT INDEXER INITIALIZED & DOCUMENTS STORED")
    results = indexer.search("مطالبه چک صیادی")
    for r in results:
        print(f"   Score [{r['score']}] -> {r['text']}")
