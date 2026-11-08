#!/usr/bin/env python3
from urllib.parse import quote

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/api/v1/payment/zibal", tags=["ZibalPayment"])

@router.get("/callback")
async def payment_callback(
    trackId: str | None = Query(None),
    track_id: str | None = Query(None),
    authority: str | None = Query(None),
    Authority: str | None = Query(None),
    success: int | None = Query(None),
    status: str | int | None = Query(None),
):
    """کال‌بک بازگشتی از درگاه‌های پرداخت (زیبال، زرین‌پال، شاپرک) — Issue #97 & T18.

    این مسیر دیگر خودش تایید/فعال‌سازی انجام نمی‌دهد: قبلاً با یک شناسه
    کاربری ثابت (``"authenticated_user"``) هر پرداخت موفق را — صرف‌نظر از
    اینکه واقعاً چه کسی پرداخت کرده — به همان یک حساب فعال می‌کرد، و علاوه
    بر آن یک JSON خام (نه یک صفحهٔ واقعی) به مرورگر کاربر برمی‌گرداند.

    پشتیبانی از پارامترهای مرسوم درگاه‌ها:
    - زیبال: trackId یا track_id با success (1/0)
    - زرین‌پال و درگاه‌های شاپرک: Authority یا authority با Status (OK/NOK)

    مسیر واقعی و صحیح، صفحهٔ فرانت‌اند ``/judge/payment/callback`` است که
    شناسه پیگیری را می‌خواند و با ``POST /api/v1/apps/judge/payments/verify``
    (``payment_service.verify_invoice``) وضعیت را از سفارش واقعی در جدول
    ``payment_orders`` — با قفل تراکنش، تطابق دقیق مبلغ سمت سرور و جلوگیری
    از شارژ مجدد (Double Credit) در ریپلای یا رفرش — تایید می‌کند."""
    token = trackId or track_id or authority or Authority
    if not token or not str(token).strip():
        return RedirectResponse(
            url="/judge/payment/callback?status=missing_token",
            status_code=302,
        )

    is_success = 0
    if success is not None:
        try:
            is_success = 1 if int(success) == 1 else 0
        except (ValueError, TypeError):
            is_success = 0
    elif status is not None:
        s_val = str(status).strip().upper()
        if s_val in ("1", "OK", "SUCCESS", "TRUE"):
            is_success = 1

    return RedirectResponse(
        url=f"/judge/payment/callback?trackId={quote(str(token).strip())}&success={is_success}",
        status_code=302,
    )
