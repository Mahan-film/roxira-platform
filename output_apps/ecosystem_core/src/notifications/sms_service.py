"""
ROXIRA OMNICHANNEL NOTIFICATION & SMS ENGINE
سرویس هوشمند ارسال پیامک خدماتی و اعلانات رویدادهای مالی و حقوقی

⚠ DEPRECATED (منسوخ):
    موتور پیامک پترنی (KavehNegar / FarazSMS / Pattern API) منسوخ شده و با
    وب‌سرویس رسمی sms.ir (Fast/Verify) جایگزین میشود. برای ارسال OTP و پیامک
    خدماتی از ماژول اختصاصی:
        output_apps.ecosystem_core.src.notifications.sms_ir_service
    استفاده کنید. این کلاس تنها برای سازگاری عقب‌گرد (backward-compat) و
    حالت شبیه‌ساز (Simulation) نگه داشته شده است.
"""
import warnings
from dataclasses import dataclass
from typing import Optional, Dict, Any
import datetime

@dataclass
class SMSDispatchResult:
    message_id: str
    recipient: str
    template_code: str
    status: str
    cost_rials: float
    dispatched_at: str

class EnterpriseSMSDispatcher:
    """
    ⚠ DEPRECATED — از sms_ir_service.SmsIrService استفاده کنید.
    موتور ماژولار قدیمی پیامک مبتنی بر پترن (Pattern/Template).
    """

    SUPPORTED_PROVIDERS = ["SIMULATOR"]  # فقط حالت شبیه‌ساز (تغییر: سرویس واقعی sms.ir)

    def __init__(self, provider: str = "SIMULATOR", api_key: Optional[str] = None):
        warnings.warn(
            "EnterpriseSMSDispatcher is deprecated; use SmsIrService from "
            "output_apps.ecosystem_core.src.notifications.sms_ir_service instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        self.provider = provider.upper() if provider else "SIMULATOR"
        self.api_key = api_key or "demo-sms-key"

    def send_pattern_sms(
        self,
        recipient: str,
        template_code: str,
        parameters: Dict[str, Any]
    ) -> SMSDispatchResult:
        """
        ارسال پیامک با پترن خط خدماتی (عبور از بلک‌لیست تبلیغاتی)
        مثال: اطلاع‌رسانی صدور فاکتور فروش یا ثبت دادخواست
        """
        # اعتبارسنجی شماره موبایل ایران (۰۹xxxxxxxxx یا +989xxxxxxxxx)
        cleaned_phone = recipient.strip().replace("+98", "0").replace("0098", "0")
        if not (len(cleaned_phone) == 11 and cleaned_phone.startswith("09")):
            raise ValueError(f"شماره همراه نامعتبر است: {recipient}")

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        msg_id = f"SMS-{int(datetime.datetime.now().timestamp())}-{cleaned_phone[-4:]}"

        # ساخت متن نهایی جهت بایگانی در لاگ ممیزی
        formatted_text = f"الگو: {template_code} | متغیرها: {parameters}"

        return SMSDispatchResult(
            message_id=msg_id,
            recipient=cleaned_phone,
            template_code=template_code,
            status="DELIVERED_TO_OPERATOR",
            cost_rials=550.0,
            dispatched_at=now_iso
        )

    def send_sale_invoice_alert(
        self,
        customer_phone: str,
        customer_name: str,
        invoice_number: str,
        total_toman: float
    ) -> SMSDispatchResult:
        """ارسال خودکار پیامک صدور فاکتور فروش به خریدار"""
        return self.send_pattern_sms(
            recipient=customer_phone,
            template_code="SALE_INVOICE_ALERT",
            parameters={
                "name": customer_name,
                "invoice_num": invoice_number,
                "amount": f"{total_toman:,.0f}"
            }
        )

    def send_legal_deadline_alert(
        self,
        client_phone: str,
        client_name: str,
        case_number: str,
        deadline_date: str
    ) -> SMSDispatchResult:
        """ارسال خودکار هشدار موعد دادگاه و فرجه تجدیدنظر به موکل"""
        return self.send_pattern_sms(
            recipient=client_phone,
            template_code="LEGAL_DEADLINE_ALERT",
            parameters={
                "name": client_name,
                "case_num": case_number,
                "deadline": deadline_date
            }
        )

if __name__ == "__main__":
    dispatcher = EnterpriseSMSDispatcher(provider="SIMULATOR")
    res = dispatcher.send_sale_invoice_alert(
        customer_phone="09129367796",
        customer_name="ماهان محمدی",
        invoice_number="INV-1404-9821",
        total_toman=15_000_000
    )
    print("=== تست سامانه پیامک و اعلان رویدادها ===")
    print(f"✅ پیامک با شناسه {res.message_id} به شماره {res.recipient} ارسال شد.")
    print(f"   ├─ وضعیت: {res.status}")
    print(f"   └─ زمان ارسال: {res.dispatched_at}")
