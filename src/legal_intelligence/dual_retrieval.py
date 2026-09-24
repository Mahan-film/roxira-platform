# -*- coding: utf-8 -*-
"""LightRAG Dual-Level Retrieval Engine (Roxira SmartJudge).

Two complementary retrieval passes over the PostgreSQL knowledge graph
(``graph_nodes``) so that a legal query is grounded on *both* exact citations
and the governing legal doctrines:

* **Low-level (exact)** — Article numbers, Supreme Court / "وحدت رویه"
  precedent numbers and active statutory citations referenced verbatim in the
  user's text.
* **High-level (doctrine)** — Governing legal doctrines (matching categories /
  titles) together with non-repealed precedents whose ``status`` is ``ACTIVE``.

Design goals
------------
* **Latency < 60 ms.** A process-local TTL cache absorbs repeated queries, and
  every cold query is resolved with a *single* database round trip (one
  connection + one ``UNION ALL`` statement) using indexed predicates with hard
  ``LIMIT`` clauses.
* **Non-repealed only.** The active predicate accepts ``metadata.status =
  'ACTIVE'`` or ``metadata.active = true`` and never returns ``REPEALED`` rows.
* **Backwards compatible.** Returns ``(laws, precedents)`` where each item keeps
  the historical ``title``/``category``/``summary`` (laws) and
  ``title``/``subject``/``summary`` (precedents) keys, augmented with
  ``node_id`` and ``match_level``.

This module is intentionally dependency-light (``psycopg`` only) and owns **no**
FastAPI router, so it is never auto-registered by the unified server.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from src.roxira_config import postgres_dsn

try:  # psycopg3 (production container)
    import psycopg
except Exception:  # pragma: no cover - defensive
    psycopg = None  # type: ignore

def _default_dsn() -> str:
    return postgres_dsn(host="roxira_postgres_prod", port=5432)

# --------------------------------------------------------------------------- #
# Query parsing helpers (Persian / Arabic text)
# --------------------------------------------------------------------------- #

_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_ASCII_DIGITS = "0123456789"
_DIGIT_TRANS = str.maketrans(
    _PERSIAN_DIGITS + _ARABIC_DIGITS, _ASCII_DIGITS + _ASCII_DIGITS
)

_ARTICLE_RE = re.compile(
    r"(?:ماده|مادۀ|مادّه|مادهای|مادة)\s*\(?\s*([0-9]{1,4})\s*\)?"
)
_PRECEDENT_RES = (
    re.compile(r"(?:وحدت\s*رویه|رویه\s*وحدت)[^\d]{0,18}([0-9]{1,4})"),
    re.compile(r"(?:رأی|رای)\s*(?:شماره\s*)?([0-9]{1,4})"),
    re.compile(r"استعلام\s*(?:شماره\s*)?([0-9]{1,4})"),
)

_STOPWORDS = {
    "ماده", "مادۀ", "قانون", "قوانین", "مورد", "درباره", "برای", "که", "این",
    "است", "های", "هایی", "شود", "گردد", "یا", "با", "از", "به", "در", "را",
    "بر", "هم", "یک", "دو", "شماره", "رأی", "رای", "وحدت", "رویه", "دیوان",
    "عالی", "کشور", "حقوقی", "خصوص", "لطفا", "لطفاً", "چیست", "کدام",
}
_WORD_RE = re.compile(r"[\u0600-\u06FF]{3,}")


def normalize_digits(text: str) -> str:
    """Convert Persian/Arabic-Indic digits to ASCII digits."""
    return (text or "").translate(_DIGIT_TRANS)


def extract_article_numbers(text: str) -> List[str]:
    """Return distinct article numbers cited in ``text`` (as ASCII strings)."""
    normalized = normalize_digits(text)
    seen: List[str] = []
    for match in _ARTICLE_RE.finditer(normalized):
        num = match.group(1).lstrip("0") or "0"
        if num not in seen:
            seen.append(num)
    return seen


def extract_precedent_numbers(text: str) -> List[str]:
    """Return distinct Supreme-Court / unified-precedent numbers in ``text``."""
    normalized = normalize_digits(text)
    seen: List[str] = []
    for pattern in _PRECEDENT_RES:
        for match in pattern.finditer(normalized):
            num = match.group(1).lstrip("0") or "0"
            if num not in seen:
                seen.append(num)
    return seen


def extract_doctrine_keywords(text: str, max_keywords: int = 6) -> List[str]:
    """Extract salient doctrine keywords (longest first) from the query."""
    normalized = normalize_digits(text)
    unique: List[str] = []
    if any(w in normalized for w in ["وحدت رویه", "دیوان عالی", "دیوان", "رأی وحدت"]):
        unique.append("وحدت رویه")
        unique.append("دیوان عالی")
    words = _WORD_RE.findall(normalized)
    for word in words:
        if word in _STOPWORDS or word in unique:
            continue
        unique.append(word)
    unique.sort(key=len, reverse=True)
    return unique[:max_keywords]


def _clean(text: Optional[str], size: int = 1200) -> str:
    """Collapse whitespace and truncate a snippet for the response payload."""
    if not text:
        return ""
    return " ".join(str(text).split())[:size]


# --------------------------------------------------------------------------- #
# Single-round-trip dual retrieval
# --------------------------------------------------------------------------- #

_ACTIVE_PREDICATE = (
    "(metadata->>'status' = 'ACTIVE' OR metadata->>'active' = 'true') "
    "AND metadata->>'status' IS DISTINCT FROM 'REPEALED'"
)

# Four ranked sub-selects are fused with UNION ALL so the whole retrieval is
# resolved in one statement / one network round trip. Named params are reused by
# psycopg across the statement.
_RETRIEVAL_SQL = f"""
WITH low_law AS (
    SELECT 'LAW' AS kind, 'LOW_EXACT_ARTICLE' AS match_level, 0 AS rank,
           node_id, title, category, content
    FROM graph_nodes
    WHERE node_type IN ('LAW', 'ARTICLE')
      AND {_ACTIVE_PREDICATE}
      AND (
            metadata->>'article_num' = ANY(%(arts)s)
         OR node_id LIKE ANY(%(art_ids)s)
         OR title ILIKE ANY(%(art_pats)s)
      )
    ORDER BY (metadata->>'article_num' = ANY(%(arts)s)) DESC, node_id ASC
    LIMIT %(cap)s
),
high_law AS (
    SELECT 'LAW' AS kind, 'HIGH_DOCTRINE' AS match_level, 1 AS rank,
           node_id, title, category, content
    FROM graph_nodes
    WHERE node_type IN ('LAW', 'ARTICLE')
      AND {_ACTIVE_PREDICATE}
      AND (title ILIKE ANY(%(kw_pats)s) OR category ILIKE ANY(%(kw_pats)s))
    ORDER BY (category ILIKE ANY(%(kw_pats)s)) DESC, node_id ASC
    LIMIT %(cap)s
),
low_prec AS (
    SELECT 'PRECEDENT' AS kind, 'LOW_EXACT_PRECEDENT' AS match_level, 0 AS rank,
           node_id, title, category, content
    FROM graph_nodes
    WHERE node_type = 'PRECEDENT'
      AND {_ACTIVE_PREDICATE}
      AND (
            metadata->>'precedent_id' = ANY(%(prec_nums)s)
         OR node_id = ANY(%(prec_ids)s)
         OR title ILIKE ANY(%(prec_pats)s)
      )
    ORDER BY (metadata->>'precedent_id' = ANY(%(prec_nums)s)) DESC, COALESCE(NULLIF(regexp_replace(node_id, '\D', '', 'g'), '')::int, 0) DESC
    LIMIT %(prec_cap)s
),
high_prec_kw AS (
    SELECT 'PRECEDENT' AS kind, 'HIGH_ACTIVE_PRECEDENT' AS match_level, 1 AS rank,
           node_id, title, category, content
    FROM graph_nodes
    WHERE node_type = 'PRECEDENT'
      AND {_ACTIVE_PREDICATE}
      AND (title ILIKE ANY(%(kw_pats)s) OR category ILIKE ANY(%(kw_pats)s))
    ORDER BY (category ILIKE ANY(%(kw_pats)s)) DESC, COALESCE(NULLIF(regexp_replace(node_id, '\D', '', 'g'), '')::int, 0) DESC
    LIMIT %(prec_cap)s
),
high_prec AS (
    SELECT * FROM high_prec_kw
    UNION ALL
    SELECT 'PRECEDENT' AS kind, 'HIGH_ACTIVE_PRECEDENT' AS match_level, 1 AS rank,
           node_id, title, category, content
    FROM (
        SELECT node_id, title, category, content
        FROM graph_nodes
        WHERE node_type = 'PRECEDENT'
          AND {_ACTIVE_PREDICATE}
        ORDER BY COALESCE(NULLIF(regexp_replace(node_id, '\D', '', 'g'), '')::int, 0) DESC
        LIMIT %(prec_cap)s
    ) general_active
    WHERE NOT EXISTS (SELECT 1 FROM high_prec_kw)
)
SELECT kind, match_level, node_id, title, category, content
FROM (
    SELECT * FROM low_law
    UNION ALL SELECT * FROM high_law
    UNION ALL SELECT * FROM low_prec
    UNION ALL SELECT * FROM high_prec
) fused
ORDER BY kind, rank, COALESCE(NULLIF(regexp_replace(node_id, '\D', '', 'g'), '')::int, 0) DESC, node_id ASC;
"""


def _build_params(article_nums: List[str], precedent_nums: List[str],
                  keywords: List[str], limit: int) -> Dict[str, Any]:
    art_pats = [f"%ماده {n}%" for n in article_nums]
    art_ids = [f"LAW_%_ART_{n}" for n in article_nums]
    prec_ids = [f"PRECEDENT_{n}" for n in precedent_nums] + [
        f"RULING-{n}" for n in precedent_nums
    ]
    prec_pats = [f"%{n}%" for n in precedent_nums]
    kw_pats = [f"%{k}%" for k in keywords]
    return {
        "arts": article_nums,
        "art_ids": art_ids,
        "art_pats": art_pats,
        "prec_nums": precedent_nums,
        "prec_ids": prec_ids,
        "prec_pats": prec_pats,
        "kw_pats": kw_pats,
        "cap": limit,
        "prec_cap": min(limit, 3),
    }


def _shape(row, kind: str) -> Dict[str, Any]:
    node_id, title, category, content, match_level = row
    if kind == "LAW":
        return {
            "node_id": node_id,
            "title": title,
            "category": category,
            "summary": _clean(content, 160),
            "match_level": match_level,
        }
    return {
        "node_id": node_id,
        "title": title,
        "subject": category,
        "summary": _clean(content, 160),
        "match_level": match_level,
    }


def _merge_ranked(items: List[Dict[str, Any]], cap: int) -> List[Dict[str, Any]]:
    """Deduplicate by node_id/title, preserving low-level (exact) priority."""
    merged: List[Dict[str, Any]] = []
    seen = set()
    for item in items:
        key = item.get("node_id") or item.get("title")
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
        if len(merged) >= cap:
            break
    return merged


# --------------------------------------------------------------------------- #
# Cached connection (removes per-query TCP/handshake latency)
# --------------------------------------------------------------------------- #

_conn_cache: Dict[str, Any] = {}
_conn_lock = threading.Lock()


def _get_connection(dsn: str):
    """Return a reusable, autocommit connection for ``dsn`` (thread-safe).

    Reusing a warm connection removes the 15-25 ms TCP/auth handshake from the
    steady-state latency budget.
    """
    conn = _conn_cache.get(dsn)
    if conn is not None and not getattr(conn, "closed", False):
        return conn
    conn = psycopg.connect(dsn, autocommit=True, connect_timeout=2)
    _conn_cache[dsn] = conn
    return conn


def _drop_connection(dsn: str) -> None:
    conn = _conn_cache.pop(dsn, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def _execute_retrieval(dsn: str, params: Dict[str, Any]) -> List[tuple]:
    """Run the fused SQL on the cached connection, serialized by a lock."""
    with _conn_lock:
        conn = _get_connection(dsn)
        try:
            with conn.cursor() as cur:
                cur.execute(_RETRIEVAL_SQL, params)
                return cur.fetchall()
        except Exception:
            _drop_connection(dsn)
            raise


def _warmup_connection(dsn: Optional[str] = None) -> None:
    """Best-effort background warmup so the first request is already fast."""
    try:
        with _conn_lock:
            _get_connection(dsn or _default_dsn())
    except Exception:
        pass


def close_connections() -> None:
    """Close all cached connections (used by tests / maintenance)."""
    with _conn_lock:
        for dsn in list(_conn_cache):
            _drop_connection(dsn)


threading.Thread(target=_warmup_connection, daemon=True).start()


# --------------------------------------------------------------------------- #
# Cache + public entry point
# --------------------------------------------------------------------------- #

_CACHE_TTL_SECONDS = 90.0
_CACHE_MAX_ENTRIES = 512
_cache: Dict[Tuple[str, int], Tuple[float, Tuple[List, List]]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: Tuple[str, int]) -> Optional[Tuple[List, List]]:
    entry = _cache.get(key)
    if not entry:
        return None
    ts, value = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return value


def _cache_put(key: Tuple[str, int], value: Tuple[List, List]) -> None:
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:_CACHE_MAX_ENTRIES // 2]:
                _cache.pop(k, None)
        _cache[key] = (time.time(), value)


_FALLBACK_LAWS = [{"title": "ماده ۱۰۸۲ قانون مدنی", "category": "حقوق خانواده",
                   "summary": "", "match_level": "FALLBACK"}]
_FALLBACK_PRECEDENTS = [{"title": "رأی وحدت رویه دیوان عالی کشور",
                         "subject": "صلاحیت اجرای ثبت", "summary": "",
                         "match_level": "FALLBACK"}]


def dual_retrieve(
    query_text: str,
    limit: int = 3,
    dsn: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Run the dual-level retrieval and return ``(laws, precedents)``.

    The function never raises: on any backend error it degrades to a small,
    deterministic statutory fallback so callers always receive usable context.
    """
    query_text = (query_text or "").strip()
    if not query_text:
        return list(_FALLBACK_LAWS), list(_FALLBACK_PRECEDENTS)

    safe_limit = max(1, min(int(limit or 3), 8))
    cache_key = (query_text, safe_limit)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    if psycopg is None:  # pragma: no cover - environment without psycopg
        return list(_FALLBACK_LAWS), list(_FALLBACK_PRECEDENTS)

    params = _build_params(
        extract_article_numbers(query_text),
        extract_precedent_numbers(query_text),
        extract_doctrine_keywords(query_text),
        safe_limit,
    )

    laws: List[Dict[str, Any]] = []
    precedents: List[Dict[str, Any]] = []
    try:
        rows = _execute_retrieval(dsn or _default_dsn(), params)
        for row in rows:
            # row = (kind, match_level, node_id, title, category, content)
            kind = row[0]
            shaped = _shape((row[2], row[3], row[4], row[5], row[1]), kind)
            (laws if kind == "LAW" else precedents).append(shaped)
    except Exception:
        return list(_FALLBACK_LAWS), list(_FALLBACK_PRECEDENTS)

    laws = _merge_ranked(laws, safe_limit)
    precedents = _merge_ranked(precedents, min(safe_limit, 3))
    if not laws:
        laws = list(_FALLBACK_LAWS)
    if not precedents:
        precedents = list(_FALLBACK_PRECEDENTS)

    result = (laws, precedents)
    _cache_put(cache_key, result)
    return result


def clear_cache() -> None:
    """Reset the retrieval cache (used by tests / maintenance)."""
    with _cache_lock:
        _cache.clear()
