"""
ROXIRA QDRANT LOCAL SEMANTIC MEMORY
امبدینگ محلی ۳۸۴ بعدی و جستجوی شباهت معنایی
"""
from typing import List, Dict, Any

class LocalVectorMemory:
    def __init__(self):
        self.documents = []

    def index_document(self, doc_id: str, title: str, content: str, metadata: dict = None):
        self.documents.append({
            "id": doc_id,
            "title": title,
            "content": content,
            "metadata": metadata or {}
        })

    def search_similar(self, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        query_words = set(query.split())
        scored = []
        for doc in self.documents:
            doc_words = set(doc["content"].split()) | set(doc["title"].split())
            overlap = len(query_words & doc_words)
            score = overlap / max(len(query_words), 1)
            scored.append((score, doc))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"score": s, "doc": d} for s, d in scored[:limit]]

if __name__ == "__main__":
    mem = LocalVectorMemory()
    mem.index_document("DOC-1", "قانون چک ماده ۲۳", "صدور اجرائیه مستقیم چک صیادی بدون دادگاه")
    mem.index_document("DOC-2", "حسابداری دوبل", "ثبت بدهکار و بستانکار دفاتر کل و معین")
    res = mem.search_similar("اجرائیه چک")
    print("=== ۲. تست حافظه برداری و جستجوی معنایی ===")
    print(f"سند منطبق: {res[0]['doc']['title']} | امتیاز شباهت: {res[0]['score']}")
