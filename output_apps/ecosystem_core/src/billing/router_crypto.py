#!/usr/bin/env python3
"""HTTP layer for the optional USDT-TRC20 checkout (docs/ops/CRYPTO_PAYMENTS.md).

Mounted under the Smart Judge router (prefix /api/v1/apps/judge) by
smartjudge_module.py. With CRYPTO_PAY_ENABLED off every endpoint except the
harmless ``config`` probe answers 404, and nothing touches the database.

Auth is injected (``resolve_user_ref``): it must return the same hashed user ref
that the Zibal create-invoice path stores, so activation hits the same account.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import crypto_orders, crypto_payment_service as cps, payment_service

logger = logging.getLogger(__name__)

_TRACK_RE = r"^USDT_[0-9a-f]{32}$"


class CryptoInvoiceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_type: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_]+$")


def _not_found() -> JSONResponse:
    return JSONResponse(status_code=404, content={"status": "NOT_FOUND"})


def build_router(
    *,
    resolve_user_ref: Callable[[Request], str | None],
    get_plans: Callable[[], dict] | None = None,
    activate_fn: Callable[[str | None, str], Any] | None = None,
    entitlement_fn: Callable[[str | None], dict | None] | None = None,
    store_factory: Callable[[], tuple[Any, Callable[[], None]]] | None = None,
    fetch_fn: Callable[..., list[dict]] | None = None,
    on_paid: Callable[[], None] | None = None,
    gate_status: Callable[[Request, str], Any] | None = None,
) -> tuple[APIRouter, Callable[[str], dict | None]]:
    """Returns (router, verify_by_track_id). The second is used by the generic
    /payments/verify endpoint for ``USDT_`` track ids (no login: the track id is
    an unguessable 128-bit token and the response only reads payment state)."""
    router = APIRouter(prefix="/payments/crypto", tags=["CryptoPayment"])

    def _plans() -> dict:
        if get_plans:
            return get_plans()
        from .pricing_service import get_calculated_pricing
        return get_calculated_pricing()

    def _deps() -> tuple[Callable, Callable]:
        if activate_fn and entitlement_fn:
            return activate_fn, entitlement_fn
        from . import zibal_service
        return (activate_fn or zibal_service.activate_user_subscription,
                entitlement_fn or zibal_service.lookup_entitlement)

    def _store() -> tuple[Any, Callable[[], None]]:
        if store_factory:
            return store_factory()
        conn = crypto_orders.get_connection()
        return crypto_orders.PgCryptoOrderStore(conn), conn.close

    def _status(track_id: str, user_ref: str | None, require_owner: bool) -> dict | None:
        act, ent = _deps()
        store, close = _store()
        try:
            res = cps.get_status(
                track_id=track_id, store=store, activate_fn=act, plans=_plans(),
                entitlement_fn=ent, user_ref=user_ref, require_owner=require_owner,
                fetch_fn=fetch_fn)
        finally:
            close()
        if res and res.get("status") == "PAID" and on_paid:
            on_paid()
        return res

    def verify_by_track_id(track_id: str) -> dict | None:
        return _status(track_id, None, require_owner=False)

    @router.get("/config")
    async def crypto_config():
        # Only tells the UI whether to show the option; never leaks the address.
        return {"enabled": cps.crypto_pay_enabled()}

    @router.post("/create-invoice")
    async def create_crypto_invoice(request: Request, body: CryptoInvoiceIn):
        if not cps.crypto_pay_enabled():
            return _not_found()
        user_ref = resolve_user_ref(request)
        if not user_ref:
            return JSONResponse(status_code=401, content={
                "status": "FAILED", "message": "برای پرداخت با تتر ابتدا وارد حساب کاربری شوید."})
        store, close = _store()
        try:
            return cps.create_crypto_invoice(
                plan_type=body.plan_type, user_ref=user_ref, plans=_plans(), store=store)
        except cps.CryptoDisabledError:
            return _not_found()
        except (payment_service.PlanNotFoundError, cps.NoUsdPriceError):
            return JSONResponse(status_code=400, content={
                "status": "FAILED", "message": "این طرح با تتر قابل پرداخت نیست."})
        except cps.InvoiceAllocationError:
            return JSONResponse(status_code=503, content={
                "status": "UNAVAILABLE", "message": "اکنون امکان صدور فاکتور تتر نیست؛ چند دقیقه بعد تلاش کنید."})
        finally:
            close()

    @router.get("/status/{track_id}")
    async def crypto_invoice_status(request: Request, track_id: str = Path(..., pattern=_TRACK_RE)):
        if not cps.crypto_pay_enabled():
            return _not_found()
        if gate_status is not None:
            limited = gate_status(request, track_id)
            if limited is not None:
                return limited
        user_ref = resolve_user_ref(request)
        if not user_ref:
            return JSONResponse(status_code=401, content={"status": "FAILED"})
        res = _status(track_id, user_ref, require_owner=True)
        return res if res is not None else _not_found()

    return router, verify_by_track_id
