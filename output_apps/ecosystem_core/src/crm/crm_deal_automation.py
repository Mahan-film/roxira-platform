import sys
import pathlib
import datetime

# افزودن مسیر ریشه پروژه به صورت قطعی
CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from output_apps.ecosystem_core.src.inventory.fifo_engine import FIFOInventoryEngine
from output_apps.ecosystem_core.src.accounting.floating_tafsili import EnhancedLedgerEntry, FloatingLedgerValidator
from output_apps.ecosystem_core.src.notifications.sms_service import EnterpriseSMSDispatcher

class IntegratedDealAutomationService:
    def __init__(self):
        self.inventory = FIFOInventoryEngine()
        self.sms = EnterpriseSMSDispatcher(provider="SIMULATOR")
        self.inventory.receive_goods("BATCH-INIT-01", "GEN-SVC-01", 1000.0, 800000.0)

    def process_won_deal(
        self,
        tenant_id: str,
        deal_id: str,
        customer_name: str,
        customer_phone: str,
        sku: str,
        quantity: float,
        sale_unit_price: float,
        description: str
    ) -> dict:
        gross_sale = quantity * sale_unit_price
        vat_amount = round(gross_sale * 0.10, 0)
        net_receivable = gross_sale + vat_amount

        cogs_amount, consumed_batches = self.inventory.calculate_cogs_and_consume(sku, quantity)
        tafsili_customer = "TAF-" + customer_name.replace(" ", "_")

        entries = [
            EnhancedLedgerEntry(f"ENT-{deal_id}-1", "1103", tafsili_customer, net_receivable, 0.0, f"فروش به {customer_name}"),
            EnhancedLedgerEntry(f"ENT-{deal_id}-2", "4101", None, 0.0, gross_sale, description),
            EnhancedLedgerEntry(f"ENT-{deal_id}-3", "2104", None, 0.0, vat_amount, "ارزش افزوده فروش"),
            EnhancedLedgerEntry(f"ENT-{deal_id}-4", "5101", None, cogs_amount, 0.0, f"بهای تمام‌شده {sku}"),
            EnhancedLedgerEntry(f"ENT-{deal_id}-5", "1104", None, 0.0, cogs_amount, f"خروج از انبار {sku}")
        ]

        FloatingLedgerValidator.validate_balanced_transaction(entries)

        sms_result = self.sms.send_sale_invoice_alert(
            customer_phone=customer_phone,
            customer_name=customer_name,
            invoice_number=deal_id,
            total_toman=net_receivable
        )

        return {
            "status": "COMPLETED",
            "deal_id": deal_id,
            "financial_summary": {
                "gross_sale_toman": gross_sale,
                "vat_10pct_toman": vat_amount,
                "total_receivable_toman": net_receivable,
                "cogs_toman": cogs_amount,
                "gross_profit_toman": gross_sale - cogs_amount
            },
            "inventory_consumed": consumed_batches,
            "accounting_entries_count": len(entries),
            "sms_dispatch": {
                "status": sms_result.status,
                "message_id": sms_result.message_id
            }
        }

if __name__ == "__main__":
    service = IntegratedDealAutomationService()
    res = service.process_won_deal("T1", "D-01", "ماهان محمدی", "09129367796", "GEN-SVC-01", 2.0, 1500000.0, "فروش خدمات")
    print("✅ CRM Deal Automation Engine Tested: Deal", res["deal_id"])
