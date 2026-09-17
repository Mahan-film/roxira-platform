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
    "REPEAL_KEYWORDS",
    "STATUS_VALID",
    "STATUS_REPEALED",
    "ArticleChunker",
    "parse_statutory_text",
    "unpack_document",
    "detect_repeal",
    "normalize_text",
    "fallback_embedding",
    "Embedder",
    "LawIngester",
    "IngestSummary",
]

COLLECTION_NAME = "iran_laws_bge_m3"
VECTOR_SIZE = 1024
DEFAULT_QDRANT_URL = os.getenv("QDRANT_URL", "http://roxira_qdrant_prod:6333")
_POINT_NAMESPACE = uuid.UUID("6f1c2c9a-0d2b-4a44-9d5f-2f6a9b1c7e10")

#: Article lifecycle status persisted to Qdrant so retrieval can exclude dead law.
STATUS_VALID = "VALID"
STATUS_REPEALED = "REPEALED"

#: Keywords that mark a statutory text (or a single article) as repealed.
#: Ordered most-specific first: the first hit is reported as the repeal reason.
REPEAL_KEYWORDS: tuple[str, ...] = (
    "نسخ صریح",
    "نسخ ضمنی",
    "منسوخه",
    "منسوخ",
    "ملغی",
    "لغو شده",
    "لغو گردید",
    "باطل شده",
    "اعتبار خود را از دست",
)

#: Persian/Arabic-Indic digits → ASCII.
_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_ARTICLE_RE = re.compile(r"^\s*(?:ماده|مادّه|مادة)\s*([0-9]+)\s*[-–—:.)]?\s*(.*)$")
_TABSIREH_RE = re.compile(r"^\s*(?:تبصره|تبصرة)\s*([0-9]+)?\s*[-–—:.)]?\s*(.*)$")
#: Explicit whole-law repeal statement, e.g. «قانون ... منسوخ گردیده است».
_LAW_REPEAL_RE = re.compile(
    r"قانون[^.\n]{0,80}?(?:منسوخ|ملغی|لغو\s+شده|باطل\s+شده)", re.UNICODE
)


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


def detect_repeal(*texts: str) -> Optional[str]:
    """Detect repeal language; return the matched keyword or ``None``.

    ``منسوخ`` (repealed), ``نسخ صریح`` (express repeal) and ``ملغی`` (annulled)
    are the canonical markers used by the Iranian legislator.
    """
    blob = normalize_text(" ".join(str(text or "") for text in texts))
    if not blob:
        return None
    for keyword in REPEAL_KEYWORDS:
        if normalize_text(keyword) in blob:
            return keyword
    return None


def unpack_document(item: Any) -> tuple[str, str, bool, str, Optional[str], Optional[str]]:
    """Normalise an ingested document to ``(law_name, raw_text, is_active, status,
    repealed_by, jurisdiction)``.

    Accepts ``(law_name, raw_text)``, ``(law_name, raw_text, is_active)``,
    ``(law_name, raw_text, is_active, status, repealed_by)`` and a 6-tuple with a
    trailing ``jurisdiction``.
    """
    if isinstance(item, (str, bytes)) or item is None:
        raise ValueError(
            "هر سند باید تاپل «(law_name, raw_text)» یا "
            "«(law_name, raw_text, is_active, status, repealed_by)» باشد."
        )
    if not isinstance(item, (tuple, list)):
        raise TypeError(f"نوع سند پشتیبانی نمی‌شود: {type(item).__name__}")
    if len(item) < 2:
        raise ValueError("سند باید حداقل شامل نام قانون و متن خام باشد.")
    law_name = str(item[0] or "").strip()
    raw_text = str(item[1] or "")
    if not law_name:
        raise ValueError("نام قانون در سند الزامی است.")
    is_active = True
    if len(item) > 2 and item[2] is not None:
        is_active = bool(item[2]) if isinstance(item[2], (bool, int)) else str(item[2]).strip().lower() not in ("0", "false", "no", "خیر", "غیرفعال")
    status = STATUS_VALID
    if len(item) > 3 and item[3]:
        status = str(item[3]).strip()
    repealed_by = str(item[4]).strip() if len(item) > 4 and item[4] else None
    jurisdiction = str(item[5]).strip() if len(item) > 5 and item[5] else None
    return law_name, raw_text, is_active, status, repealed_by, jurisdiction


def _document_preamble(raw_text: str) -> str:
    """Text preceding the first ``ماده`` — where whole-law repeal notices live."""
    head: list[str] = []
    for raw_line in (raw_text or "").splitlines():
        if _ARTICLE_RE.match(normalize_text(raw_line)):
            break
        head.append(raw_line)
    return "\n".join(head)


def _resolve_status(is_active: bool, status: str) -> tuple[bool, str]:
    """Keep ``is_active`` and ``status`` consistent."""
    if not is_active and (not status or status.upper() == STATUS_VALID):
        return False, STATUS_REPEALED
    return bool(is_active), status or STATUS_VALID


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
    is_active: bool = True
    status: str = STATUS_VALID
    repealed_by: Optional[str] = None
    jurisdiction: Optional[str] = None

    @property
    def article_label(self) -> str:
        return f"ماده {self.article_no}"

    def compute_hash(self) -> str:
        return _md5(self.law_name, str(self.article_no), self.text, "|".join(self.notes))

    def finalize(self) -> "LawArticle":
        self.is_active, self.status = _resolve_status(self.is_active, self.status)
        if not self.content_hash:
            self.content_hash = self.compute_hash()
        return self

    def mark_repealed(self, repealed_by: Optional[str] = None) -> "LawArticle":
        """Mark this article as repealed so retrieval filters it out."""
        self.is_active = False
        self.status = STATUS_REPEALED
        if repealed_by:
            self.repealed_by = repealed_by
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
            "is_active": bool(self.is_active),
            "status": self.status,
            "repealed_by": self.repealed_by,
            "jurisdiction": self.jurisdiction,
        }

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["article_label"] = self.article_label
        return data


class ArticleChunker:
    """Split a statutory text into :class:`LawArticle` chunks."""

    def __init__(
        self,
        law_code: Optional[LawCode] = None,
        scope_tags: Sequence[str] = (),
        *,
        is_active: bool = True,
        status: str = STATUS_VALID,
        repealed_by: Optional[str] = None,
        jurisdiction: Optional[str] = None,
    ) -> None:
        self._code = law_code
        self._scope_tags = tuple(scope_tags) if scope_tags else (law_code.scope_tags if law_code else ())
        self._is_active = bool(is_active)
        self._status = status or STATUS_VALID
        self._repealed_by = repealed_by
        self._jurisdiction = jurisdiction

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
            # A repeal notice may live inside a single article/تبصره as well.
            article_repeal = detect_repeal(text, *notes)
            is_active = self._is_active and not article_repeal
            status = self._status
            if article_repeal and status.upper() == STATUS_VALID:
                status = STATUS_REPEALED
            article = LawArticle(
                law_name=law_name,
                article_no=int(item["no"]),
                text=text,
                notes=notes,
                scope_tags=list(self._scope_tags),
                source_code=source_code,
                is_active=is_active,
                status=status,
                repealed_by=self._repealed_by,
                jurisdiction=self._jurisdiction,
            )
            chunks.append(article.finalize())
        return chunks


def parse_statutory_text(
    law_name: Any,
    raw_text: Optional[str] = None,
    scope_tags: Sequence[str] = (),
    source_code: Optional[str] = None,
    *,
    is_active: bool = True,
    status: str = STATUS_VALID,
    repealed_by: Optional[str] = None,
    jurisdiction: Optional[str] = None,
) -> list[LawArticle]:
    """Resolve the code by ``source_code``/name and chunk a statutory document.

    Accepts either the classic ``(law_name, raw_text, ...)`` call, or a single
    document tuple ``(law_name, raw_text)`` /
    ``(law_name, raw_text, is_active, status, repealed_by)``.

    Repealed statutes are detected automatically: any ``منسوخ`` / ``نسخ صریح`` /
    ``ملغی`` notice in the preamble (or an explicit repeal statement) flips the
    whole document to ``is_active=False``; a notice inside one article only
    deactivates that article.
    """
    if raw_text is None and not isinstance(law_name, (str, bytes)):
        (
            law_name,
            raw_text,
            tuple_active,
            tuple_status,
            tuple_repealed_by,
            tuple_jurisdiction,
        ) = unpack_document(law_name)
        is_active = is_active and tuple_active
        status = tuple_status if tuple_status != STATUS_VALID else status
        repealed_by = repealed_by or tuple_repealed_by
        jurisdiction = jurisdiction or tuple_jurisdiction

    law_name = str(law_name or "").strip()
    raw_text = str(raw_text or "")

    # Whole-document repeal: preamble notice or an express «قانون ... منسوخ» line.
    repeal_reason = detect_repeal(_document_preamble(raw_text))
    if not repeal_reason and _LAW_REPEAL_RE.search(normalize_text(raw_text)):
        repeal_reason = detect_repeal(raw_text)
    if repeal_reason:
        is_active = False
        if repealed_by is None:
            repealed_by = repeal_reason

    is_active, status = _resolve_status(is_active, status)

    code = _LAW_BY_CODE.get(source_code or "") if source_code else None
    if code is None:
        code = _LAW_BY_NAME.get(normalize_text(law_name))
    chunker = ArticleChunker(
        law_code=code,
        scope_tags=scope_tags or (code.scope_tags if code else ()),
        is_active=is_active,
        status=status,
        repealed_by=repealed_by,
        jurisdiction=jurisdiction,
    )
    chunks = chunker.chunk(raw_text)
    if code is not None and normalize_text(code.law_name) != normalize_text(law_name):
        # keep the caller's label but reuse the code's scope/tags
        for chunk in chunks:
            chunk.law_name = law_name
    return chunks


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
        collection_name: str = COLLECTION_NAME,
        vector_size: int = VECTOR_SIZE,
        embedder: Optional[Embedder] = None,
        timeout: float = 30.0,
        *,
        collection: Optional[str] = None,
    ) -> None:
        if collection:
            collection_name = collection
        self._url = (
            qdrant_url or os.getenv("QDRANT_URL") or DEFAULT_QDRANT_URL
        ).rstrip("/")
        self._collection = collection_name or COLLECTION_NAME
        self._vector_size = vector_size
        self._embedder = embedder
        self._timeout = timeout

    # -- introspection ----------------------------------------------------

    @property
    def collection_name(self) -> str:
        return self._collection

    @property
    def qdrant_url(self) -> str:
        return self._url

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
        documents: Iterable[Any],
        batch_size: int = 128,
        source_codes: Optional[dict[str, str]] = None,
    ) -> IngestSummary:
        """Parse documents, then ingest every article.

        Each document is either ``(law_name, raw_text)`` or the richer
        ``(law_name, raw_text, is_active, status, repealed_by)`` tuple; repealed
        texts are flagged automatically and stored with ``is_active=False``.
        """
        codes = source_codes or {}
        articles: list[LawArticle] = []
        for document in documents:
            if isinstance(document, (str, bytes)):
                raise ValueError("هر سند باید تاپل «(law_name, raw_text)» باشد.")
            law_name, raw_text, is_active, status, repealed_by, jurisdiction = unpack_document(document)
            articles.extend(
                parse_statutory_text(
                    law_name,
                    raw_text,
                    source_code=codes.get(law_name),
                    is_active=is_active,
                    status=status,
                    repealed_by=repealed_by,
                    jurisdiction=jurisdiction,
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
