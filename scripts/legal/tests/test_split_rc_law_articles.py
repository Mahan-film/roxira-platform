"""Offline tests for scripts/legal/split_rc_law_articles.py (inline fixture, no network)."""
# ruff: noqa: RUF001
import importlib.util
import json
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


# ---------------------------------------------------------------- amending laws (guild 1392)
GUILD_AMENDMENT = (
    "قانون اصلاح قانون نظام صنفی کشور ماده۱ـ نام «مجمع امور صنفی» به «اتاق اصناف شهرستان» تغییر می یابد. "
    "ماده۲ـ تبصره (۲) ماده (۳) قانون به شرح زیر اصلاح می شود: تبصره۲ـ متن تبصره نو. "
    "ماده۳ـ ماده (۴) قانون به شرح زیر اصلاح می شود: ماده۴ـ صنف: متن نو ماده چهار. "
    "ماده۴ ـ ماده (۲۷) قانون به شرح زیر اصلاح و دو تبصره به آن الحاق می شود: "
    "ماده۲۷ـ محل دایر شده بدون پروانه کسب پلمب می شود. تبصره۴ـ متن تبصره. "
    "ماده۵ـ یک ماده به عنوان ماده (۲۲) مکرر به شرح زیر به قانون الحاق می شود: "
    "ماده ۲۲ مکرر ـ شرایط داوطلبان هیأت مدیره. "
    "ماده۶ـ مواد (۵) و (۶) قانون به شرح زیر اصلاح می شود: ماده۵ ـ پروانه کسب نو. ماده۶ ـ متن نو شش. "
    "ماده۷ـ ماده (۸) قانون حذف می شود. "
    "ماده۸ـ یک ماده به شرح زیر به عنوان ماده ( ۹۵مکرر ۲) به قانون الحاق می شود: "
    "ماده ۹۵ مکرر۲ـ رسیدگی به تخلفات صنفی. "
    "ماده۹ـ عبارت زیر به ماده (۹۶) قانون اضافه می شود."
)
GUILD_RELAY = dict(
    RELAY_ROW,
    title="قانون اصلاح قانون نظام صنفی کشور",
    date="1392/06/12",
    url="https://rc.majlis.ir/fa/law/show/866380",
    text=GUILD_AMENDMENT,
)
RELABELLED = "قانون نظام صنفی کشور (اصلاحی 1392)"


def test_amending_base_and_relabel_name():
    assert srla.amending_base("قانون اصلاح قانون نظام صنفی کشور") == "قانون نظام صنفی کشور"
    assert srla.amending_base("قانون اصلاح مالیات‌های مستقیم") == "قانون مالیات‌های مستقیم"
    assert srla.amending_base("قانون نظام صنفی کشور") is None
    assert srla.amended_law_name("قانون نظام صنفی کشور", "۱۳۹۲/۰۶/۱۲") == RELABELLED
    assert srla.amended_law_name("قانون الف", None) == "قانون الف (اصلاحی)"


def test_guild_amendment_items_keep_their_numbers():
    rows, dropped = srla.build_rows(GUILD_RELAY)
    assert dropped == 0
    items = [r["article_no"] for r in rows if r["law_name"] == GUILD_RELAY["title"]]
    assert items == [str(i) for i in range(1, 10)], "every amendment item survives, in order"


def test_guild_quoted_base_articles_are_relabelled_not_cited_as_the_amending_law():
    rows, _ = srla.build_rows(GUILD_RELAY)
    quoted = {r["article_no"]: r for r in rows if r["law_name"] == RELABELLED}
    assert sorted(quoted) == ["22-mokarrar", "27", "4", "5", "6", "95-mokarrar-2"]
    art27 = quoted["27"]
    assert art27["article_label"] == "ماده 27"
    assert art27["text"].startswith("ماده 27 قانون نظام صنفی کشور (اصلاحی 1392): محل دایر شده")
    assert "تبصره۴ـ" in art27["text"], "a quoted تبصره stays inside its base article"
    assert art27["amending_item"] == "ماده 4 قانون اصلاح قانون نظام صنفی کشور"
    assert art27["amended_on"] == "1392/06/12"
    assert quoted["95-mokarrar-2"]["article_label"] == "ماده 95 مکرر 2"
    assert not any(
        r["text"].startswith("ماده 27 قانون اصلاح قانون نظام صنفی کشور") for r in rows
    ), "chat must never cite «ماده 27 قانون اصلاح قانون نظام صنفی کشور»"


def test_guild_item_points_to_the_relabelled_article():
    rows, _ = srla.build_rows(GUILD_RELAY)
    item4 = next(r for r in rows if r["law_name"] == GUILD_RELAY["title"] and r["article_no"] == "4")
    assert item4["text"].endswith("[متن اصلاحی: ماده 27 قانون نظام صنفی کشور (اصلاحی 1392)]")
    assert "محل دایر شده" not in item4["text"]
    item6 = next(r for r in rows if r["law_name"] == GUILD_RELAY["title"] and r["article_no"] == "6")
    assert "ماده 5 قانون نظام صنفی کشور (اصلاحی 1392)" in item6["text"]
    assert "ماده 6 قانون نظام صنفی کشور (اصلاحی 1392)" in item6["text"]


def test_item_numbering_resumes_when_the_next_item_follows_a_colon():
    # item 2 rewrites a تبصره (no quoted article heading), then item 3 starts right after a colon
    relay = dict(GUILD_RELAY, text="ماده۱ـ متن یک. ماده۲ـ تبصره ماده (۹) به شرح زیر اصلاح می شود: ماده۳ـ متن سه.")
    rows, _ = srla.build_rows(relay)
    assert [(r["law_name"], r["article_no"]) for r in rows] == [
        (GUILD_RELAY["title"], "1"), (GUILD_RELAY["title"], "2"), (GUILD_RELAY["title"], "3"),
    ]


def test_non_amending_law_is_never_relabelled():
    rows, _ = srla.build_rows(dict(RELAY_ROW, text="ماده 1 - متن. ماده 4 - به شرح زیر: ماده 2 - متن."))
    assert {r["law_name"] for r in rows} == {RELAY_ROW["title"]}


def test_annotate_points_base_article_at_the_relabelled_row():
    rows, _ = srla.build_rows(GUILD_RELAY)
    base = {"law_name": "قانون نظام صنفی کشور", "article_no": "27", "text": "ماده 27 قانون نظام صنفی کشور: متن قدیم"}
    rows.append(base)
    srla.annotate_amendments(rows)
    assert "ماده 4 قانون اصلاح قانون نظام صنفی کشور" in base["amended_by"]
    assert "«ماده 27 قانون نظام صنفی کشور (اصلاحی 1392)» را مبنا قرار دهید" in base["text"]


def test_cli_proposed_marks_rows_for_build_v7(tmp_path):
    src = tmp_path / "relay.jsonl"
    src.write_text(json.dumps(GUILD_RELAY, ensure_ascii=False) + "\n", encoding="utf-8")
    out = tmp_path / "rc_laws.jsonl"
    assert srla.main([str(src), "--out", str(out), "--proposed"]) == 0
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    assert rows and all(r["staging_status"] == "proposed" for r in rows)
    assert any(r["law_name"] == RELABELLED for r in rows)
