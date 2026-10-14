"""Offline tests for scripts/legal/dedupe_staged_rows.py (inline fixtures)."""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "dedupe_staged_rows", ROOT / "scripts" / "legal" / "dedupe_staged_rows.py"
)
d = importlib.util.module_from_spec(spec)
sys.modules["dedupe_staged_rows"] = d
spec.loader.exec_module(d)


def _row(law, no, section=None, text="x"):
    return {
        "law_name": law,
        "article_no": no,
        "article_label": f"ماده {no}",
        "section": section,
        "text": text,
    }


def test_later_input_wins():
    older = _row("قانون الف", "1", None, "old ekhtebar")
    newer = _row("قانون الف", "1", None, "new qavanin")
    assert d.dedupe_rows([older, newer]) == [newer]


def test_output_keeps_order_of_last_occurrence():
    a = _row("L", "1", None, "a")
    b = _row("L", "2", None, "b")
    a2 = _row("L", "1", None, "a2")
    assert [r["text"] for r in d.dedupe_rows([a, b, a2])] == ["b", "a2"]


def test_normalises_zwnj_and_persian_digits():
    older = _row("قانون الف", "1")
    newer = _row("قانون\u200cالف", "۱")  # ZWNJ + Persian digit
    out = d.dedupe_rows([older, newer])
    assert len(out) == 1 and out[0] is newer


def test_section_distinguishes_two_sequences():
    first = _row("L", "1", "s1", "first sequence")
    second = _row("L", "1", "s2", "second sequence")
    assert len(d.dedupe_rows([first, second])) == 2


def test_needs_review_flag_is_preserved():
    row = _row("L", "3")
    row["needs_review"] = True
    out = d.dedupe_rows([row])
    assert out[0]["needs_review"] is True


def test_merge_across_files_keeps_later_and_reports(tmp_path):
    f1 = tmp_path / "a.jsonl"
    f2 = tmp_path / "b.jsonl"
    f1.write_text(json.dumps(_row("L", "1", None, "one")) + "\n", encoding="utf-8")
    f2.write_text(json.dumps(_row("L", "1", None, "two")) + "\n", encoding="utf-8")
    rows, report = d.merge([f1, f2])
    assert [r["text"] for r in rows] == ["two"]
    assert report["rows_in"] == 2 and report["rows_out"] == 1 and report["overridden"] == 1
