"""Deterministic lawyer-answer rules for Smart Judge chat (no I/O, no LLM, no import-time effects).

Source: the lawyer's answers of 2026-10-13 to docs/legal/LAWYER_REVIEW_GATE_FA.md.

* Item 2  ``repeal_warning``: a corpus row flagged ``repeal_status: "implicit_contested"`` (payload
          field, carried through ``legal_graph.lightrag_engine._payload_to_row``) makes the answer
          carry a short Persian warning. Rows with ``is_active: false`` are already excluded earlier.
* Item 4  lease questions: ``prompt_addenda`` tells the model to present every rent regime (1356,
          1362, 1376) with its conditions and never to pick one; ``finalize_reply`` then checks the
          reply states that the governing law depends on the contract's date and type and appends a
          fixed notice when it does not. Choosing the governing law is a legal judgment.
* Item 5  mahr: verified fact (art 22 family protection law) injected into the prompt when the
          question is about mahr or imprisonment. Chosen over a corpus "note" row because a note is
          not a statute (it must never enter statutory_basis or the citation guard), a row needs a
          Qdrant re-embed and would only surface by chance, while a trigger-based prompt fact is
          deterministic, reviewed in git and testable offline.
* Item 6  social security retirement: fixed disclaimer to check with the social security organisation.

Wording here is lawyer-reviewed text; change it only with a new lawyer answer.
"""

from __future__ import annotations

from typing import Any, Iterable

from output_apps.generated_modules.smartjudge import court_catalog as _cc

IMPLICIT_CONTESTED = "implicit_contested"
CONTESTED_STATUSES = frozenset({IMPLICIT_CONTESTED})

REPEAL_WARNING_FA = (
    "هشدار: ممکن است یکی از مواد مورد استناد به‌صورت ضمنی نسخ شده باشد و اعتبار آن محل اختلاف است؛ "
    "پیش از اتکا، وضعیت آن را از وکیل یا منبع رسمی بپرسید."
)

LEASE_ADDENDUM = (
    "پرسش دربارهٔ اجاره است. در پایگاه سه قانون موجر و مستأجر (۱۳۵۶، ۱۳۶۲ و ۱۳۷۶) وجود دارد و هر کدام فقط بر "
    "قراردادهای واقع در دامنهٔ خودش حاکم است؛ تعیین قانون حاکم نظر حقوقی است. همهٔ رژیم‌های مرتبط را با "
    "شرایط اعمال هرکدام (بر پایهٔ متن بازیابی‌شده) معرفی کن، هرگز یکی را قطعاً حاکم اعلام نکن و صریح بگو "
    "قانون حاکم به تاریخ و نوع قرارداد بستگی دارد."
)
LEASE_NOTICE_FA = (
    "توجه: برای اجاره سه رژیم قانونی (قوانین موجر و مستأجر ۱۳۵۶، ۱۳۶۲ و ۱۳۷۶) وجود دارد و قانون حاکم "
    "به تاریخ و نوع قرارداد بستگی دارد؛ تعیین آن نظر حقوقی است و باید با وکیل بررسی شود."
)

MAHR_FACT = (
    "واقعیت تأییدشده توسط وکیل: ماده 22 قانون حمایت خانواده (مهریه تا 110 سکه) در حال حاضر معتبر است و فقط "
    "به حبس مربوط است. اگر 110 سکه پرداخت شود، برای باقی‌ماندهٔ مهریه حبس نیست؛ اقساط پرداخت‌نشده در "
    "محدودهٔ 110 سکه حبس را حفظ می‌کند."
)

SOCIAL_SECURITY_DISCLAIMER_FA = (
    "توجه: شرایط بازنشستگی (سن، سابقه و مسیرهای خاص) را حتماً از سازمان تأمین اجتماعی استعلام کنید؛ "
    "این پاسخ جایگزین نظر آن سازمان نیست."
)

_LEASE_TRIGGERS = ("اجاره", "مستاجر", "موجر", "اجاره نامه", "اجاره بها", "مورد اجاره")
_MAHR_TRIGGERS = ("مهریه", "مهر ", "سکه")
_RETIRE_TRIGGERS = ("بازنشست", "مستمری")
# the lease reply is acceptable when it says the governing law depends on date AND type of contract
_LEASE_MARKERS = (("بستگی",), ("تاریخ",), ("نوع",))


def _n(text: Any) -> str:
    t = _cc._norm(text).translate(str.maketrans({"أ": "ا", "ؤ": "و", "ئ": "ی", "ّ": "", "ٔ": "", "ة": "ه"}))
    return " ".join(t.split()) + " "


def is_lease_question(text: Any) -> bool:
    h = _n(text)
    return any(_n(t).strip() in h for t in _LEASE_TRIGGERS)


def is_mahr_question(text: Any) -> bool:
    h = _n(text)
    if "مهریه" in h:
        return True
    return "سکه" in h and ("حبس" in h or "مهر" in h)


def is_retirement_question(text: Any) -> bool:
    h = _n(text)
    return any(t in h for t in _RETIRE_TRIGGERS)


def prompt_addenda(user_text: Any) -> list[str]:
    """Prompt parts to append for ``user_text`` (empty list when no rule triggers)."""
    out: list[str] = []
    if is_lease_question(user_text):
        out.append(LEASE_ADDENDUM)
    if is_mahr_question(user_text):
        out.append(MAHR_FACT)
    return out


def has_contested_row(rows: Iterable[Any]) -> bool:
    for r in rows or []:
        if isinstance(r, dict) and str(r.get("repeal_status") or "").strip().lower() in CONTESTED_STATUSES:
            return True
    return False


def lease_reply_ok(reply: Any) -> bool:
    h = _n(reply)
    return all(any(m in h for m in group) for group in _LEASE_MARKERS)


def notice_lines(reply: Any, user_text: Any, rows: Iterable[Any] = ()) -> list[str]:
    """Fixed Persian lines that must accompany ``reply``; skips ones already present verbatim."""
    lines: list[str] = []
    if has_contested_row(rows):
        lines.append(REPEAL_WARNING_FA)
    if is_lease_question(user_text) and not lease_reply_ok(reply):
        lines.append(LEASE_NOTICE_FA)
    if is_retirement_question(user_text):
        lines.append(SOCIAL_SECURITY_DISCLAIMER_FA)
    current = str(reply or "")
    return [ln for ln in lines if ln not in current]


def finalize_reply(reply: str, user_text: Any, rows: Iterable[Any] = ()) -> str:
    """Append the required notice lines (one per line after a blank line); no-op when none apply."""
    lines = notice_lines(reply, user_text, rows)
    if not lines:
        return reply
    return str(reply).rstrip() + "\n\n" + "\n".join(lines)
