"""موتور گراف دانش حقوقی SmartJudge بر پایهٔ LightRAG (pip install lightrag-hku)."""
from .lightrag_engine import (  # noqa: F401
    LIGHTRAG_AVAILABLE,
    get_rag,
    ingest_texts,
    is_ready,
    lightrag_health,
    rag_query,
)

__all__ = [
    "LIGHTRAG_AVAILABLE",
    "get_rag",
    "ingest_texts",
    "is_ready",
    "lightrag_health",
    "rag_query",
]
