"""Authority tiers and legislative status classification for Smart Judge v2 (T238 / #977).

Tiers:
- Tier 1: Constitution (قانون اساسی), Majlis laws (قوانین مصوب مجلس),
  and Supreme Court unification rulings (رأی وحدت رویه).
- Tier 2: Regulations (آیین‌نامه), circulars (بخشنامه / دستورالعمل),
  and advisory opinions (نظریه مشورتی — labelled ``non_binding=True``).
- Tier 3: Single-branch rulings (رأی شعبه / دادنامه شعبه), commentary
  (شرح / تفسیر / مقاله), and FAQ (پرسش و پاسخ).

Statuses:
- ``enacted`` | ``amended`` | ``repealed`` | ``bill_unenacted``

Fail-closed rule: untagged or unknown sources default to Tier 3 so an
unofficial source never stands alone.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Sequence, Tuple

__all__ = [
    "AUTHORITY_TIER_1",
    "AUTHORITY_TIER_2",
    "AUTHORITY_TIER_3",
    "VALID_AUTHORITY_TIERS",
    "STATUS_ENACTED",
    "STATUS_AMENDED",
    "STATUS_REPEALED",
    "STATUS_BILL_UNENACTED",
    "VALID_AUTHORITY_STATUSES",
    "BILL_NOT_YET_LAW_SENTENCE",
    "NON_BINDING_LABEL",
    "classify_authority_tier",
    "classify_chunk_status",
    "resolve_chunk_authority_tier",
    "resolve_chunk_status",
    "has_authoritative_chunk",
    "has_bill_chunk",
    "filter_tier_1_2_enacted",
    "tag_chunk_authority",
]

AUTHORITY_TIER_1 = 1
AUTHORITY_TIER_2 = 2
AUTHORITY_TIER_3 = 3
VALID_AUTHORITY_TIERS = (AUTHORITY_TIER_1, AUTHORITY_TIER_2, AUTHORITY_TIER_3)

STATUS_ENACTED = "enacted"
STATUS_AMENDED = "amended"
STATUS_REPEALED = "repealed"
STATUS_BILL_UNENACTED = "bill_unenacted"
VALID_AUTHORITY_STATUSES = (
    STATUS_ENACTED,
    STATUS_AMENDED,
    STATUS_REPEALED,
    STATUS_BILL_UNENACTED,
)

BILL_NOT_YET_LAW_SENTENCE = (
    "توجه: این متن در مرحلهٔ لایحه یا طرح قانونی بوده و هنوز به قانون لازم‌الاجرا تبدیل نشده است."
)
NON_BINDING_LABEL = "غیرالزام‌آور (نظریه مشورتی)"

_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _norm(text: Any) -> str:
    s = str(text or "").translate(_DIGIT_MAP)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ").replace("ٔ", "")
    return re.sub(r"\s+", " ", s).strip().lower()


_TIER_3_MARKERS = (
    "رای شعبه",
    "رأی شعبه",
    "دادنامه شعبه",
    "شعبه بدوی",
    "شعبه تجدیدنظر",
    "شرح و تفسیر",
    "تفسیر حقوقدان",
    "یادداشت حقوقی",
    "مقاله حقوقی",
    "پرسش و پاسخ",
    "سوالات متداول",
    "single_branch_ruling",
    "single-branch",
    "commentary",
    "faq",
    "blog",
    "unofficial",
)

_ADVISORY_MARKERS = (
    "نظریه مشورتی",
    "نظریه ی مشورتی",
    "اداره کل حقوقی قوه قضاییه",
    "اداره کل حقوقی قوه قضائیه",
    "advisory_opinion",
    "advisory",
)

_TIER_2_MARKERS = (
    "آیین نامه",
    "ایین نامه",
    "بخشنامه",
    "دستورالعمل",
    "تصویب نامه",
    "مصوبه هیئت وزیران",
    "مصوبه هیات وزیران",
    "regulation",
    "circular",
    "directive",
    "secondary",
)

_TIER_1_MARKERS = (
    "قانون اساسی",
    "رای وحدت رویه",
    "رأی وحدت رویه",
    "وحدت رویه",
    "قانون ",
    "constitution",
    "unification_ruling",
    "majlis_law",
    "statute",
    "official",
)

_BILL_MARKERS = (
    "لایحه ",
    "لایحه قانونی پیشنهادی",
    "طرح قانونی",
    "پیش نویس قانون",
    "در دست بررسی مجلس",
    "bill_unenacted",
    "unenacted",
    "draft_bill",
    "bill",
)

_REPEAL_MARKERS = (
    "نسخ صریح",
    "نسخ ضمنی",
    "منسوخه",
    "منسوخ",
    "ملغی",
    "لغو شده",
    "لغو گردید",
    "باطل شده",
    "اعتبار خود را از دست",
    "repealed",
    "superseded",
    "obsolete",
)

_AMENDED_MARKERS = (
    "اصلاحی",
    "اصلاحیه",
    "ماده واحده اصلاح",
    "amended",
)


def classify_authority_tier(
    law_name: str = "",
    text: str = "",
    source_type: str = "",
    scope_tags: Sequence[str] = (),
) -> Tuple[int, bool]:
    """Classify a legal source into ``(authority_tier, non_binding)``.

    Order of precedence:
    1. Explicit Tier 3 markers (single-branch rulings, commentary, FAQ) -> ``(3, False)``.
    2. Advisory opinions -> ``(2, True)`` (labelled non-binding).
    3. Tier 2 markers (regulations, circulars, directives) -> ``(2, False)``.
    4. Tier 1 markers (constitution, Majlis laws, unification rulings) -> ``(1, False)``.
    5. Unknown/untagged -> fail closed to ``(3, False)``.
    """
    header = _norm(" ".join([str(source_type or ""), str(law_name or ""), " ".join(str(t) for t in scope_tags)]))
    body_prefix = _norm(str(text or "")[:300])
    combined = f"{header} {body_prefix}".strip()

    if not combined:
        return AUTHORITY_TIER_3, False

    for marker in _TIER_3_MARKERS:
        if _norm(marker) in combined:
            return AUTHORITY_TIER_3, False

    for marker in _ADVISORY_MARKERS:
        if _norm(marker) in combined:
            return AUTHORITY_TIER_2, True

    for marker in _TIER_2_MARKERS:
        if _norm(marker) in combined:
            return AUTHORITY_TIER_2, False

    for marker in _TIER_1_MARKERS:
        if _norm(marker) in combined:
            return AUTHORITY_TIER_1, False

    return AUTHORITY_TIER_3, False


def classify_chunk_status(
    text: str = "",
    law_name: str = "",
    explicit_status: Optional[str] = None,
    is_active: bool = True,
) -> str:
    """Classify a chunk's legislative status into one of ``VALID_AUTHORITY_STATUSES``."""
    norm_explicit = _norm(explicit_status)
    if norm_explicit in ("bill_unenacted", "bill", "unenacted", "draft_bill"):
        return STATUS_BILL_UNENACTED
    if norm_explicit in ("repealed", "superseded", "obsolete"):
        return STATUS_REPEALED
    if norm_explicit in ("amended",):
        return STATUS_AMENDED
    if not is_active:
        return STATUS_REPEALED

    blob = _norm(f"{law_name} {text}")
    for marker in _BILL_MARKERS:
        if _norm(marker) in blob:
            return STATUS_BILL_UNENACTED
    for marker in _REPEAL_MARKERS:
        if _norm(marker) in blob:
            return STATUS_REPEALED
    for marker in _AMENDED_MARKERS:
        if _norm(marker) in blob:
            return STATUS_AMENDED

    return STATUS_ENACTED


def resolve_chunk_authority_tier(chunk: Dict[str, Any]) -> int:
    """Resolve a retrieved chunk's authority tier (1, 2, or 3). Fail closed to 3."""
    raw_tier = chunk.get("authority_tier")
    if isinstance(raw_tier, int) and raw_tier in VALID_AUTHORITY_TIERS:
        return raw_tier
    if isinstance(raw_tier, str) and raw_tier.strip().isdigit():
        val = int(raw_tier.strip())
        if val in VALID_AUTHORITY_TIERS:
            return val

    source_tier = _norm(chunk.get("source_tier") or chunk.get("tier") or "")
    if source_tier == "official":
        return AUTHORITY_TIER_1
    if source_tier == "secondary":
        return AUTHORITY_TIER_2
    if source_tier == "unofficial":
        return AUTHORITY_TIER_3

    tier, _ = classify_authority_tier(
        law_name=str(chunk.get("law_name") or chunk.get("title") or ""),
        text=str(chunk.get("text") or chunk.get("summary") or ""),
        source_type=str(chunk.get("source_type") or ""),
        scope_tags=chunk.get("scope_tags") or (),
    )
    return tier


def resolve_chunk_status(chunk: Dict[str, Any]) -> str:
    """Resolve a retrieved chunk's legislative status."""
    raw = chunk.get("authority_status") or chunk.get("status")
    is_active = chunk.get("is_active", True)
    return classify_chunk_status(
        text=str(chunk.get("text") or chunk.get("summary") or ""),
        law_name=str(chunk.get("law_name") or chunk.get("title") or ""),
        explicit_status=str(raw) if raw is not None else None,
        is_active=bool(is_active),
    )


def filter_tier_1_2_enacted(chunks: Sequence[Dict[str, Any]]) -> list[Dict[str, Any]]:
    """Return only Tier 1 or Tier 2 chunks whose status is enacted or amended."""
    out: list[Dict[str, Any]] = []
    for c in chunks:
        if not isinstance(c, dict):
            continue
        tier = resolve_chunk_authority_tier(c)
        status = resolve_chunk_status(c)
        if tier in (AUTHORITY_TIER_1, AUTHORITY_TIER_2) and status in (STATUS_ENACTED, STATUS_AMENDED):
            out.append(c)
    return out


def has_authoritative_chunk(chunks: Sequence[Dict[str, Any]], top_k: int = 5) -> bool:
    """Return True if any chunk in ``chunks[:top_k]`` is Tier 1 or Tier 2 and enacted/amended."""
    return bool(filter_tier_1_2_enacted(list(chunks)[:top_k]))


def has_bill_chunk(chunks: Sequence[Dict[str, Any]], top_k: int = 5) -> bool:
    """Return True if any chunk in ``chunks[:top_k]`` has status ``bill_unenacted``."""
    for c in list(chunks)[:top_k]:
        if isinstance(c, dict) and resolve_chunk_status(c) == STATUS_BILL_UNENACTED:
            return True
    return False


def tag_chunk_authority(chunk: Dict[str, Any]) -> Dict[str, Any]:
    """Return a shallow copy of ``chunk`` tagged with authority tier, non_binding, and status."""
    out = dict(chunk)
    tier, non_binding = classify_authority_tier(
        law_name=str(out.get("law_name") or out.get("title") or ""),
        text=str(out.get("text") or out.get("summary") or ""),
        source_type=str(out.get("source_type") or ""),
        scope_tags=out.get("scope_tags") or (),
    )
    if isinstance(out.get("authority_tier"), int) and out["authority_tier"] in VALID_AUTHORITY_TIERS:
        tier = out["authority_tier"]
    status = resolve_chunk_status(out)

    out["authority_tier"] = tier
    out["non_binding"] = bool(out.get("non_binding", non_binding))
    out["authority_status"] = status
    if tier == AUTHORITY_TIER_1:
        out["source_tier"] = "official"
    elif tier == AUTHORITY_TIER_2:
        out["source_tier"] = "secondary"
    else:
        out["source_tier"] = "unofficial"
    if out["non_binding"]:
        out["authority_label"] = NON_BINDING_LABEL
    return out
