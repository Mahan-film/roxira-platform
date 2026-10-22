"""Offline tests for scripts/legal/build_v7.py (inline fixtures, no Qdrant, no network)."""
# ruff: noqa: RUF001
import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "build_v7", ROOT / "scripts" / "legal" / "build_v7.py"
)
b7 = importlib.util.module_from_spec(spec)
sys.modules["build_v7"] = b7
spec.loader.exec_module(b7)

DIM = 4
LONG = "متن کامل این سند برای آزمون قواعد انتخاب و مسیریابی در نسخه هفت کافی است"


def _row(law, no, text="متن کافی برای عبور از حداقل طول متن این آزمون", **extra):
    row = {"law_name": law, "article_no": no, "article_label": f"ماده {no}", "text": text}
    row.update(extra)
    return row


# ---------------------------------------------------------------- row filter
def test_select_keeps_only_proposed_active_long_rows():
    rows = [
        _row("L", "1", status="proposed"),
        _row("L", "2", staging_status="proposed"),
        _row("L", "3", status="VALID"),  # not proposed
        _row("L", "4", status="proposed", is_active=False),  # repealed
        _row("L", "5", status="proposed", page_status="repealed"),
        _row("L", "6", status="proposed", text="too short"),  # < 30 chars
    ]
    kept, dropped = b7.select_rows(rows)
    assert [r["article_no"] for r in kept] == ["1", "2"]
    assert dropped["not_proposed"] == 1
    assert dropped["repealed"] == 2
    assert dropped["short_text"] == 1


def test_row_article_no_falls_back_to_label():
    assert b7.row_article_no({"article_label": "ماده ۱۲"}) == "۱۲"
    assert b7.row_article_no({"article_no": "7"}) == "7"
    assert b7.row_article_no({}) == ""


def test_row_source_strips_ir_suffix():
    assert b7.row_source({"source": "nezamat"}) == "nezamat"
    assert b7.row_source({"source_label": "ekhtebar.ir"}) == "ekhtebar"
    assert b7.row_source({}) == "unknown"


# ---------------------------------------------------------------- dedupe
def test_dedupe_prefers_newest_stamp():
    older = _row("L", "1", text="old text long enough to pass", retrieved_at="2026-10-01")
    newer = _row("L", "1", text="new text long enough to pass", amended_on="2026-10-20")
    assert b7.dedupe_rows([older, newer]) == [newer]


def test_dedupe_tie_prefers_last_occurrence():
    a = _row("L", "1", text="first long enough text here")
    b = _row("L", "1", text="second long enough text here")
    assert b7.dedupe_rows([a, b]) == [b]


def test_dedupe_key_normalises_zwnj_digits_and_arabic_letters():
    a = _row("قانون‌الف", "1")
    b = _row("قانون الف", "۱")  # ZWNJ vs space, Persian digit
    assert b7.row_key(a) == b7.row_key(b)
    assert len(b7.dedupe_rows([a, b])) == 1


def test_dedupe_keeps_distinct_articles():
    rows = [_row("L", "1"), _row("L", "2"), _row("M", "1")]
    assert len(b7.dedupe_rows(rows)) == 3


# ---------------------------------------------------------------- conflicts
def test_find_conflicts_same_article_different_text():
    rows = [
        _row("L", "1", text="متن منبع نخست به اندازه کافی بلند است", source="nezamat"),
        _row("L", "1", text="متن منبع دوم کاملا متفاوت و بلند است", source="ekhtebar"),
        _row("L", "2", text="متن یکتا و بلند برای ماده دو این قانون", source="nezamat"),
    ]
    conflicts = b7.find_conflicts(rows)
    assert len(conflicts) == 1
    key, group = conflicts[0]
    assert key == b7.row_key(rows[0]) and len(group) == 2


def test_no_conflict_when_text_is_identical():
    same = [
        _row("L", "2", text="متن کامل یکسان این ماده", source="a"),
        _row("L", "2", text="متن کامل یکسان این ماده", source="b"),
    ]
    assert b7.find_conflicts(same) == []


def test_conflicts_markdown_lists_pairs_without_text():
    rows = [
        _row("قانون الف", "1", text="متن نخست بلند و کافی", source="nezamat"),
        _row("قانون الف", "1", text="متن دوم متفاوت و بلند", source="ekhtebar"),
    ]
    md = b7.conflicts_markdown(b7.find_conflicts(rows))
    assert "قانون الف" in md and "ekhtebar, nezamat" in md
    assert "متن نخست بلند" not in md  # no law text in the review file
    assert "No conflicts" in b7.conflicts_markdown([])


# ---------------------------------------------------------------- misc helpers
def test_estimate_tokens():
    assert b7.estimate_tokens("") == 1
    assert b7.estimate_tokens("a" * 30) == 10


def test_discover_files_excludes_repealed_and_review(tmp_path):
    (tmp_path / "sync_sources_2026-10-20_nezamat.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "sync_sources_2026-10-20_nezamat.repealed.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "sync_sources_2026-10-20_review.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "iran_relay_2026-10-20.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "unrelated.jsonl").write_text("", encoding="utf-8")
    found = {p.name for p in b7.discover_files(tmp_path)}
    assert found == {"sync_sources_2026-10-20_nezamat.jsonl", "iran_relay_2026-10-20.jsonl"}


def test_merge_staged_overrides_base_and_dedupes_point_ids():
    base = [
        _row("L", "1", text="base article one long enough"),
        _row("L", "2", text="base article two long enough"),
    ]
    staged = [
        _row("L", "1", text="staged replacement long enough"),
        _row("L", "3", text="new staged article long enough"),
    ]
    merged = b7.merge_rows(base, staged)
    texts = {f"{b7.row_law_name(r)}/{b7.row_article_no(r)}": r["text"] for r in merged}
    assert texts["L/1"] == "staged replacement long enough"
    assert texts["L/2"] == "base article two long enough"
    assert texts["L/3"] == "new staged article long enough"
    ids = [b7.ip.point_id(r) for r in merged]
    assert len(ids) == len(set(ids))


def test_safe_out_refuses_data_dir():
    with pytest.raises(b7.Refusal):
        b7._safe_out(ROOT / "data" / "legal" / "staged")
    assert b7._safe_out(Path("/tmp/opencode/v7-out")).name == "v7-out"


# ---------------------------------------------------------------- apply (fake Qdrant)
class FakeQdrant:
    """Minimal in-memory Qdrant: create, upsert and points_count."""

    def __init__(self):
        self.cols: dict[str, dict] = {}

    def __call__(self, method, url, body=None):
        name, _, rest = url.split("/collections/", 1)[1].partition("/")
        if not rest:
            if method == "GET":
                if name in self.cols:
                    return 200, {"result": {"points_count": len(self.cols[name])}}
                return 404, {}
            if method == "PUT":
                self.cols[name] = {}
                return 200, {"result": True}
        elif rest.startswith("points") and method == "PUT":
            for point in body["points"]:
                self.cols[name][point["id"]] = point
            return 200, {"result": True}
        return 404, {}


def fake_embed(texts):
    return [[0.1] * DIM for _ in texts]


def test_apply_creates_new_collection_and_verifies_count():
    qd = FakeQdrant()
    staged = [_row("L", "1"), _row("L", "2"), _row("L", "3")]
    result = b7.apply(
        staged,
        collection="iran_laws_v7_test",
        src=None,
        base_rows=[],
        batch=2,
        http=qd,
        embed=fake_embed,
    )
    assert result["points_written"] == 3
    assert result["points_count_verified"] == 3
    assert len(qd.cols["iran_laws_v7_test"]) == 3


def test_apply_refuses_protected_and_existing_collections():
    qd = FakeQdrant()
    with pytest.raises(b7.Refusal):
        b7.apply(
            [_row("L", "1")],
            collection="iran_laws_v6",
            src=None,
            base_rows=[],
            http=qd,
            embed=fake_embed,
        )
    qd.cols["iran_laws_v7_test"] = {}
    with pytest.raises(b7.Refusal):
        b7.apply(
            [_row("L", "1")],
            collection="iran_laws_v7_test",
            src=None,
            base_rows=[],
            http=qd,
            embed=fake_embed,
        )


# ---------------------------------------------------------------- CLI
def test_main_dry_run_writes_report_and_no_qdrant(tmp_path):
    staged = tmp_path / "staged"
    staged.mkdir()
    src = staged / "sync_sources_2026-10-20_nezamat.jsonl"
    row = _row("قانون الف", "1", status="proposed", source="nezamat")
    src.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for _ in range(2)), encoding="utf-8"
    )
    out = tmp_path / "out"
    qd = FakeQdrant()
    rc = b7.main(["--out", str(out), "--files", str(src)], http=qd, embed=fake_embed)
    assert rc == 0
    report = json.loads((out / "v7_report.json").read_text(encoding="utf-8"))
    assert report["mode"] == "dry-run" and report["selected_rows"] == 2
    assert report["collection"] is None
    assert (out / "v7_conflicts.md").exists()
    assert qd.cols == {}


def test_main_apply_with_no_base(tmp_path):
    staged = tmp_path / "staged"
    staged.mkdir()
    src = staged / "law_watch_2026-10-20.jsonl"
    row = _row("قانون ب", "5", status="proposed", source="ekhtebar")
    src.write_text(json.dumps(row, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "out"
    qd = FakeQdrant()
    rc = b7.main(
        [
            "--out",
            str(out),
            "--files",
            str(src),
            "--apply",
            "--no-base",
            "--collection",
            "iran_laws_v7_test",
        ],
        http=qd,
        embed=fake_embed,
    )
    assert rc == 0
    assert len(qd.cols["iran_laws_v7_test"]) == 1


# ---------------------------------------------------------------- rule 1: routing
def test_classify_statute_regulation_ruling_news_empty():
    assert b7.classify_row({"law_name": "L", "law_type": "LAW", "text": LONG}) == "statute"
    assert b7.classify_row({"law_name": "L", "text": LONG}) == "statute"
    assert (
        b7.classify_row({"law_name": "L", "law_type": "REGULATION", "text": LONG})
        == "regulation"
    )
    assert b7.classify_row({"law_name": "L", "doc_type": "circular", "text": LONG}) == "regulation"
    assert (
        b7.classify_row({"law_name": "L", "source": "owner_upload_cbi_circular", "text": LONG})
        == "regulation"
    )
    assert b7.classify_row({"title": "بخشنامه جدید", "text": LONG}) == "regulation"
    assert b7.classify_row({"title": "یک مقرره", "text": LONG}) == "regulation"
    assert b7.classify_row({"title": "رأی شماره ۱", "text": LONG}) == "ruling"
    assert b7.classify_row({"title": "خبر مهم", "text": LONG}) == "news"
    assert b7.classify_row({"text": LONG}) == "empty"


def test_split_routes_statutes_regulations_and_drops_empty():
    rows = [
        _row("قانون الف", "1", status="proposed", law_type="LAW", source="nezamat"),
        {"title": "بخشنامه بانک مرکزی", "text": LONG, "status": "proposed", "source": "cbi_pdf"},
        {
            "title": "مقرره‌ای بدون نام قانون",
            "text": LONG,
            "status": "proposed",
            "source": "qavanin",
        },
        {"text": LONG, "status": "proposed", "source": "qavanin"},
    ]
    laws, regs, dropped = b7.split_rows(rows)
    assert [b7.row_law_name(r) for r in laws] == ["قانون الف"]
    assert len(regs) == 2
    assert dropped["no_name_or_title"] == 1


@pytest.mark.parametrize("marker", ["منتشر می شود", "ابلاغ شد", "خبر", "به زودی"])
def test_news_titles_are_news(marker):
    assert b7.is_non_statute_kind(_row("L", "1", title=f"قانونی {marker} اینجا")) == "news"


@pytest.mark.parametrize("prefix", ["رأی شماره ۱", "رای شماره ۲"])
def test_ruling_titles_are_rulings(prefix):
    assert b7.is_non_statute_kind(_row("L", "1", title=f"{prefix} هیئت عمومی")) == "ruling"


def test_split_drops_news_and_rulings_separately():
    rows = [
        _row("L", "1", status="proposed", title="قانون جدید ابلاغ شد"),
        _row("L", "2", status="proposed", title="رأی شماره ۱۲ هیئت عمومی"),
        _row("L", "3", status="proposed", title="خبر مهم درباره قانون"),
    ]
    laws, regs, dropped = b7.split_rows(rows)
    assert laws == [] and regs == []
    assert dropped["news"] == 2
    assert dropped["ruling"] == 1


# ---------------------------------------------------------------- rule 2: similarity
def test_normalise_text_removes_zwnj_digits_and_punctuation():
    a = b7.normalise_text("قانون\u200cتجارت، مادهٔ ۱.")
    b = b7.normalise_text("قانون تجارت ماده 1")
    assert a == b == "قانونتجارتماده1"


def test_near_identical_texts_are_same_but_real_differences_are_not():
    body = LONG * 2
    assert b7.same_text(body, body + "و")
    assert b7.same_text("متن نخست، کاملاً یکسان!", "متن نخست کاملا یکسان")
    assert not b7.same_text(body, "متن کاملا متفاوت و بی‌ربط برای این آزمون طولانی")


def test_find_conflicts_ignores_near_identical_texts():
    body = LONG * 2
    rows = [
        _row("قانون تجارت", "1", text=body, source="qavanin"),
        _row("قانون تجارت", "1", text=body + "و", source="nezamat"),
    ]
    assert b7.find_conflicts(rows) == []


def test_dedupe_source_priority_rc_majlis_beats_qavanin_beats_nezamat():
    body = LONG * 2
    qavanin = _row("L", "1", text=body, source="qavanin")
    majors = _row("L", "1", text=body + "و", source="rc.majlis")
    nezamat = _row("L", "1", text=body + "ی", source="nezamat")
    assert b7.dedupe_rows([qavanin, nezamat]) == [qavanin]
    assert b7.dedupe_rows([qavanin, majors]) == [majors]


def test_find_conflicts_keeps_real_difference():
    rows = [
        _row("L", "1", text="متن نخست کاملا متفاوت درباره موضوع الف و ب", source="qavanin"),
        _row("L", "1", text="متن دوم درباره موضوعی دیگر و طولانی تر و متفاوت", source="nezamat"),
    ]
    assert len(b7.find_conflicts(rows)) == 1


# ---------------------------------------------------------------- rule 4: files / v6
def test_filter_input_files_applies_staged_exclusions(tmp_path):
    keep = tmp_path / "sync_sources_x.jsonl"
    repealed = tmp_path / "sync_sources_x.repealed.jsonl"
    review = tmp_path / "sync_sources_x_review.jsonl"
    unity = tmp_path / "unity_rulings_2026.jsonl"
    for path in (keep, repealed, review, unity):
        path.write_text("", encoding="utf-8")
    found = b7.filter_input_files([keep, repealed, review, unity, keep])
    assert {p.name for p in found} == {"sync_sources_x.jsonl"}


def test_is_excluded_file_prefix_and_suffixes():
    assert b7.is_excluded_file(Path("unity_rulings_2026.jsonl"))
    assert b7.is_excluded_file(Path("x.repealed.jsonl"))
    assert b7.is_excluded_file(Path("x_review.jsonl"))
    assert not b7.is_excluded_file(Path("sync_sources_x.jsonl"))


def test_skip_already_in_v6_matches_normalised_text():
    base = [_row("L", "1", text="متن ثابت قانون در نسخه شش که طولانی است")]
    staged = [
        _row("L", "1", text="متن ثابت قانون در نسخه شش که طولانی است", source="nezamat"),
        _row("L", "2", text="متن تازه دیگر برای نسخه هفت این قانون", source="nezamat"),
    ]
    kept, skipped = b7.skip_already_in_v6(staged, base)
    assert skipped == 1
    assert [b7.row_article_no(r) for r in kept] == ["2"]


# ---------------------------------------------------------------- rule 1-4 through main
def test_main_dry_run_reports_regulations_section(tmp_path):
    staged = tmp_path / "staged"
    staged.mkdir()
    src = staged / "sync_sources_2026-10-20_cbi.jsonl"
    rows = [
        {"title": "بخشنامه بانک مرکزی", "text": LONG, "status": "proposed", "source": "cbi_pdf"},
        _row("قانون الف", "1", status="proposed", source="nezamat"),
    ]
    src.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8"
    )
    out = tmp_path / "out"
    qd = FakeQdrant()
    rc = b7.main(
        ["--out", str(out), "--files", str(src), "--target", "regulations"],
        http=qd,
        embed=fake_embed,
    )
    assert rc == 0
    report = json.loads((out / "v7_report.json").read_text(encoding="utf-8"))
    assert report["target"] == "regulations"
    assert report["selected_rows"] == 1
    assert report["laws"]["selected_rows"] == 1
    assert report["regulations"]["selected_rows"] == 1
    assert qd.cols == {}


def test_main_files_honours_exclusions(tmp_path):
    src = tmp_path / "sync_sources_x.repealed.jsonl"
    src.write_text(json.dumps(_row("L", "1", status="proposed")), encoding="utf-8")
    out = tmp_path / "out"
    qd = FakeQdrant()
    rc = b7.main(["--out", str(out), "--files", str(src)], http=qd, embed=fake_embed)
    assert rc == 0
    report = json.loads((out / "v7_report.json").read_text(encoding="utf-8"))
    assert report["staged_files"] == []
    assert report["selected_rows"] == 0


def test_main_apply_target_regulations_uses_default_collection(tmp_path):
    staged = tmp_path / "staged"
    staged.mkdir()
    src = staged / "sync_sources_2026-10-20_cbi.jsonl"
    reg = {"title": "بخشنامه نمونه", "text": LONG, "status": "proposed", "source": "cbi_pdf"}
    src.write_text(json.dumps(reg, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "out"
    qd = FakeQdrant()
    rc = b7.main(
        [
            "--out",
            str(out),
            "--files",
            str(src),
            "--target",
            "regulations",
            "--apply",
            "--no-base",
        ],
        http=qd,
        embed=fake_embed,
    )
    assert rc == 0
    assert len(qd.cols["iran_regulations_v3"]) == 1


def test_embed_text_is_truncated_for_the_embedder_only():
    row = {"text": "ا" * 9000}
    assert len(b7.embed_text(row)) == b7.EMBED_CHARS == 2000
    assert len(row["text"]) == 9000
    assert b7.embed_text({}) == ""
