#!/usr/bin/env python3
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from output_apps.ecosystem_core.src.billing.zibal_service import (
    activate_user_subscription,
    create_payment_request,
)

router = APIRouter(prefix="/api/v1/payment/zibal", tags=["ZibalPayment"])

class SubscriptionOrderRequest(BaseModel):
    user_id: str = Field(..., example="usr_1001")
    plan_type: str = Field(..., example="PERMANENT") # TRIAL, MONTHLY, PERMANENT
    amount_rials: int = Field(default=0, example=5000000)
    mobile: str | None = Field(default=None, example="09123456789")

@router.post("/trial/start")
async def start_free_trial(user_id: str):
    """فعال‌سازی خودکار اشتراک ۷ روزه آزمایشی برای کاربر جدید بدون نیاز به پرداخت"""
    sub = activate_user_subscription(user_id, "7_DAYS_TRIAL")
    return {
        "status": "SUCCESS",
        "message": "دوره ۷ روزه آزمایشی رایگان سامانه قاضی هوشمند برای شما فعال شد.",
        "subscription": sub
    }

@router.post("/checkout")
async def checkout_subscription(order: SubscriptionOrderRequest):
    """ایجاد فاکتور و دریافت لینک پرداخت از درگاه زیبال"""
    if order.plan_type == "7_DAYS_TRIAL" or order.amount_rials == 0:
        return await start_free_trial(order.user_id)

    res = create_payment_request(
        amount_rials=order.amount_rials,
        order_id=f"GH_{order.user_id}_{int(order.amount_rials)}",
        description=f"اشتراک {order.plan_type} سامانه قاضی هوشمند (ghazihoushmand.ir)",
        mobile=order.mobile
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.get("/callback")
async def payment_callback(trackId: str = Query(...), success: int = Query(...), status: int | None = Query(None)):
    """کال‌بک بازگشتی از درگاه زیبال — مسیر قدیمی (Issue #97).

    این مسیر دیگر خودش تایید/فعال‌سازی انجام نمی‌دهد: قبلاً با یک شناسه
    کاربری ثابت (``"authenticated_user"``) هر پرداخت موفق را — صرف‌نظر از
    اینکه واقعاً چه کسی پرداخت کرده — به همان یک حساب فعال می‌کرد، و علاوه
    بر آن یک JSON خام (نه یک صفحهٔ واقعی) به مرورگر کاربر برمی‌گرداند.

    مسیر واقعی و صحیح، صفحهٔ فرانت‌اند ``/judge/payment/callback`` است که
    trackId را می‌خواند و با ``POST /api/v1/apps/judge/payments/verify``
    (``payment_service.verify_invoice``) وضعیت را از سفارش واقعی در جدول
    ``payment_orders`` — با شناسهٔ کاربر درست، نه رشتهٔ ثابت — تایید می‌کند.
    این مسیر فقط برای سازگاری با ``ZIBAL_CALLBACK_URL``ی که هنوز به آدرس
    قدیمی اشاره می‌کند نگه داشته شده و صرفاً کاربر را با همان query params
    به صفحهٔ صحیح هدایت می‌کند."""
    return RedirectResponse(
        url=f"/judge/payment/callback?trackId={quote(str(trackId))}&success={int(success)}",
        status_code=302,
    )
