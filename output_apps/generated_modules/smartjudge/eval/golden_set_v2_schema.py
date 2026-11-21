"""Schema validation and lawyer-queue CSV export for Smart Judge v2 golden set (T247 / #986)."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Sequence

__all__ = [
    "VALID_STRATA",
    "MIN_GOLDEN_ITEMS",
    "MAX_LAWYER_CSV_ROWS",
    "neutralise_csv_cell",
    "contains_pii",
    "validate_golden_set_v2",
    "export_lawyer_review_csv",
    "load_golden_set_v2",
]

VALID_STRATA = (
    "anonymised_real",
    "public_benchmark_adapted",
    "synthetic",
    "adversarial",
)
MIN_GOLDEN_ITEMS = 300
MAX_LAWYER_CSV_ROWS = 60

_PHONE_RE = re.compile(r"(?<!\d)09\d{9}(?!\d)")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_NATIONAL_ID_RE = re.compile(r"(?<!\d)\d{10}(?!\d)")
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")

EXPECTED_MIN_STRATA_COUNTS: Dict[str, int] = {
    "anonymised_real": 100,
    "public_benchmark_adapted": 100,
    "synthetic": 80,
    "adversarial": 80,
}


def neutralise_csv_cell(value: Any) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading chars with a single quote."""
    text = str(value if value is not None else "")
    if text and text[0] in _FORMULA_PREFIXES:
        return "'" + text
    return text


def contains_pii(text: str) -> bool:
    """Return True if text contains obvious PII (Iranian mobile, email, 10-digit national ID)."""
    s = str(text or "")
    return bool(_PHONE_RE.search(s) or _EMAIL_RE.search(s) or _NATIONAL_ID_RE.search(s))


def load_golden_set_v2(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("cases"), list):
        return data["cases"]
    if isinstance(data, list):
        return data
    raise ValueError("golden_set_v2 must be a list or an object with a 'cases' list")


def validate_golden_set_v2(items: Sequence[Dict[str, Any]]) -> List[str]:
    """Validate T247 golden set schema, stratification, and PII-free invariants."""
    errors: List[str] = []
    if len(items) < MIN_GOLDEN_ITEMS:
        errors.append(f"too few items: {len(items)} < {MIN_GOLDEN_ITEMS}")

    seen_ids: set[str] = set()
    seen_questions: set[str] = set()
    strata_counts: Dict[str, int] = {s: 0 for s in VALID_STRATA}

    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"item[{idx}] is not a dict")
            continue

        item_id = str(item.get("id") or "").strip()
        if not item_id:
            errors.append(f"item[{idx}]: missing id")
        elif item_id in seen_ids:
            errors.append(f"duplicate id: {item_id}")
        else:
            seen_ids.add(item_id)

        stratum = str(item.get("stratum") or "").strip()
        if stratum not in VALID_STRATA:
            errors.append(f"{item_id or idx}: invalid stratum '{stratum}'")
        else:
            strata_counts[stratum] += 1

        question = str(item.get("question") or "").strip()
        if not question:
            errors.append(f"{item_id or idx}: empty question")
        elif question in seen_questions:
            errors.append(f"{item_id or idx}: duplicate question")
        else:
            seen_questions.add(question)

        if contains_pii(question) or contains_pii(str(item.get("notes") or "")):
            errors.append(f"{item_id or idx}: potential PII detected")

        if "as_of" not in item:
            errors.append(f"{item_id or idx}: missing 'as_of' key")
        elif item["as_of"] is not None and not isinstance(item["as_of"], str):
            errors.append(f"{item_id or idx}: 'as_of' must be str or null")

        expected_ids = item.get("expected_article_ids")
        if not isinstance(expected_ids, list):
            errors.append(f"{item_id or idx}: 'expected_article_ids' must be a list")

        if not isinstance(item.get("must_abstain"), bool):
            errors.append(f"{item_id or idx}: 'must_abstain' must be bool")

        if not isinstance(item.get("notes"), str):
            errors.append(f"{item_id or idx}: 'notes' must be str")

        if "forbidden_repealed_ids" in item and not isinstance(item["forbidden_repealed_ids"], list):
            errors.append(f"{item_id or idx}: 'forbidden_repealed_ids' must be a list")

        if item.get("must_abstain") is False and isinstance(expected_ids, list) and len(expected_ids) == 0:
            errors.append(f"{item_id or idx}: non-abstaining item must have expected_article_ids")

    for s, min_count in EXPECTED_MIN_STRATA_COUNTS.items():
        count = strata_counts.get(s, 0)
        if count < min_count:
            errors.append(f"stratum '{s}' has {count} items, expected at least {min_count}")

    return errors


def export_lawyer_review_csv(
    items: Sequence[Dict[str, Any]],
    out_path: Path,
    *,
    max_rows: int = MAX_LAWYER_CSV_ROWS,
) -> int:
    """Export only hard/unsure items (needs_lawyer_review=True) to a formula-safe CSV."""
    selected = [it for it in items if isinstance(it, dict) and it.get("needs_lawyer_review") is True]
    selected = selected[:max_rows]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "id",
        "stratum",
        "question",
        "as_of",
        "expected_article_ids",
        "must_abstain",
        "notes",
        "lawyer_verdict",
    ]
    with out_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for it in selected:
            writer.writerow(
                {
                    "id": neutralise_csv_cell(it.get("id", "")),
                    "stratum": neutralise_csv_cell(it.get("stratum", "")),
                    "question": neutralise_csv_cell(it.get("question", "")),
                    "as_of": neutralise_csv_cell(it.get("as_of") or ""),
                    "expected_article_ids": neutralise_csv_cell(
                        ";".join(str(x) for x in (it.get("expected_article_ids") or []))
                    ),
                    "must_abstain": neutralise_csv_cell(it.get("must_abstain", False)),
                    "notes": neutralise_csv_cell(it.get("notes", "")),
                    "lawyer_verdict": "",
                }
            )
    return len(selected)
