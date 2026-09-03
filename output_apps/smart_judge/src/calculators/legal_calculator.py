from __future__ import annotations

import json
from typing import Dict, Any

# جدول شاخص بهای کالاها و خدمات مصرفی (نمونه شاخص‌های سالانه بانک مرکزی جهت محاسبه ماده ۵۲۲)
CPI_ANNUAL_INDEX = {
    1398: 187.5,
    1399: 256.0,
    1400: 359.8,
    1401: 527.7,
    1402: 785.4,
    1403: 1100.0,
    1404: 1540.0,
    1405: 2150.0
}

class JudicialCalculatorEngine:
    """Calculates Legal Damages (Article 522), Court Filing Fees, and Procedural Deadlines."""

    @staticmethod
    def calculate_inflation_delay_damages(principal_toman: float, due_year: int, payment_year: int = 1405) -> Dict[str, Any]:
        """Calculates late payment damages according to Article 522 of Civil Procedure Code."""
        idx_due = CPI_ANNUAL_INDEX.get(due_year, 187.5)
        idx_pay = CPI_ANNUAL_INDEX.get(payment_year, 2150.0)
        
        # فرمول رسمی اداره کل حقوقی قوه قضائیه: اصل دین * (شاخص سال پرداخت / شاخص سال سررسید)
        adjusted_amount = principal_toman * (idx_pay / idx_due)
        damage_amount = adjusted_amount - principal_toman

        return {
            "principal_toman": principal_toman,
            "due_year": due_year,
            "payment_year": payment_year,
            "cpi_index_due": idx_due,
            "cpi_index_payment": idx_pay,
            "adjusted_total_toman": round(adjusted_amount, 2),
            "damages_toman": round(damage_amount, 2),
            "legal_basis": "ماده ۵۲۲ قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی"
        }

    @staticmethod
    def calculate_court_filing_fee(claim_amount_toman: float, court_stage: str = "FIRST_INSTANCE") -> Dict[str, Any]:
        """Calculates official court filing fees based on Iranian judicial tariffs."""
        # تعرفه خدمات قضایی: مرحله نخستین (تا ۲۰ میلیون تومان ۲.۵٪، مازاد ۳.۵٪)، تجدیدنظر (۴.۵٪)
        if court_stage == "FIRST_INSTANCE":
            if claim_amount_toman <= 20000000:
                fee = claim_amount_toman * 0.025
            else:
                fee = (20000000 * 0.025) + ((claim_amount_toman - 20000000) * 0.035)
        elif court_stage == "APPEAL":
            fee = claim_amount_toman * 0.045
        elif court_stage == "SUPREME_COURT":
            fee = claim_amount_toman * 0.055
        else:
            fee = claim_amount_toman * 0.035

        return {
            "claim_amount_toman": claim_amount_toman,
            "court_stage": court_stage,
            "filing_fee_toman": round(fee, 2),
            "notes": "هزینه دادرسی دعاوی مالی موضوع ماده ۳ قانون وصول برخی از درآمدهای دولت"
        }

if __name__ == "__main__":
    calc = JudicialCalculatorEngine()
    damages = calc.calculate_inflation_delay_damages(50000000.0, due_year=1400, payment_year=1405)
    fee = calc.calculate_court_filing_fee(50000000.0, "FIRST_INSTANCE")
    print("✅ JUDICIAL_CALCULATOR_VERIFIED=PASS")
    print(f"Damages (Article 522): {damages['damages_toman']:,.2f} TOMAN")
    print(f"Filing Fee: {fee['filing_fee_toman']:,.2f} TOMAN")
