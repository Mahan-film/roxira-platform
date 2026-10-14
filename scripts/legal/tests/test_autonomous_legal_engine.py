"""Offline tests for scripts/legal/experimental/autonomous_legal_engine.py.

Pins only the pure/deterministic helpers and the JSONL exporter; no network,
no Qdrant, and no ingestion pipeline side effects.
"""
import importlib.util
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "autonomous_legal_engine",
    ROOT / "scripts" / "legal" / "experimental" / "autonomous_legal_engine.py",
)
engine = importlib.util.module_from_spec(spec)
sys.modules["autonomous_legal_engine"] = engine
spec.loader.exec_module(engine)

ZWNJ = "\u200c"


def _rec(law, no, text, label=None):
    return engine.LegalArticleRecord(
        law_name=law,
        article_no=no,
        article_label=label or f"ماده {no}",
        text=text,
    )


def test_normalize_persian_text_letters_zwnj_whitespace_digits():
    n = engine.normalize_persian_text
    assert n("ك") == "ک" and n("ي") == "ی"
    assert n("مـاده") == "ماده"  # decorative tatweel dropped
    assert n("می\u200bگردد") == "می" + ZWNJ + "گردد"  # ZWSP/ZWNJ collapsed
    assert n("٠١٢") == "012"  # Arabic-Indic digits folded to ASCII
    assert n("الف   ب\tج") == "الف ب ج"
    assert n("  متن  ") == "متن"
    assert n("") == ""


def test_parse_article_number_persian_digits_and_mokarrar():
    p = engine.parse_article_number
    assert p("۱۲") == "12"
    assert p("٥") == "5"  # Arabic-Indic variant also folds
    assert p("۵ مکرر") == "5 مکرر"
    assert p("7") == "7"
    assert p("") == ""


def test_compute_point_id_is_stable_and_normalized():
    pid = engine.compute_point_id("قانون مدنی", "۱۲", "ماده ۱۲")
    assert pid == engine.compute_point_id("قانون مدنی", "۱۲", "ماده ۱۲")
    # Arabic yeh in the law name normalizes to the same id
    assert pid == engine.compute_point_id("قانون مدني", "۱۲", "ماده ۱۲")
    # Persian vs ASCII article digits normalize to the same id
    assert pid == engine.compute_point_id("قانون مدنی", "12", "ماده ۱۲")
    # Distinct keys stay distinct
    assert pid != engine.compute_point_id("قانون مدنی", "13", "ماده ۱۲")
    assert pid != engine.compute_point_id("قانون تجارت", "۱۲", "ماده ۱۲")
    assert len(pid) == 36 and pid.count("-") == 4


def test_scan_relations_repeal_amendment_unrelated():
    records = [
        _rec("قانون الف", "1", "ماده ۱ این قانون ملغی" + ZWNJ + "الاثر می" + ZWNJ + "گردد."),
        _rec("قانون الف", "2", "ماده ۲ این قانون اصلاح می" + ZWNJ + "گردد."),
        _rec("قانون ب", "1", "دستگاه مکلف است گزارش را منتشر کند."),
        _rec("قانون الف", "3", "ماده ۳ تکلیف دیگری را بیان می" + ZWNJ + "کند."),
    ]
    graph = engine.LegalConflictGraph()
    relations = graph.scan_relations(records)

    by_type = {}
    for rel in relations:
        by_type.setdefault(rel.relation_type, []).append(rel)

    assert sorted(by_type) == ["AMENDS", "REPEALS"]
    assert len(by_type["REPEALS"]) == 1
    assert len(by_type["AMENDS"]) == 1
    assert "ملغی" in by_type["REPEALS"][0].trigger_phrase
    assert by_type["REPEALS"][0].source_article == "1"
    assert "اصلاح" in by_type["AMENDS"][0].trigger_phrase
    assert by_type["AMENDS"][0].source_article == "2"
    # unrelated record and the plain target record yield no relations of their own
    assert all(r.source_article != "3" for r in relations)
    assert all(not (r.source_law == "قانون ب" and r.source_article == "1") for r in relations)


def test_export_jsonl_round_trip(tmp_path):
    repealed = _rec("قانون الف", "1", "متن ماده ۱")
    repealed.is_active = False
    repealed.status = "منسوخ"
    repealed.repealed_by = {
        "by_law": "قانون ب",
        "by_article": "2",
        "trigger": "ملغی" + ZWNJ + "الاثر می" + ZWNJ + "گردد",
    }

    amended = _rec("قانون ب", "2", "متن ماده ۲")
    amended.amendments.append({"by_law": "قانون ج", "by_article": "3", "trigger": "اصلاح"})

    records = [repealed, amended]
    out = tmp_path / "nested" / "out.jsonl"
    engine.AutonomousLegalEngine().export_jsonl(records, out)

    raw = out.read_text(encoding="utf-8")
    assert "قانون الف" in raw  # ensure_ascii=False keeps Persian readable
    lines = [json.loads(line) for line in raw.splitlines() if line.strip()]
    assert lines == [asdict(r) for r in records]
    assert lines[0]["point_id"] == repealed.point_id
    assert lines[0]["repealed_by"] == repealed.repealed_by
    assert lines[1]["amendments"] == amended.amendments

    # The exported file is also consumable by the engine reader.
    reparsed = engine.AutonomousLegalEngine().process_file(out)
    assert [(r.law_name, r.article_no) for r in reparsed] == [
        ("قانون الف", "1"),
        ("قانون ب", "2"),
    ]
