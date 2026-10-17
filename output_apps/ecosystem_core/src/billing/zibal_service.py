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

# نتایج قطعی زیبال که یعنی تراکنش ناموفق/لغو شده — این‌ها تنها موارد مجازند که
# سفارش را failed علامت بزنند. هر نتیجهٔ دیگر (نامشخص، خطای شبکه، پاسخ ناقص)
# باید non-definitive بماند تا سفارشی که واقعاً پرداخت شده هرگز به‌خاطر یک خطای
# گذرا failed نشود — طبق بازخورد مالک روی PR #53.
_DEFINITIVE_UNPAID_RESULT_CODES = {202}


def verify_payment(track_id: str) -> Dict[str, Any]:
    """اعتبارسنجی تراکنش پس از بازگشت کاربر از درگاه بانکی.

    ``definitive=True`` یعنی زیبال پاسخ نهایی و قطعی داده (موفق یا ناموفق).
    ``definitive=False`` یعنی پاسخ نامشخص است یا اصلاً به زیبال نرسیدیم (خطای
    شبکه/timeout) — کالر (payment_service.verify_invoice) در این حالت نباید
    سفارش را failed کند، چون ممکن است تراکنش واقعاً موفق بوده باشد."""
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
    except Exception as e:
        return {
            "success": False,
            "paid": False,
            "definitive": False,
            "message": f"خطا در استعلام زیبال: {str(e)}",
        }

    result = data.get("result")
    # 100: تراکنش با موفقیت تایید شد / 201: قبلا تایید شده
    if result in (100, 201):
        return {
            "success": True,
            "paid": True,
            "definitive": True,
            "result_code": result,
            "amount": data.get("amount"),
            "ref_number": data.get("refNumber"),
            "card_number": data.get("cardNumber"),
            "paid_at": data.get("paidAt"),
            "message": "پرداخت با موفقیت تایید گردید."
        }
    if result in _DEFINITIVE_UNPAID_RESULT_CODES:
        return {
            "success": True,
            "paid": False,
            "definitive": True,
            "result_code": result,
            "message": data.get("message", "تراکنش ناموفق بود یا لغو گردید.")
        }
    # نتیجهٔ ناشناخته/غیرمنتظره — پاسخ نهایی محسوب نمی‌شود.
    return {
        "success": False,
        "paid": False,
        "definitive": False,
        "result_code": result,
        "message": data.get("message", "پاسخ نامشخص از درگاه زیبال."),
    }

def activate_user_subscription(user_id: str, plan_type: str = "7_DAYS_TRIAL") -> Dict[str, Any]:
    """فعال‌سازی دوره ۷ روزه آزمایشی رایگان یا حساب دائم — و نوشتن واقعی
    entitlement در Postgres (جدول user_entitlements)، نه صرفاً یک dict."""
    now = datetime.datetime.now(datetime.timezone.utc)
    if plan_type == "7_DAYS_TRIAL":
        expire_at = now + datetime.timedelta(days=7)
        status = "TRIAL_ACTIVE"
    elif plan_type == "PERMANENT":
        expire_at = now + datetime.timedelta(days=3650)  # ۱۰ سال
        status = "PERMANENT_ACTIVE"
    else:
        days = 30
        try:  # SJ_*_YEARLY subscriptions last 365 days; everything else keeps 30
            from . import pricing_service
            days = pricing_service.plan_period_days(plan_type, 30)
        except Exception:  # pragma: no cover - never block activation on this
            pass
        expire_at = now + datetime.timedelta(days=days)
        status = "YEARLY_ACTIVE" if days >= 365 else "MONTHLY_ACTIVE"

    result = {
        "user_id": user_id,
        "subscription_plan": plan_type,
        "status": status,
        "activated_at": now.isoformat(),
        "expires_at": expire_at.isoformat(),
        "is_active": True,
        "persisted": False,
    }

    if not user_id:
        return result

    try:
        result["persisted"] = _persist_entitlement(
            user_id=user_id,
            plan_type=plan_type,
            status=status,
            activated_at=now,
            expires_at=expire_at,
        )
    except Exception as exc:  # pragma: no cover - must never block the response
        result["persist_error"] = str(exc)

    return result


def lookup_entitlement(user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Current row of ``user_entitlements`` for a user ref (read only), used by
    the payment result page. Returns None when absent or the DB is unavailable."""
    if not user_id:
        return None
    import psycopg

    from src.roxira_config import postgres_dsn

    dsn = os.environ.get("DATABASE_URL") or postgres_dsn(
        host=os.environ.get("POSTGRES_HOST", "roxira_postgres_prod"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
    )
    try:
        with psycopg.connect(dsn, autocommit=True, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT plan_type, expires_at FROM user_entitlements WHERE user_ref = %s;",
                    (user_id,),
                )
                row = cur.fetchone()
    except Exception:
        return None
    if not row:
        return None
    return {"plan_type": row[0], "expires_at": row[1].isoformat() if row[1] else None}


_LEVEL_RANK = {"free": 0, "basic": 1, "pro": 2, "premium": 3}


def merge_entitlement(existing_plan, existing_expires, new_plan, new_expires, now):
    """Decide the row to keep when a user buys while an entitlement may still be active.

    Returns (plan_type, expires_at, write). A purchase of a LOWER level (e.g. a single draft or voice
    pack while a subscription runs) never downgrades the active subscription (write=False). Renewing the
    SAME level stacks the new period on top of the remaining time. A higher level replaces it.
    """
    from . import pricing_service

    if not existing_plan or existing_expires is None or existing_expires <= now:
        return new_plan, new_expires, True
    old_rank = _LEVEL_RANK.get(pricing_service.plan_level(existing_plan), 0)
    new_rank = _LEVEL_RANK.get(pricing_service.plan_level(new_plan), 0)
    if new_rank < old_rank or (new_rank == 0 and old_rank == 0 and new_plan != existing_plan):
        return existing_plan, existing_expires, False
    if new_rank == old_rank and new_rank > 0:
        return new_plan, existing_expires + (new_expires - now), True
    return new_plan, new_expires, True


def _persist_entitlement(
    user_id: str,
    plan_type: str,
    status: str,
    activated_at: "datetime.datetime",
    expires_at: "datetime.datetime",
) -> bool:
    """Upsert the entitlement row. Isolated so tests can monkeypatch it
    without needing a real Postgres connection."""
    import psycopg

    from src.roxira_config import postgres_dsn

    dsn = os.environ.get("DATABASE_URL") or postgres_dsn(
        host=os.environ.get("POSTGRES_HOST", "roxira_postgres_prod"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
    )
    with psycopg.connect(dsn, autocommit=True, connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_entitlements (
                    user_ref VARCHAR(128) PRIMARY KEY,
                    plan_type VARCHAR(64) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    activated_at TIMESTAMPTZ NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            cur.execute(
                "SELECT plan_type, expires_at FROM user_entitlements WHERE user_ref = %s;", (user_id,)
            )
            row = cur.fetchone()
            plan_type, expires_at, write = merge_entitlement(
                row[0] if row else None, row[1] if row else None, plan_type, expires_at,
                datetime.datetime.now(datetime.timezone.utc),
            )
            if not write:
                return True  # an active higher subscription is kept; the one-off purchase is in payment_orders
            cur.execute(
                """
                INSERT INTO user_entitlements
                    (user_ref, plan_type, status, activated_at, expires_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, now())
                ON CONFLICT (user_ref) DO UPDATE SET
                    plan_type = EXCLUDED.plan_type,
                    status = EXCLUDED.status,
                    activated_at = EXCLUDED.activated_at,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = now();
                """,
                (user_id, plan_type, status, activated_at, expires_at),
            )
    return True
