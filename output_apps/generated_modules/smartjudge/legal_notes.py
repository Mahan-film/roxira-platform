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

Round 2 (lawyer answers of 2026-10-21, docs/LAWYER_ANSWERS_2026-10-21.md), same mechanism:

* Q1/Q2   short imprisonment: statutory facts (IPC 1392 art 65-67, 70) and the lawyer's practice note are injected
          into the prompt; a fixed notice is appended when the reply never mentions the alternative punishments.
* Q15     cheques: art 11 deadlines (6 + 6 months), ruling 812 and the lawyer's practice notes.
* Q18     filing: practice note that petitions/complaints are filed through the judicial electronic services offices.
* Q20     property transactions: the new Saghar registration system (practice note, official notice still unchecked).

Statutory facts are worded as such; everything that comes only from the lawyer is worded «طبق رویهٔ عملی».

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

# ---- round 2 (2026-10-21) -------------------------------------------------------------------
SHORT_PRISON_FACT = (
    "پرسش دربارهٔ حبس کوتاه‌مدت یا مجازات جایگزین حبس است. متن قانون (قانون مجازات اسلامی ۱۳۹۲): طبق ماده 65 "
    "مرتکبان جرایم عمدی که حداکثر مجازات قانونی آنها سه ماه حبس است به‌جای حبس به مجازات جایگزین حبس محکوم "
    "می‌شوند؛ ماده 66 همین قاعده را برای حداکثر «نود و یک روز تا شش ماه» دارد، مگر آنکه متهم سابقهٔ محکومیت "
    "مؤثر داشته باشد؛ ماده 67 برای حداکثر بیش از شش ماه تا یک سال، اعمال مجازات جایگزین را اختیاری دادگاه می‌داند؛ "
    "ماده 70: دادگاه ضمن تعیین مجازات جایگزین، مدت حبس را هم تعیین می‌کند تا در صورت تعذر اجرا اعمال شود. "
    "طبق رویهٔ عملی (نظر وکیل، نه متن قانون): حکم حبس کمتر از سه ماه صادر نمی‌شود و باید به مجازات جایگزین تبدیل شود؛ "
    "اگر حداقل قانونی کمتر از سه ماه باشد، قاضی کمتر از 91 روز حبس تعیین نمی‌کند؛ و در عمل برای جرایمی مانند تهدید "
    "و توهین معمولاً جزای نقدی به‌جای حبس یا شلاق حکم داده می‌شود. این بخش رویه را با برچسب «طبق رویهٔ عملی» بگو."
)
SHORT_PRISON_NOTICE_FA = (
    "توجه: طبق مواد 65 تا 67 و 70 قانون مجازات اسلامی ۱۳۹۲، در جرایم عمدی با حداکثر مجازات تا سه ماه حبس، "
    "دادگاه به‌جای حبس به مجازات جایگزین حبس (مانند جزای نقدی، دوره مراقبت یا خدمات عمومی) حکم می‌دهد و برای "
    "حداکثر بیش از سه ماه تا شش ماه نیز اصل بر مجازات جایگزین است. طبق رویهٔ عملی، حکم حبس کمتر از سه ماه صادر "
    "نمی‌شود و در تهدید و توهین معمولاً جزای نقدی تعیین می‌شود."
)

CHEQUE_FACT = (
    "پرسش دربارهٔ چک است. متن قانون: طبق ماده 11 قانون صدور چک (در برخی متون ماده 10)، اگر دارنده تا شش ماه از "
    "تاریخ صدور چک برای وصول به بانک مراجعه نکند یا ظرف شش ماه از تاریخ گواهی عدم پرداخت شکایت نکند، دیگر حق شکایت "
    "کیفری ندارد؛ این مهلت فقط شکایت کیفری را محدود می‌کند. طبق ماده 13 (در برخی متون ماده 12)، چک سفیدامضا، "
    "مشروط یا تضمینی قابل تعقیب کیفری نیست. طبق رأی وحدت رویهٔ 812 دیوان عالی کشور مبدأ خسارت تأخیر تأدیه چک "
    "تاریخ چک است. طبق رویهٔ عملی (نظر وکیل): مرجع شکایت کیفری چک دادسرا است؛ در چک‌های صیادی پس از عدم پرداخت "
    "دعوای حقوقی هم دنبال می‌شود؛ چک‌های عادی قدیمی که مهلت شش‌ماهه را از دست داده‌اند قابل پیگرد کیفری نیستند ولی "
    "اصل وجه و خسارت تأخیر از تاریخ چک در دعوای حقوقی قابل مطالبه است؛ دعاوی تا سقف نصاب دادگاه صلح (طبق جدول "
    "صلاحیت) در دادگاه صلح و بالاتر از آن در دادگاه عمومی حقوقی رسیدگی می‌شود."
)
CHEQUE_NOTICE_FA = (
    "توجه (چک): شکایت کیفری فقط برای چکی ممکن است که تضمینی، مشروط یا سفیدامضا نباشد، ظرف شش ماه از تاریخ چک "
    "برای وصول به بانک ارائه و برگشت شود و ظرف شش ماه از تاریخ گواهی عدم پرداخت به دادسرا شکایت شود (ماده 11 "
    "قانون صدور چک). پس از این مهلت راه کیفری بسته است ولی دعوای حقوقی برای اصل وجه و خسارت تأخیر از تاریخ چک "
    "باز می‌ماند (رأی وحدت رویهٔ 812)؛ طبق رویهٔ عملی در چک‌های صیادی پس از عدم پرداخت مسیر حقوقی دنبال می‌شود."
)

FILING_FACT = (
    "طبق رویهٔ عملی (نظر وکیل): هر دادخواست یا شکوائیه باید از طریق دفاتر خدمات الکترونیک قضایی ثبت شود؛ "
    "در پاسخ به پرسش دربارهٔ ثبت یا تقدیم دعوا و شکایت، این نکته را بگو. (ماده 655 تبصره 2 قانون آیین دادرسی "
    "کیفری قوه قضاییه را به ایجاد این دفاتر مجاز کرده است.)"
)
FILING_NOTICE_FA = (
    "توجه: طبق رویهٔ عملی، ثبت دادخواست و شکوائیه از طریق دفاتر خدمات الکترونیک قضایی انجام می‌شود "
    "(مبنای ایجاد این دفاتر: ماده 655 قانون آیین دادرسی کیفری)."
)

PROPERTY_FACT = (
    "پرسش دربارهٔ معامله یا ثبت ملک است. طبق اعلام وکیل (رویهٔ عملی؛ متن قانونی آن در پایگاه نیست و «نیازمند "
    "بررسی» است): سامانهٔ جدید «ساغر» برای ثبت املاک راه‌اندازی شده و ثبت قولنامه‌ها (سند عادی) برای ملک‌هایی که "
    "سابقهٔ ثبتی دارند اکنون اجباری است. حتماً این نکته را با همین برچسب بگو و آن را قطعی‌تر از این نقل نکن."
)
PROPERTY_NOTICE_FA = (
    "توجه: طبق اعلام وکیل (رویهٔ عملی، نیازمند بررسی با ابلاغیهٔ رسمی)، سامانهٔ جدید «ساغر» برای ثبت املاک "
    "راه‌اندازی شده و ثبت قولنامه‌ها برای ملک‌های دارای سابقهٔ ثبتی اجباری است."
)

_LEASE_TRIGGERS = ("اجاره", "مستاجر", "موجر", "اجاره نامه", "اجاره بها", "مورد اجاره")
_MAHR_TRIGGERS = ("مهریه", "مهر ", "سکه")
_RETIRE_TRIGGERS = ("بازنشست", "مستمری")
_PRISON_WORDS = ("حبس", "زندان")
# duration words only count together with a prison word; offence words (where the lawyer says courts fine
# instead of jailing, items 66/67) count alone because the user often asks «مجازات توهین چیست؟» without «حبس»
_SHORT_PRISON_MARKERS = ("سه ماه", "3 ماه", "نود و یک", "91 روز", "کوتاه")
_SHORT_PRISON_OFFENCES = ("توهین", "فحاشی", "تهدید", "هجو", "مزاحمت", "افترا", "نشر اکاذیب")
_ALT_PUNISHMENT_TRIGGERS = ("مجازات جایگزین", "جایگزین حبس", "مجازاتهای جایگزین", "مجازات های جایگزین")
_CHEQUE_TOKENS = frozenset({"چک", "چکی", "چکها", "چکهای", "چک ها", "چکم", "صیادی"})
_FILING_TRIGGERS = ("دادخواست", "شکوایی", "شکایت", "طرح دعو", "ثبت دعو", "اقامه دعو")
_PROPERTY_TRIGGERS = ("قولنامه", "مبایعه", "ثبت ملک", "ثبت املاک", "سند رسمی", "سند ملک", "سند عادی",
                      "خرید ملک", "فروش ملک", "خرید خانه", "فروش خانه", "خرید آپارتمان", "فروش آپارتمان",
                      "خرید زمین", "فروش زمین", "معامله ملک", "انتقال ملک", "انتقال سند", "ثبت اسناد", "ثبت سند",
                      "املاک")
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


def is_short_prison_question(text: Any) -> bool:
    h = _n(text)
    if any(_n(t).strip() in h for t in _ALT_PUNISHMENT_TRIGGERS):
        return True
    if any(o in h for o in _SHORT_PRISON_OFFENCES):
        return True
    return any(w in h for w in _PRISON_WORDS) and any(m in h for m in _SHORT_PRISON_MARKERS)


def is_cheque_question(text: Any) -> bool:
    return bool(set(_n(text).split()) & _CHEQUE_TOKENS)


def is_filing_question(text: Any) -> bool:
    h = _n(text)
    return any(t in h for t in _FILING_TRIGGERS)


def is_property_question(text: Any) -> bool:
    """Property sale/registration questions; leases are a separate rule (item 4)."""
    h = _n(text)
    if is_lease_question(text):
        return False
    return any(_n(t).strip() in h for t in _PROPERTY_TRIGGERS)


def prompt_addenda(user_text: Any) -> list[str]:
    """Prompt parts to append for ``user_text`` (empty list when no rule triggers)."""
    out: list[str] = []
    if is_lease_question(user_text):
        out.append(LEASE_ADDENDUM)
    if is_mahr_question(user_text):
        out.append(MAHR_FACT)
    if is_short_prison_question(user_text):
        out.append(SHORT_PRISON_FACT)
    if is_cheque_question(user_text):
        out.append(CHEQUE_FACT)
    if is_filing_question(user_text):
        out.append(FILING_FACT)
    if is_property_question(user_text):
        out.append(PROPERTY_FACT)
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
    hr = _n(reply)
    if is_short_prison_question(user_text) and "جایگزین" not in hr:
        lines.append(SHORT_PRISON_NOTICE_FA)
    if is_cheque_question(user_text) and not any(m in hr for m in ("شش ماه", "6 ماه")):
        lines.append(CHEQUE_NOTICE_FA)
    if is_filing_question(user_text) and "دفاتر خدمات الکترونیک قضایی" not in hr:
        lines.append(FILING_NOTICE_FA)
    if is_property_question(user_text) and "ساغر" not in hr:
        lines.append(PROPERTY_NOTICE_FA)
    current = str(reply or "")
    return [ln for ln in lines if ln not in current]


def finalize_reply(reply: str, user_text: Any, rows: Iterable[Any] = ()) -> str:
    """Append the required notice lines (one per line after a blank line); no-op when none apply."""
    lines = notice_lines(reply, user_text, rows)
    if not lines:
        return reply
    return str(reply).rstrip() + "\n\n" + "\n".join(lines)
