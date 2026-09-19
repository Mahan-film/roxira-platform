#!/usr/bin/env python3
"""
Roxira OS & SmartJudge (ghazihoushmand.ir) - Official Zibal Gateway Integration
Merchant: REDACTED_SECRET_17
Handles: Payment Request, Verification, 7-Day Trial, and Permanent Subscriptions.
"""
import os, json, urllib.request, datetime
from typing import Dict, Any, Optional

ZIBAL_REQUEST_URL = "https://gateway.zibal.ir/v1/request"
ZIBAL_VERIFY_URL = "https://gateway.zibal.ir/v1/verify"
ZIBAL_START_URL = "https://gateway.zibal.ir/start/"

def get_merchant() -> str:
    return os.environ.get("ZIBAL_MERCHANT", "REDACTED_SECRET_17")

def create_payment_request(
    amount_rials: int,
    order_id: str,
    description: str,
    mobile: Optional[str] = None,
    callback_url: Optional[str] = None
) -> Dict[str, Any]:
    """ارسال درخواست به درگاه پرداخت زیبال و دریافت trackId جهت هدایت کاربر"""
    merchant = get_merchant()
    cb = callback_url or os.environ.get("ZIBAL_CALLBACK_URL", "https://ghazihoushmand.ir/api/v1/payment/zibal/callback")

    payload = {
        "merchant": merchant,
        "amount": amount_rials,
        "callbackUrl": cb,
        "description": description,
        "orderId": order_id
    }
    if mobile:
        payload["mobile"] = mobile

    req = urllib.request.Request(
        ZIBAL_REQUEST_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            track_id = data.get("trackId")
            result = data.get("result")
            if result == 100 and track_id:
                return {
                    "success": True,
                    "track_id": track_id,
                    "payment_url": f"{ZIBAL_START_URL}{track_id}",
                    "message": "شناسه پرداخت با موفقیت تولید شد."
                }
            return {
                "success": False,
                "result_code": result,
                "message": data.get("message", "خطا در برقراری ارتباط با درگاه زیبال.")
            }
    except Exception as e:
        return {"success": False, "message": f"خطای شبکه در ارتباط با زیبال: {str(e)}"}

def verify_payment(track_id: str) -> Dict[str, Any]:
    """اعتبارسنجی تراکنش پس از بازگشت کاربر از درگاه بانکی"""
    merchant = get_merchant()
    payload = {
        "merchant": merchant,
        "trackId": track_id
    }
    req = urllib.request.Request(
        ZIBAL_VERIFY_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result = data.get("result")
            # 100: تراکنش با موفقیت تایید شد / 201: قبلا تایید شده
            if result in [100, 201]:
                return {
                    "success": True,
                    "paid": True,
                    "amount": data.get("amount"),
                    "ref_number": data.get("refNumber"),
                    "card_number": data.get("cardNumber"),
                    "paid_at": data.get("paidAt"),
                    "message": "پرداخت با موفقیت تایید گردید."
                }
            return {
                "success": False,
                "paid": False,
                "result_code": result,
                "message": data.get("message", "تراکنش ناموفق بود یا لغو گردید.")
            }
    except Exception as e:
        return {"success": False, "message": f"خطا در استعلام زیبال: {str(e)}"}

def activate_user_subscription(user_id: str, plan_type: str = "7_DAYS_TRIAL") -> Dict[str, Any]:
    """مدیریت فعال‌سازی دوره ۷ روزه آزمایشی رایگان یا حساب دائم"""
    now = datetime.datetime.now(datetime.timezone.utc)
    if plan_type == "7_DAYS_TRIAL":
        expire_at = now + datetime.timedelta(days=7)
        status = "TRIAL_ACTIVE"
    elif plan_type == "PERMANENT":
        expire_at = now + datetime.timedelta(days=3650)  # ۱۰ سال
        status = "PERMANENT_ACTIVE"
    else:
        expire_at = now + datetime.timedelta(days=30)
        status = "MONTHLY_ACTIVE"

    return {
        "user_id": user_id,
        "subscription_plan": plan_type,
        "status": status,
        "activated_at": now.isoformat(),
        "expires_at": expire_at.isoformat(),
        "is_active": True
    }
