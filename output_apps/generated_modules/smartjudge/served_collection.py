"""Single source of truth for the Qdrant collection the legal retriever serves from.

The retriever (``legal_graph.lightrag_engine``) reads ``LIGHTRAG_QDRANT_COLLECTION``.
Anything that reports or labels the collection (the citation guard) must resolve it the
same way instead of carrying its own hardcoded default (T201: the guard said
``iran_laws_bge_m3`` while the served collection was ``iran_laws_v8h``).
"""

from __future__ import annotations

import os
from typing import Mapping, Optional

SERVED_COLLECTION_ENV = "LIGHTRAG_QDRANT_COLLECTION"
CITATION_COLLECTION_ENV = "ROXIRA_CITATION_QDRANT_COLLECTION"  # explicit override for the guard only
LAST_RESORT_COLLECTION = "iran_laws_v2"  # same last-resort default as lightrag_engine


def served_collection(environ: Optional[Mapping[str, str]] = None) -> str:
    """Collection the retriever queries: env first, else the engine's own resolved default."""
    env = os.environ if environ is None else environ
    explicit = (env.get(SERVED_COLLECTION_ENV) or "").strip()
    if explicit:
        return explicit
    try:
        from .legal_graph import lightrag_engine as _engine

        return str(_engine.QDRANT_FALLBACK_COLLECTION)
    except Exception:  # noqa: BLE001 - engine optional; this is a label only
        return LAST_RESORT_COLLECTION


def citation_collection(environ: Optional[Mapping[str, str]] = None) -> str:
    """Collection name the citation guard reports: explicit guard override, else the served one."""
    env = os.environ if environ is None else environ
    return (env.get(CITATION_COLLECTION_ENV) or "").strip() or served_collection(env)
