#!/usr/bin/env python3
"""Persian QA & Web Fuzzing Tools for Smart Judge and Roxira OS.

Incorporates domain-specific Persian edge cases:
- Jalali 1405 SH calendar boundary test payloads (e.g. 31st of Ordibehesht vs Gregorian bleed).
- Persian/Arabic numeral normalization and BiDi LTR paragraph flip detection.
- Deterministic statutory citation extraction (ماده، تبصره، بند، اصل).
- Zero-hallucination ERP invoice arithmetic auditor (Qty * Price - Discount + Tax).
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

from output_apps.ecosystem_core.src.factory.parsitext import (
    normalize_digits,
    normalize_persian,
    ZWNJ,
)

def to_ascii_digits(text: str) -> str:
    """Translate Persian (۰-۹) and Arabic (٠-٩) digits to ASCII (0-9)."""
    return normalize_digits(text, to="ascii")

def to_persian_digits(text: str) -> str:
    """Translate ASCII (0-9) and Arabic (٠-٩) digits to Persian (۰-۹)."""
    return normalize_digits(text, to="persian")

def normalize_persian_text(text: str) -> str:
    """Full normalization: Arabic characters, digits, ZWNJ."""
    return normalize_persian(text)

# Statutory citation pattern matching Iranian laws
RE_STATUTORY_CITATION = re.compile(
    r"(?:ماده|تبصره|بند|اصل)\s+([۰-۹\d]+)(?:\s+(?:مکرر|[الف-ی]))?\s+(?:قانون\s+[\u0600-\u06FF\u200c\s]{3,50})",
    re.UNICODE,
)

# Numeric cleaner for table cells
RE_NUMERIC_CHARS = re.compile(r"[^\d.-]")


def generate_jalali_1405_boundary_test_cases() -> Dict[str, str]:
    """Generates Jalali 1405 SH boundary dates for calendar fuzzing.

    Key vulnerabilities targeted:
    - Gregorian Feb bleed: 1405/02/31 (31st of Ordibehesht) is valid in Persian solar calendar,
      but backend validators converting month 2 to February mistakenly reject day 31.
    - Autumn 31st: 1405/07/31 (31st of Mehr) has only 30 days.
    - Non-leap Esfand 30: 1405 SH is a standard 29-day Esfand year; 1405/12/30 is invalid.
    """
    return {
        "valid_spring_31st_ordibehesht": "1405/02/31",
        "valid_summer_31st_shahrivar": "1405/06/31",
        "invalid_autumn_31st_mehr": "1405/07/31",
        "invalid_non_leap_esfand_30": "1405/12/30",
        "valid_persian_digits_ordibehesht": "۱۴۰۵/۰۲/۳۱",
        "valid_first_day_farvardin": "1405/01/01",
    }


def detect_bidi_layout_flip_risk(text: str) -> bool:
    """Detects whether text begins with Latin digits or English tokens causing BiDi paragraph flip."""
    if not text:
        return False
    stripped = text.strip()
    # If starts with Latin digits + period/space or ASCII word, risk of LTR flip on unstyled containers
    if re.match(r"^\d+\.|\b[a-zA-Z]{2,}\b", stripped):
        # But contains Persian characters
        if re.search(r"[\u0600-\u06FF]", stripped):
            return True
    return False


def extract_statutory_citations(text: str) -> List[Dict[str, Any]]:
    """Extracts statutory citations and normalizes article numbers."""
    if not text:
        return []
    citations = []
    norm_text = normalize_persian_text(text)
    for match in RE_STATUTORY_CITATION.finditer(norm_text):
        full_cit = match.group(0).strip()
        raw_num = match.group(1)
        ascii_num = to_ascii_digits(raw_num)
        citations.append({
            "citation": full_cit,
            "article_number": int(ascii_num) if ascii_num.isdigit() else ascii_num,
        })
    return citations


def audit_invoice_arithmetic(
    lines: List[Dict[str, Any]],
    expected_grand_total: Optional[Decimal] = None,
) -> Dict[str, Any]:
    """Audits ERP invoice table calculations deterministically without LLM hallucination.

    Formula: Line Total = (Quantity * Unit Price) - Discount + Tax
             Grand Total = Sum(Line Totals)
    """
    discrepancies: List[str] = []
    computed_grand_total = Decimal("0")

    for idx, item in enumerate(lines):
        try:
            qty = Decimal(str(item.get("qty", 1)))
            unit_price = Decimal(str(item.get("unit_price", 0)))
            discount = Decimal(str(item.get("discount", 0)))
            tax = Decimal(str(item.get("tax", 0)))
            declared_total = Decimal(str(item.get("line_total", 0)))

            expected_line = (qty * unit_price) - discount + tax
            computed_grand_total += expected_line

            if expected_line != declared_total:
                discrepancies.append(
                    f"Line {idx + 1}: Declared {declared_total} != Expected {expected_line} "
                    f"(Qty: {qty}, Price: {unit_price}, Disc: {discount}, Tax: {tax})"
                )
        except (InvalidOperation, TypeError, ValueError) as err:
            discrepancies.append(f"Line {idx + 1}: Invalid numeric conversion: {err}")

    grand_total_match = True
    if expected_grand_total is not None:
        if computed_grand_total != expected_grand_total:
            grand_total_match = False
            discrepancies.append(
                f"Grand Total Mismatch: Declared {expected_grand_total} != Computed {computed_grand_total}"
            )

    return {
        "valid": len(discrepancies) == 0 and grand_total_match,
        "computed_grand_total": str(computed_grand_total),
        "discrepancies": discrepancies,
    }


def verify_iranian_national_code(code: str) -> bool:
    """Validate 10-digit Iranian National Code (کد ملی اشخاص حقیقی) using Modulo 11.
    
    Returns True if the check digit matches official civil registration checksum,
    False otherwise (including repetitive digits or non-10 digit inputs).
    """
    if not code:
        return False
    digits = to_ascii_digits(str(code)).strip()
    digits = re.sub(r"\D", "", digits)
    if len(digits) != 10:
        if 8 <= len(digits) < 10:
            digits = digits.zfill(10)
        else:
            return False
    if len(set(digits)) == 1:
        return False
    check_digit = int(digits[9])
    total = sum(int(digits[i]) * (10 - i) for i in range(9))
    remainder = total % 11
    if remainder < 2:
        return check_digit == remainder
    return check_digit == (11 - remainder)


def verify_iranian_legal_national_id(code: str) -> bool:
    """Validate 11-digit Iranian Legal Entity National ID (شناسه ملی اشخاص حقوقی) using Modulo 11.
    
    Formula:
    d10 = int(code[9]) + 2
    weights = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17]
    Sum = sum((int(code[i]) + d10) * weights[i] for i in range(10))
    Remainder = Sum % 11
    Expected Check Digit = 0 if Remainder == 10 else Remainder
    """
    if not code:
        return False
    digits = to_ascii_digits(str(code)).strip()
    digits = re.sub(r"\D", "", digits)
    if len(digits) != 11:
        return False
    if len(set(digits)) == 1:
        return False
    d10 = int(digits[9]) + 2
    weights = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17]
    total = sum((int(digits[i]) + d10) * weights[i] for i in range(10))
    remainder = total % 11
    check_digit = 0 if remainder == 10 else remainder
    return check_digit == int(digits[10])


def verify_sayad_id_format(sayad_id: str) -> bool:
    """Validate 16-digit Central Bank of Iran Sayad Cheque ID structure.
    
    Accepts Persian, Arabic, or ASCII digits with optional dashes or whitespace.
    """
    if not sayad_id:
        return False
    digits = to_ascii_digits(str(sayad_id)).strip()
    digits = re.sub(r"[\s\-_/]", "", digits)
    if len(digits) != 16 or not digits.isdigit():
        return False
    if len(set(digits)) == 1:
        return False
    return True


def audit_ledger_table_balance(
    rows: List[Dict[str, Any]],
    expected_debit_total: Optional[Decimal] = None,
    expected_credit_total: Optional[Decimal] = None,
) -> Dict[str, Any]:
    """Reconciles horizontal and vertical balances in financial ledger / journal entries.
    
    - Vertical reconciliation: Sum(Debit) == Sum(Credit).
    - Horizontal reconciliation: If row has beginning/ending balance, Ending == Beginning + Debit - Credit.
    """
    discrepancies: List[str] = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")

    for idx, row in enumerate(rows, 1):
        try:
            debit = Decimal(str(row.get("debit", 0)))
            credit = Decimal(str(row.get("credit", 0)))
            total_debit += debit
            total_credit += credit

            if "beginning_balance" in row and "ending_balance" in row:
                beg = Decimal(str(row.get("beginning_balance", 0)))
                end = Decimal(str(row.get("ending_balance", 0)))
                expected_end = beg + debit - credit
                if expected_end != end:
                    discrepancies.append(
                        f"Row {idx}: Horizontal balance mismatch: "
                        f"Beg {beg} + Debit {debit} - Credit {credit} = {expected_end} != End {end}"
                    )
        except (InvalidOperation, TypeError, ValueError) as err:
            discrepancies.append(f"Row {idx}: Invalid numeric conversion: {err}")

    vertical_match = (total_debit == total_credit)
    if not vertical_match:
        discrepancies.append(
            f"Vertical balance mismatch: Total Debit {total_debit} != Total Credit {total_credit}"
        )

    if expected_debit_total is not None and total_debit != expected_debit_total:
        discrepancies.append(
            f"Debit total mismatch: Declared {expected_debit_total} != Computed {total_debit}"
        )
    if expected_credit_total is not None and total_credit != expected_credit_total:
        discrepancies.append(
            f"Credit total mismatch: Declared {expected_credit_total} != Computed {total_credit}"
        )

    return {
        "valid": len(discrepancies) == 0 and vertical_match,
        "total_debit": str(total_debit),
        "total_credit": str(total_credit),
        "balanced": vertical_match,
        "discrepancies": discrepancies,
    }

