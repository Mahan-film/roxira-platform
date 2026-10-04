"""Pure catalog of Iranian courts/stages with deterministic keyword suggestions.

No I/O, no LLM, no logging. Suggestions are guidance only: jurisdiction depends
on the facts and on current law, and must be confirmed with a lawyer. No
statute is cited here on purpose.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

DISCLAIMER_FA = (
    "این پیشنهادها صرفاً راهنما هستند؛ صلاحیت مرجع به وقایع و قوانین جاری بستگی دارد "
    "و باید با وکیل تأیید شود."
)
INDICTMENT = "indictment"
STAGES = ("prosecution", "trial", "appeal", "disciplinary", "council")

# (key, Persian name, stage, drafts_supported)
_CATALOG_ROWS: Tuple[Tuple[str, str, str, Tuple[str, ...]], ...] = (
    ("prosecution_investigator", "دادسرا (بازپرسی)", "prosecution", (INDICTMENT,)),
    ("prosecution_deputy", "دادسرا (دادیار)", "prosecution", (INDICTMENT,)),
    ("criminal_1", "دادگاه کیفری یک", "trial", ("criminal_1",)),
    ("criminal_2", "دادگاه کیفری دو", "trial", ("criminal_2",)),
    ("general_civil", "دادگاه عمومی حقوقی", "trial", ("general_civil",)),
    ("peace", "دادگاه صلح", "trial", ("peace",)),
    ("revolution", "دادگاه انقلاب", "trial", ("revolution",)),
    ("family", "دادگاه خانواده", "trial", ("family",)),
    ("commercial", "دادگاه تجاری", "trial", ("commercial",)),
    ("labor", "دادگاه/هیئت‌های رسیدگی به اختلافات کار", "trial", ("labor",)),
    ("administrative", "دیوان عدالت اداری", "trial", ("administrative",)),
    ("dispute_council", "شورای حل اختلاف", "council", ()),
    ("guild_violations", "هیئت/کمیسیون رسیدگی به تخلفات صنفی", "disciplinary", ("guild_violations",)),
    ("computer_guild", "نظام صنفی رایانه‌ای (تخلفات فناوری و هوش مصنوعی)", "disciplinary", ("computer_guild",)),
    ("bar_disciplinary", "دادگاه انتظامی وکلا", "disciplinary", ("bar_disciplinary",)),
)

COURT_CATALOG: Dict[str, Dict[str, Any]] = {
    key: {"court_key": key, "court_name_fa": name, "stage": stage, "drafts_supported": list(drafts)}
    for key, name, stage, drafts in _CATALOG_ROWS
}

# (keywords, ((court_key, weight, reason_fa), ...))
_RULES: Tuple[Tuple[Tuple[str, ...], Tuple[Tuple[str, int, str], ...]], ...] = (
    (
        ("چک", "سفته", "برات", "شرکت", "تاجر", "سهام"),
        (
            ("commercial", 3, "موضوع به اسناد تجاری یا شرکت مربوط به نظر می‌رسد"),
            ("general_civil", 2, "دعوای مالی/قراردادی در صلاحیت عمومی حقوقی نیز می‌تواند باشد"),
        ),
    ),
    (
        ("مهریه", "طلاق", "حضانت", "نفقه", "ملاقات فرزند", "جهیزیه"),
        (("family", 5, "موضوع خانوادگی است"),),
    ),
    (
        ("اخراج", "حق السعی", "حق‌السعی", "کارفرما", "کارگر", "بیمه کارگری", "سنوات"),
        (("labor", 5, "موضوع رابطهٔ کار است"),),
    ),
    (
        ("کلاهبرداری", "سرقت", "ضرب و جرح", "ضرب‌وجرح", "توهین", "خیانت در امانت", "جعل"),
        (
            ("criminal_2", 4, "جرم عمومی؛ معمولاً در مرحلهٔ رسیدگی کیفری دو"),
            ("prosecution_deputy", 3, "پیش از دادگاه، تحقیقات مقدماتی در دادسرا انجام می‌شود"),
        ),
    ),
    (
        ("قتل", "تجاوز", "آدم‌ربایی", "آدم ربایی", "جرایم مهم", "جرم مهم"),
        (
            ("criminal_1", 5, "جرم مهم؛ احتمالاً در صلاحیت کیفری یک"),
            ("prosecution_investigator", 3, "تحقیقات مقدماتی جرایم مهم معمولاً با بازپرس است"),
        ),
    ),
    (
        ("امنیتی", "مواد مخدر", "محاربه", "قاچاق", "جاسوسی"),
        (("revolution", 5, "موضوع امنیتی/مواد مخدر؛ احتمالاً دادگاه انقلاب"),),
    ),
    (
        ("گران‌فروشی", "گرانفروشی", "گران فروشی", "عدم درج قیمت", "اصناف", "واحد صنفی", "پروانه کسب"),
        (("guild_violations", 5, "موضوع تخلف صنفی است"),),
    ),
    (
        ("نرم‌افزار", "نرم افزار", "رایانه", "هوش مصنوعی", "نظام صنفی رایانه‌ای"),
        (("computer_guild", 4, "موضوع حوزهٔ فناوری/رایانه یا هوش مصنوعی است"),),
    ),
    (
        ("وکیل", "کانون وکلا", "کانون"),
        (("bar_disciplinary", 4, "شکایت یا تخلف مرتبط با وکیل/کانون وکلا"),),
    ),
    (
        ("مصوبه", "تصمیم اداری", "دستگاه اجرایی", "شهرداری", "سازمان دولتی"),
        (("administrative", 5, "اعتراض به مصوبه یا تصمیم اداری"),),
    ),
    (
        ("خواسته مالی کوچک", "مبلغ کم", "خواسته کم", "مبلغ اندک", "دعوای خرد"),
        (
            ("peace", 4, "خواسته مالی کوچک؛ ممکن است در صلاحیت دادگاه صلح باشد"),
            ("dispute_council", 3, "برای خواستهٔ اندک، شورای حل اختلاف نیز محتمل است"),
        ),
    ),
)

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_ZWNJ = "‌"


def _norm(text: Any) -> str:
    value = str(text or "").translate(_DIGITS).replace("ي", "ی").replace("ك", "ک")
    return " ".join(value.replace(_ZWNJ, " ").split()).lower()


def suggest_courts(facts: str, claims: str, hint: Optional[str] = None) -> List[Dict[str, Any]]:
    """Top 3 courts by keyword score; ties keep catalog order. Deterministic."""
    haystack = _norm(str(facts or "") + " " + str(claims or ""))
    scores: Dict[str, int] = {}
    reasons: Dict[str, str] = {}
    for keywords, targets in _RULES:
        hits = sum(1 for k in keywords if _norm(k) in haystack)
        if not hits:
            continue
        for key, weight, reason in targets:
            scores[key] = scores.get(key, 0) + weight + (hits - 1)
            reasons.setdefault(key, reason)
    hint_n = _norm(hint) if hint else ""
    if hint_n:
        for key, meta in COURT_CATALOG.items():
            name_n = _norm(meta["court_name_fa"])
            if key in hint_n or name_n in hint_n or hint_n in name_n:
                scores[key] = scores.get(key, 0) + 2
                reasons.setdefault(key, "مطابق با راهنمایی کاربر")
    order = {key: i for i, key in enumerate(COURT_CATALOG)}
    ranked = sorted(scores, key=lambda k: (-scores[k], order[k]))[:3]
    return [
        {
            "court_key": k,
            "court_name_fa": COURT_CATALOG[k]["court_name_fa"],
            "stage": COURT_CATALOG[k]["stage"],
            "reason_fa": reasons[k],
            "score": scores[k],
        }
        for k in ranked
    ]
