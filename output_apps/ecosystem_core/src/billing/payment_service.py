#!/usr/bin/env python3
"""Real-money invoice/verify orchestration for Smart Judge payments (W17).

Deliberately framework- and database-free: every side effect (calling Zibal,
reading/writing an order) comes in as a callable or a small store object, so
this module can be unit tested offline with fakes (see
src/billing/test_payment_service.py) while
output_apps/generated_modules/smartjudge/smartjudge_module.py wires the real
zibal_service.* functions and a payment_orders.PgOrderStore around it.

Pricing is never taken from the client: ``create_invoice`` only accepts a
``plans`` dict (the caller passes ``get_calculated_pricing()``'s output) and
looks the amount up by ``plan_type`` — a client-supplied amount is never read.
"""
from __future__ import annotations

import logging
import os
import re
from collections.abc import Callable
from typing import Any, Protocol

logger = logging.getLogger(__name__)

_IRAN_MOBILE_RE = re.compile(r"^09\d{9}$")


def payments_live_enabled() -> bool:
    """PAYMENTS_LIVE — default OFF. While off, create-invoice must return 503
    instead of ever faking a payment_url or a PAID status."""
    return os.environ.get("PAYMENTS_LIVE", "").strip().lower() in {"1", "true", "yes", "on"}


def crypto_payments_enabled() -> bool:
    """PAYMENTS_CRYPTO_ENABLED — default OFF (hub decision: crypto disabled
    until on-chain verification exists)."""
    return os.environ.get("PAYMENTS_CRYPTO_ENABLED", "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def normalize_iranian_mobile(raw: str | None) -> str | None:
    """Returns a normalized 09xxxxxxxxx mobile, or None if absent/invalid.

    Never raises and never falls back to a hardcoded number — the caller
    decides whether a missing/invalid phone is acceptable (it is: mobile is
    optional for Zibal)."""
    if not raw:
        return None
    s = str(raw).strip().replace(" ", "").replace("-", "")
    if s.startswith("+98"):
        s = "0" + s[3:]
    elif s.startswith("0098"):
        s = "0" + s[4:]
    elif s.startswith("98") and len(s) == 12:
        s = "0" + s[2:]
    return s if _IRAN_MOBILE_RE.match(s) else None


class PlanNotFoundError(ValueError):
    """Raised when plan_type is not one of the server's known plans."""


class MissingIdentifierError(ValueError):
    """Raised when there is no one to activate: neither an authenticated user
    ref nor a valid mobile was supplied. A paid order must never have no
    identifier to activate against."""


class OrderStore(Protocol):
    def create_pending_order(
        self, *, track_id: str, plan_type: str, amount_rial: int,
        phone: str | None = None, user_ref: str | None = None,
    ) -> None: ...

    def get_order(self, track_id: str) -> dict | None: ...

    def mark_paid(self, track_id: str, gateway_ref_number: str | None) -> bool: ...

    def mark_failed(self, track_id: str) -> None: ...


def price_for_plan(plan_type: str, plans: dict) -> dict:
    """The ONLY place an amount is decided: looked up server-side by
    plan_type. Raises PlanNotFoundError for anything not in ``plans`` —
    callers must map that to HTTP 400, never fall back to a default plan."""
    if not plan_type or plan_type not in plans:
        raise PlanNotFoundError(str(plan_type))
    return plans[plan_type]


def create_invoice(
    *,
    plan_type: str,
    phone: str | None,
    user_ref: str | None,
    plans: dict,
    order_store: OrderStore,
    zibal_create_fn: Callable[..., dict],
    order_id_fn: Callable[[], str],
) -> dict:
    """Real Zibal invoice creation. Price comes only from ``plans``
    (server-side get_calculated_pricing()), never from the caller.

    Requires an identifier to activate against: ``user_ref`` (an authenticated
    user ref — the caller is responsible for resolving/hashing this from a
    JWT/session) or a valid Iranian mobile. Without either, a paid order
    would have no one to activate, so this raises MissingIdentifierError
    instead of silently creating an unowned invoice."""
    plan = price_for_plan(plan_type, plans)
    mobile = normalize_iranian_mobile(phone)
    if not user_ref and not mobile:
        raise MissingIdentifierError(
            "create_invoice requires an authenticated user_ref or a valid Iranian mobile"
        )

    amount_rial = int(plan["price_rial"])

    res = zibal_create_fn(
        amount_rials=amount_rial,
        order_id=order_id_fn(),
        description=plan.get("name", plan_type),
        mobile=mobile,
    )
    if not res.get("success"):
        return {
            "status": "FAILED",
            "message": res.get("message", "خطا در ایجاد فاکتور پرداخت زیبال."),
        }

    track_id = str(res["track_id"])
    order_store.create_pending_order(
        track_id=track_id,
        plan_type=plan_type,
        amount_rial=amount_rial,
        phone=mobile,
        user_ref=user_ref,
    )
    return {
        "status": "SUCCESS",
        "track_id": track_id,
        "payment_url": res["payment_url"],
        "amount_rial": amount_rial,
        "plan_type": plan_type,
    }


def verify_invoice(
    *,
    track_id: str,
    order_store: OrderStore,
    zibal_verify_fn: Callable[[str], dict],
    activate_fn: Callable[[str | None, str], Any],
) -> dict:
    """Real Zibal verify. Idempotent: a second call for an already-paid
    track_id returns PAID again without re-calling Zibal or re-activating.
    Rejects when the amount Zibal reports does not match the stored order.

    A transient/unknown gateway response (``verify_res["definitive"]`` is
    False — network error, timeout, unrecognized result code) never marks
    the order failed: it returns status "PENDING_RETRY" and leaves the order
    exactly as it was, so a paid order can never be permanently lost to a
    transient error and a later, real verify can still succeed."""
    order = order_store.get_order(track_id)
    if not order:
        return {"status": "FAILED", "message": "سفارش با این شناسه یافت نشد."}

    if order["status"] == "paid":
        return {
            "status": "PAID",
            "message": "این تراکنش پیش‌تر تایید و فعال شده است.",
            "track_id": track_id,
        }

    verify_res = zibal_verify_fn(track_id)

    if not verify_res.get("definitive"):
        # No final answer from the gateway yet — leave the order pending
        # (never mark_failed here) so the callback page can retry.
        return {
            "status": "PENDING_RETRY",
            "message": verify_res.get(
                "message",
                "امکان تایید قطعی نتیجهٔ پرداخت در حال حاضر وجود ندارد؛ لطفاً دوباره تلاش کنید.",
            ),
            "track_id": track_id,
        }

    if not verify_res.get("paid"):
        order_store.mark_failed(track_id)
        return {
            "status": "FAILED",
            "message": verify_res.get("message", "پرداخت تایید نشد."),
        }

    gateway_amount = int(verify_res.get("amount") or 0)
    if gateway_amount != int(order["amount_rial"]):
        order_store.mark_failed(track_id)
        return {
            "status": "FAILED",
            "message": "مبلغ تایید شده توسط درگاه با فاکتور مطابقت ندارد.",
        }

    became_paid = order_store.mark_paid(track_id, verify_res.get("ref_number"))
    if not became_paid:
        # Raced with another verify call for the same track_id (or the order
        # was already terminal). Re-read and only ever report PAID if it is
        # genuinely paid now — never claim success on a guess.
        refreshed = order_store.get_order(track_id) or order
        if refreshed.get("status") != "paid":
            return {
                "status": "FAILED",
                "message": "وضعیت تراکنش نامشخص است؛ لطفاً دوباره تلاش کنید.",
            }
        return {
            "status": "PAID",
            "message": "این تراکنش پیش‌تر تایید و فعال شده است.",
            "track_id": track_id,
        }

    activation_result = activate_fn(
        order.get("user_ref") or order.get("phone"), order["plan_type"]
    )
    activation_pending = isinstance(activation_result, dict) and not activation_result.get(
        "persisted", True
    )
    if activation_pending:
        # Payment IS captured and marked paid — never undo that. But the
        # entitlement write failed, so this needs manual reconciliation
        # (see docs/W17_payment_fix.md). track_id only, no PII.
        logger.error(
            "W17 payment verified but entitlement persist failed: track_id=%s", track_id
        )

    result = {
        "status": "PAID",
        "message": "پرداخت با موفقیت تایید و حساب کاربری فعال شد.",
        "track_id": track_id,
        "ref_number": verify_res.get("ref_number"),
    }
    if activation_pending:
        result["activation_pending"] = True
    return result
