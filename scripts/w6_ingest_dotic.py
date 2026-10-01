#!/usr/bin/env python3
"""
W6 — DOTIC article-level ingest for the legal RAG corpus.

Builds article-level JSONL records for 5 of the 6 target laws from the
Hugging Face snapshot ``endomorphosis/ipfs_iran_laws`` (``data/articles.parquet``,
DOTIC's consolidated article text), and for the 3 laws the owner supplies
directly (Civil Procedure 1379, Cheque Law as amended 1397, Dispute Councils
1402) from a ``.txt``/``.docx``/``.html`` file. The JSONL can then be embedded
with the local ``BAAI/bge-m3`` model and upserted into a **non-production**
Qdrant collection (never ``iran_laws_bge_m3`` — see ``docs/W6_legal_corpus_diagnosis.md``).

Usage
-----
Build from the HF parquet snapshot (see the docstring in the repo root README
of this script's PR, or docs/W6_legal_corpus_diagnosis.md, for how to download
``data/articles.parquet``)::

    python3 scripts/w6_ingest_dotic.py \\
        --parquet data/raw/articles.parquet \\
        --build data/legal/dotic_articles_2026-09-22.jsonl --dry-run

Ingest one owner-supplied law not in the dataset (appends to the same file)::

    python3 scripts/w6_ingest_dotic.py \\
        --file /path/to/cheque_law_1397.docx \\
        --law-name "قانون صدور چک (اصلاحی ۱۳۹۷)" --law-type COMMERCIAL \\
        --build data/legal/dotic_articles_2026-09-22.jsonl --append --dry-run

Embed + upsert into a scratch collection (run inside ``roxira_app_prod``,
never against ``iran_laws_bge_m3``)::

    python3 scripts/w6_ingest_dotic.py --upsert --collection iran_laws_v2 \\
        --build data/legal/dotic_articles_2026-09-22.jsonl

Design note
-----------
Heavy dependencies (``pandas``/``pyarrow`` for reading the parquet,
``python-docx``/``bs4`` for owner files, ``sentence_transformers`` for
embedding) are imported lazily, inside the functions that need them. The pure
parsing/normalisation functions below have no such imports, so they can be
unit-tested (see ``src/legal_intelligence/test_w6_dotic_ingest.py``) without
those packages installed. This also matches what ``roxira_app_prod`` actually
has: ``pandas`` and ``sentence_transformers`` are installed there, but
``pyarrow`` is not — which is fine, because ``--upsert`` only ever reads the
already-built JSONL, never the parquet.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any


# Articles 51 and 53–71 were declared invalid by the 1403/11/15 law.
INVALID_ARTICLES = {
    "لایحه اصلاحی قانون تجارت": {51, *range(53, 72)},
    "لایحه قانونی اصلاح قسمتی از قانون تجارت": {51, *range(53, 72)},
}


def filter_records(
    records: list[dict],
    drop_inactive: bool = True,
    invalid_articles: dict[str, set[int]] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Split Dotic records into corpus-eligible and excluded records."""
    invalid_articles = invalid_articles or {}
    kept: list[dict] = []
    dropped: list[dict] = []

    for record in records:
        article_no = str(record.get("article_no", ""))
        article_part = article_no.split("-", 1)[0]
        try:
            article_number = int(article_part)
        except (TypeError, ValueError):
            article_number = None

        is_invalid = article_number in invalid_articles.get(record.get("law_name"), set())
        if (drop_inactive and record.get("is_active") is False) or is_invalid:
            dropped.append(record)
        else:
            kept.append(record)

    return kept, dropped

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant_prod:6333")
VECTOR_SIZE = 1024
PRODUCTION_COLLECTION = "iran_laws_bge_m3"
# Same namespace the W6 cheque-law PoC (scripts/w6_cheque_law_v2.py) used, so
# point ids stay stable/comparable across the two ingestion scripts.
NAMESPACE = uuid.UUID("6f1c2c9a-0d2b-4a44-9d5f-2f6a9b1c7e10")
DOTIC_SOURCE = "dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22"

# HF ipfs_iran_laws law_id -> (law_name exactly as the eval/engine expect, law_type)
LAW_CONFIG: dict[str, dict[str, str]] = {
    "ir-5580": {"law_name": "قانون مدنی", "law_type": "CIVIL"},
    "ir-news-5324": {"law_name": "قانون مجازات اسلامی", "law_type": "CRIMINAL"},
    "ir-5584": {"law_name": "قانون آیین دادرسی کیفری", "law_type": "PROCEDURE"},
    "ir-news-5274": {"law_name": "قانون تجارت", "law_type": "COMMERCIAL"},
    "ir-news-4862": {"law_name": "لایحه اصلاحی قانون تجارت", "law_type": "COMMERCIAL"},
}
# Explicitly ignored per docs/STRATEGY.md §5 priority 1:
#   ir-news-5580 (exact duplicate of ir-5580), ir-news-5584 (duplicate of
#   ir-5584), ir-news-4321 (partial copy).

DEFAULT_MAX_CHUNK_LEN = 1500

# ─────────────────────────────────────────────────────────────────────────────
# Pure text normalisation / parsing (no heavy deps — unit tested)
# ─────────────────────────────────────────────────────────────────────────────

_CHAR_MAP = str.maketrans({"ي": "ی", "ك": "ک"})
_PAGE_MARKER_RE = re.compile(r"©\s*[0-9۰-۹]+\s*©")
# Control characters seen in the raw DOTIC scrape (e.g. "(\x02)"), excluding
# the \n and \t we rely on for paragraph structure.
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
_NUM_RE = re.compile(r"[0-9۰-۹]+")
_MOKARRAR_RE = re.compile(r"مكرر|مکرر")
_AMEND_RE = re.compile(
    r"(?:اصلاحي|اصلاحی)\s*([0-9۰-۹]{1,2})\s*/\s*([0-9۰-۹]{1,2})\s*/\s*([0-9۰-۹]{2,4})"
)
_REPEAL_RE = re.compile(
    r"حذف\s*شده|نسخ\s*شده|منسوخ|ابطال\s*شده|خلاف\s*موازين\s*شرع|خلاف\s*موازین\s*شرع"
)
_ARTICLE_HEADER_RE = re.compile(
    r"(?m)^\s*ماده\s*([0-9۰-۹]+(?:\s*(?:مكرر|مکرر))?)\s*[-–—:.٫]?\s*"
)


def to_latin_digits(s: str) -> str:
    """Persian digits -> Latin digits. Does not touch anything else."""
    return (s or "").translate(_PERSIAN_DIGITS)


def normalize_text(text: str) -> str:
    """ي→ی, ك→ک, strip ``©N©`` page markers and control chars, collapse whitespace.

    Deliberately does not attempt to reconstruct lost ZWNJs (half-spaces) —
    the DOTIC scrape does not have them, and guessing would be worse than
    leaving words run together.
    """
    if not text:
        return ""
    t = text.translate(_CHAR_MAP)
    t = _PAGE_MARKER_RE.sub("", t)
    t = _CONTROL_CHAR_RE.sub("", t)
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t]+", " ", t)  # collapse runs of spaces/tabs, keep newlines
    t = re.sub(r"\n{3,}", "\n\n", t)  # collapse 3+ blank lines to one paragraph break
    t = re.sub(r" *\n *", "\n", t)  # trim spaces around newlines
    return t.strip()


def extract_amended_on(text: str) -> str | None:
    """Parse ``(اصلاحي dd/mm/yyyy)`` into an ISO-ish ``yyyy-mm-dd`` string (Persian calendar)."""
    m = _AMEND_RE.search(text or "")
    if not m:
        return None
    day, month, year = (int(to_latin_digits(g)) for g in m.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def detect_status(text: str) -> str:
    """Best-effort REPEALED/VALID classification from repeal phrasing in the body.

    Approximate: catches the common DOTIC phrasing ("حذف شده است", "منسوخ",
    a Guardian Council ابطال note) but is not a substitute for legal review.
    """
    return "REPEALED" if _REPEAL_RE.search(text or "") else "VALID"


def derive_article_no(raw_article_number: str, article_text: str) -> str:
    """Base article number (Latin digits) plus a ``-mokarrar`` suffix when the
    article body itself is headed "ماده N مکرر" (a supplementary article that
    shares its base number with the original — the source of the Civil
    Code's 4 duplicate numbers: 218, 881, 1313, 1328).
    """
    m = _NUM_RE.search(raw_article_number or "")
    base = to_latin_digits(m.group(0)) if m else "0"
    header = (article_text or "")[:40]
    is_mokarrar = bool(_MOKARRAR_RE.search(header))
    return f"{base}-mokarrar" if is_mokarrar else base


def split_long_text(text: str, max_len: int = DEFAULT_MAX_CHUNK_LEN) -> list[str]:
    """Split article text longer than ``max_len`` chars into chunks.

    Prefers paragraph breaks (تبصره/بند boundaries survive as ``\\n\\n``);
    falls back to sentence-ish boundaries (``.``/``؛``) inside an
    over-length paragraph. Never drops text.
    """
    text = text or ""
    if len(text) <= max_len:
        return [text] if text else [""]

    paragraphs = [p for p in text.split("\n\n") if p.strip()] or [text]
    chunks: list[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current.strip():
            chunks.append(current.strip())
        current = ""

    for para in paragraphs:
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= max_len:
            current = candidate
            continue
        flush()
        if len(para) <= max_len:
            current = para
            continue
        # Paragraph itself is too long: split on sentence-ish boundaries.
        pieces = re.split(r"(?<=[.؛])\s+", para)
        piece = ""
        for p in pieces:
            cand = f"{piece} {p}".strip() if piece else p
            if len(cand) <= max_len:
                piece = cand
            else:
                if piece:
                    chunks.append(piece.strip())
                piece = p
        if piece:
            chunks.append(piece.strip())
    flush()
    return chunks or [text]


def dedupe_articles(
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve (law_id, article_no) collisions that ``derive_article_no`` did not
    already separate via the ``-mokarrar`` suffix (e.g. the Commerce Code rows
    where two unrelated documents were scraped under one law_id and both
    restart their numbering at "ماده 1"/"ماده 2").

    Keeps the longer text per colliding key (ties broken by later file
    position, since the DOTIC scrape tends to place the complete/canonical
    version after a shorter preface fragment). Returns ``(kept, dropped)``.
    """
    groups: dict[tuple[Any, str], list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for idx, row in enumerate(rows):
        groups[(row["law_id"], row["article_no"])].append((idx, row))

    kept_idx = set()
    dropped: list[dict[str, Any]] = []
    for _, items in groups.items():
        if len(items) == 1:
            kept_idx.add(items[0][0])
            continue
        best_idx, _best_row = max(items, key=lambda pair: (len(pair[1]["text"]), pair[0]))
        kept_idx.add(best_idx)
        for idx, row in items:
            if idx != best_idx:
                dropped.append(row)

    kept = [row for idx, row in enumerate(rows) if idx in kept_idx]
    return kept, dropped


def find_missing_numbers(article_nos: Iterable[str]) -> list[int]:
    """Gaps in the numeric article range (e.g. Civil Code 1306-1308/1310-1311,
    repealed and dropped entirely from the DOTIC scrape)."""
    nums = set()
    for a in article_nos:
        base = a.split("-mokarrar")[0]
        if base.isdigit():
            nums.add(int(base))
    if not nums:
        return []
    lo, hi = min(nums), max(nums)
    return [n for n in range(lo, hi + 1) if n not in nums]


def content_hash(text: str) -> str:
    return hashlib.md5((text or "").encode("utf-8")).hexdigest()


def build_point_id(law_key: str, article_no: str, chunk_index: int) -> str:
    """Deterministic Qdrant point id from law + article + chunk (stable re-upserts)."""
    return str(uuid.uuid5(NAMESPACE, f"{law_key}:{article_no}:{chunk_index}"))


def split_amending_law_by_ordinal(raw_text: str) -> list[tuple[str, str]]:
    """Split an amending law, leaving quoted article headings in their body."""
    text = normalize_text(raw_text)
    articles: list[tuple[str, str]] = []
    expected = 1
    current_no: str | None = None
    current_start = 0

    for match in _ARTICLE_HEADER_RE.finditer(text):
        article_no = to_latin_digits(match.group(1))
        if "مکرر" in match.group(0) or article_no != str(expected):
            continue
        if current_no is not None:
            articles.append((current_no, text[current_start:match.start()].strip()))
        current_no = article_no
        current_start = match.end()
        expected += 1

    if current_no is not None:
        articles.append((current_no, text[current_start:].strip()))
    return articles


def split_owner_text_by_articles(raw_text: str) -> list[tuple[str, str]]:
    if globals().get("_AMENDING_FILE_MODE", False):
        return split_amending_law_by_ordinal(raw_text)
    """Split an owner-supplied plain-text law into ``(article_no, body)`` pairs
    on "ماده N" / "ماده N مکرر" headings. Used for the 3 laws not in the HF
    dataset (Civil Procedure 1379, Cheque Law 1397, Dispute Councils 1402).
    """
    text = normalize_text(raw_text)
    matches = list(_ARTICLE_HEADER_RE.finditer(text))
    if not matches:
        return []
    pairs: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        num_raw = m.group(1)
        is_mokarrar = bool(_MOKARRAR_RE.search(num_raw))
        num_match = _NUM_RE.search(num_raw)
        num = to_latin_digits(num_match.group(0)) if num_match else "0"
        article_no = f"{num}-mokarrar" if is_mokarrar else num
        body = text[start:end].strip()
        pairs.append((article_no, body))
    return pairs


def _record_text(
    law_name: str, label: str, chunk_text: str, chunk_index: int, total_chunks: int
) -> str:
    if total_chunks == 1:
        return f"{label} {law_name}: {chunk_text}"
    return f"{label} {law_name} (بخش {chunk_index + 1} از {total_chunks}): {chunk_text}"


def _article_label(article_no: str) -> str:
    return f"ماده {article_no.replace('-mokarrar', ' مکرر')}"


def _build_records_for_article(
    law_id: str | None,
    law_name: str,
    law_type: str,
    article_no: str,
    body: str,
    source_url: str,
    source: str,
    approval_date: str | None,
    source_tier: str = "secondary",
    max_chunk_len: int = DEFAULT_MAX_CHUNK_LEN,
) -> list[dict[str, Any]]:
    label = _article_label(article_no)
    amended_on = extract_amended_on(body)
    status = detect_status(body)
    chunks = split_long_text(body, max_chunk_len)
    records = []
    for i, chunk_text in enumerate(chunks):
        title = f"{law_name} - {label}"
        if len(chunks) > 1:
            title += f" (بخش {i + 1})"
        records.append(
            {
                "law_id": law_id,
                "law_name": law_name,
                "law_type": law_type,
                "article_no": article_no,
                "article_label": label,
                "chapter": None,
                "amended_on": amended_on,
                "approval_date": approval_date,
                "status": status,
                "is_active": status != "REPEALED",
                "source_url": source_url,
                "source_tier": source_tier,
                "source": source,
                "content_hash": content_hash(chunk_text),
                "chunk_index": i,
                "text": _record_text(law_name, label, chunk_text, i, len(chunks)),
                "title": title,
                "category": law_type,
                "scope_tags": [law_type.lower()],
            }
        )
    return records


# ─────────────────────────────────────────────────────────────────────────────
# Parquet-backed build (lazy pandas import)
# ─────────────────────────────────────────────────────────────────────────────

def build_records_from_parquet(
    parquet_path: str,
    law_ids: Sequence[str] | None = None,
    max_chunk_len: int = DEFAULT_MAX_CHUNK_LEN,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    import pandas as pd  # lazy: only --build needs pandas/pyarrow

    law_ids = list(law_ids or LAW_CONFIG.keys())
    df = pd.read_parquet(parquet_path)
    df = df[df["law_id"].isin(law_ids)].reset_index(drop=True)

    raw_rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        law_id = row["law_id"]
        cfg = LAW_CONFIG.get(law_id)
        if not cfg:
            continue
        text = normalize_text(str(row["text"]))
        article_no = derive_article_no(str(row["article_number"]), text)
        raw_rows.append(
            {
                "law_id": law_id,
                "law_name": cfg["law_name"],
                "law_type": cfg["law_type"],
                "article_no": article_no,
                "text": text,
                "source_url": str(row.get("source_url") or ""),
            }
        )

    kept, dropped = dedupe_articles(raw_rows)

    records: list[dict[str, Any]] = []
    for row in kept:
        records.extend(
            _build_records_for_article(
                law_id=row["law_id"],
                law_name=row["law_name"],
                law_type=row["law_type"],
                article_no=row["article_no"],
                body=row["text"],
                source_url=row["source_url"],
                source=DOTIC_SOURCE,
                approval_date=None,
                source_tier="official",
                max_chunk_len=max_chunk_len,
            )
        )
    return records, dropped


# ─────────────────────────────────────────────────────────────────────────────
# Owner-file build (.txt / .docx / .html — lazy python-docx / bs4 import)
# ─────────────────────────────────────────────────────────────────────────────

def read_owner_file(path: str) -> str:
    p = Path(path)
    suffix = p.suffix.lower()
    if suffix == ".txt":
        return p.read_text(encoding="utf-8")
    if suffix == ".docx":
        import docx  # lazy

        document = docx.Document(str(p))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    if suffix in (".html", ".htm"):
        from bs4 import BeautifulSoup  # lazy

        soup = BeautifulSoup(p.read_text(encoding="utf-8"), "html.parser")
        return soup.get_text("\n")
    raise ValueError(f"unsupported file extension {suffix!r}; use .txt, .docx or .html")


def build_records_from_file(
    path: str,
    law_name: str,
    law_type: str,
    source_url: str | None = None,
    approval_date: str | None = None,
    source_tier: str = "secondary",
    max_chunk_len: int = DEFAULT_MAX_CHUNK_LEN,
) -> list[dict[str, Any]]:
    raw_text = read_owner_file(path)
    pairs = split_owner_text_by_articles(raw_text)
    records: list[dict[str, Any]] = []
    for article_no, body in pairs:
        records.extend(
            _build_records_for_article(
                law_id=None,
                law_name=law_name,
                law_type=law_type,
                article_no=article_no,
                body=body,
                source_url=source_url or "owner-supplied",
                source="owner-supplied file",
                approval_date=approval_date,
                source_tier=source_tier,
                max_chunk_len=max_chunk_len,
            )
        )
    return records


# ─────────────────────────────────────────────────────────────────────────────
# Dry-run report
# ─────────────────────────────────────────────────────────────────────────────

def print_dry_run_report(records: list[dict[str, Any]], dropped: list[dict[str, Any]]) -> None:
    by_law: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in records:
        by_law[r["law_name"]].append(r)

    print("=== W6 DOTIC ingest — dry run ===")
    for law_name, recs in by_law.items():
        article_nos = sorted({r["article_no"] for r in recs})
        missing = find_missing_numbers(article_nos)
        extra_chunks = sum(1 for r in recs if r["chunk_index"] > 0)
        missing_preview = missing[:20]
        suffix = "..." if len(missing) > 20 else ""
        print(
            f"- {law_name}: {len(recs)} points, {len(article_nos)} unique article numbers, "
            f"{extra_chunks} extra chunks from long articles, "
            f"missing numbers in range: {missing_preview}{suffix}"
        )

    if dropped:
        print(f"\nduplicate article numbers dropped (kept the longer text): {len(dropped)}")
        for r in dropped[:10]:
            print(f"  - law_id={r['law_id']} article_no={r['article_no']} len={len(r['text'])}")
        if len(dropped) > 10:
            print(f"  ... and {len(dropped) - 10} more")

    print("\n--- 3 sample payloads ---")
    for r in records[:3]:
        print(json.dumps(r, ensure_ascii=False, indent=2))


# ─────────────────────────────────────────────────────────────────────────────
# Qdrant REST + embedding (lazy sentence_transformers import) — only for --upsert
# ─────────────────────────────────────────────────────────────────────────────

def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def _put(url: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method="PUT")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def ensure_collection(collection: str) -> None:
    try:
        info = _get(f"{QDRANT_URL}/collections/{collection}")
        print(f"[dotic] collection {collection} exists: {info['result']['points_count']} points")
        return
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
    print(f"[dotic] creating collection {collection} (size={VECTOR_SIZE}, cosine)")
    vectors_config = {"size": VECTOR_SIZE, "distance": "Cosine"}
    _put(f"{QDRANT_URL}/collections/{collection}", {"vectors": vectors_config})


def embed_texts(texts: list[str]) -> list[list[float]]:
    from sentence_transformers import SentenceTransformer  # lazy

    print("[dotic] loading BAAI/bge-m3 (local, CPU) ...")
    model = SentenceTransformer("BAAI/bge-m3")
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)
    return [v.tolist() for v in vectors]


def run_upsert(jsonl_path: Path, collection: str) -> int:
    records = []
    with jsonl_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    if not records:
        print("[dotic] no records to upsert")
        return 1

    ensure_collection(collection)
    texts = [r["text"] for r in records]
    print(f"[dotic] embedding {len(texts)} chunks ...")
    vectors = embed_texts(texts)

    points = []
    for r, v in zip(records, vectors, strict=True):
        law_key = r.get("law_id") or r["law_name"]
        point_id = build_point_id(law_key, r["article_no"], r["chunk_index"])
        points.append({"id": point_id, "vector": v, "payload": r})

    batch_size = 200
    for i in range(0, len(points), batch_size):
        batch = points[i : i + batch_size]
        resp = _put(f"{QDRANT_URL}/collections/{collection}/points?wait=true", {"points": batch})
        print(f"[dotic] upserted {i}-{i + len(batch)}/{len(points)}: {resp.get('status')}")

    info = _get(f"{QDRANT_URL}/collections/{collection}")
    print(f"[dotic] {collection} now has {info['result']['points_count']} points")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--parquet", default="data/raw/articles.parquet",
        help="HF endomorphosis/ipfs_iran_laws articles.parquet path",
    )
    parser.add_argument(
        "--build", metavar="PATH",
        help="Output JSONL path (build mode); input JSONL path with --upsert",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print per-law counts, missing/duplicate article numbers, 3 sample payloads",
    )
    parser.add_argument(
        "--upsert", action="store_true",
        help="Embed with local BAAI/bge-m3 and upsert --build's JSONL into --collection",
    )
    parser.add_argument(
        "--collection", help="Target Qdrant collection for --upsert (never iran_laws_bge_m3)"
    )
    parser.add_argument(
        "--file", help="Owner-supplied .txt/.docx/.html for one law not in the HF snapshot"
    )
    parser.add_argument("--law-name", help="Required with --file")
    parser.add_argument("--law-type", help="Required with --file (e.g. PROCEDURE, COMMERCIAL)")
    parser.add_argument("--source-url", default=None)
    parser.add_argument("--approval-date", default=None)
    parser.add_argument(
        "--source-tier",
        choices=("official", "secondary"),
        default="secondary",
        help="Trust tier for --file records (parquet/DOTIC records are always official)",
    )
    parser.add_argument(
        "--append", action="store_true",
        help="Append to --build's output file instead of overwriting",
    )
    parser.add_argument("--max-chunk-len", type=int, default=DEFAULT_MAX_CHUNK_LEN)
    parser.add_argument(
        "--keep-inactive",
        action="store_true",
        help="Keep records explicitly marked inactive (default: drop them).",
    )
    parser.add_argument(
        "--amending",
        action="store_true",
        help="Split --file input as an ordinal-numbered amending law.",
    )
    args = parser.parse_args()
    globals()["_AMENDING_FILE_MODE"] = args.amending and args.file is not None

    if args.upsert:
        if not args.collection:
            parser.error("--upsert requires --collection")
        if args.collection == PRODUCTION_COLLECTION:
            parser.error(
                f"refusing to upsert into the production collection {PRODUCTION_COLLECTION!r}; "
                "use a scratch collection such as iran_laws_v2"
            )
        if not args.build:
            parser.error("--upsert requires --build PATH pointing at an already-built JSONL file")
        return run_upsert(Path(args.build), args.collection)

    if args.file:
        if not args.law_name or not args.law_type:
            parser.error("--file requires --law-name and --law-type")
        records = build_records_from_file(
            args.file, args.law_name, args.law_type,
            source_url=args.source_url, approval_date=args.approval_date,
            source_tier=args.source_tier,
            max_chunk_len=args.max_chunk_len,
        )
        dropped: list[dict[str, Any]] = []
    else:
        records, dropped = build_records_from_parquet(
            args.parquet, max_chunk_len=args.max_chunk_len
        )

    if args.build:
        records, filtered_dropped = filter_records(
            records,
            drop_inactive=not args.keep_inactive,
            invalid_articles=INVALID_ARTICLES,
        )
        print(f"[dotic] dropped {len(filtered_dropped)} inactive/invalid records")

    if not args.dry_run and not args.build:
        parser.error("nothing to do: pass --dry-run and/or --build PATH")

    if args.dry_run:
        print_dry_run_report(records, dropped)
        if args.build:
            print(f"[dotic] dry run: not writing {args.build}")

    if args.build and not args.dry_run:
        out_path = Path(args.build)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if args.append else "w"
        with out_path.open(mode, encoding="utf-8") as fh:
            for r in records:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"[dotic] wrote {len(records)} records to {out_path} (mode={mode})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
