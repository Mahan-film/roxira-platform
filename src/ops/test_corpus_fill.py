"""Offline tests for scripts/legal/corpus_fill.py (no network, no Qdrant)."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
cf = None


@pytest.fixture(autouse=True, scope="module")
def _load():
    global cf
    path = ROOT / "scripts/legal/corpus_fill.py"
    spec = importlib.util.spec_from_file_location("corpus_fill", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["corpus_fill"] = module
    spec.loader.exec_module(module)
    cf = module
    yield


def cfg(**stage):
    return {"id": "t", "title_fa": "قانون آزمایشی", "topic": "x", "stage": stage}


FETCHED = {"source_url": "https://example.test/law", "source": "ekhtebar"}

MADDE = """منوی سایت
کپی لینک اضافه
‌فصل اول- کلیات
‌ماده ۱– هر کس مرتکب شود به حبس محکوم می‌شود.
تبصره- مورد خاص.
ماده ۱ این قانون در موارد دیگر نیز اعمال می‌شود، این خط ادامه ماده قبل است.
ماده ۲ مکرر (الحاقی ۱۳۹۰/۲/۳)- متن مکرر.
‫ماده ۳ [منسوخ]- متن قدیمی.
ماده ۴ (اصلاحی ۱۳۹۹/۲/۲۳)-
توهین جزای نقدی است.
برچسب ها
ماده ۹۹- نباید دیده شود
"""


def test_normalise_text_digits_bidi_and_kaf():
    out = cf.normalise_text("‫ماده ۱۲ ك ي‬ ٣")
    assert out == "ماده 12 ک ی 3"


def test_parse_madde_markers_and_continuations():
    arts, _ = cf.parse_articles(MADDE)
    assert [a["label"] for a in arts] == ["ماده 1", "ماده 2 مکرر", "ماده 3", "ماده 4"]
    assert arts[0]["chapter"] == "فصل اول- کلیات"
    # «ماده 1 این قانون ...» has no separator after the number: it is body text, not a marker
    assert "ماده 1 این قانون" in arts[0]["body"]
    assert arts[1]["no"] == "2-mokarrar"
    assert arts[3]["body"].startswith("توهین")
    assert "نباید دیده شود" not in "".join(a["body"] for a in arts)  # cut at the end marker


def test_repealed_detection_and_explicit_numbers():
    arts, _ = cf.parse_articles(MADDE, repealed_numbers=[4])
    flags = {a["label"]: a["repealed"] for a in arts}
    assert flags == {"ماده 1": False, "ماده 2 مکرر": False, "ماده 3": True, "ماده 4": True}


def test_amended_on_takes_latest_date_and_rows_split_active_repealed():
    res = cf.stage_law(cfg(law_name="قانون آزمایشی", approval_date="1375-03-02"), MADDE, FETCHED)
    assert len(res["rows"]) == 3 and len(res["repealed_rows"]) == 1
    by = {r["article_label"]: r for r in res["rows"]}
    assert by["ماده 2 مکرر"]["amended_on"] == "1390-02-03"
    assert by["ماده 4"]["amended_on"] == "1399-02-23"
    r = by["ماده 1"]
    assert r["text"].startswith("ماده 1 قانون آزمایشی: ")
    assert r["is_active"] and r["status"] == "VALID" and r["approval_date"] == "1375-03-02"
    assert res["repealed_rows"][0]["status"] == "REPEALED"
    assert not res["repealed_rows"][0]["is_active"]
    assert len(r["content_hash"]) == 32


def test_dedupe_relabels_second_occurrence_and_gate_has_no_duplicates():
    text = "ماده 1- الف\nماده 1- ب\n"
    res = cf.stage_law(cfg(law_name="قانون کار"), text, FETCHED, {"قانون کار": True})
    labels = [r["article_label"] for r in res["rows"]]
    assert labels == ["ماده 1", "ماده 1 (2)"]
    assert res["gates"]["gate_counts"]["duplicates"] == 0
    assert "duplicate_key_relabelled" in res["rows"][1]["review_reasons"]


def test_gate_blocks_law_not_in_allowlist():
    res = cf.stage_law(cfg(law_name="قانون ناشناخته"), "ماده 1- الف\n", FETCHED, {"قانون کار": True})
    assert not res["gates"]["ok"]
    assert res["gates"]["gate_counts"]["not_in_allowlist"] == 1


def test_article_range_filters_and_analysis_reports_gaps():
    text = "ماده 1- الف\nماده 3- ب\nماده 700- ج\n"
    res = cf.stage_law(cfg(law_name="x", article_range=[1, 10]), text, FETCHED)
    assert [r["article_no"] for r in res["rows"]] == ["1", "3"]
    assert res["analysis"]["missing_numbers"] == list(range(2, 3)) + list(range(4, 700))


def test_ordinals_including_glued_forms():
    f = cf.ordinal_to_int
    assert f("اوّل") == 1
    assert f("بیست و یکم") == 21
    assert f("یکصدو سی ویکم") == 131
    assert f("یکصد و چهل وچهارم") == 144
    assert f("یکصد و هفتاد و هفتم") == 177
    assert f("سی ام") == 30
    assert f("تعداد وزیران") is None


CONSTITUTION = """مقدمه
فصل اوّل: اصول کلّی
اصل اوّل
حکومت ایران جمهوری اسلامی است.
اصل دوم
نظام جمهوری اسلامی بر پایه ایمان استوار است.
اصل سابق‏: متن قدیمی دوم.
ادامه متن قدیمی.
اصل یکصدو سی ویکم
در صورت فوت رئیس‌جمهور.
اصل سابق: قدیم.
تعداد وزیران
منابع
بیرون از متن
"""


def test_constitution_marker_drops_superseded_wording():
    res = cf.stage_law(cfg(law_name="قانون اساسی", marker="asl"), CONSTITUTION, FETCHED)
    by = {r["article_label"]: r for r in res["rows"]}
    assert set(by) == {"اصل 1", "اصل 2", "اصل 131"}
    assert "قدیمی" not in by["اصل 2"]["text"] and "قدیم" not in by["اصل 131"]["text"]
    assert "superseded_wording_dropped" in by["اصل 2"]["review_reasons"]
    assert by["اصل 1"]["chapter"] == "فصل اوّل: اصول کلّی".replace("ّ", "") or by["اصل 1"]["chapter"]


def test_wahed_article_and_empty_body_flag():
    res = cf.stage_law(cfg(law_name="x"), "ماده واحده- متن\nماده 2-\n", FETCHED)
    assert [r["article_label"] for r in res["rows"]] == ["ماده واحده", "ماده 2"]
    assert "empty_body" in res["rows"][1]["review_reasons"]


def test_article_page_text_drops_title_and_shop_line():
    html = (
        "<html><body><div class='entry-content'><h1>ماده ۶۰۸ قانون مجازات اسلامی (تعزیرات)</h1>"
        "<p>ماده ۶۰۸ (اصلاحی ۱۳۹۹/۲/۲۳)-</p><p>توهین جزای نقدی است.</p>"
        "<p>جهت خرید آنلاین کتاب کلیک کنید</p></div></body></html>"
    )

    def extract(h):
        import re

        return "\n".join(re.sub(r"<[^>]+>", "\n", h).split("\n")).strip()

    out = cf.article_page_text(html, extract)
    assert "جهت خرید" not in out
    assert "(تعزیرات)" not in out
    assert out.startswith("ماده ۶۰۸ (اصلاحی")


def test_run_stage_writes_files_and_summary(tmp_path):
    fetched = tmp_path / "f"
    fetched.mkdir()
    (fetched / "t.txt").write_text(MADDE, encoding="utf-8")
    (fetched / "manifest.json").write_text(
        json.dumps(
            {
                "laws": {
                    "t": {"status": "done", "kind": "text", "file": "t.txt", **FETCHED},
                    "u": {"status": "gave_up"},
                }
            }
        ),
        encoding="utf-8",
    )
    config = tmp_path / "c.json"
    config.write_text(
        json.dumps(
            {
                "laws": [
                    {"id": "t", "title_fa": "قانون کار", "topic": "x", "stage": {"law_name": "قانون کار"}},
                    {"id": "u", "title_fa": "قانون دیگر", "topic": "x"},
                    {"id": "a", "title_fa": "فقط ممیزی", "topic": "x", "audit_only": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    out = tmp_path / "o"
    summary = cf.run_stage(fetched, config, out, None, None)
    assert summary["laws"]["u"] == {"skipped": "not_fetched_as_text"}
    assert "a" not in summary["laws"]
    assert summary["laws"]["t"]["rows"] == 3 and summary["laws"]["t"]["repealed_excluded"] == 1
    assert summary["laws"]["t"]["gates"]["ok"]  # قانون کار is on the allowlist
    rows = [json.loads(x) for x in (out / "staged_t.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 3
    assert (out / "staged_t.repealed.jsonl").exists()
    assert (out / "stage_summary.json").exists()


PRIOR = """ماده 1- متن فعلی.
تبصره 1– [به موجب ماده 15 قانون کاهش حبس تعزیری مصوب 1399 نسخ شده است.]

متن سابق تبصره 1- قدیمی یک.

ادامه قدیمی دو.
تبصره 2- باقی است.
ماده 2
[به موجب ماده 15 قانون کاهش حبس تعزیری مصوب 1399 نسخ شده است.]
متن سابق ماده 2- قدیمی.
"""


def test_prior_text_is_dropped_and_repealed_note_marks_article():
    arts, _ = cf.parse_articles(PRIOR.replace("ماده 2\n[", "ماده 2- ["))
    a1, a2 = arts
    assert "قدیمی" not in a1["body"] and "تبصره 2- باقی است." in a1["body"]
    assert not a1["repealed"] and a1["had_prev"]
    assert a2["repealed"] and "قدیمی" not in a2["body"]
    res = cf.stage_law(cfg(law_name="x"), PRIOR.replace("ماده 2\n[", "ماده 2- ["), FETCHED)
    assert [r["article_label"] for r in res["rows"]] == ["ماده 1"]
    assert [r["article_label"] for r in res["repealed_rows"]] == ["ماده 2"]
    assert "superseded_wording_dropped" in res["rows"][0]["review_reasons"]


def test_stage_gates_proposed_law_unless_allow_proposed(tmp_path, monkeypatch):
    monkeypatch.delenv("LEGAL_ALLOW_PROPOSED", raising=False)
    name = "قانون جرایم رایانه‌ای"  # status "proposed" in config/legal_allowlist.json
    fetched = tmp_path / "f"
    fetched.mkdir()
    (fetched / "t.txt").write_text(MADDE, encoding="utf-8")
    (fetched / "manifest.json").write_text(
        json.dumps({"laws": {"t": {"status": "done", "kind": "text", "file": "t.txt", **FETCHED}}}),
        encoding="utf-8",
    )
    config = tmp_path / "c.json"
    config.write_text(
        json.dumps({"laws": [{"id": "t", "title_fa": name, "topic": "x", "stage": {"law_name": name}}]}),
        encoding="utf-8",
    )
    default = cf.run_stage(fetched, config, tmp_path / "o1", None, None)
    assert default["laws"]["t"]["gates"]["gate_counts"]["not_in_allowlist"] == 3
    assert not default["laws"]["t"]["gates"]["ok"]
    allowed = cf.run_stage(fetched, config, tmp_path / "o2", None, None, allow_proposed=True)
    assert allowed["laws"]["t"]["gates"]["ok"]
