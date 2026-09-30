"""Offline tests for the Dotic corpus eligibility rules."""

import importlib.util
from pathlib import Path

import pytest


mod = None


@pytest.fixture(scope="module", autouse=True)
def load_ingest_module():
    """Load the script lazily so importing this test has no script side effects."""
    global mod
    script = Path(__file__).resolve().parents[1] / "scripts" / "w6_ingest_dotic.py"
    spec = importlib.util.spec_from_file_location("w6_ingest_dotic", script)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)


def test_filter_records_drops_inactive_by_default():
    records = [
        {"law_name": "قانون نمونه", "article_no": "1", "is_active": True},
        {"law_name": "قانون نمونه", "article_no": "2", "is_active": False},
    ]

    kept, dropped = mod.filter_records(records)

    assert kept == [records[0]]
    assert dropped == [records[1]]


def test_filter_records_can_keep_inactive_records():
    records = [{"law_name": "قانون نمونه", "article_no": "2", "is_active": False}]

    kept, dropped = mod.filter_records(records, drop_inactive=False)

    assert kept == records
    assert dropped == []


def test_filter_records_drops_invalid_commerce_act_articles():
    law_name = "لایحه اصلاحی قانون تجارت"
    records = [
        {"law_name": law_name, "article_no": article, "is_active": True}
        for article in ("51", "52", "53", "53-mokarrar", "71", "72")
    ]

    kept, dropped = mod.filter_records(records, invalid_articles=mod.INVALID_ARTICLES)

    assert [record["article_no"] for record in kept] == ["52", "72"]
    assert [record["article_no"] for record in dropped] == ["51", "53", "53-mokarrar", "71"]


def test_filter_records_leaves_other_laws_untouched():
    records = [{"law_name": "قانون تجارت", "article_no": "53", "is_active": True}]

    kept, dropped = mod.filter_records(records, invalid_articles=mod.INVALID_ARTICLES)

    assert kept == records
    assert dropped == []
