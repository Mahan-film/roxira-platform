#!/usr/bin/env python3
"""ekhtebar.ir -> court rulings (آرای وحدت رویه دیوان عالی کشور + آرای هیئت عمومی دیوان عدالت اداری). No LLM.

Source: www.ekhtebar.ir ONLY (owner rule), WordPress REST like fetch_ekhtebar_wp.py / law_watch.py:
  category 247 = آرا وحدت رویه (Supreme Court unity rulings, mixed with news/commentary posts)
  category 794 = آرای دیوان عدالت اداری (General Board annulments + board unity rulings + other items)
Every row is `source_tier: unofficial`, `needs_review: true`. Politeness comes from fetch_ekhtebar_wp.Client: browser UA,
>= 2 s between requests, robots.txt honoured, 401/403/429/451/5xx or a CAPTCHA/challenge stops the run (never bypassed),
budget default 600 requests (a full run needs about 25).

  fetch_unity_rulings.py fetch --raw-dir DIR            page both categories (10 posts/call, full content; larger pages arrive truncated) -> DIR/cat<id>_o<offset>_n<size>.json
                                                         (pages already on disk are reused; --refresh re-downloads)
  fetch_unity_rulings.py stage --raw-dir DIR [--date 2026-10-12] [--out-dir data/legal/staged]
                                                         parse -> unity_rulings_<date>.jsonl, admin_court_board_rulings_<date>.jsonl
                                                         (+ a *_report.json); existing files are never overwritten
  fetch_unity_rulings.py run    --raw-dir DIR ...        fetch + stage
  fetch_unity_rulings.py validate FILE.jsonl             schema / duplicate / HTML-junk checks

Parsing is pure regex (functions below are unit-tested offline in tests/test_unity_rulings.py).
"""

# ruff: noqa: RUF001, RUF002
from __future__ import annotations

import argparse
import http.client
import importlib.util
import json
import re
import sys
import tempfile
import time
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAT_UNITY, CAT_ADMIN = 247, 794
PER_PAGE = 10
MAX_REQUESTS = 600
FIELDS = "id,date,modified,link,title,categories,content"
SOURCE = "ekhtebar"
BODY_SC = "هیئت عمومی دیوان عالی کشور"
BODY_ADMIN = "هیئت عمومی دیوان عدالت اداری"
TYPE_SC_UNITY = "unity_supreme_court"
TYPE_ADMIN_ANNUL = "admin_court_annulment"
TYPE_ADMIN_UNITY = "admin_court_unity"
TYPE_ADMIN_OTHER = "admin_court_board_other"  # legacy label, no longer produced


def _fe():
    name = "fetch_ekhtebar_wp"
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/legal/fetch_ekhtebar_wp.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


# ----------------------------------------------------------------------------- text helpers
_TRANS = str.maketrans({
    "ي": "ی", "ك": "ک", "ة": "ه", "أ": "ا", "إ": "ا", "ؤ": "و", "ٔ": "", "ـ": "", "‌": " ", "‏": "", "‎": "", "‍": "",
    **{chr(0x06F0 + i): str(i) for i in range(10)}, **{chr(0x0660 + i): str(i) for i in range(10)},
})  # fmt: skip


def norm(text: str) -> str:
    """Comparison form: Persian letters/digits unified, ZWNJ -> space, hamza/tatweel dropped, spaces collapsed."""
    t = str(text or "").translate(_TRANS).replace("آئین", "آیین").replace("ً", "").replace("ٌ", "").replace("ٍ", "")
    t = t.replace("ّ", "").replace("ْ", "").replace("َ", "").replace("ُ", "").replace("ِ", "")
    return re.sub(r"\s+", " ", t).strip()


def ascii_digits(text: str) -> str:
    return str(text or "").replace("\u200d", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))


def jalali_to_iso(date: str) -> str | None:
    """'1405/6/17' (Persian or Latin digits) -> '2026-09-08'. None when it is not a plausible date."""
    m = re.fullmatch(r"\s*(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\s*", ascii_digits(date or ""))
    if not m:
        return None
    jy, jm, jd = (int(x) for x in m.groups())
    if not (1 <= jm <= 12 and 1 <= jd <= 31) or jy < 1200:
        return None
    # standard Jalali -> Gregorian algorithm (jalaali-js style arithmetic)
    jy -= 979
    jm -= 1
    jd -= 1
    j_days_in_month = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29]
    g_days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    j_day_no = 365 * jy + (jy // 33) * 8 + ((jy % 33 + 3) // 4)
    for i in range(jm):
        j_day_no += j_days_in_month[i]
    j_day_no += jd
    g_day_no = j_day_no + 79
    gy = 1600 + 400 * (g_day_no // 146097)
    g_day_no %= 146097
    leap = True
    if g_day_no >= 36525:
        g_day_no -= 1
        gy += 100 * (g_day_no // 36524)
        g_day_no %= 36524
        if g_day_no >= 365:
            g_day_no += 1
        else:
            leap = False
    gy += 4 * (g_day_no // 1461)
    g_day_no %= 1461
    if g_day_no >= 366:
        leap = False
        g_day_no -= 1
        gy += g_day_no // 365
        g_day_no %= 365
    gm = 0
    while gm < 12:
        dim = g_days_in_month[gm] + (1 if gm == 1 and leap else 0)
        if g_day_no < dim:
            break
        g_day_no -= dim
        gm += 1
    return f"{gy:04d}-{gm + 1:02d}-{g_day_no + 1:02d}"


_MONTHS = {"فروردین": 1, "اردیبهشت": 2, "خرداد": 3, "تیر": 4, "مرداد": 5, "شهریور": 6, "مهر": 7, "آبان": 8, "آذر": 9,
           "دی": 10, "بهمن": 11, "اسفند": 12}  # fmt: skip


def clean_date(date: str) -> str:
    """Zero-padded Latin-digit Jalali 'YYYY/MM/DD' ('' when unparsable or implausible). Handles Persian digits, «؍» separators,
    day/month/year order, 2-digit years, month names («۵ تیر ۱۴۰۰») and Shahanshahi years (2536 = 1356)."""
    t = ascii_digits(date or "").replace("؍", "/")
    y = mo = d = None
    m = re.search(r"(?<!\d)(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})(?!\d)", t)  # d/m/yyyy
    if m:
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.search(r"(?<!\d)(\d{4}|\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?!\d)", t)
        if m:
            y, mo, d = int(m[1]), int(m[2]), int(m[3])
            if y < 100:
                y += 1300
        else:
            m = re.search(r"(\d{1,2})\s+(" + "|".join(_MONTHS) + r")\s+(\d{4})", norm(t))
            if m:
                d, mo, y = int(m[1]), _MONTHS[m[2]], int(m[3])
    if y is None:
        return ""
    if 2400 <= y <= 2600:  # Shahanshahi year
        y -= 1180
    if not (1280 <= y <= 1460 and 1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return f"{y:04d}/{mo:02d}/{d:02d}"


_CHROME_CUT_RE = re.compile(
    r"^\s*(?:جدیدترین آراء وحدت رویه|تازه‌های قوانین|مطالب مرتبط|مستندات مرتبط|برچسب‌ها|دیدگاه‌ها|ارسال دیدگاه)\b.*$", re.M)
_RELATED_RE = re.compile(r"^\s*مواد قانونی مرتبط\s*:?\s*$", re.M)


def split_related(text: str) -> tuple[str, str]:
    """(ruling text, related-provisions block). Page chrome (latest rulings, tags...) is dropped; the quoted statute
    texts ekhtebar appends under «مواد قانونی مرتبط:» are kept apart from the ruling itself."""
    m = _CHROME_CUT_RE.search(text)
    if m:
        text = text[: m.start()]
    r = _RELATED_RE.search(text)
    if r:
        return text[: r.start()].strip(), text[r.end():].strip()
    return text.strip(), ""


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]


# ----------------------------------------------------------------------------- law / article references
_STOP = {
    "مصوب", "مورخ", "اصلاحی", "اصلاحات", "الحاقی", "الحاقات", "که", "را", "است", "می", "نیز", "چنین", "مذکور", "مزبور",
    "مرقوم", "یادشده", "فوق", "اشاره", "مبنی", "دایر", "نموده", "کرده", "شده", "بوده", "باشد", "لذا", "بنابراین", "پس",
    "ناظر", "مقرر", "مقرره", "صادر", "مندرج", "به", "برای", "از", "در", "با", "تا", "هر", "این", "آن", "لیکن", "ولی",
    "یا", "اما", "هیچ", "مجلس", "سال", "بعدی", "قبلی", "همان", "طبق", "موجب", "مستند", "استناد", "بر", "بند", "تبصره",
    "ماده", "مواد", "اصل", "فصل", "الف", "ب", "ج", "د", "شماره", "بهره", "مند", "پیش", "گفته", "اخیر", "اخیرالذکر",
    "مارالذکر", "الذکر", "خارج", "درصورتی", "منطبق", "نمی", "مورد", "موارد", "آمده",
}  # fmt: skip
_NUM = r"[\d]+(?:\s*مکرر)?"
_NUMLIST = rf"{_NUM}(?:\s*(?:،|,|و|تا|الی|ـ|-)\s*{_NUM})*"
_REF_RE = re.compile(
    rf"(?P<kind>ماده\s+واحده|مواد|ماده|اصل|اصول)\s*(?:ی\s*)?\(?\s*(?P<nums>{_NUMLIST})?\s*\)?\s*"
    r"(?P<tail>(?:الحاقی|اصلاحی|مکرر)\s*)*"
    r"(?:(?P<this>این\s+قانون)|(?P<again>قانون\s+(?:یاد\s*شده|مذکور|مزبور|فوق|مرقوم))|(?P<law>(?:قانون|آیین\s*نامه|اساسنامه)\s+[^\n.؛:«»()\[\]]{1,160}))?"
)
_PUNCT_STOP = re.compile(r"[،,؛:؟?!()\[\]«»“”\"]")


KNOWN_LAWS = (
    "قانون اساسی", "قانون مدنی", "قانون مجازات اسلامی", "قانون آیین دادرسی کیفری", "قانون آیین دادرسی مدنی",
    "قانون آیین دادرسی دادگاه های عمومی و انقلاب در امور مدنی", "قانون آیین دادرسی دادگاه های عمومی و انقلاب",
    "قانون آیین دادرسی دیوان عدالت اداری", "قانون تشکیلات و آیین دادرسی دیوان عدالت اداری", "قانون دیوان عدالت اداری",
    "قانون تجارت", "قانون صدور چک", "قانون ثبت اسناد و املاک", "قانون ثبت احوال", "قانون اجرای احکام مدنی",
    "قانون کار", "قانون تامین اجتماعی", "قانون حمایت خانواده", "قانون مسئولیت مدنی", "قانون شوراهای حل اختلاف",
    "قانون نحوه اجرای محکومیت های مالی", "قانون تشکیل دادگاه های عمومی و انقلاب", "قانون مبارزه با قاچاق کالا و ارز",
    "قانون مبارزه با مواد مخدر", "قانون جرایم رایانه ای", "قانون روابط موجر و مستاجر", "قانون کاهش مجازات حبس تعزیری",
    "قانون مجازات جرایم نیروهای مسلح", "قانون مالیات های مستقیم", "قانون مالیات بر ارزش افزوده", "قانون شهرداری ها",
    "قانون تملک آپارتمان ها", "قانون نظام صنفی", "قانون بازار اوراق بهادار", "قانون بیمه اجباری", "قانون تعزیرات حکومتی",
    "قانون تشدید مجازات مرتکبین ارتشاء اختلاس و کلاهبرداری", "قانون مجازات اخلالگران در نظام اقتصادی کشور",
    "قانون نحوه تقویم ابنیه املاک و اراضی مورد نیاز شهرداری ها", "قانون استخدام کشوری", "قانون مقررات استخدامی",
    "قانون تجارت الکترونیکی", "قانون بانکداری",
    "قانون عملیات بانکی بدون ربا", "قانون پولی و بانکی کشور", "قانون صدور چک", "قانون مطبوعات",
    "قانون حمایت از خانواده", "قانون حمایت از کودکان و نوجوانان", "قانون راجع به ازدواج", "قانون مبارزه با پولشویی", "قانون حدود صلاحیت دادسراها و دادگاه های انقلاب", "قانون تشکیل دادگاه های حقوقی یک و دو",
    "قانون مجازات قاچاق اسلحه و مهمات و دارندگان سلاح و مهمات غیر مجاز", "قانون نحوه تقویم ابنیه املاک و اراضی مورد نیاز",
)  # fmt: skip
_NOT_A_NAME = {"گذار", "موصوف", "ذکر", "مرقوم", "مزبور", "مذکور", "فوق", "اخیر", "پیش", "سابق", "لاحق", "جدید", "قدیم", "مربوط", "مارالذکر"}
_KNOWN_N = sorted({norm(k) for k in KNOWN_LAWS}, key=len, reverse=True)


def _law_name_from(raw: str) -> tuple[str, bool]:
    """Cut a captured «قانون ...» phrase at the first stop word / punctuation (max 9 words), then snap it to a known
    law name when it starts with one. Returns (name, known); ('', False) when nothing usable remains."""
    raw = _PUNCT_STOP.split(raw, maxsplit=1)[0].strip()
    for k in _KNOWN_N:  # snap BEFORE cutting: canonical names contain «با/در/از/و»
        if raw == k or raw.startswith(k + " "):
            return k, True
    words = raw.split()
    out: list[str] = []
    for i, w in enumerate(words):
        if i == 0:
            out.append(w)
            continue
        if w in _STOP or re.fullmatch(r"\d+", w) or len(out) >= 9:
            break
        out.append(w)
    while out and out[-1] in {"و", "یا", "ی"}:
        out.pop()
    name = " ".join(out)
    if len(out) < 2 and name != "قانون اساسی":
        return "", False
    if len(out) >= 2 and out[1] in _NOT_A_NAME:
        return "", False
    return name, False


def _expand_nums(nums: str) -> list[str]:
    out: list[str] = []
    s = re.sub(r"\s*(?:تا|الی)\s*", "..", nums)
    for part in re.split(r"\s*(?:،|,|و)\s*", s):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d+)\.\.(\d+)", part)
        if m and 0 < int(m[2]) - int(m[1]) <= 40:
            out += [str(n) for n in range(int(m[1]), int(m[2]) + 1)]
            continue
        m = re.fullmatch(r"(\d+)\s*(مکرر)?", part.replace("..", ""))
        if m:
            out.append(m[1] + ("-مکرر" if m[2] else ""))
    return out


def extract_law_refs(text: str) -> list[dict]:
    """[{law_name, articles, known}] from running text. «ماده 9 قانون یاد شده» / «ماده 3 این قانون» attach to the last
    named law; references without any resolvable law are dropped. ``known`` = the name matches a canonical law name
    (KNOWN_LAWS); other names are best-effort cuts of the running text. First-appearance order, deduplicated."""
    t = norm(text)
    laws: dict[str, list[str]] = {}
    known: dict[str, bool] = {}
    last = ""
    pos = 0
    while True:
        m = _REF_RE.search(t, pos)
        if m is None:
            break
        pos = max(m.end(), pos + 1)
        kind = m["kind"]
        law = ""
        if m["law"]:
            law, is_known = _law_name_from(m["law"])
            # resume right after the cut name, so «ماده 18 قانون X و مواد 5 قانون Y» still sees the second reference
            pos = m.start("law") + (len(law) if law else len("قانون"))
            if law:
                last = law
                known[law] = is_known
        elif m["again"] or m["this"]:
            law = last
        if kind.startswith("اصل") and not law and re.match(r"\s*قانون\s+اساسی", t[m.end():]):
            law = "قانون اساسی"
            known[law] = True
        if not law:
            continue
        nums = _expand_nums(m["nums"] or "") if m["nums"] else (["واحده"] if kind.startswith("ماده واحده") else [])
        if kind.startswith("اصل"):
            nums = [f"اصل {n}" for n in nums]
        bucket = laws.setdefault(law, [])
        for n in nums:
            if n not in bucket:
                bucket.append(n)
    return [{"law_name": k, "articles": v, "known": known.get(k, False)} for k, v in laws.items()]


# ----------------------------------------------------------------------------- classification + parsing
_SC_TITLE_RE = re.compile(
    r"رای\s+(?:وحدت\s+رویه|وحدت)(?:\s+قضایی)?\s*(?:شماره)?\s*(?P<num>\d{1,4}(?:\s*[/و]\s*\d{1,4})?)\s*[-–—]?\s*(?P<date>\d{4}/\d{1,2}/\d{1,2})?"
    r"[^\n]*?(?:هیات|هیئت)\s+عمومی\s+دیوان\s+عالی\s+کشور"
)
_ADMIN_UNITY_TITLE_RE = re.compile(r"رای\s+وحدت\s+رویه[^\n]*?(?:هیات|هیئت)\s+عمومی\s+دیوان\s+عدالت\s+اداری")


def title_text(post: dict) -> str:
    return norm(_fe().html_to_text((post.get("title") or {}).get("rendered", "")).strip())


def parse_sc_unity(post: dict, text: str) -> dict | None:
    """A Supreme Court unity ruling post -> row, or None when the post is news/commentary."""
    title = title_text(post)
    m = _SC_TITLE_RE.search(title)
    if not m:
        return None
    ruling_text, related = split_related(text)
    paras = paragraphs(ruling_text)
    number_raw = re.sub(r"\s+", "", m["num"])
    number = re.match(r"\d+", number_raw)[0]
    date = clean_date(m["date"] or "")
    if not date:
        d = re.search(r"رای\s+وحدت\s+رویه(?:\s+قضایی)?\s+شماره\s*\d+\s*[-–—]?\s*(\d{4}/\d{1,2}/\d{1,2})", norm(ruling_text))
        date = clean_date(d[1]) if d else ""
    # lead = the holding paragraph(s) between the title line and «مقدمه»; fallback: first paragraph after the «ج) رأی» heading
    holding = ""
    idx_m = next((i for i, p in enumerate(paras) if p.strip() == "مقدمه"), None)
    if idx_m is not None and idx_m > 1:
        holding = " ".join(paras[1:idx_m])
    if not holding:
        j = next((i for i, p in enumerate(paras) if re.match(r"^\s*[جc]\)\s*رای", norm(p))), None)
        if j is not None and j + 1 < len(paras):
            holding = paras[j + 1]
    if not holding and len(paras) > 1:
        holding = paras[1]
    holding = holding.strip()
    refs = extract_law_refs(ruling_text)
    extra = extract_law_refs(" ".join(ln.split(":", 1)[0] for ln in related.splitlines() if ":" in ln))
    for e in extra:
        cur = next((r for r in refs if r["law_name"] == e["law_name"]), None)
        if cur is None:
            refs.append(e)
        else:
            cur["articles"] += [a for a in e["articles"] if a not in cur["articles"]]
    return {
        "ruling_type": TYPE_SC_UNITY, "issuing_body": BODY_SC, "number": number, "number_raw": number_raw, "date": date,
        "date_iso": jalali_to_iso(date), "case_number": "", "title": paras[0] if paras else title,
        "subject": first_sentence(holding, 220), "holding": holding, "text": ruling_text,
        "related_provisions_chars": len(related), "laws_referenced": refs,
    }  # fmt: skip


def first_sentence(text: str, limit: int) -> str:
    t = " ".join(str(text or "").split())
    m = re.search(r"[.؟!]\s", t)
    s = t[: m.start() + 1] if m and m.start() < limit else t
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


HEY = r"ه(?:یأت|یئت|یات|یْأت)"  # «هیأت / هیئت / هیات»
_LABELS = (
    r"تاریخ\s+دادنامه|تاریخ\s+تنظیم|تاریخ\s+رای|تاریخ|کلاسه\s+پرونده|شماره\s+دادنامه|شماره\s+پرونده(?:\s*ها)?|مرجع\s+رسیدگی|شاکیان|شاکی|طرف\s+شکایت|"
    r"موضوع\s+شکایت\s+و\s+خواسته|موضوع\s+شکایت|موضوع|خواسته|اعلام\s*کنندگان\s+تعارض|اعلام\s*کننده\s+تعارض|گردش[\s‌]*کار"
)
_LABEL_RE = re.compile(rf"(?P<k>{_LABELS})\s*:?\s*(?=\S)")
_LABEL_COLON_RE = re.compile(rf"(?P<k>{_LABELS})\s*:")
_ADMIN_SIGNATURE_RE = re.compile(rf"(?:رئیس|رییس)\s+(?:محترم\s+)?{HEY}\s+عمومی\b")
_ADMIN_VERDICT_RE = re.compile(rf"(?:رای|رأی|تصمیم)\s+{HEY}\s+عمومی\s+(?:دیوان\s+عدالت\s+اداری)?\s*:?")


def parse_admin_fields(text: str) -> tuple[dict, int]:
    """Header of an Administrative Court decision -> (fields, header_start). Works on the flattened text because many
    posts put the whole header in one paragraph; a value runs until the next label (labels are matched with their colon,
    except «گردش کار» which ends the header)."""
    flat = " ".join(text.split())
    start = None
    for m in re.finditer(r"شماره\s+دادنامه|تاریخ\s+دادنامه", flat[:2500]):
        start = m.start()
        break
    if start is None:
        return {}, -1
    seg = flat[start:]
    marks = list(_LABEL_COLON_RE.finditer(seg))
    end_work = re.search(r"گردش[\s‌]*کار", seg)
    limit = end_work.start() if end_work else min(len(seg), 1800)
    fields: dict[str, str] = {}
    for i, m in enumerate(marks):
        if m.start() >= limit:
            break
        stop = marks[i + 1].start() if i + 1 < len(marks) else limit
        stop = min(stop, limit)
        key = re.sub(r"\s+", " ", m["k"])
        fields.setdefault(key, seg[m.end():stop].strip())
    return fields, start


def parse_admin(post: dict, text: str) -> dict | None:
    """Administrative Court General Board post -> row when it carries a decision header (شماره دادنامه), else None."""
    ruling_text, related = split_related(text)
    nrm_text = norm(ruling_text)
    if re.match(r"\s*پایگاه خبری", nrm_text):
        return None  # news item
    fields, hstart = parse_admin_fields(ruling_text)
    if not fields:
        return None
    num_field = ascii_digits(norm(fields.get("شماره دادنامه", ""))).replace(" ", "")
    nm = re.match(r"\d+(?:[-–/و،]\d+)*", num_field)
    if not nm:
        return None
    number_raw = nm[0]
    number = re.match(r"\d+", number_raw)[0]
    authority = norm(fields.get("مرجع رسیدگی", ""))
    if not re.search(r"(?:هیات|هیئت)\s+عمومی", authority):
        return None  # branch decisions (شعبه) are not General Board rulings
    title = title_text(post)
    subject = fields.get("موضوع شکایت و خواسته") or fields.get("موضوع شکایت") or fields.get("موضوع") or title
    tm = re.search(r"با\s+موضوع\s*:?\s*(.+)$", title)
    if tm and re.search(r"رای\s+وحدت\s+رویه", title):  # «رای وحدت رویه ... با موضوع: X» -> X (the header only says «اعلام تعارض»)
        subject = tm[1]
    elif "اعلام تعارض" in norm(subject) and re.search(r"رای\s+وحدت\s+رویه", title):
        subject = re.sub(r"^رای\s+وحدت\s+رویه\s+" + HEY + r"\s+عمومی\s+دیوان\s+عدالت\s+اداری\s*(?:در\s+خصوص|درخصوص)?\s*", "", title) or subject
    subject = re.sub(r"\s+", " ", subject).strip()[:600]
    is_unity = bool(re.search(r"رای\s+وحدت\s+رویه", title) or "اعلام تعارض" in norm(fields.get("موضوع", "")))
    rtype = TYPE_ADMIN_UNITY if is_unity else TYPE_ADMIN_ANNUL
    # holding: text after the last verdict heading up to the signature; else the tail before the signature
    flat = " ".join(ruling_text.split())
    sig = None
    for sig in _ADMIN_SIGNATURE_RE.finditer(flat):
        pass
    body = flat[: sig.start()] if sig else flat
    holding = ""
    verdicts = list(_ADMIN_VERDICT_RE.finditer(body))
    if verdicts and len(body) - verdicts[-1].end() > 40:
        holding = body[verdicts[-1].end():].strip()
    if not holding:
        holding = body[-1200:].strip()
    holding = holding[-2500:]
    date = ""
    for key in ("تاریخ دادنامه", "تاریخ تنظیم", "تاریخ رای", "تاریخ"):
        date = clean_date(fields.get(key, ""))
        if date:
            break
    if not date:  # «رای شماره ۱۱۴۱ مورخ ۱۴۰۰/۴/۵ ...» in the title, or a date written with a month name in the header
        date = clean_date(title) or clean_date(ruling_text[:700])
    return {
        "ruling_type": rtype, "issuing_body": BODY_ADMIN, "number": number, "number_raw": number_raw, "date": date,
        "date_iso": jalali_to_iso(date), "case_number": ascii_digits(fields.get("شماره پرونده", "")).strip(),
        "title": title, "subject": subject, "holding": holding, "text": ruling_text,
        "related_provisions_chars": len(related), "laws_referenced": extract_law_refs(ruling_text),
        "plaintiff": fields.get("شاکی") or fields.get("شاکیان", ""), "defendant": fields.get("طرف شکایت", ""),
    }  # fmt: skip


def build_row(post: dict, row: dict, fetched_at: str) -> dict:
    link = post.get("link", "")
    rid = {TYPE_SC_UNITY: "sc-unity", TYPE_ADMIN_ANNUL: "adl-board", TYPE_ADMIN_UNITY: "adl-unity"}.get(row["ruling_type"], "adl-other")
    return {
        "ruling_id": f"{rid}-{row['number']}" + (f"-{row['date_iso']}" if row.get("date_iso") else ""), **row,
        "source": SOURCE, "source_url": link, "source_url_decoded": urllib.parse.unquote(link),
        "post_id": post.get("id"), "wp_date": post.get("date"), "wp_modified": post.get("modified"),
        "source_tier": "unofficial", "needs_review": True, "is_active": True, "status": "ACTIVE", "fetched_at": fetched_at,
    }  # fmt: skip


def parse_post(post: dict, category: int, fetched_at: str) -> tuple[dict | None, str]:
    """(row | None, reason). reason explains a skipped post: 'news_or_commentary' / 'no_decision_header'."""
    text = _fe().html_to_text((post.get("content") or {}).get("rendered", ""))
    if category == CAT_UNITY:
        row = parse_sc_unity(post, text)
        return (build_row(post, row, fetched_at), "ok") if row else (None, "news_or_commentary")
    row = parse_admin(post, text)
    return (build_row(post, row, fetched_at), "ok") if row else (None, "no_decision_header")


# ----------------------------------------------------------------------------- fetch
def chunk_path(raw_dir: Path, cat: int, offset: int, size: int) -> Path:
    return raw_dir / f"cat{cat}_o{offset:05d}_n{size:02d}.json"


def _get_chunk(client, cat: int, offset: int, size: int, retries: int = 1) -> list[dict] | None:
    """One REST call (offset paging). None = past the end (HTTP 400). FetchFailed bubbles up to the caller."""
    fe = _fe()
    q = {"categories": cat, "per_page": size, "offset": offset, "orderby": "date", "order": "desc", "_fields": FIELDS}
    url = f"{fe.BASE}/wp-json/wp/v2/posts?" + urllib.parse.urlencode(q)
    try:
        try:
            status, data = client.get(url, retries=retries)
        except (http.client.HTTPException, OSError):  # e.g. BadStatusLine from a flaky proxy tunnel: pause, one more try
            time.sleep(6)
            status, data = client.get(url, retries=retries)
    except (http.client.HTTPException, OSError) as exc:
        raise fe.FetchFailed(f"{url}: {type(exc).__name__}") from exc
    if status == 400:
        return None
    if status != 200:
        raise fe.FetchFailed(f"cat {cat} offset {offset}: HTTP {status}")
    return json.loads(data)


def fetch_all(raw_dir: Path, client, refresh: bool = False, cats=(CAT_UNITY, CAT_ADMIN)) -> dict:
    """Offset paging, PER_PAGE posts per call. A call that keeps arriving truncated (very long rulings) is redone one post
    at a time for that window only. Chunks already on disk are reused."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    fe = _fe()
    totals: dict[int, int] = {}
    failed: list[str] = []
    for cat in cats:
        offset = 0
        while True:
            path = chunk_path(raw_dir, cat, offset, PER_PAGE)
            single = [chunk_path(raw_dir, cat, offset + i, 1) for i in range(PER_PAGE)]
            if path.exists() and not refresh:
                posts = json.loads(path.read_text(encoding="utf-8"))
            else:
                try:
                    posts = _get_chunk(client, cat, offset, PER_PAGE)
                except fe.FetchFailed:
                    posts, posts_n = [], 0
                    for i, sp in enumerate(single):
                        if sp.exists() and not refresh:
                            one = json.loads(sp.read_text(encoding="utf-8"))
                        else:
                            try:
                                one = _get_chunk(client, cat, offset + i, 1)
                            except fe.FetchFailed:  # one oversized post keeps arriving truncated: note it, go on (rerun retries it)
                                failed.append(f"cat{cat}:offset{offset + i}")
                                posts_n += 1
                                continue
                            if one is None:
                                break
                            sp.write_text(json.dumps(one, ensure_ascii=False), encoding="utf-8")
                        posts += one
                        posts_n += 1
                        if not one:
                            break
                    if len(posts) == posts_n:  # the whole window arrived: cache it as one chunk too (rerun = 0 requests)
                        path.write_text(json.dumps(posts, ensure_ascii=False), encoding="utf-8")
                    posts = posts + [None] * (posts_n - len(posts))  # keep the window length for the paging test
                    print(f"cat {cat} offset {offset}: fell back to single-post requests", flush=True)
                else:
                    if posts is None:
                        break
                    path.write_text(json.dumps(posts, ensure_ascii=False), encoding="utf-8")
            totals[cat] = totals.get(cat, 0) + len([p for p in posts if p])
            print(f"cat {cat} offset {offset}: {len(posts)} posts (requests so far: {client.requests})", flush=True)
            if len(posts) < PER_PAGE:
                break
            offset += PER_PAGE
    if failed:
        print(f"UNFETCHABLE (truncated every time; rerun fetch to retry): {failed}", file=sys.stderr)
    (raw_dir / "unfetchable.json").write_text(json.dumps(failed), encoding="utf-8")
    return totals


def load_posts(raw_dir: Path, cat: int) -> list[dict]:
    out: list[dict] = []
    for p in sorted(raw_dir.glob(f"cat{cat}_[op]*.json")):
        out += json.loads(p.read_text(encoding="utf-8"))
    return out


# ----------------------------------------------------------------------------- stage
def stage(raw_dir: Path, fetched_at: str) -> dict:
    """Parse the raw pages -> {'unity': rows, 'admin': rows, 'report': {...}}. Duplicates (same type+number+date; numbers restart across eras) keep the
    longest text; the others are listed in the report."""
    report: dict = {"fetched_at": fetched_at, "categories": {}}
    result = {"unity": [], "admin": []}
    for cat, key in ((CAT_UNITY, "unity"), (CAT_ADMIN, "admin")):
        posts = load_posts(raw_dir, cat)
        seen_posts: set = set()
        rows: list[dict] = []
        skipped = Counter()
        skipped_titles: list[str] = []
        for p in posts:
            if p["id"] in seen_posts:
                skipped["duplicate_post_id"] += 1
                continue
            seen_posts.add(p["id"])
            row, why = parse_post(p, cat, fetched_at)
            if row is None:
                skipped[why] += 1
                if len(skipped_titles) < 8:
                    skipped_titles.append(title_text(p)[:100])
                continue
            rows.append(row)
        by_key: dict[tuple, list[dict]] = defaultdict(list)
        for r in rows:
            by_key[(r["ruling_type"], r["number"], r["date"])].append(r)
        kept, dups = [], []
        for k, group in by_key.items():
            group.sort(key=lambda r: (-len(r["text"]), r["post_id"]))
            kept.append(group[0])
            if len(group) > 1:
                dups.append({"key": f"{k[0]}:{k[1]}:{k[2]}", "kept_post": group[0]["post_id"], "dropped_posts": [g["post_id"] for g in group[1:]]})
        kept.sort(key=lambda r: (r["ruling_type"], r["date_iso"] or "", r["number"]))
        dates = sorted(r["date_iso"] for r in kept if r["date_iso"])
        report["categories"][str(cat)] = {
            "posts": len(posts), "rows": len(kept), "by_type": dict(Counter(r["ruling_type"] for r in kept)),
            "skipped": dict(skipped), "skipped_title_samples": skipped_titles,
            "duplicates": dups, "date_range_iso": [dates[0], dates[-1]] if dates else None,
            "missing_date": sum(1 for r in kept if not r["date_iso"]), "missing_holding": sum(1 for r in kept if not r["holding"]),
            "with_law_refs": sum(1 for r in kept if r["laws_referenced"]),
        }  # fmt: skip
        result[key] = kept
    result["report"] = report
    return result


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as fh:  # 'x': never overwrite an existing file
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


REQUIRED = ("ruling_id", "ruling_type", "number", "issuing_body", "subject", "text", "source_url", "source_tier", "status")
JUNK_RE = re.compile(r"<\/?[a-zA-Z][^>]*>|&[a-z]+;|&#\d+;|\bclass=|\bhref=")


def validate_rows(rows: list[dict]) -> dict:
    ids = Counter(r.get("ruling_id") for r in rows)
    return {
        "rows": len(rows),
        "missing_fields": [r.get("ruling_id") for r in rows if any(not r.get(k) for k in REQUIRED)],
        "duplicate_ids": [k for k, c in ids.items() if c > 1],
        "html_junk": [r["ruling_id"] for r in rows if JUNK_RE.search(r.get("text", ""))],
        "no_date": [r["ruling_id"] for r in rows if not r.get("date_iso")],
        "bad_host": [r["ruling_id"] for r in rows if urllib.parse.urlparse(r.get("source_url", "")).netloc not in _fe().ALLOWED_HOSTS],
    }


def cmd_fetch(args) -> int:
    fe = _fe()
    client = fe.Client(args.delay, args.max_requests)
    try:
        fetch_all(args.raw_dir, client, refresh=args.refresh)
    except fe.Blocked as exc:
        print(f"STOPPED (not bypassed): {exc}", file=sys.stderr)
        return 6
    except fe.FetchFailed as exc:
        print(f"FETCH FAILED: {exc}", file=sys.stderr)
        return 4
    print(f"requests made: {client.requests}")
    return 0


def cmd_stage(args) -> int:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    res = stage(args.raw_dir, now)
    out_u = args.out_dir / f"unity_rulings_{args.date}.jsonl"
    out_a = args.out_dir / f"admin_court_board_rulings_{args.date}.jsonl"
    if not res["unity"] or not res["admin"]:
        print("ERROR: a staged file would be empty; nothing written", file=sys.stderr)
        print(json.dumps(res["report"], ensure_ascii=False, indent=1))
        return 5
    for p in (out_u, out_a):
        if p.exists():
            print(f"ERROR: {p} exists (never overwritten)", file=sys.stderr)
            return 2
    write_jsonl(out_u, res["unity"])
    write_jsonl(out_a, res["admin"])
    rep = {**res["report"], "validate": {"unity": validate_rows(res["unity"]), "admin": validate_rows(res["admin"])}}
    (args.out_dir / f"unity_rulings_{args.date}_report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    bad = any(v["missing_fields"] or v["duplicate_ids"] or v["html_junk"] for v in rep["validate"].values())
    return 3 if bad else 0


def cmd_run(args) -> int:
    rc = cmd_fetch(args)
    return rc or cmd_stage(args)


def cmd_validate(args) -> int:
    rows = [json.loads(ln) for ln in args.file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    rep = validate_rows(rows)
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    return 3 if rep["missing_fields"] or rep["duplicate_ids"] or rep["html_junk"] or rep["bad_host"] else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    default_raw = Path(tempfile.gettempdir()) / "roxira_unity_raw"

    def common(p, fetch=False, stg=False):
        p.add_argument("--raw-dir", type=Path, default=default_raw)
        if fetch:
            p.add_argument("--delay", type=float, default=2.0)
            p.add_argument("--max-requests", type=int, default=MAX_REQUESTS)
            p.add_argument("--refresh", action="store_true")
        if stg:
            p.add_argument("--date", default="2026-10-12")
            p.add_argument("--out-dir", type=Path, default=ROOT / "data/legal/staged")

    common(sub.add_parser("fetch"), fetch=True)
    common(sub.add_parser("stage"), stg=True)
    common(sub.add_parser("run"), fetch=True, stg=True)
    v = sub.add_parser("validate")
    v.add_argument("file", type=Path)
    args = ap.parse_args(argv)
    return {"fetch": cmd_fetch, "stage": cmd_stage, "run": cmd_run, "validate": cmd_validate}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
