"""Rust-ready retrieval contract (`RetrievalBackend` Protocol + JSON wire models).

Separates the Smart Judge hot-path retrieval interface from its implementation so
a future Rust sidecar/service can implement the exact same JSON contract over
HTTP/Unix-socket without changing ``/chat`` or ``/chat/stream``.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, runtime_checkable

from pydantic import BaseModel, Field


class RetrievalRequest(BaseModel):
    """JSON wire request sent to any ``RetrievalBackend`` implementation."""

    query: str = Field(..., min_length=1, description="User or expanded legal query text.")
    limit: int = Field(default=5, ge=1, le=50, description="Max hits per corpus.")
    as_of: Optional[str] = Field(default=None, description="Optional ISO date for temporal law filtering.")
    include_rulings: bool = Field(default=True, description="Include judicial precedents / unity rulings.")
    include_regulations: bool = Field(default=True, description="Include circulars / regulations.")
    trace_id: Optional[str] = Field(default=None, description="Correlation id for per-stage timing.")


class LawHit(BaseModel):
    """Normalised statutory hit returned by ``RetrievalBackend``."""

    title: str
    summary: str = ""
    category: str = "LAW"
    law_name: Optional[str] = None
    article_no: Optional[str] = None
    match_level: Optional[str] = None
    source_tier: str = "official"
    repeal_status: Optional[str] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    score: Optional[float] = None


class PrecedentHit(BaseModel):
    """Normalised precedent / regulation / doctrine hit returned by ``RetrievalBackend``."""

    title: str
    summary: str = ""
    category: str = "PRECEDENT"
    number: Optional[str] = None
    subject: Optional[str] = None
    binding_effect: Optional[str] = None
    match_level: Optional[str] = None
    source_tier: str = "unofficial"
    score: Optional[float] = None


class RetrievalTimings(BaseModel):
    """Per-stage latency breakdown (milliseconds)."""

    embed_ms: float = 0.0
    qdrant_ms: float = 0.0
    sql_ms: float = 0.0
    rulings_ms: float = 0.0
    regs_ms: float = 0.0
    total_ms: float = 0.0


class RetrievalResponse(BaseModel):
    """JSON wire response returned by any ``RetrievalBackend`` implementation."""

    laws: List[LawHit] = Field(default_factory=list)
    precedents: List[PrecedentHit] = Field(default_factory=list)
    source: str = "unknown"
    collection: Optional[str] = None
    timings: RetrievalTimings = Field(default_factory=RetrievalTimings)
    meta: Dict[str, Any] = Field(default_factory=dict)

    def to_legacy_tuple(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Convert back to ``(laws, precedents)`` list-of-dicts used by callers."""
        return (
            [h.model_dump(exclude_none=True) for h in self.laws],
            [h.model_dump(exclude_none=True) for h in self.precedents],
        )


@runtime_checkable
class RetrievalBackend(Protocol):
    """Contract implemented by Python LightRAG/Qdrant/SQL or a Rust retrieval service."""

    async def retrieve(self, request: RetrievalRequest) -> RetrievalResponse:
        ...


def _coerce_law(row: Any) -> LawHit:
    if isinstance(row, LawHit):
        return row
    d = dict(row or {})
    return LawHit(
        title=str(d.get("title") or ""),
        summary=str(d.get("summary") or d.get("excerpt") or ""),
        category=str(d.get("category") or "LAW"),
        law_name=d.get("law_name"),
        article_no=str(d["article_no"]) if d.get("article_no") is not None else None,
        match_level=d.get("match_level"),
        source_tier=str(d.get("source_tier") or d.get("tier") or "official"),
        repeal_status=d.get("repeal_status"),
        valid_from=d.get("valid_from"),
        valid_to=d.get("valid_to"),
        score=float(d["score"]) if d.get("score") is not None else None,
    )


def _coerce_precedent(row: Any) -> PrecedentHit:
    if isinstance(row, PrecedentHit):
        return row
    d = dict(row or {})
    return PrecedentHit(
        title=str(d.get("title") or ""),
        summary=str(d.get("summary") or d.get("excerpt") or ""),
        category=str(d.get("category") or "PRECEDENT"),
        number=str(d["number"]) if d.get("number") is not None else None,
        subject=d.get("subject"),
        binding_effect=d.get("binding_effect"),
        match_level=d.get("match_level"),
        source_tier=str(d.get("source_tier") or d.get("tier") or "unofficial"),
        score=float(d["score"]) if d.get("score") is not None else None,
    )


class LocalRetrievalBackend:
    """In-process adapter wrapping ``aquery_knowledge_graph`` behind ``RetrievalBackend``."""

    def __init__(self, query_fn: Callable[..., Awaitable[tuple[list, list]]]):
        self._query_fn = query_fn

    async def retrieve(self, request: RetrievalRequest) -> RetrievalResponse:
        import time

        meta_out: Dict[str, Any] = {}
        t0 = time.perf_counter()
        laws_raw, prec_raw = await self._query_fn(request.query, limit=request.limit, meta_out=meta_out)
        total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        return RetrievalResponse(
            laws=[_coerce_law(r) for r in (laws_raw or [])],
            precedents=[_coerce_precedent(r) for r in (prec_raw or [])],
            source=str(meta_out.get("source") or "local"),
            collection=meta_out.get("collection"),
            timings=RetrievalTimings(total_ms=total_ms),
            meta=meta_out,
        )
