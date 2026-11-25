"""Citation hallucination guard and legal catalog verification (extracted from smartjudge_module.py)."""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys
from typing import Optional, Sequence

from output_apps.generated_modules.smartjudge import served_collection as _served_collection

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

CITATION_GUARD_VERSION = "1.0"


def _resolve_citation_collection(environ=None) -> str:
    """Collection name reported by the guard: env ROXIRA_CITATION_QDRANT_COLLECTION, else the
    collection the retriever serves from (LIGHTRAG_QDRANT_COLLECTION; see served_collection.py)."""
    return _served_collection.citation_collection(environ)


CITATION_QDRANT_COLLECTION = _resolve_citation_collection()
CITATION_MISMATCH_FLAG = "[فاقد تطابق رسمی]"
CITATION_GUARD_QDRANT_ENABLED = os.environ.get("ROXIRA_CITATION_GUARD_QDRANT", "1") != "0"
CITATION_QDRANT_TIMEOUT = float(os.environ.get("ROXIRA_CITATION_QDRANT_TIMEOUT", "1.5"))
# پالایش قوانین منسوخ: هنگام پرس‌وجو از iran_laws_bge_m3 پالایهٔ {"is_active": True}
# به‌صورت پیشفرض اعمال می‌شود تا هرگز مادهٔ منسوخ در تولید پیش‌نویس استناد نشود.
CITATION_QDRANT_ACTIVE_ONLY = os.environ.get("ROXIRA_CITATION_QDRANT_ACTIVE_ONLY", "1") != "0"
CITATION_MIN_SCOPE_TOKENS = 3  # کمینهٔ واژگان فراتر از خود استناد برای آزمون دامنه
CITATION_MIN_SUBSTITUTE_SCORE = 2  # کمینهٔ هم‌پوشانی واژگانی برای جانشینی خودکار ماده

# کاتالوگ محلی مواد قانونی (پایهٔ اعتبارسنجی آفلاین). هر ماده: عنوان + واژگان دامنه.
LEGAL_CATALOG = {
    "قانون آیین دادرسی مدنی": {
        "category": "PROCEDURE_CIVIL",
        "aliases": ("ق.آ.د.م", "ق.آ.د.م.", "آیین دادرسی مدنی", "قانون آ.د.م", "CPC"),
        "articles": {
            "51": {"title": "شرایط دادخواست",
                   "scope": ("دادخواست", "خواهان", "خوانده", "خواسته", "شرایط", "امضا")},
            "55": {"title": "منضمات دادخواست",
                   "scope": ("منضمات", "پیوست", "دادخواست", "اسناد", "ضمیمه")},
            "56": {"title": "ابطال دادخواست",
                   "scope": ("ابطال", "دادخواست", "نقص", "رد")},
            "92": {"title": "تقدیم لایحه",
                   "scope": ("لایحه", "تقدیم", "دفاع", "دادخواست")},
            "198": {"title": "ایرادات و جهات دفاع",
                    "scope": ("ایراد", "دفاع", "جهات", "شکلی")},
            "201": {"title": "ایرادات شکلی و صلاحیت",
                    "scope": ("صلاحیت", "ایراد", "شکلی")},
            "426": {"title": "اعاده دادرسی",
                    "scope": ("اعاده", "دادرسی", "محکوم", "جهات")},
            "515": {"title": "خسارات دادرسی",
                    "scope": ("خسارت", "دادرسی", "هزینه", "محکوم")},
        },
    },
    "قانون آیین دادرسی کیفری": {
        "category": "PROCEDURE_CRIMINAL",
        "aliases": ("ق.آ.د.ک", "ق.آ.د.ک.", "آیین دادرسی کیفری", "قانون آ.د.ک", "CPC-CRIM"),
        "articles": {
            "68": {"title": "شکواییه و شرایط آن",
                   "scope": ("شکواییه", "شاکی", "مشتکی‌عنه", "دادسرا", "شکایت")},
            "69": {"title": "شکواییه شفاهی",
                   "scope": ("شکواییه", "شفاهی", "دادسرا", "صورت‌جلسه")},
            "100": {"title": "تحقیقات مقدماتی",
                    "scope": ("تحقیقات", "مقدماتی", "دادسرا", "دستور", "بازپرس")},
            "146": {"title": "دفاع و وکالت",
                    "scope": ("دفاع", "وکالت", "وکیل", "متهم")},
        },
    },
    "قانون صدور چک": {
        "category": "COMMERCIAL_PAPER",
        "aliases": ("قانون چک", "ق.ص.چ", "ق.ص.چ.", "صدور چک"),
        "articles": {
            "3": {"title": "چک بلامحل و وصف کیفری",
                  "scope": ("چک", "بلامحل", "کیفری", "پرداخت", "دارنده")},
            "5": {"title": "شکایت کیفری دارندهٔ چک",
                  "scope": ("چک", "شکایت", "دارنده", "کیفری")},
            "21": {"title": "وصول وجه چک",
                   "scope": ("چک", "وصول", "پرداخت", "بانک")},
            "23": {"title": "دعوای کیفری و مطالبهٔ وجه چک",
                   "scope": ("چک", "دعوا", "کیفری", "مطالبه", "وجه")},
        },
    },
    "قانون مدنی": {
        "category": "CIVIL_CODE",
        "aliases": ("ق.م", "ق.م.", "قانون مدنی"),
        "articles": {
            "10": {"title": "اصل آزادی قراردادی",
                   "scope": ("قرارداد", "تعهد", "آزادی", "خصوصی")},
            "183": {"title": "تعریف عقد",
                    "scope": ("عقد", "تعریف", "توافق", "ایقاع")},
            "190": {"title": "شرایط اساسی صحت معامله",
                    "scope": ("معامله", "شرایط", "صحت", "قصد", "اهلیت")},
            "219": {"title": "اصل لزوم قراردادها",
                    "scope": ("لزوم", "قرارداد", "عقد", "طرفین")},
            "220": {"title": "آثار قرارداد نسبت به طرفین",
                    "scope": ("قرارداد", "عقد", "طرفین", "آثار")},
            "226": {"title": "تعهد به نتیجه و منشأ قراردادی",
                    "scope": ("تعهد", "قراردادی", "منشأ", "انجام")},
            "227": {"title": "جبران خسارت ناشی از نقض تعهد",
                    "scope": ("خسارت", "تعهد", "نقض", "جبران")},
        },
    },
    "قانون جرایم رایانه‌ای": {
        "category": "CYBER_CRIME",
        "aliases": ("ق.ج.ر", "ق.ج.ر.", "جرایم رایانه‌ای", "رایانه‌ای"),
        "articles": {
            "1": {"title": "کلاهبرداری رایانه‌ای",
                  "scope": ("کلاهبرداری", "رایانه‌ای", "داده", "وجه")},
            "2": {"title": "جعل رایانه‌ای",
                  "scope": ("جعل", "رایانه‌ای", "داده", "سند")},
            "3": {"title": "تخریب و اخلال در داده‌ها",
                  "scope": ("تخریب", "اخلال", "داده", "سیستم")},
            "12": {"title": "انتشار محتوای مجرمانه",
                   "scope": ("انتشار", "محتوا", "مجاز", "منافی")},
            "13": {"title": "دسترسی غیرمجاز",
                   "scope": ("دسترسی", "غیرمجاز", "سیستم", "داده")},
        },
    },
    "قانون مجازات اسلامی (تعزیرات)": {
        "category": "PENAL_CODE",
        "aliases": ("ق.م.ا", "ق.م.ا.", "قانون تعزیرات", "تعزیرات"),
        "articles": {
            "608": {"title": "توهین به افراد",
                    "scope": ("توهین", "فحاشی", "اهانت", "شخص")},
            "690": {"title": "تصرف عدوانی",
                    "scope": ("تصرف", "عدوانی", "ملک", "املاک")},
        },
    },
}

# فهرست رویه‌های لازم‌الاتباع دیوان عالی کشور (آرای وحدت رویه).
PRECEDENT_CATALOG = {
    "794": {"title": "رأی وحدت رویه شماره ۷۹۴",
            "authority": "هیئت عمومی دیوان عالی کشور",
            "scope": ("صلاحیت", "دادخواست", "شرایط شکلی")},
    "733": {"title": "رأی وحدت رویه شماره ۷۳۳",
            "authority": "هیئت عمومی دیوان عالی کشور",
            "scope": ("صلاحیت محلی", "تحقیقات مقدماتی", "دادسرا")},
    "671": {"title": "رأی وحدت رویه شماره ۶۷۱",
            "authority": "هیئت عمومی دیوان عالی کشور",
            "scope": ("دفاع شکلی", "دادرسی", "ایراد")},
}

_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_CITATION_TOKEN_RE = re.compile(r"[\w\u0600-\u06FF]+", re.UNICODE)
_CITATION_ARTICLE_RE = re.compile(r"ماد(?:ه|ۀ|ة)\s*(\d{1,4})")
_CITATION_PRECEDENT_RE = re.compile(
    r"(?P<label>رأی\s*وحدت\s*رویه|رای\s*وحدت\s*رویه|رأی\s*شماره|رای\s*شماره|نظریه\s*مشورتی)"
    r"\s*(?:شماره\s*)?(?P<num>\d{1,4}(?:\s*[/\-]\s*\d{1,4})*)"
)
_CITATION_GLUE_RE = re.compile(r"^[\s،,.\-]*(?:قانون|از|ماده|مبحث)?[\s،,.\-]*$")
_CLAUSE_BOUNDARY_RE = re.compile(r"[.\n؛;؟!]|(?:\s+و\s+)")


def _norm_len(text) -> str:
    """نرمال‌سازی طول‌ثابت (حذف نیم‌فاصله، یکسان‌سازی ارقام/حروف) برای تطبیق دقیق."""
    return (
        str(text or "")
        .replace("\u200c", " ")
        .replace("\u200f", " ")
        .replace("ي", "ی")
        .replace("ك", "ک")
        .replace("ۀ", "ه")
        .translate(_DIGIT_TRANS)
    )


def _to_persian_digits(value) -> str:
    """نمایش عدد با ارقام فارسی برای متن رسمی."""
    return "".join(
        _PERSIAN_DIGITS[int(ch)] if ch.isdigit() else ch for ch in str(value)
    )


def _citation_tokens(text) -> set:
    """واژگان معنادار متن (برای آزمون دامنه و تشخیص موضوع)."""
    tokens = set()
    for raw in _CITATION_TOKEN_RE.findall(_norm_len(text).lower()):
        token = raw.strip(".")
        if len(token) > 1:
            tokens.add(token)
    return tokens


def _citation_clause(text: str, start: int, end: int) -> str:
    """بند حاوی استناد (زمینهٔ آزمون دامنه) — مرزبندی با نقطه/ویرگول و حرف ربط «و»."""
    left = 0
    for boundary in _CLAUSE_BOUNDARY_RE.finditer(text, 0, start):
        left = boundary.end()
    right = len(text)
def _build_law_alias_index(catalog=None) -> list:
    """ساخت فهرست نگاشت نام/مخفف قانون به نام استاندارد."""
    index = []
    for law, meta in (catalog if catalog is not None else LEGAL_CATALOG).items():
        for alias in (law,) + tuple(meta.get("aliases", ())):
            normalized = _norm_len(alias).strip().strip(".").lower()
            if normalized:
                index.append((normalized, law))
    return index


_LAW_ALIAS_INDEX = _build_law_alias_index()


def _resolve_law(norm_lower: str, article_start: int, article_end: int, window: int = 60):
    """نزدیک‌ترین نام قانون به یک استناد (ترجیح قانونِ پس از شمارهٔ ماده).

    در رویهٔ نگارش فارسی، نام قانون پس از «ماده X» می‌آید؛ بنابراین نخست نام
    قانونِ بلافاصله پس از شمارهٔ ماده انتخاب می‌شود و تنها در نبود آن، نزدیک‌ترین
    نام قانونِ پیش از آن بررسی می‌گردد.
    """
    after = None
    before = None
    for alias, law in _LAW_ALIAS_INDEX:
        start = norm_lower.find(alias)
        while start != -1:
            end = start + len(alias)
            if start >= article_end and (start - article_end) <= window:
                score = (start - article_end, -len(alias))
                if after is None or score < after[0]:
                    after = (score, law, start, end)
            elif end <= article_start and (article_start - end) <= window:
                score = (article_start - end, -len(alias))
                if before is None or score < before[0]:
                    before = (score, law, start, end)
            start = norm_lower.find(alias, start + 1)
    chosen = after or before
    if chosen is None:
        return None, None, None
    return chosen[1], chosen[2], chosen[3]


def _canonical_citation(law: str, number, meta: dict) -> str:
    """متن رسمی استناد: «ماده X <قانون> (<عنوان مصوب>)»."""
    title = str((meta or {}).get("title") or "").strip()
    base = f"ماده {_to_persian_digits(number)} {law}"
    return f"{base} ({title})" if title else base


class CitationHallucinationGuard:
    """استخراج، اعتبارسنجی و اصلاح خودکار استنادات حقوقی متن."""

    version = CITATION_GUARD_VERSION

    def __init__(self, catalog=None, precedents=None, *, qdrant_lookup=None, use_qdrant=None):
        self.catalog = LEGAL_CATALOG if catalog is None else catalog
        self.precedents = PRECEDENT_CATALOG if precedents is None else precedents
        self.qdrant_lookup = qdrant_lookup
        self.use_qdrant = CITATION_GUARD_QDRANT_ENABLED if use_qdrant is None else bool(use_qdrant)
        self._qdrant_cache: dict = {}

    # ── استخراج استنادات ────────────────────────────────────────────────────
    def extract_citations(self, text: str) -> list:
        source = str(text or "")
        norm = _norm_len(source)
        norm_lower = norm.lower()
        citations: list = []

        for match in _CITATION_ARTICLE_RE.finditer(norm):
            number = match.group(1).lstrip("0") or "0"
            law, alias_start, alias_end = _resolve_law(norm_lower, match.start(), match.end())
            end = match.end()
            if law and alias_start is not None and end <= alias_start <= end + 30:
                if _CITATION_GLUE_RE.match(norm[end:alias_start]):
                    end = alias_end
            citations.append(
                {
                    "kind": "article",
                    "raw": source[match.start():end],
                    "article": number,
                    "law": law,
                    "start": match.start(),
                    "end": end,
                }
            )

        for match in _CITATION_PRECEDENT_RE.finditer(norm):
            number = re.sub(r"\s+", "", match.group("num")).replace("-", "/")
            citations.append(
                {
                    "kind": "precedent",
                    "raw": source[match.start():match.end()],
                    "number": number,
                    "label": re.sub(r"\s+", " ", match.group("label")),
                    "start": match.start(),
                    "end": match.end(),
                }
            )

        citations.sort(key=lambda item: item["start"])
        return citations

    # ── اعتبارسنجی ──────────────────────────────────────────────────────────
    @staticmethod
    def _scope_matches(citation: dict, law: str, meta: dict, context: str) -> bool:
        citation_tokens = _citation_tokens(f"{citation.get('raw')} {law}")
        context_tokens = _citation_tokens(context)
        scope_tokens = _citation_tokens(" ".join(meta.get("scope", ())))
        title_tokens = _citation_tokens(str(meta.get("title") or ""))
        if (scope_tokens | title_tokens) & context_tokens:
            return True
        # استنادِ برهنه (بدون شرح موضوع) پذیرفته می‌شود؛ تنها متن موضوع‌دار مخالف رد می‌شود.
        return len(context_tokens - citation_tokens) < CITATION_MIN_SCOPE_TOKENS

    def _nearest_article(self, law: str, citation: dict, context: str):
        """نزدیک‌ترین مادهٔ موجود همان قانون بر پایهٔ هم‌پوشانی واژگان دامنه."""
        articles = self.catalog.get(law, {}).get("articles", {})
        excluded = _citation_tokens(f"ماده {citation.get('article')}")
        context_tokens = _citation_tokens(context) - excluded
        if not articles or not context_tokens:
            return None
        scored = []
        for number, meta in articles.items():
            keywords = _citation_tokens(
                " ".join(meta.get("scope", ())) + " " + str(meta.get("title") or "")
            )
            score = len(context_tokens & keywords)
            if score >= CITATION_MIN_SUBSTITUTE_SCORE:
                scored.append((score, str(number), meta))
        if not scored:
            return None
        scored.sort(key=lambda item: (-item[0], item[1]))
        if len(scored) > 1 and scored[0][0] == scored[1][0]:
            return None  # نتیجهٔ مبهم؛ دستکاری خودکار انجام نمی‌شود
        return scored[0][1], scored[0][2]

    def _verify_article(self, citation: dict, text: str) -> dict:
        record = {
            "kind": "article",
            "raw": citation["raw"],
            "start": citation["start"],
            "end": citation["end"],
            "article": citation["article"],
            "law": citation.get("law"),
        }
        law = citation.get("law")
        if not law:
            record["status"] = "unresolved_law"
            record["reason"] = f"قانون مرجع استناد «{citation['raw']}» قابل تشخیص نیست."
            return record
        articles = self.catalog.get(law, {}).get("articles", {})
        meta = articles.get(citation["article"])
        context = _citation_clause(text, citation["start"], citation["end"])
        if meta is None:
            record["status"] = "not_found"
            record["reason"] = f"{citation['raw']} در «{law}» وجود ندارد."
            substitute = self._nearest_article(law, citation, context)
            if substitute:
                number, sub_meta = substitute
                record["replacement"] = _canonical_citation(law, number, sub_meta)
                record["replaced_with"] = {
                    "law": law,
                    "article": number,
                    "title": sub_meta.get("title"),
                    "citation": record["replacement"],
                }
            return record

        record["title"] = meta.get("title")
        record["canonical"] = _canonical_citation(law, citation["article"], meta)
        if not self._scope_matches(citation, law, meta, context):
            record["status"] = "scope_mismatch"
            record["reason"] = (
                f"دامنهٔ {record['canonical']} با موضوع استناد مطابقت ندارد."
            )
            record["replacement"] = record["canonical"]
            return record
        record["status"] = "valid"
        record["source"] = "local_catalog"
        return record

    def _verify_precedent(self, citation: dict, extra_precedents: Optional[Sequence[dict]] = None) -> dict:
        record = {
            "kind": "precedent",
            "raw": citation["raw"],
            "start": citation["start"],
            "end": citation["end"],
            "number": citation["number"],
        }
        meta = self.precedents.get(citation["number"])
        if meta is None and extra_precedents:
            norm_num = str(citation["number"]).strip()
            for p in extra_precedents:
                if not isinstance(p, dict):
                    continue
                p_num = str(p.get("number") or "").strip()
                p_title = str(p.get("title") or "")
                if norm_num and (norm_num == p_num or f"شماره {norm_num}" in p_title or f"شمارهٔ {norm_num}" in p_title):
                    meta = {
                        "title": p.get("title") or f"رأی شماره {norm_num}",
                        "authority": p.get("issuing_body") or "هیئت عمومی دیوان عالی کشور",
                    }
                    break

        if meta is None:
            record["status"] = "not_found"
            record["reason"] = (
                f"شمارهٔ استنادشده در «{citation['raw']}» در فهرست رویه‌های وحدت رویهٔ "
                "دیوان عالی کشور یافت نشد."
            )
            return record
        record["title"] = meta.get("title")
        record["canonical"] = (
            f"رأی وحدت رویه شماره {_to_persian_digits(citation['number'])} "
            f"{meta.get('authority') or 'هیئت عمومی دیوان عالی کشور'}"
        )
        record["status"] = "valid"
        record["source"] = "local_catalog"
        return record

    def _evaluate_all(self, text: str, extra_precedents: Optional[Sequence[dict]] = None):
        citations = self.extract_citations(text)
        records = [
            self._verify_article(citation, text)
            if citation["kind"] == "article"
            else self._verify_precedent(citation, extra_precedents=extra_precedents)
            for citation in citations
        ]
        return citations, records

    # ── تطبیق با Qdrant ─────────────────────────────────────────────────────
    async def _qdrant_confirm(self, record: dict, lookup) -> bool:
        query = str(record.get("raw") or "").strip()
        if record.get("law"):
            query = f"{record['law']} {query}".strip()
        if not query:
            return False
        if query in self._qdrant_cache:
            return self._qdrant_cache[query]
        number = record.get("article") or record.get("number")
        confirmed = False
        try:
            rows = await asyncio.wait_for(lookup(query, 5), timeout=CITATION_QDRANT_TIMEOUT)
        except Exception as exc:  # noqa: BLE001 - هیچ‌گاه مسیر درخواست را نمی‌شکند
            print(f"[SMARTJUDGE][CITATION-QDRANT] {type(exc).__name__}: {exc}", file=sys.stderr)
            rows = []
        if number:
            pattern = re.compile(rf"(?<!\d){re.escape(str(number))}(?!\d)")
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                blob = _norm_len(
                    " ".join(
                        str(row.get(key) or "")
                        for key in ("title", "summary", "text", "content", "article")
                    )
                )
                if pattern.search(blob):
                    confirmed = True
                    break
        self._qdrant_cache[query] = confirmed
        return confirmed

    # ── گزارش نهایی ─────────────────────────────────────────────────────────
    def _finalize(self, text: str, records: list, qdrant_state: dict) -> dict:
        validated_articles: list = []
        validated_precedents: list = []
        flags: list = []
        warnings: list = []
        replacements: list = []
        by_status: dict = {}
        auto_replaced = 0

        for record in records:
            status = record["status"]
            by_status[status] = by_status.get(status, 0) + 1
            if status == "valid":
                canonical = record.get("canonical")
                if not canonical and record.get("law"):
                    canonical = _canonical_citation(record["law"], record.get("article"), {})
                canonical = canonical or record.get("raw")
                if record["kind"] == "article":
                    validated_articles.append(
                        {
                            "law": record.get("law"),
                            "article": record.get("article"),
                            "title": record.get("title"),
                            "citation": canonical,
                            "source": record.get("source") or "local_catalog",
                        }
                    )
                else:
                    validated_precedents.append(
                        {
                            "precedent": record.get("number"),
                            "title": record.get("title"),
                            "citation": canonical,
                            "source": record.get("source") or "local_catalog",
                        }
                    )
                continue

            replacement = record.get("replacement")
            if replacement:
                auto_replaced += 1
            new_text = (replacement or record.get("raw") or "").rstrip() + " " + CITATION_MISMATCH_FLAG
            replacements.append((record["start"], record["end"], new_text))
            flags.append(
                {
                    "kind": record["kind"],
                    "raw": record.get("raw"),
                    "law": record.get("law"),
                    "article": record.get("article"),
                    "precedent": record.get("number"),
                    "status": status,
                    "reason": record.get("reason"),
                    "replacement": replacement,
                    "flag": CITATION_MISMATCH_FLAG,
                }
            )
            if record.get("reason"):
                warnings.append(record["reason"])

        guarded = text
        for start, end, new_text in sorted(replacements, key=lambda item: item[0], reverse=True):
            guarded = guarded[:start] + new_text + guarded[end:]

        total = len(records)
        valid = len(validated_articles) + len(validated_precedents)
        accuracy = 1.0 if total == 0 else round(valid / total, 4)
        return {
            "text": guarded,
            "citation_accuracy": accuracy,
            "validated_articles": validated_articles,
            "validated_precedents": validated_precedents,
            "citations": [
                {
                    "kind": record["kind"],
                    "raw": record.get("raw"),
                    "law": record.get("law"),
                    "article": record.get("article"),
                    "precedent": record.get("number"),
                    "status": record["status"],
                    "title": record.get("title"),
                    "canonical": record.get("canonical"),
                    "source": record.get("source"),
                }
                for record in records
            ],
            "flags": flags,
            "warnings": warnings,
            "counts": {
                "total_citations": total,
                "validated": valid,
                "invalid": total - valid,
                "auto_replaced": auto_replaced,
                "flagged": len(flags),
                "by_status": by_status,
            },
            "sources": {
                "guard": "CitationHallucinationGuard",
                "version": self.version,
                "local_catalog": True,
                "qdrant_collection": CITATION_QDRANT_COLLECTION,
                "qdrant_enabled": bool(qdrant_state.get("enabled")),
                "qdrant_checked": bool(qdrant_state.get("checked")),
                "qdrant_active_only": bool(CITATION_QDRANT_ACTIVE_ONLY),
            },
        }

    # ── API همگام/asyncio ───────────────────────────────────────────────────
    def verify(self, text: str, extra_precedents: Optional[Sequence[dict]] = None) -> dict:
        """اعتبارسنجی آفلاین بر پایهٔ کاتالوگ محلی (بدون Qdrant)."""
        _, records = self._evaluate_all(text, extra_precedents=extra_precedents)
        return self._finalize(text, records, {"enabled": self.use_qdrant, "checked": False})

    async def verify_async(self, text: str, *, qdrant_lookup=None, use_qdrant=None, extra_precedents: Optional[Sequence[dict]] = None) -> dict:
        """اعتبارسنجی + تطبیق برداری استنادهای ناشناخته با ``iran_laws_bge_m3``."""
        enabled = self.use_qdrant if use_qdrant is None else bool(use_qdrant)
        lookup = qdrant_lookup if qdrant_lookup is not None else self.qdrant_lookup
        _, records = self._evaluate_all(text, extra_precedents=extra_precedents)
        checked = False
        if enabled and lookup is not None:
            checked = True
            for record in records:
                if record["status"] == "valid":
                    continue
                if await self._qdrant_confirm(record, lookup):
                    record["status"] = "valid"
                    record["source"] = "qdrant:" + CITATION_QDRANT_COLLECTION
                    record.pop("replacement", None)
                    record["reason"] = "با پایگاه برداری رسمی تطبیق داده شد."
        return self._finalize(text, records, {"enabled": enabled, "checked": checked})

    # نسخهٔ صریح نام
    guard = verify
    guard_async = verify_async

    def stats(self, report: dict) -> dict:
        """آمار موردنیاز API: دقت استناد و فهرست مواد تأییدشده."""
        report = report or {}
        return {
            "citation_accuracy": report.get("citation_accuracy", 1.0),
            "validated_articles": list(report.get("validated_articles") or []),
        }


def _citation_report_public(report: dict) -> dict:
    """حذف متن اصلاح‌شده از گزارش برای درج در پاسخ API."""
    return {key: value for key, value in (report or {}).items() if key != "text"}


