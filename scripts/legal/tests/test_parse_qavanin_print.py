"""Offline tests for scripts/legal/parse_qavanin_print.py (inline fixtures, no PDF, no network)."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("parse_qavanin_print", ROOT / "scripts" / "legal" / "parse_qavanin_print.py")
pq = importlib.util.module_from_spec(spec)
sys.modules["parse_qavanin_print"] = pq
spec.loader.exec_module(pq)

PAGE_CHROME = "garbled title\nhttps://qavanin.ir/Law/PrintText/?IDS=123&font=\n10/13/26, 3:24 AM\n"

SAMPLE = """قانون نمونه
باب اول - مقررات عمومي
فصل اول - کلیات
ماده  - 1این قانون براي ھمه است.

ادامه ماده اول.
ماده ) 2اصلاحي  -(1403ˏˏ03ˏˏ30تأمین کننده متخلف از مواد ) (36) ،(35) ،(34) ،(33و ) (37این قانون
به مجازات محکوم مي شود.
تبصره  - 1حکم اول.
تبصره )منسوخه  -(1399ˏˏ02ˏˏ23حکم منسوخ.
ماده ) 3منسوخه  -(1390ˏˏ04ˏˏ08متن قدیمي.
ماده 4 (الحاقي 1395/05/06)- متن الحاقي.
ماده 5 مکرر -متن مکرر.
قانون فوق مشتمل بر پنج ماده است.
"""


def parse(text, **kw):
    return pq.parse_law("ecommerce", text, source_url="u", fetched_at="t", **kw)


def test_basic_rows_and_schema():
    rows, _rep, report = parse(PAGE_CHROME + SAMPLE)
    assert report["qavanin_ids"] == "123"
    assert [r["article_no"] for r in rows] == ["1", "2", "4", "5 مکرر"]
    r1 = rows[0]
    assert r1["source"] == "qavanin" and r1["staging_status"] == "proposed" and r1["status"] == "VALID"
    assert r1["text"].startswith("ماده 1 قانون تجارت الکترونیکی: این قانون برای همه است.")
    assert "garbled title" not in r1["text"] and "qavanin.ir" not in r1["text"]
    assert r1["chapter"] == "باب اول - مقررات عمومی / فصل اول - کلیات"
    assert r1["section"] is None and r1["text_original"].count("ي") >= 1  # original keeps Arabic yeh
    assert "ي" not in r1["text"] and "ي" not in r1["text_search"]


def test_amendment_note_and_reference_repair():
    rows, _, _ = parse(SAMPLE)
    r2 = rows[1]
    assert r2["amended_on"] == "1403-03-30"
    assert "(33)، (34)، (35)، (36) و (37) این قانون" in r2["text"]
    assert "[اصلاحی 1403/03/30]" in r2["text"]
    assert r2["needs_review"] and "pdf_bidi_reference_repair" in r2["review_reasons"]
    assert "تبصره 1- حکم اول." in r2["text"]


def test_repealed_paragraph_and_article():
    rows, rep, _ = parse(SAMPLE)
    r2 = rows[1]
    assert "منسوخ" not in r2["text"] and r2["repealed_parts"][0]["date"] == "1399-02-23"
    assert [r["article_no"] for r in rep] == ["3"]
    assert rep[0]["status"] == "REPEALED" and rep[0]["is_active"] is False
    r4 = rows[2]
    assert r4["amendment_notes"] == [{"kind": "الحاقی", "date": "1395-05-06"}]


def test_section_key_disambiguates_duplicates():
    text = "بخش یک\nماده 1 -الف.\nبخش دو\nماده 1 -ب.\n"
    rows, _, report = parse(text, extra_sections=[(r"^بخش یک", "s1"), (r"^بخش دو", "s2")])
    assert [(r["section"], r["article_no"]) for r in rows] == [("s1", "1"), ("s2", "1")]
    assert report["duplicate_keys"] == []
    _, _, report = parse(text)
    assert report["duplicate_keys"] == ["None|ماده 1"]


def test_no_articles_reports_error():
    _, _, report = parse(PAGE_CHROME)
    assert report["rows"] == 0 and "error" in report


def test_search_normalisation():
    assert pq.search_form("ماده ۵: كتاب يك") == "ماده 5 کتاب یک"


def test_article_header_with_dropped_first_letter():
    # pdftotext sometimes drops the first glyph at a page top: "اده -149..." must still start an article
    rows, _, _ = parse("ماده  -148متن اول.\n\nاده  -149آیین نامه اجرائي.\nماده  -150متن آخر.\n")
    assert [r["article_no"] for r in rows] == ["148", "149", "150"]


def test_new_law_keys_are_configured():
    for key in ("third_party_insurance", "industrial_property", "insurance_1316"):
        law = pq.LAWS[key]
        assert law["law_id"].startswith("qavanin_") and law["approval_date"]
