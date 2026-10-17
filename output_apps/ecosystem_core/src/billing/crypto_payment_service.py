#!/usr/bin/env python3
"""Optional self-custody USDT (TRC20) checkout. OFF by default.

Completely inert unless ``CRYPTO_PAY_ENABLED=1`` AND ``CRYPTO_USDT_TRC20_ADDRESS``
is a valid TRON address (see docs/ops/CRYPTO_PAYMENTS.md). No third-party
processor, no KYC provider, no fees: the customer sends USDT to our own
(public) address and we match the on-chain transfer by exact amount.

Like payment_service.py this module is database- and framework-free: persistence
comes in as a store object (crypto_orders.PgCryptoOrderStore in production, a
fake in src/billing/test_crypto_payment_service.py) and the TronGrid call is an
injectable function, so everything is unit-testable offline. Settlement reuses
the Zibal path: ``store.mark_paid`` (atomic, idempotent) followed by
``payment_service.activate_with_retry`` (-> zibal_service.activate_user_subscription).

Amount only ever comes from the server-side plan USD price
(``pricing_service.get_calculated_pricing()[plan]["usd"]``), never from the client.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Protocol

from . import payment_service

logger = logging.getLogger(__name__)

METHOD = "usdt_trc20"
TRACK_PREFIX = "USDT_"
# Official Tether USDT TRC20 token contract on TRON mainnet (public, not a secret).
# Base58check-validated by is_valid_tron_address() and pinned by a unit test.
USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
TRONGRID_BASE = "https://api.trongrid.io"
USDT_DECIMALS = 6
MICRO = 10 ** USDT_DECIMALS
INVOICE_TTL = timedelta(minutes=60)
# Pending rows are only swept to 'expired' this long after expires_at, so a
# transfer made in time but seen late (poller outage) can still be matched.
SWEEP_GRACE = timedelta(hours=6)
SUFFIX_MAX_MICRO = 9999        # unique tail: +0.000001 .. +0.009999 USDT
MAX_CREATE_ATTEMPTS = 25
MIN_FLAG_MICRO = 1 * MICRO     # unmatched incoming transfers below 1 USDT are dust/spam: ignored

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


class CryptoDisabledError(RuntimeError):
    """Crypto checkout is not enabled/configured; endpoints map this to 404."""


class NoUsdPriceError(ValueError):
    """The plan has no USD base price (e.g. SINGLE_DRAFT) so it cannot be paid in USDT."""


class InvoiceAllocationError(RuntimeError):
    """Could not allocate a unique amount (too many open invoices)."""


# ---------------------------------------------------------------- config ----
def is_valid_tron_address(addr: str | None) -> bool:
    """Base58check (version byte 0x41, 25 bytes, 34 chars starting with T)."""
    if not addr or len(addr) != 34 or addr[0] != "T":
        return False
    num = 0
    for ch in addr:
        idx = _B58.find(ch)
        if idx < 0:
            return False
        num = num * 58 + idx
    if num >= 1 << 200:
        return False
    raw = num.to_bytes(25, "big")
    if raw[0] != 0x41:
        return False
    return hashlib.sha256(hashlib.sha256(raw[:21]).digest()).digest()[:4] == raw[21:]


def receiving_address() -> str | None:
    addr = os.environ.get("CRYPTO_USDT_TRC20_ADDRESS", "").strip()
    return addr if is_valid_tron_address(addr) else None


def crypto_pay_enabled() -> bool:
    """CRYPTO_PAY_ENABLED (default OFF) and a valid receiving address."""
    flag = os.environ.get("CRYPTO_PAY_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
    return flag and receiving_address() is not None


def require_enabled() -> str:
    addr = receiving_address()
    if not crypto_pay_enabled() or addr is None:
        raise CryptoDisabledError("crypto checkout disabled")
    return addr


# --------------------------------------------------------------- amounts ----
def to_micro(amount: str | Decimal | float) -> int:
    return int((Decimal(str(amount)) * MICRO).to_integral_value())


def format_micro(micro: int) -> str:
    """String decimal with exactly 6 dp, e.g. 10_003_417 -> '10.003417'."""
    return f"{micro // MICRO}.{micro % MICRO:06d}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- store -----
class CryptoOrderStore(Protocol):
    def create_crypto_order(self, order: dict) -> bool:
        """Insert a pending order; False if amount_usdt is already used by another pending order."""

    def get_order(self, track_id: str) -> dict | None: ...

    def list_pending(self) -> list[dict]: ...

    def mark_paid(self, track_id: str, gateway_ref_number: str | None) -> bool:
        """Atomic pending->paid that also stores tx_hash (= gateway_ref_number).
        False when not pending or when tx_hash is already used (unique)."""

    def tx_used(self, tx_hash: str) -> bool: ...

    def flag_unmatched(self, *, tx_hash: str, sender: str, value_micro: int,
                       block_ts: datetime, reason: str) -> None: ...

    def sweep_expired(self, before: datetime) -> int: ...


# --------------------------------------------------------------- invoice ----
def create_crypto_invoice(
    *,
    plan_type: str,
    user_ref: str | None,
    plans: dict,
    store: CryptoOrderStore,
    now: datetime | None = None,
    suffix_fn: Callable[[], int] | None = None,
) -> dict:
    """Price = plan USD base (server-side) + unique micro suffix. Requires a login (user_ref)."""
    address = require_enabled()
    if not user_ref:
        raise payment_service.MissingIdentifierError("crypto checkout requires a logged-in user")
    plan = payment_service.price_for_plan(plan_type, plans)
    usd = plan.get("usd")
    if not usd or float(usd) <= 0:
        raise NoUsdPriceError(plan_type)
    base_micro = to_micro(usd)
    now = now or _utcnow()
    pick = suffix_fn or (lambda: secrets.randbelow(SUFFIX_MAX_MICRO) + 1)
    store.sweep_expired(now - SWEEP_GRACE)

    for _ in range(MAX_CREATE_ATTEMPTS):
        suffix = int(pick())
        if not 1 <= suffix <= SUFFIX_MAX_MICRO:
            raise ValueError("suffix out of range")
        order = {
            "track_id": TRACK_PREFIX + uuid.uuid4().hex,
            "plan_type": plan_type,
            "amount_rial": 0,
            "status": "pending",
            "user_ref": user_ref,
            "phone": None,
            "method": METHOD,
            "amount_usdt": format_micro(base_micro + suffix),
            "address": address,
            "created_at": now,
            "expires_at": now + INVOICE_TTL,
            "tx_hash": None,
        }
        if store.create_crypto_order(order):
            return public_view(order, now)
    raise InvoiceAllocationError("no free unique amount")


def public_view(order: dict, now: datetime) -> dict:
    status = str(order["status"]).upper()
    if status == "PENDING" and now > order["expires_at"]:
        status = "EXPIRED"
    return {
        "status": status,  # PENDING | PAID | EXPIRED | FAILED
        "track_id": order["track_id"],
        "plan_type": order["plan_type"],
        "method": METHOD,
        "network": "TRON (TRC20)",
        "asset": "USDT",
        "amount_usdt": order["amount_usdt"],
        "address": order["address"],
        "expires_at": order["expires_at"].isoformat(),
        "seconds_left": max(0, int((order["expires_at"] - now).total_seconds())),
    }


# --------------------------------------------------------------- TronGrid ----
def fetch_trc20_transfers(
    address: str, min_timestamp_ms: int, *, api_key: str | None = None,
    http_get: Callable[[str, dict], dict] | None = None, max_pages: int = 3,
) -> list[dict]:
    """Confirmed USDT TRC20 transfers touching ``address`` since min_timestamp_ms."""
    api_key = api_key if api_key is not None else os.environ.get("TRONGRID_API_KEY", "").strip()
    headers = {"Accept": "application/json"}
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key
    get = http_get or _http_get_json
    query = urllib.parse.urlencode({
        "only_confirmed": "true", "contract_address": USDT_TRC20_CONTRACT,
        "min_timestamp": int(min_timestamp_ms), "limit": 200, "order_by": "block_timestamp,asc",
    })
    url: str | None = f"{TRONGRID_BASE}/v1/accounts/{address}/transactions/trc20?{query}"
    out: list[dict] = []
    for _ in range(max_pages):
        if not url:
            break
        body = get(url, headers)
        out.extend(body.get("data") or [])
        url = ((body.get("meta") or {}).get("links") or {}).get("next")
        if url and not url.startswith(TRONGRID_BASE + "/"):
            break  # never follow a pagination link off TronGrid
    return out


def _http_get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 (fixed https host)
        return json.loads(resp.read().decode("utf-8"))


# -------------------------------------------------------------- matching ----
def _tx_fields(tx: dict) -> tuple[str, str, str, int, int] | None:
    """(tx_hash, sender, to, value_micro, block_ts_ms) for a genuine USDT Transfer, else None."""
    try:
        if tx.get("type") not in (None, "Transfer"):
            return None
        info = tx.get("token_info") or {}
        if info.get("address") != USDT_TRC20_CONTRACT:
            return None
        if int(info.get("decimals", USDT_DECIMALS)) != USDT_DECIMALS:
            return None
        return (str(tx["transaction_id"]), str(tx.get("from", "")), str(tx["to"]),
                int(str(tx["value"])), int(tx["block_timestamp"]))
    except (KeyError, TypeError, ValueError):
        return None


def process_transfers(
    transfers: list[dict], *, store: CryptoOrderStore, address: str,
    activate_fn: Callable[[str | None, str], Any],
) -> dict:
    """Match transfers to pending invoices and settle exact matches. Idempotent:
    re-feeding the same transfers never activates twice."""
    summary: dict = {"paid": [], "skipped_used": 0, "flagged": 0, "ignored": 0}
    pending = store.list_pending()
    for tx in transfers:
        f = _tx_fields(tx)
        if f is None:
            summary["ignored"] += 1
            continue
        tx_hash, sender, to, value, ts_ms = f
        if to != address:
            summary["ignored"] += 1
            continue
        if store.tx_used(tx_hash):
            summary["skipped_used"] += 1
            continue
        block_ts = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        in_window = [o for o in pending if o["created_at"] <= block_ts <= o["expires_at"]]
        exact = [o for o in in_window if to_micro(o["amount_usdt"]) == value]
        if len(exact) == 1:
            order = exact[0]
            if store.mark_paid(order["track_id"], tx_hash):
                _, act_pending = payment_service.activate_with_retry(
                    order, order["track_id"], activate_fn)
                summary["paid"].append(order["track_id"])
                pending = [o for o in pending if o["track_id"] != order["track_id"]]
                if act_pending:
                    logger.error("crypto paid but activation pending: track_id=%s", order["track_id"])
            else:
                summary["skipped_used"] += 1  # raced / tx_hash reuse rejected by the store
            continue
        if value >= MIN_FLAG_MICRO:
            reason = "near_open_invoice" if in_window else "no_open_invoice"
            if len(exact) > 1:
                reason = "ambiguous_amount"
            store.flag_unmatched(tx_hash=tx_hash, sender=sender, value_micro=value,
                                 block_ts=block_ts, reason=reason)
            logger.warning("crypto transfer NOT auto-activated (support): tx=%s value=%s reason=%s",
                           tx_hash, format_micro(value), reason)
            summary["flagged"] += 1
        else:
            summary["ignored"] += 1
    return summary


def poll_once(
    *, store: CryptoOrderStore, activate_fn: Callable[[str | None, str], Any],
    fetch_fn: Callable[..., list[dict]] | None = None, now: datetime | None = None,
) -> dict:
    """One poll cycle (systemd timer script and the verify/status endpoint)."""
    address = require_enabled()
    now = now or _utcnow()
    pending = store.list_pending()
    if not pending:
        store.sweep_expired(now - SWEEP_GRACE)
        return {"paid": [], "skipped_used": 0, "flagged": 0, "ignored": 0, "pending": 0}
    since = min(o["created_at"] for o in pending)
    fetch = fetch_fn or fetch_trc20_transfers
    transfers = fetch(address, int(since.timestamp() * 1000))
    summary = process_transfers(transfers, store=store, address=address, activate_fn=activate_fn)
    store.sweep_expired(now - SWEEP_GRACE)
    summary["pending"] = len(pending)
    return summary


def get_status(
    *, track_id: str, store: CryptoOrderStore, activate_fn: Callable[[str | None, str], Any],
    plans: dict | None = None, entitlement_fn: Callable[[str | None], dict | None] | None = None,
    user_ref: str | None = None, require_owner: bool = True,
    fetch_fn: Callable[..., list[dict]] | None = None, now: datetime | None = None,
) -> dict | None:
    """Status of one invoice (polls the chain first if still pending). None when
    unknown or (require_owner) not owned by ``user_ref`` — callers answer 404."""
    require_enabled()
    now = now or _utcnow()
    order = store.get_order(track_id)
    if not order or order.get("method") != METHOD:
        return None
    if require_owner and (not user_ref or order.get("user_ref") != user_ref):
        return None
    if order["status"] == "pending" and now <= order["expires_at"] + SWEEP_GRACE:
        try:
            poll_once(store=store, activate_fn=activate_fn, fetch_fn=fetch_fn, now=now)
        except Exception:  # TronGrid down: stay pending, the timer retries
            logger.exception("crypto poll failed: track_id=%s", track_id)
        order = store.get_order(track_id) or order
    if order["status"] == "paid":
        result = payment_service.paid_result(
            order, track_id, "پرداخت تتر با موفقیت تایید و حساب کاربری فعال شد.",
            plans=plans, entitlement_fn=entitlement_fn)
        result.update(public_view(order, now))
        result["status"] = "PAID"
        return result
    return public_view(order, now)
