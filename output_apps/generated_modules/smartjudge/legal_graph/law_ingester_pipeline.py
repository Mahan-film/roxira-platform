"""Article-level statutory ingestion pipeline for the SmartJudge legal graph.

Parses Iranian statutory codes into structured, article-level chunks, computes a
stable MD5 ``content_hash`` per article, and batch-ingests them into the Qdrant
collection ``iran_laws_bge_m3`` with idempotent (deterministic-id) upserts.

Design goals
------------
* **Article-level chunking** — one point per ``ماده`` with its ``تبصره`` notes
  attached, instead of arbitrary character windows.
* **Structured fields** — ``law_name``, ``article_no``, ``text``, ``notes``,
  ``scope_tags``, ``content_hash`` (+ ``source_code``).
* **Idempotent** — the Qdrant point id is ``uuid5(namespace, content_hash)``, so
  re-ingesting the same article overwrites the same point and never duplicates.
* **Dependency-light** — Qdrant is reached over its HTTP API with the standard
  library; embeddings fall back to a deterministic hash vector when no real
  embedder is supplied, so the pipeline is fully testable offline.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import unicodedata
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Optional, Protocol, Sequence

__all__ = [
    "LawArticle",
    "LawCode",
    "LAW_CODES",
    "ArticleChunker",
    "parse_statutory_text",
    "normalize_text",
    "fallback_embedding",
    "Embedder",
    "LawIngester",
    "IngestSummary",
]

COLLECTION_NAME = "iran_laws_bge_m3"
VECTOR_SIZE = 1024
DEFAULT_QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
_POINT_NAMESPACE = uuid.UUID("6f1c2c9a-0d2b-4a44-9d5f-2f6a9b1c7e10")

#: Persian/Arabic-Indic digits → ASCII.
_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_ARTICLE_RE = re.compile(r"^\s*(?:ماده|مادّه|مادة)\s*([0-9]+)\s*[-–—:.)]?\s*(.*)$")
_TABSIREH_RE = re.compile(r"^\s*(?:تبصره|تبصرة)\s*([0-9]+)?\s*[-–—:.)]?\s*(.*)$")


def normalize_text(value: str) -> str:
    """Normalise digits/whitespace so hashing and matching are stable."""
    text = unicodedata.normalize("NFC", str(value or "")).translate(_DIGIT_MAP)
    text = text.replace("\u200c", " ").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _to_int(value: str) -> int:
    return int(normalize_text(value)) if normalize_text(value).isdigit() else 0


def _md5(*parts: str) -> str:
    payload = "\u0001".join(normalize_text(part) for part in parts).encode("utf-8")
    try:  # FIPS builds forbid MD5 unless flagged non-security.
        return hashlib.md5(payload, usedforsecurity=False).hexdigest()
    except TypeError:  # pragma: no cover - older interpreters
        return hashlib.md5(payload).hexdigest()


@dataclass(slots=True)
class LawCode:
    """Registry entry describing one statutory code."""

    source_code: str
    law_name: str
    article_from: int
    article_to: int
    scope_tags: tuple[str, ...]
    category: str = "STATUTE"


#: Canonical codes covered by the ingester (article ranges are inclusive).
LAW_CODES: tuple[LawCode, ...] = (
    LawCode(
        source_code="CPC",
        law_name="قانون آیین دادرسی مدنی",
        article_from=1,
        article_to=529,
        scope_tags=("civil_procedure", "courts", "civil"),
    ),
    LawCode(
        source_code="CPC_CRIMINAL",
        law_name="قانون آیین دادرسی کیفری",
        article_from=1,
        article_to=570,
        scope_tags=("criminal_procedure", "courts", "criminal"),
    ),
    LawCode(
        source_code="IPC",
        law_name="قانون مجازات اسلامی",
        article_from=1,
        article_to=728,
        scope_tags=("penal", "general", "taazirat", "cyber"),
    ),
    LawCode(
        source_code="DISPUTE_COUNCILS_1402",
        law_name="قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲",
        article_from=1,
        article_to=45,
        scope_tags=("peace_courts", "dispute_councils", "1402"),
    ),
    LawCode(
        source_code="CHEQUE",
        law_name="قانون صدور چک",
        article_from=1,
        article_to=24,
        scope_tags=("commercial", "cheque", "sayad"),
    ),
)

_LAW_BY_CODE = {code.source_code: code for code in LAW_CODES}
_LAW_BY_NAME = {normalize_text(code.law_name): code for code in LAW_CODES}


@dataclass(slots=True)
class LawArticle:
    """One article-level chunk ready for indexing."""

    law_name: str
    article_no: int
    text: str
    notes: list[str] = field(default_factory=list)
    scope_tags: list[str] = field(default_factory=list)
    content_hash: str = ""
    source_code: Optional[str] = None

    @property
    def article_label(self) -> str:
        return f"ماده {self.article_no}"

    def compute_hash(self) -> str:
        return _md5(self.law_name, str(self.article_no), self.text, "|".join(self.notes))

    def finalize(self) -> "LawArticle":
        if not self.content_hash:
            self.content_hash = self.compute_hash()
        return self

    def point_id(self) -> str:
        """Deterministic Qdrant point id → idempotent upsert (no duplicates)."""
        seed = self.content_hash or self.compute_hash()
        return str(uuid.uuid5(_POINT_NAMESPACE, seed))

    def payload(self) -> dict[str, Any]:
        return {
            "law_name": self.law_name,
            "article_no": self.article_no,
            "article_label": self.article_label,
            "text": self.text,
            "notes": list(self.notes),
            "scope_tags": list(self.scope_tags),
            "content_hash": self.content_hash or self.compute_hash(),
            "source_code": self.source_code,
        }

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["article_label"] = self.article_label
        return data


class ArticleChunker:
    """Split a statutory text into :class:`LawArticle` chunks."""

    def __init__(self, law_code: Optional[LawCode] = None, scope_tags: Sequence[str] = ()) -> None:
        self._code = law_code
        self._scope_tags = tuple(scope_tags) if scope_tags else (law_code.scope_tags if law_code else ())

    @classmethod
    def for_code(cls, source_code: str) -> "ArticleChunker":
        code = _LAW_BY_CODE.get(source_code)
        if code is None:
            raise KeyError(f"unknown law code: {source_code}")
        return cls(law_code=code)

    def chunk(self, raw_text: str) -> list[LawArticle]:
        law_name = self._code.law_name if self._code else "قانون نامشخص"
        source_code = self._code.source_code if self._code else None

        articles: list[dict[str, Any]] = []
        current: Optional[dict[str, Any]] = None

        for raw_line in (raw_text or "").splitlines():
            line = normalize_text(raw_line)
            if not line:
                continue
            article_match = _ARTICLE_RE.match(line)
            if article_match:
                if current is not None:
                    articles.append(current)
                body = article_match.group(2).strip()
                current = {"no": _to_int(article_match.group(1)), "body": [body] if body else [], "notes": [], "in_note": False}
                continue
            tab_match = _TABSIREH_RE.match(line)
            if tab_match and current is not None:
                note = tab_match.group(2).strip()
                current["notes"].append(note)
                current["in_note"] = True
                continue
            if current is None:
                continue
            if current["in_note"] and current["notes"]:
                merged = f"{current['notes'][-1]} {line}".strip()
                current["notes"][-1] = merged
            else:
                current["body"].append(line)

        if current is not None:
            articles.append(current)

        chunks: list[LawArticle] = []
        for item in articles:
            text = " ".join(part for part in item["body"] if part).strip()
            notes = [note for note in item["notes"] if note]
            if not text and not notes:
                continue
            article = LawArticle(
                law_name=law_name,
                article_no=int(item["no"]),
                text=text,
                notes=notes,
                scope_tags=list(self._scope_tags),
                source_code=source_code,
            )
            chunks.append(article.finalize())
        return chunks


def parse_statutory_text(
    law_name: str,
    raw_text: str,
    scope_tags: Sequence[str] = (),
    source_code: Optional[str] = None,
) -> list[LawArticle]:
    """Convenience wrapper: resolve the code by ``source_code``/name and chunk."""
    code = _LAW_BY_CODE.get(source_code or "") if source_code else None
    if code is None:
        code = _LAW_BY_NAME.get(normalize_text(law_name))
    if code is not None and normalize_text(code.law_name) != normalize_text(law_name):
        # keep the caller's label but reuse the code's scope/tags
        chunks = ArticleChunker(law_code=code, scope_tags=scope_tags or code.scope_tags).chunk(raw_text)
        for chunk in chunks:
            chunk.law_name = law_name
        return chunks
    return ArticleChunker(law_code=code, scope_tags=scope_tags).chunk(raw_text)


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------


class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...


def fallback_embedding(text: str, size: int = VECTOR_SIZE) -> list[float]:
    """Deterministic pseudo-embedding (hash-expanded) for offline/fallback use.

    Not semantically meaningful — it simply guarantees a stable, non-zero vector
    of the right dimension so ingestion never blocks on a model download.
    """
    digest = hashlib.sha256(normalize_text(text).encode("utf-8")).digest()
    vector: list[float] = []
    counter = 0
    while len(vector) < size:
        block = hashlib.sha256(digest + counter.to_bytes(4, "big")).digest()
        for index in range(0, len(block), 2):
            raw = int.from_bytes(block[index : index + 2], "big")
            vector.append((raw / 32767.5) - 1.0)
            if len(vector) >= size:
                break
        counter += 1
    return vector


# ---------------------------------------------------------------------------
# Qdrant ingestion
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class IngestSummary:
    collection: str
    parsed: int = 0
    uploaded: int = 0
    skipped_duplicates: int = 0
    batches: int = 0
    status: str = "ok"
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LawIngester:
    """Batch, idempotent ingestion of :class:`LawArticle` into Qdrant."""

    def __init__(
        self,
        qdrant_url: Optional[str] = None,
        collection: str = COLLECTION_NAME,
        vector_size: int = VECTOR_SIZE,
        embedder: Optional[Embedder] = None,
        timeout: float = 30.0,
    ) -> None:
        self._url = (qdrant_url or DEFAULT_QDRANT_URL).rstrip("/")
        self._collection = collection
        self._vector_size = vector_size
        self._embedder = embedder
        self._timeout = timeout

    # -- HTTP plumbing ----------------------------------------------------

    def _request(self, method: str, path: str, payload: Optional[dict[str, Any]] = None) -> Optional[dict[str, Any]]:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            f"{self._url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
            return None

    async def _request_async(self, method: str, path: str, payload: Optional[dict[str, Any]] = None) -> Optional[dict[str, Any]]:
        return await asyncio.to_thread(self._request, method, path, payload)

    # -- embeddings -------------------------------------------------------

    def embed(self, text: str) -> list[float]:
        if self._embedder is not None:
            try:
                vector = self._embedder.embed(text)
                if vector:
                    return list(vector)
            except Exception:
                pass
        return fallback_embedding(text, self._vector_size)

    # -- collection / upsert ----------------------------------------------

    async def ensure_collection(self) -> bool:
        """Create the collection if missing (idempotent)."""
        info = await self._request_async("GET", f"/collections/{self._collection}")
        if info is not None:
            return True
        created = await self._request_async(
            "PUT",
            f"/collections/{self._collection}",
            {"vectors": {"size": self._vector_size, "distance": "Cosine"}},
        )
        return created is not None

    async def _existing_ids(self, ids: Sequence[str]) -> set[str]:
        if not ids:
            return set()
        data = await self._request_async(
            "POST", f"/collections/{self._collection}/points", {"ids": list(ids)}
        )
        if not data:
            return set()
        result = data.get("result") or []
        return {str(point.get("id")) for point in result if isinstance(point, dict) and point.get("id")}

    async def ingest(self, articles: Iterable[LawArticle], batch_size: int = 128) -> IngestSummary:
        """Idempotently upsert ``articles`` in batches.

        Deterministic point ids (``uuid5(content_hash)``) make re-runs safe; an
        extra existence check lets a re-run *skip* already-indexed points and
        report the duplicate count instead of re-uploading them.
        """
        summary = IngestSummary(collection=self._collection)
        items = [article.finalize() for article in articles]
        summary.parsed = len(items)
        if not items:
            return summary

        await self.ensure_collection()
        batch_size = max(1, int(batch_size))
        for start in range(0, len(items), batch_size):
            batch = items[start : start + batch_size]
            summary.batches += 1
            ids = [article.point_id() for article in batch]
            existing = await self._existing_ids(ids)
            points = []
            for article, point_id in zip(batch, ids):
                if point_id in existing:
                    summary.skipped_duplicates += 1
                    continue
                points.append(
                    {
                        "id": point_id,
                        "vector": self.embed(f"{article.law_name} {article.article_label} {article.text}"),
                        "payload": article.payload(),
                    }
                )
            if not points:
                continue
            result = await self._request_async(
                "PUT",
                f"/collections/{self._collection}/points?wait=true",
                {"points": points},
            )
            if result is None:
                summary.status = "offline"
                summary.error = "qdrant unreachable during upsert"
                return summary
            summary.uploaded += len(points)
        return summary

    async def ingest_documents(
        self,
        documents: Iterable[tuple[str, str]],
        batch_size: int = 128,
        source_codes: Optional[dict[str, str]] = None,
    ) -> IngestSummary:
        """Parse ``(law_name, raw_text)`` documents, then ingest every article."""
        codes = source_codes or {}
        articles: list[LawArticle] = []
        for law_name, raw_text in documents:
            articles.extend(
                parse_statutory_text(
                    law_name,
                    raw_text,
                    source_code=codes.get(law_name),
                )
            )
        return await self.ingest(articles, batch_size=batch_size)


#: Minimal seed corpus so the pipeline is exercisable end-to-end without the
#: full statute bundles (real corpora are supplied by the crawler at runtime).
SEED_STATUTORY_TEXT: dict[str, str] = {
    "قانون آیین دادرسی مدنی": (
        "ماده ۵۲۲ - در دعاوی که جهات قانونی خسارت تأخیر تأدیه پیش‌بینی شده است، "
        "دادگاه با مطالبه دائن و با ملاحظه اوضاع و احوال، خسارت را تعیین می‌کند.\n"
        "تبصره - در دعاوی مربوط به چک، خسارت تأخیر از تاریخ سررسید محاسبه می‌شود."
    ),
    "قانون صدور چک": (
        "ماده ۲۳ - دارنده چک می‌تواند با اخذ گواهی عدم پرداخت، از دادگاه تقاضای صدور اجراییه کند.\n"
        "تبصره - اجراییه بر اساس اصل چک و گواهی عدم پرداخت صادر می‌شود."
    ),
    "قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲": (
        "ماده ۱۲ - دعاوی مالی تا نصاب یک میلیارد ریال در صلاحیت دادگاه صلح است."
    ),
}
