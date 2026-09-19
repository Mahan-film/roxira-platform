#!/usr/bin/env python3
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional
from output_apps.ecosystem_core.src.billing.zibal_service import (
    create_payment_request,
    verify_payment,
    activate_user_subscription
)

router = APIRouter(prefix="/api/v1/payment/zibal", tags=["ZibalPayment"])

class SubscriptionOrderRequest(BaseModel):
    user_id: str = Field(..., example="usr_1001")
    plan_type: str = Field(..., example="PERMANENT") # TRIAL, MONTHLY, PERMANENT
    amount_rials: int = Field(default=0, example=5000000)
    mobile: Optional[str] = Field(default=None, example="09123456789")

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
async def payment_callback(trackId: str = Query(...), success: int = Query(...), status: Optional[int] = Query(None)):
    """کال‌بک بازگشتی از درگاه زیبال جهت نهایی‌سازی و شارژ حساب کاربر"""
    if success != 1:
        return {
            "status": "FAILED",
            "message": "پرداخت توسط کاربر لغو شد یا ناموفق بود."
        }

    verify_res = verify_payment(trackId)
    if verify_res.get("success"):
        # فعال‌سازی حساب دائم پس از پرداخت موفق
        sub = activate_user_subscription("authenticated_user", "PERMANENT")
        return {
            "status": "PAID_VERIFIED",
            "message": "پرداخت با موفقیت انجام و حساب کاربری قاضی هوشمند به حالت دائمی ارتقا یافت.",
            "transaction": verify_res,
            "subscription": sub
        }
    else:
        return {
            "status": "VERIFY_FAILED",
            "message": verify_res.get("message")
        }
