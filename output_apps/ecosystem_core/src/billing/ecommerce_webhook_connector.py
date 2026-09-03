"""
ROXIRA OMNICHANNEL E-COMMERCE & PAYMENT WEBHOOK CONNECTOR
دریافت وب‌هوک‌های خرید از ووکامرس، درگاه‌های پرداخت و سامانه‌های فروشگاهی
و اتصال خودکار به اتوماسیون CRM، کسر انبار FIFO و صدور سند دوبل
"""
import sys
import pathlib
from typing import Dict, Any

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from output_apps.ecosystem_core.src.crm.crm_deal_automation import IntegratedDealAutomationService

class ECommerceWebhookProcessor:
    def __init__(self):
        self.deal_service = IntegratedDealAutomationService()

    def handle_payment_success_webhook(self, payload: Dict[str, Any], provider: str = "WOOCOMMERCE") -> Dict[str, Any]:
        """
        پردازش وب‌هوک پرداخت موفق:
        استخراج داده‌ها ➔ ثبت در CRM ➔ کسر FIFO ➔ صدور سند دوبل ➔ ارسال پیامک
        """
        order_id = str(payload.get("order_id", "ORD-UNKNOWN"))
        customer_name = payload.get("customer_name", "مشتری آنلاین")
        customer_phone = payload.get("customer_phone", "09129367796")
        sku = payload.get("sku", "GEN-SVC-01")
        quantity = float(payload.get("quantity", 1.0))
        sale_unit_price = float(payload.get("unit_price", 1000000.0))
        tenant_id = payload.get("tenant_id", "ONLINE-STORE-01")

        deal_result = self.deal_service.process_won_deal(
            tenant_id=tenant_id,
            deal_id=f"WEBHOOK-{provider}-{order_id}",
            customer_name=customer_name,
            customer_phone=customer_phone,
            sku=sku,
            quantity=quantity,
            sale_unit_price=sale_unit_price,
            description=f"خرید آنلاین از طریق وب‌هوک {provider} - سفارش {order_id}"
        )

        return {
            "webhook_status": "PROCESSED",
            "provider": provider,
            "order_id": order_id,
            "pipeline_output": deal_result
        }

if __name__ == "__main__":
    processor = ECommerceWebhookProcessor()
    sample_webhook = {
        "order_id": "99482",
        "customer_name": "ماهان محمدی",
        "customer_phone": "09129367796",
        "sku": "GEN-SVC-01",
        "quantity": 2.0,
        "unit_price": 3000000.0,
        "tenant_id": "MAIN-STORE"
    }
    res = processor.handle_payment_success_webhook(sample_webhook, provider="ZARINPAL")
    print("✅ تست وب‌هوک پرداخت فروشگاه آنلاین:")
    print("وضعیت پردازش:", res["webhook_status"])
    print("شناسه سفارش:", res["order_id"])
    print("جمع فاکتور صادرشده:", f"{res['pipeline_output']['financial_summary']['total_receivable_toman']:,.0f} تومان")
