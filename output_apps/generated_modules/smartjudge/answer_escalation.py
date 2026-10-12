"""B3: quality-gated escalation of a Smart Judge chat answer from the cheap to the strong tier.

Opt-in (SMARTJUDGE_ESCALATION=1, same flag as escalation_helper; default off, then this module
changes nothing). The triggers are deterministic and cost nothing (no extra model call):

* ``no_valid_citation``  retrieval found relevant articles but the answer cites none the guard validates
* ``invented_citation``  the citation guard flagged an article the corpus does not contain
* ``too_short``          the answer is shorter than SMARTJUDGE_ESCALATION_MIN_ANSWER_CHARS for a
                         complex question (case files attached, or a long question)

On a trigger the same messages are re-asked ONCE on the ``strong`` tier (model ids from
config/models.yaml via llm_router; never a :free id, sensitive=True). Who may escalate:
SMARTJUDGE_ESCALATION_SCOPE=vip (default; VIP plan only) or ``all`` (everyone, but bounded by
SMARTJUDGE_ESCALATION_DAILY_CAP strong re-asks per day, default 50). VIP is not capped.
Only counts are logged -- never question or answer text.
See docs/ops/ESCALATION.md ("Chat answer escalation").
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

STRONG_TIER = "strong"
DEFAULT_MIN_ANSWER_CHARS = 400
DEFAULT_COMPLEX_QUESTION_CHARS = 160
DEFAULT_DAILY_CAP = 50
DEFAULT_MAX_COST_USD = 0.05


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def enabled() -> bool:
    return os.environ.get("SMARTJUDGE_ESCALATION") == "1"


def scope() -> str:
    return "all" if os.environ.get("SMARTJUDGE_ESCALATION_SCOPE", "vip").strip().lower() == "all" else "vip"


def is_complex_question(user_text: str, has_case_files: bool) -> bool:
    return bool(has_case_files) or len((user_text or "").strip()) >= _int_env(
        "SMARTJUDGE_ESCALATION_COMPLEX_CHARS", DEFAULT_COMPLEX_QUESTION_CHARS)


_ARTICLE_RE = re.compile(r"ماده(?:\s*ی|\s*ٔ)?\s*[0-9۰-۹٠-٩]+")


def triggers(answer: str, *, grounded: bool, guard_report: Optional[dict], complex_question: bool,
             has_case_refs: bool = False) -> List[str]:
    """Deterministic reason codes (empty list = answer is fine). Never echoes content.

    ``no_valid_citation`` fires only when grounding exists and either the answer has article-style
    citations (ماده N) of which none validated, or it has no citation of any kind (no article,
    no validated precedent, no case-file page ref). Precedent-only / case-file-only answers pass.
    """
    out: List[str] = []
    report = guard_report or {}
    validated = report.get("validated_articles") or []
    bad_articles = [f for f in (report.get("flags") or []) if isinstance(f, dict) and f.get("kind") == "article"]
    if grounded and not validated:
        article_cited = bool(_ARTICLE_RE.search(answer or "")) or any(
            isinstance(c, dict) and c.get("kind") == "article" for c in (report.get("citations") or []))
        any_citation = (article_cited or bool(report.get("validated_precedents"))
                        or bool(report.get("citations")) or has_case_refs)
        if article_cited or not any_citation:
            out.append("no_valid_citation")
    if bad_articles:
        out.append("invented_citation")
    if complex_question and len((answer or "").strip()) < _int_env(
            "SMARTJUDGE_ESCALATION_MIN_ANSWER_CHARS", DEFAULT_MIN_ANSWER_CHARS):
        out.append("too_short")
    return out


def _has_case_refs(reply: str, case_records: Optional[List[dict]]) -> bool:
    if not case_records:
        return False
    from output_apps.generated_modules.smartjudge import case_files

    return bool(case_files.extract_case_file_refs(reply, case_records))


def _today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")


def _default_counter(key: str, window_s: int) -> int:
    from output_apps.generated_modules.smartjudge import chat_auth

    return int(chat_auth.incr(key, window_s)[0])


@dataclass
class EscalationOutcome:
    reply: str
    model: Optional[str] = None
    escalated: bool = False
    triggers: List[str] = field(default_factory=list)
    skipped: Optional[str] = None  # why a triggered escalation did not run


def _log(outcome: str, trig: List[str], extra: str = "") -> None:
    # counts/codes only: no question or answer text, no user id
    print(f"[SMARTJUDGE][ESCALATION] outcome={outcome} triggers={','.join(trig) or '-'}{extra}", file=sys.stderr)


async def maybe_escalate(
    *,
    reply: str,
    messages: List[Dict[str, Any]],
    user_text: str,
    grounded: bool,
    has_case_files: bool,
    plan: str,
    first_tier: str,
    case_records: Optional[List[dict]] = None,
    guard: Callable[[str], Awaitable[dict]],
    complete: Callable[..., Awaitable[Any]],
    counter: Optional[Callable[[str, int], int]] = None,
    user_ref: Optional[str] = None,
    **params: Any,
) -> EscalationOutcome:
    """Return the original reply, or the strong tier's reply when a trigger fired and policy allows.

    ``guard(text)`` is the citation guard (async, returns its report dict); ``complete`` is
    ``llm_router.complete``; ``counter(key, window_s)`` increments and returns the day count.
    Any failure keeps the original answer: escalation can only improve a reply, never lose it.
    """
    if not enabled() or not reply:
        return EscalationOutcome(reply)
    if first_tier == STRONG_TIER:  # already the strong tier: a second ask would be identical
        return EscalationOutcome(reply, skipped="already_strong")
    if scope() == "vip" and plan != "VIP":
        return EscalationOutcome(reply, skipped="scope")
    try:
        report = await guard(reply)
    except Exception as exc:  # noqa: BLE001
        _log("guard_error", [], f" err={type(exc).__name__}")
        return EscalationOutcome(reply, skipped="guard_error")
    trig = triggers(reply, grounded=grounded, guard_report=report,
                    complex_question=is_complex_question(user_text, has_case_files),
                    has_case_refs=_has_case_refs(reply, case_records))
    if not trig:
        return EscalationOutcome(reply)
    if scope() == "all" and plan != "VIP":
        cap = _int_env("SMARTJUDGE_ESCALATION_DAILY_CAP", DEFAULT_DAILY_CAP)
        count = await asyncio.to_thread(counter or _default_counter, f"sj:esc:daily:{_today()}", 86400 + 3600)
        if count > cap:
            _log("capped", trig, f" count={count} cap={cap}")
            return EscalationOutcome(reply, triggers=trig, skipped="daily_cap")
    try:
        from src.ops_fallback.escalation import arun_with_escalation

        async def _call(tier: str, _ids: list) -> Any:
            return await complete(tier, messages, sensitive=True, tenant="smartjudge", user=user_ref,
                                  feature="consult_escalation", **params)

        out = await arun_with_escalation(
            [STRONG_TIER], _call, lambda _r: (True, []),
            max_cost_usd=float(os.environ.get("SMARTJUDGE_ESCALATION_MAX_COST_USD", DEFAULT_MAX_COST_USD)),
            sensitive=True, cost_of=lambda r, _t: getattr(r, "cost_usd", None) or None,
        )
        res = out["result"]
        new_reply = (getattr(res, "content", "") or "").strip()
    except Exception as exc:  # noqa: BLE001 - incl. cost cap / sensitive refusal / provider errors
        _log("failed", trig, f" err={type(exc).__name__}")
        return EscalationOutcome(reply, triggers=trig, skipped="error")
    if not new_reply:
        _log("empty", trig)
        return EscalationOutcome(reply, triggers=trig, skipped="empty")
    _log("escalated", trig)
    return EscalationOutcome(new_reply, getattr(res, "model", None) or None, True, trig)
