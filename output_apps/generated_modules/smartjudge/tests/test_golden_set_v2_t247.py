"""CI validation tests for T247 (#986): Smart Judge v2 golden set and lawyer review CSV."""

from __future__ import annotations

import csv
from pathlib import Path

from output_apps.generated_modules.smartjudge.eval.golden_set_v2_schema import (
    MAX_LAWYER_CSV_ROWS,
    MIN_GOLDEN_ITEMS,
    VALID_STRATA,
    contains_pii,
    export_lawyer_review_csv,
    load_golden_set_v2,
    neutralise_csv_cell,
    validate_golden_set_v2,
)

EVAL_DIR = Path(__file__).resolve().parent.parent / "eval"
GOLDEN_JSON = EVAL_DIR / "golden_set_v2.json"
LAWYER_CSV = EVAL_DIR / "lawyer_review_queue.csv"


def test_golden_set_v2_exists_and_passes_schema():
    assert GOLDEN_JSON.exists(), f"missing {GOLDEN_JSON}"
    items = load_golden_set_v2(GOLDEN_JSON)
    assert len(items) >= MIN_GOLDEN_ITEMS
    errors = validate_golden_set_v2(items)
    assert errors == [], f"schema errors: {errors[:5]}"

    strata = {it["stratum"] for it in items}
    assert strata == set(VALID_STRATA)

    real = [it for it in items if it["stratum"] == "anonymised_real"]
    bench = [it for it in items if it["stratum"] == "public_benchmark_adapted"]
    syn = [it for it in items if it["stratum"] == "synthetic"]
    adv = [it for it in items if it["stratum"] == "adversarial"]

    assert len(real) == 100, f"expected 100 anonymised_real, got {len(real)}"
    assert len(bench) == 100, f"expected 100 public_benchmark_adapted, got {len(bench)}"
    assert len(syn) == 80, f"expected 80 synthetic, got {len(syn)}"
    assert len(adv) == 80, f"expected 80 adversarial, got {len(adv)}"
    assert len(items) == 360

    # Adversarial stratum must have must_abstain items and forbidden_repealed_ids items
    assert any(it.get("must_abstain") is True for it in adv)
    assert any(it.get("forbidden_repealed_ids") for it in adv)


def test_build_items_reproducible():
    from scripts.build_golden_set_v2 import build_items

    built = build_items()
    assert len(built) == 360
    items = load_golden_set_v2(GOLDEN_JSON)
    assert built == items, "build_items() output must match committed golden_set_v2.json exactly"


def test_lawyer_review_csv_under_60_rows_and_safe():
    assert LAWYER_CSV.exists(), f"missing {LAWYER_CSV}"
    with LAWYER_CSV.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    assert 1 <= len(rows) <= MAX_LAWYER_CSV_ROWS
    for r in rows:
        assert not contains_pii(r["question"])
        assert not contains_pii(r["notes"])


def test_csv_formula_neutralisation(tmp_path):
    assert neutralise_csv_cell("=CMD()") == "'=CMD()"
    assert neutralise_csv_cell("+1+1") == "'+1+1"
    assert neutralise_csv_cell("-2") == "'-2"
    assert neutralise_csv_cell("@SUM(A1)") == "'@SUM(A1)"
    assert neutralise_csv_cell("\nCMD()") == "'\nCMD()"
    assert neutralise_csv_cell("normal") == "normal"

    out = tmp_path / "test.csv"
    count = export_lawyer_review_csv(
        [
            {
                "id": "X-1",
                "stratum": "synthetic",
                "question": "=HYPERLINK(\"http://evil\")",
                "as_of": None,
                "expected_article_ids": ["CIVIL:10"],
                "must_abstain": False,
                "notes": "+note",
                "needs_lawyer_review": True,
            }
        ],
        out,
    )
    assert count == 1
    with out.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    assert rows[0]["question"].startswith("'=")
    assert rows[0]["notes"].startswith("'+")
