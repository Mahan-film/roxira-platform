"""
ROXIRA 4-LEVEL FLOATING TAFSILI LEDGER
"""
from dataclasses import dataclass
from typing import Optional, List

@dataclass
class EnhancedLedgerEntry:
    entry_id: str
    account_code: str
    tafsili_id: Optional[str]
    debit: float
    credit: float
    description: str

class FloatingLedgerValidator:
    @staticmethod
    def validate_balanced_transaction(entries: List[EnhancedLedgerEntry]) -> bool:
        total_debit = sum(e.debit for e in entries)
        total_credit = sum(e.credit for e in entries)
        if abs(total_debit - total_credit) > 1e-6:
            raise ValueError(f"عدم تراز سند! بدهکار: {total_debit} | بستانکار: {total_credit}")
        return True

if __name__ == "__main__":
    entries = [
        EnhancedLedgerEntry("E-01", "1103", "T-9001", 15000000.0, 0.0, "بدهکاران تجاری - موکل الف"),
        EnhancedLedgerEntry("E-02", "4101", None, 0.0, 13636364.0, "درآمد خدمات"),
        EnhancedLedgerEntry("E-03", "2104", None, 0.0, 1363636.0, "ارزش افزوده ۱۰٪")
    ]
    FloatingLedgerValidator.validate_balanced_transaction(entries)
    print("✅ تراز سند ۴ سطحی با تفصیلی شناور تایید شد.")
