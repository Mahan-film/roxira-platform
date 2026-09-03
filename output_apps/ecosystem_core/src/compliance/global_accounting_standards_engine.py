"""
ROXIRA GLOBAL ACCOUNTING & MULTI-JURISDICTION COMPLIANCE ENGINE
استانداردهای IFRS، US GAAP، حوزه خلیج فارس ZATCA/FTA، اتحادیه اروپا، روسیه و ایران
"""
from dataclasses import dataclass
from typing import Dict, Any, List

@dataclass
class GlobalComplianceReport:
    jurisdiction: str
    accounting_standard: str
    currency: str
    net_sales: float
    tax_rate: float
    tax_amount: float
    gross_total: float
    inventory_method: str
    electronic_invoice_regime: str

class GlobalAccountingStandardsEngine:
    REGIMES_CONFIG = {
        "IRAN": {
            "standard": "Iranian Accounting Standards (IAS-IR)",
            "inventory_rule": "Standard #8 (FIFO / Weighted Average)",
            "currency": "TOMAN",
            "vat_rate": 0.10,
            "e_invoicing": "سامانه مؤدیان و پایانه‌های فروشگاهی (قانون پایانه های فروشگاهی)"
        },
        "UAE": {
            "standard": "IFRS Standards for SMEs",
            "inventory_rule": "IAS 2 Inventories (FIFO)",
            "currency": "AED",
            "vat_rate": 0.05,
            "e_invoicing": "Federal Tax Authority (FTA) E-Tax"
        },
        "SAUDI_ARABIA": {
            "standard": "SOCPA / IFRS Standards",
            "inventory_rule": "IAS 2 (FIFO / Weighted Average)",
            "currency": "SAR",
            "vat_rate": 0.15,
            "e_invoicing": "ZATCA Fatoora Phase 2 (UBL 2.1 XML Integration)"
        },
        "EU": {
            "standard": "IFRS EU Endorsed",
            "inventory_rule": "IAS 2 (Lower of Cost and Net Realizable Value)",
            "currency": "EUR",
            "vat_rate": 0.21,
            "e_invoicing": "PEPPOL & EU VAT Directive One-Stop-Shop (OSS)"
        },
        "USA": {
            "standard": "US GAAP (FASB)",
            "inventory_rule": "ASC 330 (FIFO / LIFO / Average Cost)",
            "currency": "USD",
            "vat_rate": 0.085,
            "e_invoicing": "Automated State Sales Tax & 1099 Compliance"
        },
        "RUSSIA": {
            "standard": "Russian Accounting Standards (PBU / RAS)",
            "inventory_rule": "PBU 5/01 (FIFO / Average Cost)",
            "currency": "RUB",
            "vat_rate": 0.20,
            "e_invoicing": "Federal Tax Service of Russia (1C Format XML)"
        }
    }

    @classmethod
    def evaluate_compliance(cls, jurisdiction: str, net_amount: float) -> GlobalComplianceReport:
        jur = jurisdiction.upper()
        cfg = cls.REGIMES_CONFIG.get(jur, cls.REGIMES_CONFIG["IRAN"])
        
        tax_amt = round(net_amount * cfg["vat_rate"], 2)
        gross = round(net_amount + tax_amt, 2)
        
        return GlobalComplianceReport(
            jurisdiction=jur,
            accounting_standard=cfg["standard"],
            currency=cfg["currency"],
            net_sales=net_amount,
            tax_rate=cfg["vat_rate"],
            tax_amount=tax_amt,
            gross_total=gross,
            inventory_method=cfg["inventory_rule"],
            electronic_invoice_regime=cfg["e_invoicing"]
        )

if __name__ == "__main__":
    engine = GlobalAccountingStandardsEngine()
    for j in ["IRAN", "UAE", "SAUDI_ARABIA", "EU", "USA", "RUSSIA"]:
        rep = engine.evaluate_compliance(j, 10000.0)
        print(f"[{rep.jurisdiction}] Standard: {rep.accounting_standard} | VAT: {rep.tax_rate*100}% ({rep.tax_amount} {rep.currency}) | Invoicing: {rep.electronic_invoice_regime[:40]}...")
