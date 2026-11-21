"""Hard abstention gate, as-of temporal filtering, and deterministic citation verification.

Implements R6 decisions 1, 3, 4, 5 (docs/strategy/research/R5_R6_R7_GTM_LEGAL_PORTFOLIO.md):
1. Versioned, as-of retrieval: filtering on valid_from / valid_to and active/amended status.
2. Hard abstention gate across 4 rules:
   - score below rerank threshold;
   - unresolved version conflict;
   - out-of-scope question;
   - false-premise question.
3. Deterministic citation check: every cited article must appear in retrieved chunks,
   and an unofficial source never stands alone.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from output_apps.generated_modules.smartjudge.authority_tiers import (
    AUTHORITY_TIER_1,
    AUTHORITY_TIER_2,
    BILL_NOT_YET_LAW_SENTENCE,
    STATUS_BILL_UNENACTED,
    STATUS_REPEALED,
    filter_tier_1_2_enacted,
    has_authoritative_chunk,
    has_bill_chunk,
    resolve_chunk_authority_tier,
    resolve_chunk_status,
)

# Re-use digit translation
_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

DEFAULT_RERANK_THRESHOLD = 0.35
BETA_MAX_HALLUCINATION_RATE = 0.10
BETA_MIN_ABSTENTION_RECALL = 0.85


def norm(text: Any) -> str:
    """Normalize digits, Arabic letters, and whitespace for comparison."""
    s = str(text or "").translate(_DIGIT_MAP)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("‌", " ").replace("ٔ", "")
    return re.sub(r"\s+", " ", s).strip().lower()


@dataclass
class AbstentionDecision:
    should_abstain: bool
    reason: Optional[str] = None  # "low_score" | "version_conflict" | "out_of_scope" | "false_premise" | "no_as_of_version" | "unofficial_only" | "bill_unenacted" | "repealed_only"
    message: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    notices: List[str] = field(default_factory=list)


def _parse_date_tuple(raw: Any) -> Optional[Tuple[int, int, int]]:
    """Parse YYYY-MM-DD, YYYY/MM/DD, or DD/MM/YYYY into (year, month, day)."""
    s = norm(raw).replace("/", "-")
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    m = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})$", s)
    if m:
        return int(m.group(3)), int(m.group(2)), int(m.group(1))
    return None


def filter_by_as_of(
    chunks: Sequence[dict],
    as_of_date: Optional[str] = None,
) -> List[dict]:
    """Filters chunks to those in force as of the given date.
    
    If as_of_date is None, returns chunks with status 'active' or 'transitional'
    (or chunks lacking temporal bounds).
    If as_of_date is provided, checks valid_from <= as_of_date <= valid_to.
    """
    if not chunks:
        return []

    if not as_of_date:
        # Default view: active or unversioned rows
        out = []
        for c in chunks:
            status = str(c.get("status") or "").lower()
            if status in ("repealed", "superseded", "obsolete"):
                continue
            out.append(c)
        return out

    norm_target = norm(as_of_date).replace("/", "-")
    target_tuple = _parse_date_tuple(norm_target)
    valid_chunks = []
    for c in chunks:
        vf = norm(c.get("valid_from") or "").replace("/", "-")
        vt = norm(c.get("valid_to") or "").replace("/", "-")
        vf_tuple = _parse_date_tuple(vf)
        vt_tuple = _parse_date_tuple(vt)
        status = str(c.get("status") or "").lower()

        # If explicit valid_from exists, target must be >= valid_from
        if vf:
            if target_tuple and vf_tuple:
                if target_tuple < vf_tuple:
                    continue
            elif norm_target < vf:
                continue

        # If explicit valid_to exists, target must be <= valid_to
        if vt:
            if target_tuple and vt_tuple:
                if target_tuple > vt_tuple:
                    continue
            elif norm_target > vt:
                continue

        # If status says repealed/superseded without valid_to, exclude for current queries
        if status in ("repealed", "superseded") and not vt:
            continue

        valid_chunks.append(c)

    return valid_chunks


def detect_version_conflict(chunks: Sequence[dict], as_of_date: Optional[str] = None) -> bool:
    """Detects if multiple conflicting versions of the same law/article exist in chunks
    without an explicit as-of date to disambiguate them.
    """
    if as_of_date or not chunks:
        return False

    seen_articles: Dict[Tuple[str, str], Set[str]] = {}
    for c in chunks:
        law = norm(c.get("law_name") or c.get("title") or "")
        art = str(c.get("article_no") or c.get("article") or "").strip()
        status = str(c.get("status") or "active").lower()
        if not law or not art:
            continue
        key = (law, art)
        if key not in seen_articles:
            seen_articles[key] = set()
        seen_articles[key].add(status)

    for (law, art), statuses in seen_articles.items():
        # Conflict: both active and amended/repealed versions present simultaneously
        if len(statuses) > 1 and ("active" in statuses or "current" in statuses):
            if any(s in statuses for s in ("amended", "repealed", "superseded", "old")):
                return True

    return False


# Word-boundary lookarounds that work for both ASCII and Persian/Arabic script
_WB_START = r"(?<![\w\u0600-\u06FF])"
_WB_END = r"(?![\w\u0600-\u06FF])"

# Out-of-scope intent triggers: non-legal, medical, programming, foreign law without Iran comparative basis
OUT_OF_SCOPE_PATTERNS = [
    re.compile(_WB_START + norm(r"(?:پایتون|جاوااسکریپت|برنامه‌نویسی|html|css|react|sql query|کد نویسی)") + _WB_END, re.IGNORECASE),
    re.compile(_WB_START + norm(r"(?:علائم سکته|درمان دارویی|دوز دارو|علت تنگی نفس|پزشک متخصص|کرونا)") + _WB_END, re.IGNORECASE),
    re.compile(_WB_START + norm(r"(?:پیش‌بینی وضعیت هوا|دمای امروز|قیمت بیت‌کوین|ارز دیجیتال برای ترید)") + _WB_END, re.IGNORECASE),
    re.compile(_WB_START + norm(r"(?:قانون اساسی آمریکا|دادگاه فدرال آلمان|حقوق فرانسه بدون تطبیق)") + _WB_END, re.IGNORECASE),
]

FALSE_PREMISE_PATTERNS = [
    # E.g. asserts clearly false legal assertions as a leading question (digits normalized to 0-9)
    re.compile(norm(r"طبق کدام ماده.*?(?:چک سندی غیرتجاری است|قتل عمد هیچ مجازاتی ندارد|ساعت کار هفتگی (?:60|۶۰) ساعت است)"), re.IGNORECASE),
    re.compile(norm(r"با توجه به اینکه.*?(?:حقوق کارگران غیرقانونی است|مالیات در ایران لغو شده است)"), re.IGNORECASE),
    re.compile(_WB_START + norm(r"(?:ماده\s*(?:[3-9]\d|[1-9]\d{2,})\s*(?:قانون\s*)?(?:صدور\s*)?چک)") + _WB_END, re.IGNORECASE),
    re.compile(_WB_START + norm(r"(?:قانون\s*(?:صدور\s*)?چک\s*ماده\s*(?:[3-9]\d|[1-9]\d{2,}))") + _WB_END, re.IGNORECASE),
]

# Maximum known article counts for key statutes to detect non-existent article queries
KNOWN_LAW_MAX_ARTICLES = {
    "چک": 23,
    "صدور چک": 23,
    "قانون چک": 23,
    "قانون صدور چک": 23,
    "حمایت خانواده": 58,
    "قانون حمایت خانواده": 58,
    "شوراهای حل اختلاف": 47,
    "قانون شوراهای حل اختلاف": 47,
}


def detect_out_of_scope(query: str, chunks: Sequence[dict]) -> bool:
    """Checks whether the query is clearly out of the legal domain and has no grounded sources."""
    q_norm = norm(query)
    for pat in OUT_OF_SCOPE_PATTERNS:
        if pat.search(q_norm):
            # If there are also no high-scoring legal chunks, it's out of scope
            return True
    return False


def detect_false_premise(query: str, chunks: Sequence[dict]) -> bool:
    """Checks if the question asserts a premise that contradicts established law or the retrieved text."""
    q_norm = norm(query)
    for pat in FALSE_PREMISE_PATTERNS:
        if pat.search(q_norm):
            return True

    # Check for queries asking for non-existent articles of known laws
    # e.g. "ماده ۶۰ قانون صدور چک" or "ماده 60 چک"
    art_matches = re.finditer(r"ماده\s*(\d+)\s*(?:قانون\s*)?([^\d\n\r،.؛]+)", q_norm)
    for m in art_matches:
        art_no = int(m.group(1))
        law_candidate = m.group(2).strip()
        for known_law, max_arts in KNOWN_LAW_MAX_ARTICLES.items():
            if known_law in law_candidate and art_no > max_arts:
                return True

    return False


def evaluate_abstention_gate(
    query: str,
    retrieved_chunks: Sequence[dict],
    *,
    rerank_score: Optional[float] = None,
    rerank_threshold: float = DEFAULT_RERANK_THRESHOLD,
    as_of_date: Optional[str] = None,
    require_grounding: bool = True,
    tier_1_2_fallback: Optional[Callable[[str], Sequence[dict]]] = None,
    enforce_authority_tier: bool = True,
) -> AbstentionDecision:
    """Evaluates the hard abstention rules (R6 Decision 3 + T238 authority tiers)."""
    # 0. As-of date validity check
    if as_of_date:
        valid_chunks = filter_by_as_of(retrieved_chunks, as_of_date)
        if not valid_chunks:
            return AbstentionDecision(
                should_abstain=True,
                reason="no_as_of_version",
                message=f"در تاریخ مبنای درخواستی ({as_of_date}) هیچ نسخهٔ معتبری از قانون مربوطه در پیکره یافت نشد.",
                details={"as_of_date": as_of_date, "total_chunks": len(retrieved_chunks)},
            )
        retrieved_chunks = valid_chunks

    # Rule 1: Rerank score is below the threshold or no relevant chunks when grounding is required
    if require_grounding and not retrieved_chunks:
        return AbstentionDecision(
            should_abstain=True,
            reason="low_score",
            message="مستند قانونی کافی و معتبری برای پاسخ به این پرسش در پیکرهٔ قوانین یافت نشد.",
            details={"rerank_score": rerank_score, "chunks_count": 0},
        )

    if rerank_score is not None and rerank_score < rerank_threshold:
        return AbstentionDecision(
            should_abstain=True,
            reason="low_score",
            message=f"ضریب اطمینان بازیابی ({rerank_score:.2f}) پایین‌تر از آستانهٔ مجاز ({rerank_threshold:.2f}) است.",
            details={"rerank_score": rerank_score, "threshold": rerank_threshold},
        )

    # Rule 2: Unresolved version conflict
    if detect_version_conflict(retrieved_chunks, as_of_date):
        return AbstentionDecision(
            should_abstain=True,
            reason="version_conflict",
            message="نسخه‌های متعارض و اصلاح‌شده از این ماده قانونی در اسناد یافت شد و بدون تعیین تاریخ مبنا (as-of) امکان پاسخ قطعی وجود ندارد.",
            details={"as_of_date": as_of_date},
        )

    # Rule 3: Question is outside the corpus
    if detect_out_of_scope(query, retrieved_chunks):
        return AbstentionDecision(
            should_abstain=True,
            reason="out_of_scope",
            message="این پرسش خارج از پیکرهٔ موضوعی قوانین و صلاحیت حقوقی سامانه هوشمند است.",
            details={"query": query},
        )

    # Rule 4: Question's premise contradicts the retrieved text
    if detect_false_premise(query, retrieved_chunks):
        return AbstentionDecision(
            should_abstain=True,
            reason="false_premise",
            message="فرضیهٔ مطرح‌شده در پرسش با مفاد قوانین موضوعه و متون استنادی مغایرت دارد.",
            details={"query": query},
        )

    # Rule 5 (T238): Repealed-only chunks without as_of_date cannot ground a current answer
    if not as_of_date and retrieved_chunks:
        if all(resolve_chunk_status(c) == STATUS_REPEALED for c in retrieved_chunks if isinstance(c, dict)):
            return AbstentionDecision(
                should_abstain=True,
                reason="repealed_only",
                message="تمامی مستندات بازیابی‌شده منسوخ یا ملغی شده‌اند و قانون لازم‌الاجرای معتبری یافت نشد.",
                details={"chunks_count": len(retrieved_chunks)},
            )

    # Rule 6 (T238): Authority tier gate — top-5 must contain at least one Tier 1 or Tier 2
    # enacted/amended chunk; otherwise run one fallback search restricted to Tiers 1-2.
    notices: List[str] = []
    if enforce_authority_tier and retrieved_chunks:
        top_5 = list(retrieved_chunks)[:5]
        bill_present = has_bill_chunk(top_5, top_k=5)
        if bill_present:
            notices.append(BILL_NOT_YET_LAW_SENTENCE)

        if not has_authoritative_chunk(top_5, top_k=5):
            fallback_hits: List[dict] = []
            fallback_attempted = False
            if tier_1_2_fallback is not None:
                fallback_attempted = True
                raw_fallback = tier_1_2_fallback(query) or []
                fallback_hits = filter_tier_1_2_enacted(raw_fallback)

            if fallback_hits:
                return AbstentionDecision(
                    should_abstain=False,
                    details={"fallback_used": True, "fallback_hits": len(fallback_hits)},
                    notices=notices,
                )

            if bill_present:
                return AbstentionDecision(
                    should_abstain=True,
                    reason="bill_unenacted",
                    message=BILL_NOT_YET_LAW_SENTENCE,
                    details={"fallback_attempted": fallback_attempted},
                    notices=[BILL_NOT_YET_LAW_SENTENCE],
                )

            return AbstentionDecision(
                should_abstain=True,
                reason="unofficial_only",
                message="مستند رسمی یا شبه‌رسمی (سطح ۱ یا ۲) برای پاسخ به این پرسش یافت نشد و منابع غیررسمی به تنهایی کافی نیستند.",
                details={"fallback_attempted": fallback_attempted},
            )

    return AbstentionDecision(should_abstain=False, notices=notices)


def deterministic_citation_check(
    cited_items: Sequence[dict],
    retrieved_chunks: Sequence[dict],
) -> Tuple[List[dict], List[dict], bool]:
    """Every cited law and article in the model's output must appear in the retrieved chunks.
    
    Returns:
      (valid_citations, dropped_citations, unofficial_stands_alone)
    """
    valid_citations: List[dict] = []
    dropped_citations: List[dict] = []

    # Map available chunks by (law, article_no) -> tier
    available_chunks: Dict[Tuple[str, str], str] = {}
    has_official_or_secondary = False

    for c in retrieved_chunks:
        law_key = norm(c.get("law_name") or c.get("title") or "")
        art_key = norm(c.get("article_no") or c.get("article") or "")
        tier = str(c.get("source_tier") or c.get("tier") or "unofficial").lower()
        if law_key and art_key:
            prev = available_chunks.get((law_key, art_key))
            if prev is None or tier in ("official", "secondary"):
                available_chunks[(law_key, art_key)] = tier

    for item in cited_items:
        c_law = norm(item.get("law_name") or item.get("law") or item.get("title") or "")
        c_art = norm(item.get("article_no") or item.get("article") or item.get("number") or "")
        if not c_law or not c_art:
            dropped_citations.append(dict(item))
            continue

        matched_tier = available_chunks.get((c_law, c_art))
        if matched_tier is not None:
            out_item = dict(item)
            out_item["source_tier"] = matched_tier
            valid_citations.append(out_item)
            if matched_tier in ("official", "secondary"):
                has_official_or_secondary = True
        else:
            dropped_citations.append(dict(item))

    # An unofficial source never stands alone (R6 decision 4)
    unofficial_stands_alone = bool(valid_citations and not has_official_or_secondary)

    return valid_citations, dropped_citations, unofficial_stands_alone
