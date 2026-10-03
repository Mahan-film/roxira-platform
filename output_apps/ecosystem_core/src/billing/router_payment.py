#!/usr/bin/env python3
from urllib.parse import quote

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/api/v1/payment/zibal", tags=["ZibalPayment"])

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
