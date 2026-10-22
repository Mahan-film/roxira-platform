#!/usr/bin/env python3
# ruff: noqa: RUF001, RUF002
"""Build the next served legal collection ``iran_laws_v7`` = ``iran_laws_v6`` + staged rows.

This is the Python counterpart of the v6 build (``build_v4_on_server.sh``, run as
``DST=iran_laws_v6``): it merges the staged proposed rows with the current collection and
writes a NEW collection only. It reuses the v6 build pieces under ``scripts/legal/``
(``ingest_pipeline`` for norm/point_id/embed and ``build_collection`` for the read-only
scroll) instead of copying them.

Staged inputs (``data/legal/staged/``): ``sync_sources_*`` (nezamat/ekhtebar new laws),
``iran_relay_*``, ``rc_laws_*``, ``law_watch_*`` and ``ekhtebar_api_tag_*``.
``*.repealed.jsonl``, ``*_review.jsonl`` and ``unity_rulings_*`` are never selected — the
same exclusions apply to explicit ``--files`` and to the ``--staged-dir`` globs.

Selection rules (see :func:`split_rows`):
  * ``status``/``staging_status`` is ``proposed``, the row is not repealed/inactive and its
    normalised text is at least ``MIN_TEXT_CHARS`` long;
  * the laws collection is STATUTES ONLY — rows that are CBI circulars / بخشنامه /
    دستورالعمل / tax opinions, or rows with a ``title`` but no ``law_name``, are routed to a
    SEPARATE regulations plan (``--target regulations``) for ``iran_regulations_v3`` and never
    reach ``iran_laws_v7``; rows with neither ``law_name`` nor ``title`` are dropped;
  * news-like titles and «رأی شماره»/«رای شماره» rulings are dropped and counted;
  * rows already present in ``iran_laws_v6`` with the same normalised text are skipped
    (``already_in_v6``);
  * rows are deduped by ``(normalised law_name, article_no)``. Texts whose hard-normalised
    similarity (``difflib`` ratio >= 0.97) is near-identical are the SAME text and only one
    survives, by source priority rc.majlis > qavanin > nezamat > ekhtebar > dotic > others.
    Only real differences stay in ``<out>/v7_conflicts.md``.

Embedding uses the Cloudflare Workers AI path (``EMBED_BACKEND=cf``, ``@cf/baai/bge-m3``,
1024-d, L2-normalised, parity 1.0 vs TEI proven 2026-10-22) in batches of 50 with retry,
falling back to the v6 TEI/local embedder on any error.

Safety:
  * ``--dry-run`` is the default; it writes NOTHING to Qdrant (only ``--out`` files);
  * ``--apply`` creates a NEW collection and never reads/writes ``iran_laws_v6`` except the
    read-only scroll; ``iran_laws_v6`` / ``iran_laws_v2`` are refused as targets;
  * nothing under ``data/`` is ever modified; ``--out`` must be outside ``data/``;
  * no law text is printed — reports are counts, law names and paths only.

  build_v7.py --out /tmp/v7 [--files FILE ...]                  # laws dry-run (default)
  build_v7.py --out /tmp/v7 --target regulations [--files ...]  # regulations dry-run
  EMBED_BACKEND=cf build_v7.py --apply --collection iran_laws_v7 --out /tmp/v7
"""

from __future__ import annotations

import argparse
import difflib
import importlib.util
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, rel: str):
    """Import a sibling script under scripts/legal/ once (same pattern as dedupe_staged_rows)."""
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    path = ROOT / rel
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ip = _load("ingest_pipeline", "scripts/legal/ingest_pipeline.py")
bc = _load("build_collection", "scripts/legal/build_collection.py")
Refusal = ip.Refusal

STAGED_DIR = ROOT / "data" / "legal" / "staged"
DEFAULT_PATTERNS = (
    "sync_sources_*.jsonl",
    "iran_relay_*.jsonl",
    "rc_laws_*.jsonl",
    "law_watch_*.jsonl",
    "ekhtebar_api_tag_*.jsonl",
)
EXCLUDE_SUFFIXES = (".repealed.jsonl", "_review.jsonl")
EXCLUDE_PREFIXES = ("unity_rulings_",)
REPEALED_STATUSES = ip.REPEALED_STATUSES | {"ANNULLED"}
PROPOSED = "proposed"
MIN_TEXT_CHARS = 30
BATCH = 50

# Row routing (rule 1/3). ``--target laws`` keeps statutes only; regulations go to their
# own plan (``iran_regulations_v3``) and are never written into ``iran_laws_v7``.
SOURCES_REGULATION = frozenset({"cbi_pdf", "owner_upload_cbi_circular", "taxreg"})
DOC_TYPES_REGULATION = frozenset({"circular", "opinion", "tax_opinion", "directive"})
LAW_TYPES_STATUTE = frozenset({"law", "statute", "قانون", "آیین نامه", "آییننامه"})
LAW_TYPES_REGULATION = frozenset({"regulation"})
TITLE_PREFIXES_REGULATION = (
    "بخشنامه",
    "دستورالعمل",
    "شیوه نامه",
    "شیوهنامه",
    "ابلاغیه",
    "مصوبه",
    "نظر",
)
TITLE_NEWS_MARKERS = ("منتشر می شود", "ابلاغ شد", "خبر", "به زودی")
TITLE_RULING_PREFIXES = ("رأی شماره", "رای شماره")

# Near-identical texts (rule 2): hard-normalised difflib ratio at/above this is the SAME text.
SIMILARITY_THRESHOLD = 0.97
SOURCE_PRIORITY = ("rc.majlis", "qavanin", "nezamat", "ekhtebar", "dotic")

# Output targets: ``--target laws`` -> iran_laws_v7, ``regulations`` -> iran_regulations_v3.
TARGET_LAWS = "laws"
TARGET_REGULATIONS = "regulations"
DEFAULT_COLLECTIONS = {TARGET_LAWS: "iran_laws_v7", TARGET_REGULATIONS: "iran_regulations_v3"}

# Cloudflare Workers AI embedding path (mirrors legal_graph/lightrag_engine.py cf backend).
CF_EMBED_MODEL = "@cf/baai/bge-m3"
CF_EMBED_DIM = 1024
CF_EMBED_URL = "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/" + CF_EMBED_MODEL
CF_EMBED_TIMEOUT = float(os.environ.get("CF_EMBED_TIMEOUT", "30"))
CF_EMBED_RETRIES = int(os.environ.get("CF_EMBED_RETRIES", "4"))
CHARS_PER_TOKEN = 3  # conservative bge-m3 estimate for mixed Persian/Latin text


# ----------------------------------------------------------------------------- row helpers
def row_text(row: dict) -> str:
    return str(row.get("text") or "").strip()


def row_law_name(row: dict) -> str:
    return str(row.get("law_name") or row.get("title") or "").strip()


def row_title(row: dict) -> str:
    return str(row.get("title") or "").strip()


def has_law_name(row: dict) -> bool:
    return bool(str(row.get("law_name") or "").strip())


def has_title(row: dict) -> bool:
    return bool(row_title(row))


def row_article_no(row: dict) -> str:
    art = row.get("article_no")
    if art not in (None, ""):
        return str(art).strip()
    m = re.search(r"\d+", str(row.get("article_label") or ""))
    return m.group(0) if m else ""


def row_source(row: dict) -> str:
    src = str(row.get("source") or row.get("source_label") or "").strip()
    src = re.sub(r"\.ir$", "", src)
    return src or "unknown"


def row_stamp(row: dict) -> str:
    """Newest-wins stamp; ISO date/time strings compare lexicographically."""
    for key in (
        "amended_on",
        "retrieved_at",
        "fetched_at",
        "modified_at",
        "published_at",
        "approval_date",
        "date",
    ):
        value = row.get(key)
        if value:
            return str(value)
    return ""


def row_key(row: dict) -> tuple[str, str]:
    """Dedupe key: normalised (law_name, article_no)."""
    return (ip.norm_name(row_law_name(row)), ip.norm_name(row_article_no(row)))


def is_proposed(row: dict) -> bool:
    fields = (row.get("status"), row.get("staging_status"))
    return any(str(v or "").strip().lower() == PROPOSED for v in fields)


def is_repealed(row: dict) -> bool:
    if row.get("is_active") is False:
        return True
    for key in ("status", "page_status", "staging_status"):
        if str(row.get(key) or "").strip().upper() in REPEALED_STATUSES:
            return True
    return False


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / CHARS_PER_TOKEN))


# ----------------------------------------------------------------------------- text compare
def normalise_text(text: str) -> str:
    """Hard normalisation for text comparison (rule 2).

    Canonicalises Arabic/Persian letters and digits, drops ZWNJ, then keeps only letters and
    numbers (whitespace, punctuation and symbols removed) so near-identical texts collapse.
    """
    translated = str(text or "").translate(ip._TRANS)
    return "".join(ch for ch in translated if unicodedata.category(ch)[0] in ("L", "N"))


def text_ratio(a: str, b: str) -> float:
    """difflib ratio over hard-normalised text (1.0 when both normalise to the same string)."""
    na, nb = normalise_text(a), normalise_text(b)
    if na == nb:
        return 1.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


def same_text(a: str, b: str, threshold: float = SIMILARITY_THRESHOLD) -> bool:
    """True when two texts are the SAME under hard normalisation (ratio >= threshold)."""
    return text_ratio(a, b) >= threshold


def source_rank(row: dict) -> int:
    """Source priority rc.majlis > qavanin > nezamat > ekhtebar > dotic > others.

    Lower is better.
    """
    rank = SOURCE_PRIORITY.index(row_source(row)) if row_source(row) in SOURCE_PRIORITY else None
    return len(SOURCE_PRIORITY) if rank is None else rank


def _starts_with(title: str, prefixes: tuple[str, ...]) -> bool:
    norm = ip.norm_name(title)
    return any(norm.startswith(ip.norm_name(p)) for p in prefixes)


def is_regulation_row(row: dict) -> bool:
    """CBI circulars / بخشنامه / دستورالعمل / tax opinions (rule 1)."""
    law_type = ip.norm_name(row.get("law_type") or "").lower()
    doc_type = str(row.get("doc_type") or "").strip().lower()
    return (
        law_type in LAW_TYPES_REGULATION
        or doc_type in DOC_TYPES_REGULATION
        or row_source(row) in SOURCES_REGULATION
        or _starts_with(row_title(row), TITLE_PREFIXES_REGULATION)
    )


def is_non_statute_kind(row: dict) -> str:
    """Return ``ruling``/``news`` when the title clearly is not statute material (rule 3)."""
    title = row_title(row)
    if _starts_with(title, TITLE_RULING_PREFIXES):
        return "ruling"
    norm = ip.norm_name(title)
    if any(ip.norm_name(m) in norm for m in TITLE_NEWS_MARKERS):
        return "news"
    return ""


def classify_row(row: dict) -> str:
    """Route a staged row: ``statute`` | ``regulation`` | ``ruling`` | ``news`` | ``empty``."""
    kind = is_non_statute_kind(row)
    if kind:
        return kind
    if not has_law_name(row) and not has_title(row):
        return "empty"
    if is_regulation_row(row):
        return "regulation"
    if ip.norm_name(row.get("law_type") or "").lower() in LAW_TYPES_STATUTE:
        return "statute"
    if not has_law_name(row):
        return "regulation"  # a title but no law_name is a regulation, never a statute
    return "statute"


# ----------------------------------------------------------------------------- selection
def select_rows(rows: list[dict]) -> tuple[list[dict], Counter]:
    """Keep proposed, active rows with enough text. Returns (kept, drop reason counts)."""
    kept: list[dict] = []
    dropped: Counter = Counter()
    for row in rows:
        if not is_proposed(row):
            dropped["not_proposed"] += 1
            continue
        if is_repealed(row):
            dropped["repealed"] += 1
            continue
        if len(row_text(row)) < MIN_TEXT_CHARS:
            dropped["short_text"] += 1
            continue
        kept.append(row)
    return kept, dropped


def split_rows(rows: list[dict]) -> tuple[list[dict], list[dict], Counter]:
    """Filter and route staged rows into (statutes, regulations, drop reason counts).

    Applies the base selection (proposed/active/long) and then rules 1 & 3: non-statute news
    and rulings are dropped (counted separately), ``بخشنامه``/``دستورالعمل``/CBI/tax-opinion
    and title-only rows go to the regulations plan, and rows with neither ``law_name`` nor
    ``title`` are dropped.
    """
    statutes: list[dict] = []
    regulations: list[dict] = []
    dropped: Counter = Counter()
    for row in rows:
        if not is_proposed(row):
            dropped["not_proposed"] += 1
            continue
        if is_repealed(row):
            dropped["repealed"] += 1
            continue
        if len(row_text(row)) < MIN_TEXT_CHARS:
            dropped["short_text"] += 1
            continue
        kind = classify_row(row)
        if kind == "statute":
            statutes.append(row)
        elif kind == "regulation":
            regulations.append(row)
        elif kind == "ruling":
            dropped["ruling"] += 1
        elif kind == "news":
            dropped["news"] += 1
        else:
            dropped["no_name_or_title"] += 1
    return statutes, regulations, dropped


def _pick_winner(rows: list[dict]) -> dict:
    """Best row of a group: source priority first, newest stamp then last occurrence."""
    best = rows[0]
    for row in rows[1:]:
        rank_ok = source_rank(row) < source_rank(best)
        equal = source_rank(row) == source_rank(best)
        if rank_ok or (equal and row_stamp(row) >= row_stamp(best)):
            best = row
    return best


def _text_clusters(rows: list[dict]) -> list[list[dict]]:
    """Group rows whose texts are the SAME (hard-normalised similarity >= threshold)."""
    clusters: list[list[dict]] = []
    for row in rows:
        for cluster in clusters:
            if same_text(row_text(row), row_text(cluster[0])):
                cluster.append(row)
                break
        else:
            clusters.append([row])
    return clusters


def dedupe_rows(rows: list[dict]) -> list[dict]:
    """One row per (law, article_no) key; near-identical texts collapse by source priority.

    Output keeps last-occurrence order. For a key with several real (non-similar) texts the
    overall best row (priority then stamp) survives; the difference is reported separately.
    """
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        groups[row_key(row)].append(row)
    winners = {key: _pick_winner(group) for key, group in groups.items()}
    keep = {id(row) for row in winners.values()}
    return [row for row in rows if id(row) in keep]


def find_conflicts(rows: list[dict]) -> list[tuple[tuple[str, str], list[dict]]]:
    """Same (law, article_no) key carrying more than one SAME-text cluster."""
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        groups[row_key(row)].append(row)
    conflicts: list[tuple[tuple[str, str], list[dict]]] = []
    for key, group in groups.items():
        clusters = _text_clusters(group)
        if len(clusters) > 1:
            conflicts.append((key, [_pick_winner(c) for c in clusters]))
    conflicts.sort(key=lambda item: item[0])
    return conflicts


def merge_rows(base: list[dict], staged: list[dict]) -> list[dict]:
    """Base rows with staged winners overriding equal keys; then any remaining staged rows.

    A final pass drops duplicate point ids so the written count matches Qdrant exactly.
    """
    staged_by_key = {row_key(r): r for r in staged}
    out: list[dict] = []
    used: set[tuple[str, str]] = set()
    for row in base:
        key = row_key(row)
        if key in staged_by_key and key not in used:
            out.append(staged_by_key[key])
            used.add(key)
        else:
            out.append(row)
    for row in staged:
        key = row_key(row)
        if key not in used:
            out.append(row)
            used.add(key)
    seen_ids: set[str] = set()
    unique: list[dict] = []
    for row in out:
        pid = ip.point_id(row)
        if pid in seen_ids:
            continue
        seen_ids.add(pid)
        unique.append(row)
    return unique


# ----------------------------------------------------------------------------- file discovery
def is_excluded_file(path: Path) -> bool:
    """Rule 4: the same exclusions for ``--files`` and ``--staged-dir``."""
    name = Path(path).name
    return name.endswith(EXCLUDE_SUFFIXES) or name.startswith(EXCLUDE_PREFIXES)


def filter_input_files(paths: list[Path]) -> list[Path]:
    """Drop repealed/review/unity-ruling files from an explicit ``--files`` list (deduped)."""
    found: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        path = Path(path)
        if is_excluded_file(path) or path in seen:
            continue
        seen.add(path)
        found.append(path)
    return found


def discover_files(staged_dir: Path, patterns=DEFAULT_PATTERNS) -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    for pattern in patterns:
        for path in sorted(Path(staged_dir).glob(pattern)):
            if is_excluded_file(path):
                continue
            if path in seen:
                continue
            seen.add(path)
            found.append(path)
    return found


def load_inputs(paths: list[Path]) -> tuple[list[dict], list[str], int]:
    rows: list[dict] = []
    names: list[str] = []
    unparsable = 0
    for path in paths:
        part, bad = ip.load_rows(Path(path))
        rows += part
        unparsable += bad
        names.append(str(path))
    return rows, names, unparsable


# ----------------------------------------------------------------------------- Cloudflare embed
def _cf_post_json(url: str, payload: dict, timeout: float, token: str) -> tuple[int, dict]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        status = int(getattr(response, "status", 200) or 200)
        raw = response.read().decode("utf-8") or "{}"
    return status, json.loads(raw)


def _extract_cf_vectors(payload: object) -> list[list[float]]:
    if not isinstance(payload, dict):
        return []
    for container in (payload.get("result"), payload):
        if not isinstance(container, dict):
            continue
        for key in ("data", "response"):
            value = container.get(key)
            if isinstance(value, list) and all(isinstance(v, list) for v in value):
                return [[float(x) for x in v] for v in value]
    return []


def _l2_normalise(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(x) * float(x) for x in vector))
    if norm <= 0.0:
        return [float(x) for x in vector]
    return [float(x) / norm for x in vector]


def cf_embed(texts: list[str], *, post=_cf_post_json) -> list[list[float]]:
    """Embed via Workers AI ``@cf/baai/bge-m3`` with retry; token is never logged."""
    account = os.environ.get("CF_ACCOUNT_ID", "").strip()
    token = os.environ.get("CF_AI_TOKEN", "").strip()
    if not account or not token:
        raise Refusal("EMBED_BACKEND=cf but CF_ACCOUNT_ID/CF_AI_TOKEN are unset")
    url = CF_EMBED_URL.format(account=account)
    last: BaseException | None = None
    for attempt in range(CF_EMBED_RETRIES + 1):
        try:
            status, payload = post(url, {"text": list(texts)}, CF_EMBED_TIMEOUT, token)
            if status != 200:
                raise RuntimeError(f"HTTP {status}")
            vectors = _extract_cf_vectors(payload)
            if len(vectors) != len(texts):
                raise RuntimeError(f"returned {len(vectors)} vectors for {len(texts)} texts")
            if any(len(v) != CF_EMBED_DIM for v in vectors):
                raise RuntimeError(f"expected {CF_EMBED_DIM} dims")
            return [_l2_normalise(v) for v in vectors]
        except Exception as exc:  # noqa: BLE001 - retried, then falls back to TEI upstream
            last = exc
            if attempt < CF_EMBED_RETRIES:
                time.sleep(min(2.0**attempt, 15.0))
    raise Refusal(f"CF embed failed after {CF_EMBED_RETRIES + 1} attempts: {last}")


# Same cut as the v6/regulation builds (EMBED_CHARS in ingest_regulations.py / docs/infra/MODAL_EMBED_PARITY.md):
# the embedding sees the first 2000 chars; the full text stays in the payload. Workers AI also rejects
# inputs over 8192 tokens (HTTP 400 "Sequence too long", found on the first --apply run 2026-10-22).
EMBED_CHARS = 2000


def embed_text(row: dict) -> str:
    """Text sent to the embedder for one row (truncated; the payload keeps the full text)."""
    return str(row.get("text") or "")[:EMBED_CHARS]


def make_embedder(backend: str | None = None):
    """Return an embed callable: CF first with TEI/local fallback when ``EMBED_BACKEND=cf``."""
    chosen = (
        backend if backend is not None else os.environ.get("EMBED_BACKEND", "")
    ).strip().lower()

    def _embed(texts: list[str]) -> list[list[float]]:
        if chosen == "cf":
            try:
                return cf_embed(texts)
            except Exception as exc:  # noqa: BLE001
                print(
                    f"warning: Cloudflare embed unavailable ({exc}); TEI/local fallback",
                    file=sys.stderr,
                )
        return ip.default_embed(texts)

    return _embed


# ----------------------------------------------------------------------------- Qdrant helpers
def scroll_payloads(http, base: str, src: str, batch: int = 256) -> list[dict]:
    """Read-only payload scroll of the source collection (never writes)."""
    if not ip.collection_exists(http, base, src):
        raise Refusal(f"source collection {src!r} not found on {base}")
    rows: list[dict] = []
    for points in bc.scroll(http, base, src, batch):
        for point in points:
            payload = point.get("payload") or {}
            if payload:
                rows.append(payload)
    return rows


def try_scroll_payloads(http, base: str, src: str, batch: int = 256) -> list[dict]:
    """Like :func:`scroll_payloads` but returns ``[]`` when the source is absent/unreachable.

    The dry-run wants the v6 text set for the ``already_in_v6`` count without a missing local
    collection (or an offline host) turning the whole report into a Refusal.
    """
    if http is None:
        return []
    try:
        if not ip.collection_exists(http, base, src):
            return []
        return scroll_payloads(http, base, src, batch)
    except Exception as exc:  # noqa: BLE001 - dry-run degrades to no already_in_v6 count
        print(f"warning: cannot read {src} for already_in_v6 ({exc})", file=sys.stderr)
        return []


def skip_already_in_v6(rows: list[dict], base_rows: list[dict]) -> tuple[list[dict], int]:
    """Rule 4: drop rows whose hard-normalised text is already in ``iran_laws_v6``."""
    if not base_rows:
        return list(rows), 0
    base_texts = {normalise_text(row_text(r)) for r in base_rows if row_text(r)}
    kept: list[dict] = []
    skipped = 0
    for row in rows:
        if normalise_text(row_text(row)) in base_texts:
            skipped += 1
            continue
        kept.append(row)
    return kept, skipped


def points_count(http, base: str, collection: str) -> int | None:
    status, data = http("GET", f"{base}/collections/{collection}", None)
    if status != 200:
        return None
    return ((data.get("result") or {}).get("points_count"))


def _safe_out(path: Path) -> Path:
    resolved = Path(path).resolve()
    data_dir = (ROOT / "data").resolve()
    if resolved == data_dir or data_dir in resolved.parents:
        raise Refusal("refused: --out must be outside data/ (data/ is immutable)")
    return resolved


# ----------------------------------------------------------------------------- report
def _plan_section(rows: list[dict], conflicts) -> dict:
    by_source = Counter(row_source(r) for r in rows)
    by_law = Counter(ip.norm_name(row_law_name(r)) for r in rows)
    return {
        "selected_rows": len(rows),
        "deduped_rows": len(dedupe_rows(rows)),
        "by_source": dict(sorted(by_source.items())),
        "by_law": dict(sorted(by_law.items())),
        "conflict_keys": len(conflicts),
        "conflict_rows": sum(len(group) for _key, group in conflicts),
        "estimated_tokens": sum(estimate_tokens(row_text(r)) for r in rows),
    }


def build_report(
    *,
    target: str,
    rows_in: int,
    laws: list[dict],
    regulations: list[dict],
    dropped: Counter,
    conflicts,
    names: list[str],
    unparsable: int,
) -> dict:
    """Dry-run report with a ``laws`` and a ``regulations`` section (target picks the top level)."""
    laws_section = _plan_section(laws, conflicts)
    regs_section = _plan_section(regulations, [])
    chosen = laws_section if target == TARGET_LAWS else regs_section
    report = {
        "staged_files": names,
        "rows_in": rows_in,
        "target": target,
        "dropped": dict(dropped),
        "unparsable_lines": unparsable,
        "laws": laws_section,
        "regulations": regs_section,
    }
    report.update(chosen)
    return report


def conflicts_markdown(conflicts) -> str:
    lines = [
        "# iran_laws_v7 staged-row conflicts",
        "",
        "Same (law_name, article_no) with more than one text across sources. Not guessed; a",
        "human decides which source wins before the build. No law text is reproduced here.",
        "",
    ]
    if not conflicts:
        lines.append("No conflicts. / بدون تعارض.")
        return "\n".join(lines) + "\n"
    lines += [
        f"Conflicting article keys: {len(conflicts)}",
        "",
        "| law | article | sources | rows | text chars (min-max) |",
        "|---|---|---|---|---|",
    ]
    for key, group in conflicts:
        law = row_law_name(group[0]) or key[0]
        sources = ", ".join(sorted({row_source(r) for r in group}))
        lengths = [len(row_text(r)) for r in group]
        lines.append(
            f"| {law} | {row_article_no(group[0]) or key[1]} | {sources} | {len(group)} "
            f"| {min(lengths)}-{max(lengths)} |"
        )
    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------- apply
def apply(
    staged: list[dict],
    *,
    collection: str,
    qdrant: str = ip.DEFAULT_QDRANT,
    src: str | None = "iran_laws_v6",
    base_rows: list[dict] | None = None,
    batch: int = BATCH,
    http=None,
    embed=None,
) -> dict:
    """Create a NEW collection from base + staged rows. Never touches the source."""
    if http is None:
        http = ip.default_http
    if embed is None:
        embed = make_embedder()
    base = ip.assert_local(qdrant)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", collection or ""):
        raise Refusal("refused: invalid collection name")
    if collection in (ip.PROTECTED_COLLECTION, "iran_laws_v6") or collection == src:
        raise Refusal(f"refused: {collection} is protected; pick a NEW collection name")
    if ip.collection_exists(http, base, collection):
        raise Refusal(f"refused: collection {collection!r} already exists")
    if base_rows is None and src:
        base_rows = scroll_payloads(http, base, src)
    merged = merge_rows(base_rows or [], staged)
    if not merged:
        raise Refusal("refused: nothing to write (empty base + staged rows)")

    written = 0
    created = False
    for start in range(0, len(merged), batch):
        chunk = merged[start : start + batch]
        vectors = embed([embed_text(row) for row in chunk])
        if len(vectors) != len(chunk):
            raise Refusal("embed function returned a wrong number of vectors")
        if not created:
            status, _ = http(
                "PUT",
                f"{base}/collections/{collection}",
                {"vectors": {"size": len(vectors[0]), "distance": "Cosine"}},
            )
            if status != 200:
                raise Refusal(f"create collection failed: HTTP {status}")
            created = True
        points = [
            {
                "id": ip.point_id(row),
                "vector": vector,
                "payload": {**row, "ingest_pipeline": "build_v7.v1"},
            }
            for row, vector in zip(chunk, vectors, strict=True)
        ]
        status, _ = http(
            "PUT",
            f"{base}/collections/{collection}/points?wait=true",
            {"points": points},
        )
        if status != 200:
            raise Refusal(f"upsert failed: HTTP {status} after {written} points")
        written += len(points)

    actual = points_count(http, base, collection)
    if actual != written:
        raise Refusal(
            f"point count mismatch: {actual} in {collection}, expected {written}; "
            "collection is PARTIAL"
        )
    return {
        "collection": collection,
        "base_rows": len(base_rows or []),
        "staged_rows": len(staged),
        "points_written": written,
        "points_count_verified": actual,
    }


# ----------------------------------------------------------------------------- CLI
def main(argv: list[str] | None = None, *, http=None, embed=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--out", required=True, type=Path, help="output dir (must be outside data/)")
    ap.add_argument("--files", nargs="*", type=Path, help="staged JSONL files (default: globs)")
    ap.add_argument("--staged-dir", type=Path, default=STAGED_DIR)
    ap.add_argument("--apply", action="store_true", help="write the new collection (else dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="default; write nothing to Qdrant")
    ap.add_argument(
        "--target",
        choices=(TARGET_LAWS, TARGET_REGULATIONS),
        default=TARGET_LAWS,
        help="laws -> iran_laws_v7 (default); regulations -> iran_regulations_v3",
    )
    ap.add_argument("--collection", default=None, help="target collection (defaults per --target)")
    ap.add_argument("--qdrant", default=ip.DEFAULT_QDRANT)
    ap.add_argument("--src-collection", default="iran_laws_v6")
    ap.add_argument("--no-base", action="store_true", help="build from staged rows only")
    ap.add_argument("--batch", type=int, default=BATCH)
    args = ap.parse_args(argv)
    if args.apply and args.dry_run:
        print("--apply and --dry-run are mutually exclusive", file=sys.stderr)
        return 2
    try:
        if http is None:
            http = ip.default_http
        out = _safe_out(args.out)
        files = (
            filter_input_files(list(args.files))
            if args.files
            else discover_files(args.staged_dir)
        )
        rows, names, unparsable = load_inputs(files)
        laws, regulations, dropped = split_rows(rows)
        base_rows: list[dict] | None = None
        if args.target == TARGET_LAWS and not args.no_base:
            base = ip.assert_local(args.qdrant)
            base_rows = try_scroll_payloads(http, base, args.src_collection)
            laws, skipped = skip_already_in_v6(laws, base_rows)
            dropped["already_in_v6"] = skipped
        conflicts = find_conflicts(laws)
        report = build_report(
            target=args.target,
            rows_in=len(rows),
            laws=laws,
            regulations=regulations,
            dropped=dropped,
            conflicts=conflicts,
            names=names,
            unparsable=unparsable,
        )
        out.mkdir(parents=True, exist_ok=True)
        (out / "v7_conflicts.md").write_text(conflicts_markdown(conflicts), encoding="utf-8")
        if not args.apply:
            report["mode"] = "dry-run"
            report["collection"] = None
            (out / "v7_report.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
            )
            print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
            print(f"\n[dry-run] no writes to Qdrant. Review: {out / 'v7_conflicts.md'}")
            return 0
        target_rows = laws if args.target == TARGET_LAWS else regulations
        winners = dedupe_rows(target_rows)
        collection = args.collection or DEFAULT_COLLECTIONS[args.target]
        if args.target == TARGET_LAWS and not args.no_base:
            src, apply_base = args.src_collection, base_rows
        else:
            src, apply_base = None, None
        result = apply(
            winners,
            collection=collection,
            qdrant=args.qdrant,
            src=src,
            base_rows=apply_base,
            batch=args.batch,
            http=http,
            embed=embed,
        )
        report["mode"] = "apply"
        report["apply"] = result
        (out / "v7_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
