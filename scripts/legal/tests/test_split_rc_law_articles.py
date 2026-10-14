"""Offline tests for scripts/legal/split_rc_law_articles.py (inline fixture, no network)."""
# ruff: noqa: RUF001
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "legal" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


srla = _load("split_rc_law_articles")
ir = _load("iran_relay")

FIXTURE = """\
بسم الله الرحمن الرحیم
قانون آزمایشی نمونه
مقدمهٔ این قانون که پیش از ماده یک می‌آید باید حذف شود.
ماده 1 - متن ماده یک.
ماده 2: متن ماده دو.
تبصره 1 - تبصرهٔ ماده دو.
ماده ۳ مکرر: متن ماده سه مکرر.
"""

RELAY_ROW = {
    "source": "rcmajlis",
    "source_tier": "official",
    "url": "https://rc.majlis.ir/fa/law/show/91488",
    "doc_id": "rcmajlis:91488",
    "title": "قانون آزمایشی نمونه",
    "doc_type": "law",
    "number": None,
    "date": "1366/12/03",
    "issuer": None,
    "text": FIXTURE,
    "fetched_at": "2026-10-14T00:00:00Z",
    "staging_status": "proposed",
    "needs_review": True,
}


def test_split_inline_fixture_into_article_rows():
    rows, dropped = srla.build_rows(RELAY_ROW)
    assert dropped == 0
    assert [r["article_no"] for r in rows] == ["1", "2", "3-mokarrar"]
    assert [r["article_label"] for r in rows] == ["ماده 1", "ماده 2", "ماده 3 مکرر"]
    assert not any("مقدمه" in r["text"] for r in rows), "the cover letter must be dropped"
    by = {r["article_no"]: r for r in rows}
    assert "تبصره 1" in by["2"]["text"], "a تبصره stays inside its article"
    assert by["2"]["text"] == "ماده 2 قانون آزمایشی نمونه: متن ماده دو.\nتبصره 1 - تبصرهٔ ماده دو."
    first = rows[0]
    assert first["law_name"] == "قانون آزمایشی نمونه"
    assert first["law_type"] == "STATUTE"
    assert first["approval_date"] == "1366/12/03"
    assert first["status"] == "VALID" and first["is_active"] is True
    assert first["source_url"].endswith("/91488")
    assert first["source_tier"] == "official"
    assert first["source"] == "rc.majlis.ir relay"
    assert first["chunk_index"] == 0
    assert first["text"] == "ماده 1 قانون آزمایشی نمونه: متن ماده یک."


def test_duplicate_article_numbers_keep_the_first():
    relay = dict(RELAY_ROW, text="ماده 1 - اول.\nماده 1 - دوم.\nماده 2 - دو.")
    rows, dropped = srla.build_rows(relay)
    assert [r["article_no"] for r in rows] == ["1", "2"]
    assert "اول" in rows[0]["text"] and "دوم" not in rows[0]["text"]
    assert dropped == 1


def test_rcmajlis_text_is_not_clipped_but_taxreg_is():
    long = "م" * (ir.MAX_TEXT_CHARS + 5000)
    rc = ir.make_row("rcmajlis", "u", "d", "t", "law", None, None, None, long)
    tx = ir.make_row("taxreg", "u", "d", "t", "law", None, None, None, long)
    assert len(rc["text"]) == ir.MAX_TEXT_CHARS + 5000
    assert len(tx["text"]) == ir.MAX_TEXT_CHARS


def test_annotate_amendments_marks_base_articles():
    base = {"law_name": "قانون نظام صنفی کشور", "article_no": "8", "text": "ماده 8 قانون نظام صنفی کشور: متن قدیم"}
    other = {"law_name": "قانون نظام صنفی کشور", "article_no": "9", "text": "ماده 9 قانون نظام صنفی کشور: متن"}
    item = {"law_name": "قانون اصلاح قانون نظام صنفی کشور", "article_no": "6", "approval_date": "1392/06/12",
            "text": "ماده 6 قانون اصلاح قانون نظام صنفی کشور: ماده (۸) قانون به شرح زیر اصلاح می شود: متن نو"}
    assert srla.annotate_amendments([base, other, item]) == 1
    assert base["amended_on"] == "1392/06/12" and "ماده 6 قانون اصلاح" in base["text"]
    assert "amended_by" not in other
