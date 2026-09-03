"""
ROXIRA MULTI-JURISDICTION TAX & VAT ENGINE
محاسبه‌گر جامع قوانین مالیاتی و ارزش افزوده ایران و نظام‌های بین‌المللی
"""
from dataclasses import dataclass
from typing import Dict, Any

@dataclass
class TaxCalculationResult:
    jurisdiction: str
    currency: str
    net_amount: float
    tax_rate: float
    tax_amount: float
    gross_amount: float
    compliance_regime: str

class MultiJurisdictionTaxEngine:
    REGIMES = {
        "IRAN": {"vat_rate": 0.10, "currency": "TOMAN", "regime": "سامانه مؤدیان و پایانه‌های فروشگاهی"},
        "UAE": {"vat_rate": 0.05, "currency": "AED", "regime": "FTA GCC VAT (United Arab Emirates)"},
        "SAUDI_ARABIA": {"vat_rate": 0.15, "currency": "SAR", "regime": "ZATCA Fatoora (Saudi Arabia)"},
        "EU_STANDARD": {"vat_rate": 0.21, "currency": "EUR", "regime": "EU VAT One Stop Shop (OSS/VIES)"},
        "USA_STANDARD": {"vat_rate": 0.0825, "currency": "USD", "regime": "US State & Local Sales Tax"},
        "RUSSIA": {"vat_rate": 0.20, "currency": "RUB", "regime": "Federal Tax Service (1C Compatible)"}
    }

    @classmethod
    def calculate_tax(cls, amount: float, jurisdiction: str = "IRAN") -> TaxCalculationResult:
        jur_key = jurisdiction.upper()
        config = cls.REGIMES.get(jur_key, cls.REGIMES["IRAN"])
        
        tax_rate = config["vat_rate"]
        tax_amt = round(amount * tax_rate, 2)
        gross = round(amount + tax_amt, 2)

        return TaxCalculationResult(
            jurisdiction=jur_key,
            currency=config["currency"],
            net_amount=amount,
            tax_rate=tax_rate,
            tax_amount=tax_amt,
            gross_amount=gross,
            compliance_regime=config["regime"]
        )

if __name__ == "__main__":
    engine = MultiJurisdictionTaxEngine()
    for jur in ["IRAN", "UAE", "SAUDI_ARABIA", "EU_STANDARD", "USA_STANDARD", "RUSSIA"]:
        r = engine.calculate_tax(1000.0, jur)
        print(f"[{r.jurisdiction}] خالص: {r.net_amount} {r.currency} | نرخ: {r.tax_rate*100}% | ناخالص: {r.gross_amount} {r.currency}")
