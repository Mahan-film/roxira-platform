"""Pure prompt library for the Smart Judge /consult path (no I/O, no import-time effects).

* ``detect_domains``: deterministic Persian keyword rules -> scored legal domains.
* ``expand_competence_queries``: extra retrieval queries for competence questions.
* ``build_system_prompt``: structured Persian system prompt (single-domain,
  multi-domain and competence templates).

Smart Judge is a NON-BINDING AI assistant. Keyword rules and checklists here are
NOT legally reviewed. No statute is cited in this file on purpose: articles may
only come from retrieved text.
"""

from __future__ import annotations

import os
from typing import Any

from output_apps.generated_modules.smartjudge import chat_safety as _cs
from output_apps.generated_modules.smartjudge import court_catalog as _cc

ENV_FLAG = "SMARTJUDGE_PROMPT_LIBRARY"
MAX_EXTRA_QUERIES = 3
MAX_DOMAINS_IN_PROMPT = 4
MAX_ANSWER_WORDS = 450
MAX_CLARIFYING_QUESTIONS = 3

DOMAIN_LABELS_FA: dict[str, str] = {
    "civil": "حقوقی (مدنی)",
    "criminal": "کیفری",
    "family": "خانواده",
    "commercial": "تجاری",
    "labor": "کار",
    "administrative": "اداری (دیوان عدالت اداری)",
    "guild_violations": "تخلفات صنفی",
    "computer_guild": "نظام صنفی رایانه‌ای",
    "disciplinary_bar": "انتظامی وکلا",
    "competence_question": "پرسش صلاحیت",
}

# domain -> keywords (normalised on use). Tune here; see docs/ops/SMARTJUDGE_PROMPTS.md.
DOMAIN_KEYWORDS: dict[str, tuple[str, ...]] = {
    "civil": (
        "دادخواست", "خواهان", "خوانده", "مطالبه", "خسارت", "قرارداد", "ملک", "سند",
        "تخلیه", "اجاره", "الزام", "ابطال", "فسخ", "دعوای حقوقی", "دعوای مالی", "طلب",
        "دعوای خرد", "خواسته مالی",
    ),
    "criminal": (
        "شکایت کیفری", "کلاهبرداری", "سرقت", "ضرب و جرح", "توهین", "خیانت در امانت",
        "جعل", "قتل", "تهدید", "جرم", "دادسرا", "بازپرس", "دادیار", "کیفرخواست",
        "مجازات", "بزه", "قاچاق", "مواد مخدر", "محاربه", "امنیتی", "جاسوسی",
        "آدم ربایی", "تجاوز",
    ),
    "family": ("مهریه", "طلاق", "حضانت", "نفقه", "ملاقات فرزند", "جهیزیه", "نکاح", "عقدنامه"),
    "commercial": ("چک", "سفته", "برات", "شرکت", "تاجر", "سهام", "ورشکستگی", "تجاری"),
    "labor": ("اخراج", "حق السعی", "کارفرما", "کارگر", "بیمه کارگری", "سنوات", "قرارداد کار"),
    "administrative": (
        "مصوبه", "تصمیم اداری", "دستگاه اجرایی", "شهرداری", "سازمان دولتی",
        "دیوان عدالت اداری", "ابطال مصوبه", "کمیسیون ماده",
    ),
    "guild_violations": (
        "گران فروشی", "گرانفروشی", "عدم درج قیمت", "اصناف", "واحد صنفی", "پروانه کسب",
        "تخلف صنفی", "تعزیرات",
    ),
    "computer_guild": (
        "نرم افزار", "رایانه", "هوش مصنوعی", "نظام صنفی رایانه ای", "نظام صنفی رایانه",
    ),
    "disciplinary_bar": (
        "کانون وکلا", "دادگاه انتظامی وکلا", "تخلف انتظامی", "انتظامی وکلا", "وکیل متخلف",
    ),
    "competence_question": (
        "صلاحیت", "مرجع صالح", "دادگاه صالح", "کدام دادگاه", "کدام مرجع", "کجا باید شکایت",
        "کجا باید دادخواست", "کجا طرح", "دادگاه صلح", "قانون دادگاه صلح", "صلاحیت ذاتی",
        "صلاحیت محلی", "مرجع رسیدگی", "کدام شعبه", "عدم صلاحیت", "قرار عدم صلاحیت",
    ),
}

DOMAIN_ORDER: tuple[str, ...] = tuple(DOMAIN_KEYWORDS)

# Targeted expansions for competence questions (capped by MAX_EXTRA_QUERIES).
COMPETENCE_QUERY_TEMPLATES: tuple[str, ...] = (
    "صلاحیت دادگاه صلح",
    "قانون دادگاه صلح 1402",
    "صلاحیت ذاتی",
    "صلاحیت محلی",
)

_NORM = _cc._norm  # same normalisation as the court catalog (digits, ی/ک, ZWNJ)


def detect_domains(text: str) -> list[dict[str, Any]]:
    """Scored domains for ``text``; highest score first, ties keep DOMAIN_ORDER."""
    haystack = _NORM(text)
    if not haystack:
        return []
    found: list[dict[str, Any]] = []
    for domain in DOMAIN_ORDER:
        hits = 0
        for kw in DOMAIN_KEYWORDS[domain]:
            if _NORM(kw) in haystack:
                hits += 1
        if hits:
            found.append({"domain": domain, "score": hits})
    order = {d: i for i, d in enumerate(DOMAIN_ORDER)}
    found.sort(key=lambda r: (-r["score"], order[r["domain"]]))
    return found


def _is_competence(domains: list[dict[str, Any]]) -> bool:
    return any(d.get("domain") == "competence_question" for d in domains or [])


def _case_domains(domains: list[dict[str, Any]]) -> list[str]:
    names = [d["domain"] for d in domains or [] if d.get("domain") != "competence_question"]
    return names[:MAX_DOMAINS_IN_PROMPT]


def expand_competence_queries(text: str) -> list[str]:
    """Up to 3 de-duplicated extra retrieval queries when a competence question is detected."""
    if not _is_competence(detect_domains(text)):
        return []
    base = _NORM(text)
    out: list[str] = []
    seen = {base}
    for q in COMPETENCE_QUERY_TEMPLATES:
        key = _NORM(q)
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
        if len(out) >= MAX_EXTRA_QUERIES:
            break
    return out


def prompt_library_enabled() -> bool:
    return os.environ.get(ENV_FLAG, "").strip().lower() in ("1", "true", "yes", "on")


_ROLE = (
    "شما «قاضی هوشمند»، یک دستیار هوش مصنوعی غیرالزام‌آور برای راهنمایی حقوقی هستید؛ "
    "قاضی، وکیل یا مرجع رسمی نیستید و پاسخ شما رأی یا مشاورهٔ قطعی نیست."
)

_GROUNDING_RULES = (
    "قواعد استناد: فقط به موادی استناد کن که در بخش «مواد قانونی استخراج‌شده» همین پیام آمده است. "
    "هرگز شمارهٔ ماده، شمارهٔ رأی یا تاریخ تصویب نساز. اگر مادهٔ لازم در متن بازیابی‌شده نیست، "
    "بنویس «" + _cs.UNVERIFIED_ARTICLE_MARK + "» و از کاربر یا وکیل بخواه آن را راستی‌آزمایی کند."
)

_UNGROUNDED_RULES = (
    "در پایگاه دانش مستند مرتبطی یافت نشد؛ فقط به‌صورت کلی به اصول و نهادهای حقوقی اشاره کن، "
    "هیچ شماره‌ای برای ماده یا رأی ذکر نکن و پاسخ را رد نکن."
)

_LIMITS = (
    "حداکثر طول پاسخ حدود " + str(MAX_ANSWER_WORDS) + " کلمه است؛ هر بخش کوتاه و گزاره‌ای باشد. "
    "اگر وقایع برای نتیجه‌گیری کافی نیست، حداکثر " + str(MAX_CLARIFYING_QUESTIONS)
    + " پرسش روشن‌کننده بپرس و حدس نزن."
)

_PER_DOMAIN_SECTIONS = (
    "وقایع مؤثر",
    "صلاحیت/مرجع صالح",
    "مستند قانونی (فقط از پایگاه)",
    "مهلت‌ها",
    "ادله",
    "ریسک‌ها",
    "گام بعدی",
)

_COMPETENCE_TEMPLATE = (
    "این یک پرسش دربارهٔ صلاحیت است. پاسخ را دقیقاً در این سه بخش بده: "
    "۱) «قاعدهٔ حاکم»: ابتدا قاعدهٔ صلاحیت را فقط از متن بازیابی‌شده بیان کن و منبع آن را نام ببر؛ "
    "اگر متن مرتبطی نیست صریحاً بگو «در پایگاه دانش نص مرتبط یافت نشد». "
    "۲) «انطباق با وقایع»: قاعده را بر وقایع کاربر تطبیق بده و مرجع یا مرحلهٔ محتمل "
    "را به‌صورت راهنما بگو. "
    "۳) «استثناها و مواردی که باید راستی‌آزمایی شود»: استثناها، قوانین خاص و تغییرات اخیر "
    "(مثلاً قانون دادگاه‌های صلح مصوب 1402 در صورت نبودن متنش در پایگاه) "
    "را فهرست کن و بگو باید با وکیل تأیید شود."
)


def _multi_domain_template(domains: list[str]) -> str:
    sections = "؛ ".join(_PER_DOMAIN_SECTIONS)
    names = "، ".join(DOMAIN_LABELS_FA[d] for d in domains)
    return (
        "این پرونده چندحوزه‌ای است (" + names + "). حوزه‌ها را از هم جدا کن "
        "و ساختار پاسخ الزامی است: "
        "برای هر حوزه یک بخش کوتاه با عنوان همان حوزه و زیرعنوان‌های (" + sections + ") بیاور. "
        "سپس بخش پایانی «ارتباط میان دعاوی» را بنویس (مثلاً اثر دعوای کیفری بر دعوای حقوقی، "
        "تأثیر زمان‌بندی‌ها بر یکدیگر) و در پایان فهرست کوتاه «اطلاعات ناقص» را بیاور."
    )


def _single_domain_template(domain: str | None) -> str:
    label = DOMAIN_LABELS_FA.get(domain or "", "عمومی")
    return (
        "حوزهٔ اصلی: " + label + ". پاسخ را کوتاه و ساختاریافته بده: "
        "وقایع مؤثر، مرجع صالح (راهنما)، "
        "مستند قانونی (فقط از پایگاه)، مهلت‌ها و گام بعدی."
    )


def _courts_guidance(user_text: str) -> str:
    try:
        courts = _cc.suggest_courts(user_text, "")
    except Exception:  # pragma: no cover - defensive
        return ""
    if not courts:
        return ""
    names = "؛ ".join(c["court_name_fa"] for c in courts)
    return "مراجع احتمالی (فقط راهنما، نه نتیجهٔ قطعی): " + names + ". " + _cc.DISCLAIMER_FA


def build_system_prompt(domains: list[dict[str, Any]], grounded: bool, user_text: str) -> str:
    """Compose the structured Persian system prompt. Pure and deterministic."""
    parts: list[str] = [_ROLE]
    parts.append(_GROUNDING_RULES if grounded else _UNGROUNDED_RULES)
    parts.append(_cs.LATIN_DIGITS_INSTRUCTION)
    case_domains = _case_domains(domains)
    if _is_competence(domains):
        parts.append(_COMPETENCE_TEMPLATE)
        if len(case_domains) >= 2:
            parts.append(_multi_domain_template(case_domains))
    elif len(case_domains) >= 2:
        parts.append(_multi_domain_template(case_domains))
    else:
        parts.append(_single_domain_template(case_domains[0] if case_domains else None))
    guidance = _courts_guidance(user_text)
    if guidance:
        parts.append(guidance)
    parts.append(_LIMITS)
    return "\n".join(parts)
