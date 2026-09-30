"""Unit tests for scripts/legal_coverage_report.py (W25-2, issue #139).

scripts/ runs outside pytest's `testpaths = ["src"]`, so the module is loaded
dynamically by path -- same pattern as src/test_check_models.py.

Fully offline: a 5-row sample JSONL in a tmp dir. No network, no database, no
secret. Verifies the aggregation numbers, the Jalali date comparison, the bill
warning, and that the Markdown and JSON outputs carry identical numbers.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

report = None  # populated by the fixture before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_report_module():
    global report
    if report is None:
        module_path = Path(__file__).resolve().parents[1] / "scripts" / "legal_coverage_report.py"
        spec = importlib.util.spec_from_file_location("legal_coverage_report", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module


def _row(
    law_name,
    law_type,
    article_no,
    is_active,
    amended_on,
    approval_date,
    source,
    source_tier="official",
):
    return {
        "law_id": None,
        "law_name": law_name,
        "law_type": law_type,
        "article_no": article_no,
        "article_label": f"ماده {article_no}",
        "chapter": None,
        "amended_on": amended_on,
        "approval_date": approval_date,
        "status": "VALID",
        "is_active": is_active,
        "source_url": f"https://example.test/{article_no}",
        "source": source,
        "source_tier": source_tier,
        "content_hash": f"hash-{law_name}-{article_no}",
        "chunk_index": 0,
        "text": "متن نمونه",
    }


@pytest.fixture
def sample_records():
    # 5 rows across 2 laws; one row is inactive; one law is a لایحه.
    # Amended dates are deliberately non-zero-padded so a naive string sort
    # would pick "1370-8-14" over the truly newer "1370-10-2".
    return [
        _row("قانون الف", "CIVIL", "1", True, "1370-8-14", "1370-01-01", "owner-supplied file"),
        _row("قانون الف", "CIVIL", "2", True, "1370-10-2", "1370-01-01", "owner-supplied file"),
        _row("قانون الف", "CIVIL", "3", False, None, "1370-01-01", "owner-supplied file"),
        _row("لایحه ب", "COMMERCIAL", "1", True, None, None, "dotic via HF snapshot"),
        _row("لایحه ب", "COMMERCIAL", "2", True, None, None, "dotic via HF snapshot"),
    ]


@pytest.fixture
def sample_file(tmp_path, sample_records):
    path = tmp_path / "sample.jsonl"
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in sample_records) + "\n",
        encoding="utf-8",
    )
    return path


def test_totals(sample_records):
    manifest = report.build_manifest(sample_records)
    totals = manifest["totals"]
    assert totals["laws"] == 2
    assert totals["articles"] == 5
    assert totals["active"] == 4
    assert totals["inactive"] == 1
    assert totals["bills"] == 1


def test_per_law_counts_and_dates(sample_records):
    manifest = report.build_manifest(sample_records)
    by_name = {row["name"]: row for row in manifest["laws"]}

    civil = by_name["قانون الف"]
    assert civil["articles"] == 3
    assert civil["active"] == 2
    assert civil["inactive"] == 1
    assert civil["newest_amended_on"] == "1370-10-2"  # numeric, not lexical
    assert civil["newest_approval_date"] == "1370-01-01"
    assert civil["sources"] == ["owner-supplied file"]
    assert civil["is_bill"] is False

    bill = by_name["لایحه ب"]
    assert bill["articles"] == 2
    assert bill["is_bill"] is True


def test_bill_warning_emitted():
    commerce_name = "لایحه اصلاحی قانون تجارت"
    commerce_manifest = report.build_manifest(
        [
            _row(
                commerce_name,
                "COMMERCIAL",
                "1",
                True,
                None,
                None,
                "dotic via HF snapshot",
            )
        ]
    )
    commerce_row = commerce_manifest["laws"][0]
    assert commerce_row["is_bill"] is False
    assert commerce_manifest["totals"]["bills"] == 0
    assert commerce_manifest["warnings"] == [
        "«لایحه اصلاحی قانون تجارت» قانون لازم‌الاجرا است (مصوب کمیسیون مشترک مجلسین)؛ "
        "مواد ۵۱ و ۵۳ تا ۷۱ آن طبق قانون ۱۴۰۳/۱۱/۱۵ نامعتبر اعلام شده و باید از پایگاه حذف شود."
    ]

    unknown_manifest = report.build_manifest(
        [
            _row(
                "لایحه آزمایشی",
                "COMMERCIAL",
                "1",
                True,
                None,
                None,
                "dotic via HF snapshot",
            )
        ]
    )
    assert unknown_manifest["laws"][0]["is_bill"] is True
    assert unknown_manifest["totals"]["bills"] == 1


def test_manifest_contains_source_tiers(sample_records):
    manifest = report.build_manifest(sample_records)
    by_name = {row["name"]: row for row in manifest["laws"]}
    assert by_name["قانون الف"]["source_tiers"] == ["official"]
    assert by_name["لایحه ب"]["source_tiers"] == ["official"]


def test_secondary_only_law_warns():
    records = [
        _row(
            "قانون غیررسمی",
            "CIVIL",
            "1",
            True,
            None,
            None,
            "owner-supplied file",
            source_tier="secondary",
        )
    ]
    manifest = report.build_manifest(records)
    warnings = [w for w in manifest["warnings"] if "قانون غیررسمی" in w]
    assert len(warnings) == 1
    assert "منبع غیررسمی" in warnings[0]
    assert "تطبیق" in warnings[0]


def test_official_law_does_not_warn():
    records = [
        _row(
            "قانون رسمی",
            "CIVIL",
            "1",
            True,
            None,
            None,
            "dotic via HF snapshot",
            source_tier="official",
        )
    ]
    manifest = report.build_manifest(records)
    assert all("قانون رسمی" not in warning for warning in manifest["warnings"])


def test_missing_source_tier_is_unknown():
    row = _row("قانون بی‌تیر", "CIVIL", "1", True, None, None, "owner-supplied file")
    row.pop("source_tier")
    manifest = report.build_manifest([row])
    by_name = {r["name"]: r for r in manifest["laws"]}
    assert by_name["قانون بی‌تیر"]["source_tiers"] == ["unknown"]


def test_render_markdown_has_tier_column(sample_records):
    manifest = report.build_manifest(sample_records)
    markdown = report.render_markdown(manifest)
    assert "| Source | Tier |" in markdown
    assert "official" in markdown


def test_date_sort_key_normalizes_digits(sample_records):
    persian_date = "\u06f1\u06f3\u06f7\u06f9-\u06f0\u06f1-\u06f2\u06f1"
    assert report._date_sort_key(persian_date) == report._date_sort_key("1379-01-21")
    assert report._date_sort_key(None) is None
    assert report._date_sort_key("not-a-date") is None


def test_render_markdown_has_persian_heading_and_numbers(sample_records):
    manifest = report.build_manifest(sample_records)
    markdown = report.render_markdown(manifest)
    assert "# مانیفست پوشش حقوقی" in markdown
    assert "| Law | Type | Articles |" in markdown
    assert "| Articles (rows) | 5 |" in markdown
    assert "| Active | 4 |" in markdown
    assert "| Inactive | 1 |" in markdown
    assert "⚠️" in markdown


def test_write_outputs_json_matches_markdown(sample_records, tmp_path):
    manifest = report.build_manifest(sample_records)
    md_path = tmp_path / "out" / "manifest.md"
    json_path = tmp_path / "out" / "manifest.json"
    report.write_outputs(manifest, md_path, json_path)

    markdown = md_path.read_text(encoding="utf-8")
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["totals"]["articles"] == 5
    assert data["totals"]["active"] == 4
    # Same numbers in both artifacts.
    assert "| Articles (rows) | 5 |" in markdown


def test_main_writes_both_artifacts(sample_file, tmp_path):
    md_path = tmp_path / "manifest.md"
    json_path = tmp_path / "manifest.json"
    code = report.main(
        [
            "--data-dir",
            str(sample_file.parent),
            "--md-out",
            str(md_path),
            "--json-out",
            str(json_path),
            "--quiet",
        ]
    )
    assert code == 0
    assert md_path.exists()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["totals"]["laws"] == 2


def test_load_records_rejects_bad_json(tmp_path):
    path = tmp_path / "bad.jsonl"
    path.write_text('{"law_name": "x"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="invalid JSON"):
        report.load_records(tmp_path)


def test_load_records_requires_a_shard(tmp_path):
    with pytest.raises(FileNotFoundError):
        report.load_records(tmp_path)
