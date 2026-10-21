"""Owner admin console API (served under /api/v1/apps/judge/admin/console/*).

Wired from smartjudge_module.py with ``build_router(...)``; this module never imports it (no cycle): the
token verifier, the admin phone list, phone normalisation and the entitlement-cache hook come in as
arguments.

Security model, in the order it is applied to EVERY endpoint:
  1. a verified bearer token (401 otherwise, via chat_auth);
  2. the token's phone must be in SMARTJUDGE_ADMIN_PHONES (403 otherwise) - read per request, so removing a
     phone takes effect at once; e-mail accounts can never be admins;
  3. a per-admin hourly rate limit per bucket (read / write / heavy), 429 + Retry-After;
  4. a Pydantic body with ``extra="forbid"`` (422 on anything unexpected). Nothing accepts shell text: the
     only subprocess is ``taskq.py add`` with a fixed argv list and no shell (task text goes into a file).
Mutations write an ``admin_audit`` row (actor, action, target, reason, ts); entitlement changes do so in the
same transaction. Secrets, tokens and env values are never returned.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
import os
import re
import secrets
import time
from collections.abc import Callable
from typing import Any, Literal, NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from output_apps.ecosystem_core.src.billing import (
    crypto_payment_service,
    payment_orders,
    payment_service,
    pricing_service,
    zibal_service,
)
from output_apps.generated_modules.smartjudge import (
    admin_hostdata as hostdata,
)
from output_apps.generated_modules.smartjudge import (
    admin_site_check,
    chat_auth,
    llm_gateway,
)
from output_apps.generated_modules.smartjudge.admin_store import StoreError

logger = logging.getLogger("admin_api")

READ_PER_HOUR = 1200
WRITE_PER_HOUR = 120
HEAVY_PER_HOUR = 40
RESEARCH_MAX_RUNNING = 2
RESEARCH_TIMEOUT_S = 900
JOB_TTL_S = 7200
MAX_JOBS = 40

PLAN_LEVELS = ("free", "basic", "pro", "premium", "team")
USER_REF_RE = r"^[0-9a-f]{16}$"
PRIVATE_DATA_RE = re.compile(r"(?<!\d)(?:09\d{9}|\+98\d{10}|\d{10})(?!\d)")


# ------------------------------------------------------------------ helpers
def hashed_user_ref(identity: str) -> str:
    """Same pseudonymous id as smartjudge_module._hashed_user_ref (a test keeps them identical)."""
    return hashlib.sha256(f"smartjudge:{identity}".encode()).hexdigest()[:16]


def mask_phone(phone: str) -> str:
    return f"{phone[:4]}***{phone[-4:]}" if len(phone) >= 8 else "***"


class AdminCtx(NamedTuple):
    phone: str
    actor: str  # masked phone, what the audit table stores


def _http(status: int, message: str, code: str = "ADMIN_ERROR", headers: dict | None = None) -> HTTPException:
    return HTTPException(status_code=status, headers=headers,
                         detail={"status": "error", "message": message, "code": code})


def _from_response(resp) -> HTTPException:
    keep = {k: v for k, v in resp.headers.items() if k.lower() in ("retry-after", "www-authenticate")}
    return HTTPException(status_code=resp.status_code, detail=json.loads(resp.body), headers=keep or None)


def _level_of(plan_type: str) -> str:
    if str(plan_type).upper() == "FREE":
        return "free"
    return pricing_service.plan_level(plan_type)


def _by_level(counts: dict[str, int] | None) -> dict[str, int] | None:
    if counts is None:
        return None
    out = dict.fromkeys(PLAN_LEVELS, 0)
    for plan, n in counts.items():
        out[_level_of(plan)] += int(n)
    return out


def allowed_grant_plans() -> list[str]:
    return sorted(pricing_service.USD_PLANS) + ["7_DAYS_TRIAL"]


def _peek(key: str) -> int | None:
    """Current value of a rate-limit counter WITHOUT incrementing it (None when the store is unreachable)."""
    try:
        client = chat_auth._get_redis()
        if client is not None:
            value = client.get(key)
            return int(value) if value is not None else 0
        with chat_auth._mem_lock:
            item = chat_auth._mem_get(key)
            return int(item[0]) if item else 0
    except Exception:  # noqa: BLE001
        return None


# ------------------------------------------------------------------ request models
class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EntitlementBody(_Strict):
    user_ref: str = Field(pattern=USER_REF_RE)
    action: Literal["grant", "extend", "revoke"]
    plan_type: str | None = Field(default=None, max_length=64)
    days: int | None = Field(default=None, ge=1, le=3650)
    reason: str = Field(min_length=3, max_length=500)

    @model_validator(mode="after")
    def _shape(self) -> EntitlementBody:
        if self.action == "grant":
            if self.plan_type not in allowed_grant_plans():
                raise ValueError("plan_type must be one of " + ", ".join(allowed_grant_plans()))
            if self.days is None:
                self.days = 7 if self.plan_type == "7_DAYS_TRIAL" else pricing_service.plan_period_days(self.plan_type, 30)
        elif self.action == "extend":
            if self.days is None or self.plan_type is not None:
                raise ValueError("extend needs days and no plan_type")
        elif self.plan_type is not None or self.days is not None:
            raise ValueError("revoke takes neither plan_type nor days")
        return self


class MatchCryptoBody(_Strict):
    track_id: str = Field(pattern=r"^USDT_[0-9a-f]{32}$")
    tx_hash: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    reason: str = Field(min_length=3, max_length=500)


class ReverifyBody(_Strict):
    track_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$")
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("track_id")
    @classmethod
    def _not_usdt(cls, v: str) -> str:
        if v.startswith("USDT_"):
            raise ValueError("USDT orders are matched with match-crypto, not re-verified at Zibal")
        return v


class ResearchBody(_Strict):
    query: str = Field(min_length=5, max_length=1500)
    report_type: Literal["research_report", "resource_report", "outline_report"] = "research_report"
    max_sources: int = Field(default=8, ge=1, le=20)


class SiteCheckBody(_Strict):
    url: str = Field(min_length=8, max_length=500)


class TaskBody(_Strict):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,39}$")
    task: str = Field(min_length=10, max_length=8000)
    scopes: list[str] = Field(default_factory=list, max_length=10)
    ladder: list[Literal["best", "free", "ds-flash", "strong"]] = Field(default_factory=lambda: ["ds-flash"], min_length=1, max_length=4)
    public: bool = False
    priority: int = Field(default=0, ge=-10, le=10)

    @field_validator("scopes")
    @classmethod
    def _scopes(cls, value: list[str]) -> list[str]:
        for scope in value:
            if not hostdata.valid_scope(scope):
                raise ValueError("scope must be a relative repo path without '..'")
        return value

    @field_validator("ladder")
    @classmethod
    def _ladder(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("ladder steps must be unique")
        return value


class MarketingDecisionBody(_Strict):
    post_id: int = Field(ge=1, le=10**9)
    decision: Literal["approve", "reject"]
    reason: str = Field(default="", max_length=300)


# ------------------------------------------------------------------ router
def build_router(
    *,
    get_current_user: Callable,
    admin_phones: Callable[[], set],
    store: Any,
    normalize_phone: Callable[[str], str],
    is_valid_phone: Callable[[str], bool],
    on_entitlement_change: Callable[[], None] | None = None,
    fetch_transfers: Callable[..., list] | None = None,
    activate_fn: Callable | None = None,
    zibal_verify: Callable[[str], dict] | None = None,
    research_fn: Callable[..., Any] | None = None,
    site_check_fn: Callable[[str], dict] | None = None,
    queue_task_fn: Callable[..., int] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/admin/console", tags=["Owner admin console"])
    changed = on_entitlement_change or (lambda: None)
    do_fetch = fetch_transfers or crypto_payment_service.fetch_trc20_transfers
    do_activate = activate_fn or zibal_service.activate_user_subscription
    do_research = research_fn or hostdata.run_research
    do_site = site_check_fn or admin_site_check.check_site
    do_queue = queue_task_fn or hostdata.queue_task
    jobs: dict[str, dict] = {}
    tasks: set[asyncio.Task] = set()

    # ---- authorisation -------------------------------------------------
    def gate(bucket: str, limit: int):
        async def dep(user: chat_auth.CurrentUser = Depends(get_current_user)) -> AdminCtx:
            denied = chat_auth.deny_if_invalid(user) or chat_auth.require_auth(user)
            if denied is not None:
                raise _from_response(denied)
            if user.phone not in admin_phones():
                raise _http(403, "دسترسی مجاز نیست.", "FORBIDDEN")
            ok, left = await chat_auth.acheck_limit(f"adminc-{bucket}", user.phone, limit)
            if not ok:
                raise _from_response(chat_auth.rate_limited(left))
            return AdminCtx(phone=user.phone, actor=mask_phone(user.phone))

        return dep

    read_gate, write_gate, heavy_gate = gate("r", READ_PER_HOUR), gate("w", WRITE_PER_HOUR), gate("x", HEAVY_PER_HOUR)

    async def run(fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Blocking work off the event loop; business-rule errors become clean 4xx."""
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except StoreError as exc:
            raise _http(exc.status, exc.message, exc.code) from exc

    async def audit(ctx: AdminCtx, action: str, target: str, reason: str, detail: dict | None = None) -> bool:
        """Best-effort audit row for actions whose effect already happened elsewhere."""
        try:
            await asyncio.to_thread(store.write_audit, actor=ctx.actor, action=action, target=target,
                                    reason=reason, detail=detail or {})
            return True
        except Exception:  # noqa: BLE001
            logger.exception("admin audit write failed: action=%s", action)
            return False

    # ---- session -------------------------------------------------------
    @router.get("/me")
    async def me(ctx: AdminCtx = Depends(read_gate)) -> dict:
        return {"status": "ok", "admin": ctx.actor, "tenant": getattr(store, "tenant", "smartjudge")}

    # ---- 1. dashboard --------------------------------------------------
    @router.get("/dashboard")
    async def dashboard(_: AdminCtx = Depends(read_gate)) -> dict:
        starts = hostdata.window_starts()
        db_f = asyncio.to_thread(store.dashboard, starts)
        cost_f = asyncio.to_thread(_cost_windows, starts)
        umami_f = asyncio.to_thread(hostdata.umami_visitors, starts)
        rate_f = asyncio.to_thread(_usd_toman_rate)
        db, cost, umami, rate = await asyncio.gather(db_f, cost_f, umami_f, rate_f, return_exceptions=True)
        if isinstance(db, BaseException):
            logger.error("dashboard db failed: %s", type(db).__name__)
            db = {"windows": {}, "subscriptions": None, "errors": [f"db: {type(db).__name__}"]}
        for label, part in (("cost", cost), ("umami", umami), ("rate", rate)):
            if isinstance(part, BaseException):
                logger.warning("dashboard %s failed: %s", label, type(part).__name__)
        cost = {} if isinstance(cost, BaseException) else cost
        umami = {"status": "unreachable"} if isinstance(umami, BaseException) else umami
        rate = None if isinstance(rate, BaseException) else rate
        windows: dict[str, Any] = {}
        for name in starts:
            w = db["windows"].get(name, {})
            paid = w.get("paid") or {}
            zibal_rial = sum(v["amount_rial"] for m, v in paid.items() if m != "usdt_trc20")
            usdt = sum(float(v["amount_usdt"]) for m, v in paid.items() if m == "usdt_trc20")
            revenue_toman = zibal_rial // 10
            c = cost.get(name, {"calls": 0, "errors": 0, "error_rate": 0.0, "cost_usd": 0.0})
            # toman revenue can only be put next to USD cost when a rate is known
            equiv = None if (revenue_toman and not rate) else usdt + (revenue_toman / rate if rate else 0.0)
            windows[name] = {
                "since": starts[name].isoformat(),
                "new_users": None if w.get("new_email_users") is None and w.get("new_phone_users") is None
                else (w.get("new_email_users") or 0) + (w.get("new_phone_users") or 0),
                "new_email_users": w.get("new_email_users"), "new_phone_users": w.get("new_phone_users"),
                "active_users": w.get("active_users"),
                "questions_by_plan": _by_level(w.get("questions_by_plan_type")),
                "paid_orders": sum(v["orders"] for v in paid.values()) if w.get("paid") is not None else None,
                "paid_by_method": {m: v["orders"] for m, v in paid.items()},
                "revenue_toman": revenue_toman, "revenue_usdt": round(usdt, 6),
                "revenue_usd_equiv": None if equiv is None else round(equiv, 2),
                "orders_by_status": w.get("orders_by_status"),
                "llm_calls": c["calls"], "llm_errors": c["errors"], "error_rate": c["error_rate"],
                "llm_cost_usd": c["cost_usd"],
                "margin_usd": None if equiv is None else round(equiv - c["cost_usd"], 2),
            }
        subs = db.get("subscriptions")
        return {"status": "ok", "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "usd_toman_rate": rate,
                "windows": windows, "subscriptions_by_level": _by_level(subs), "subscriptions_by_plan": subs,
                "pending_activation": db.get("pending_activation"), "umami": umami,
                "cost_log": {"path_ok": hostdata.cost_log_path().is_file()}, "errors": db.get("errors", [])}

    # ---- 2. users ------------------------------------------------------
    @router.get("/users/lookup")
    async def user_lookup(q: str = Query(min_length=4, max_length=254), _: AdminCtx = Depends(read_gate)) -> dict:
        q = q.strip()
        if "@" in q:
            ref_row = await run(store.email_user_ref, q.lower())
            if not ref_row:
                raise _http(404, "حساب ایمیلی با این نشانی پیدا نشد.", "NOT_FOUND")
            identity, kind, hint = ref_row, "email", q.lower()[:3] + "***" + q[q.index("@"):]
        else:
            phone = normalize_phone(q)
            if not is_valid_phone(phone):
                raise _http(400, "شماره همراه یا ایمیل معتبر وارد کنید.", "BAD_QUERY")
            identity, kind, hint = phone, "phone", mask_phone(phone)
        user_ref = hashed_user_ref(identity)
        ent, orders, audits = await asyncio.gather(
            run(store.get_entitlement, user_ref), run(store.orders_for_user, user_ref, 5),
            run(store.list_audit, 5, user_ref))
        usage = {lvl: _peek(f"rl:chat-day:{lvl}:{identity}") for lvl in ("free", "basic", "pro", "premium", "team", "vip")}
        limits = {"free": chat_auth.chat_free_daily_limit(), "basic": chat_auth.chat_basic_daily_limit(),
                  "pro": chat_auth.chat_pro_daily_limit(), "premium": chat_auth.chat_premium_daily_limit(),
                  "team": chat_auth.chat_team_daily_limit(),
                  "vip": chat_auth.chat_vip_daily_limit()}
        used = {lvl: n for lvl, n in usage.items() if n}
        return {"status": "ok", "kind": kind, "identity_hint": hint, "user_ref": user_ref, "entitlement": ent,
                "level": _level_of(ent["plan_type"]) if ent and ent.get("active") else "free",
                "usage_today": {"used_by_level": used, "limits": limits,
                                "top_model_used": {lvl: _peek(f"rl:top-day:{lvl}:{identity}") for lvl in ("pro", "premium", "team")}},
                "recent_orders": orders, "recent_audit": audits, "grantable_plans": allowed_grant_plans()}

    @router.post("/users/entitlement")
    async def user_entitlement(body: EntitlementBody, ctx: AdminCtx = Depends(write_gate)) -> dict:
        result = await run(store.apply_entitlement, user_ref=body.user_ref, action=body.action,
                           plan_type=body.plan_type, days=body.days, reason=body.reason, actor=ctx.actor)
        changed()  # drop the 60 s tier cache so the user sees the new plan at once
        return {"status": "ok", **result}

    @router.get("/audit")
    async def audit_log(limit: int = Query(default=50, ge=1, le=200), _: AdminCtx = Depends(read_gate)) -> dict:
        return {"status": "ok", "audit": await run(store.list_audit, limit)}

    # ---- 3. payments ---------------------------------------------------
    @router.get("/payments")
    async def payments(method: Literal["zibal", "usdt_trc20"] | None = None,
                       status: Literal["pending", "paid", "failed", "expired"] | None = None,
                       limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0, le=100000),
                       _: AdminCtx = Depends(read_gate)) -> dict:
        data = await run(store.list_orders, method=method, status=status, limit=limit, offset=offset)
        for row in data["orders"]:
            row["phone"] = mask_phone(row["phone"]) if row.get("phone") else None
            row["amount_toman"] = int(row["amount_rial"] or 0) // 10
        return {"status": "ok", **data}

    @router.get("/payments/unmatched")
    async def payments_unmatched(_: AdminCtx = Depends(read_gate)) -> dict:
        data = await run(store.list_unmatched)
        for row in data["unmatched"]:
            row["amount_usdt"] = crypto_payment_service.format_micro(int(row["value_micro"]))
        return {"status": "ok", **data}

    @router.post("/payments/match-crypto")
    async def match_crypto(body: MatchCryptoBody, ctx: AdminCtx = Depends(heavy_gate)) -> dict:
        result = await run(_match_crypto, body, ctx.actor)
        changed()
        return {"status": "ok", **result}

    def _match_crypto(body: MatchCryptoBody, actor: str) -> dict:
        address = crypto_payment_service.receiving_address()
        if address is None:
            raise StoreError(503, "آدرس دریافت تتر پیکربندی نشده است.", "CRYPTO_DISABLED")
        order = store.get_order(body.track_id)
        if not order or order.get("method") != crypto_payment_service.METHOD:
            raise StoreError(404, "سفارش تتر با این شناسه یافت نشد.", "ORDER_NOT_FOUND")
        if order["status"] not in ("pending", "expired"):
            raise StoreError(409, "فقط سفارش در انتظار یا منقضی قابل تطبیق است.", "BAD_ORDER_STATUS")
        if order.get("address") != address:
            raise StoreError(409, "آدرس سفارش با آدرس دریافت فعلی یکی نیست.", "ADDRESS_MISMATCH")
        if not order.get("user_ref"):
            raise StoreError(409, "سفارش کاربر مالک ندارد و فعال‌سازی ممکن نیست.", "NO_OWNER")
        tx = store.get_unmatched(body.tx_hash)
        if not tx or tx.get("resolved"):
            raise StoreError(404, "تراکنش تطبیق‌نشدهٔ باز با این هش وجود ندارد.", "TX_NOT_FOUND")
        want = crypto_payment_service.to_micro(order["amount_usdt"])
        if int(tx["value_micro"]) != want:
            raise StoreError(409, "مبلغ تراکنش با مبلغ سفارش دقیقاً برابر نیست.", "AMOUNT_MISMATCH")
        block_ts = dt.datetime.fromisoformat(str(tx["block_ts"]))
        created = order["created_at"]
        created_dt = dt.datetime.fromisoformat(created) if isinstance(created, str) else created
        if block_ts < created_dt:
            raise StoreError(409, "این تراکنش قبل از ایجاد سفارش انجام شده است.", "TX_BEFORE_ORDER")
        # re-validate against the chain itself: right contract, our address, same amount
        try:
            transfers = do_fetch(address, int(block_ts.timestamp() * 1000) - 60_000)
        except Exception as exc:  # noqa: BLE001
            raise StoreError(502, "بررسی بلاکچین (TronGrid) ناموفق بود؛ بعداً دوباره تلاش کنید.", "CHAIN_UNREACHABLE") from exc
        on_chain = next((t for t in transfers if str(t.get("transaction_id")) == body.tx_hash), None)
        fields = crypto_payment_service._tx_fields(on_chain) if on_chain else None
        if fields is None or fields[2] != address or fields[3] != want:
            raise StoreError(409, "تراکنش روی بلاکچین با آدرس یا مبلغ سفارش مطابقت ندارد.", "CHAIN_MISMATCH")
        settled = store.settle_crypto_match(
            track_id=body.track_id, tx_hash=body.tx_hash, actor=actor, reason=body.reason,
            detail={"amount_usdt": order["amount_usdt"], "order_status_before": order["status"]})
        _, pending = payment_service.activate_with_retry(order, body.track_id, do_activate)
        if pending:
            try:
                store.write_audit(actor=actor, action="crypto_match_activation_pending", target=body.track_id,
                                  reason="activation failed after match; grant the plan manually",
                                  detail={"user_ref": order["user_ref"], "plan_type": order["plan_type"]})
            except Exception:  # noqa: BLE001
                logger.exception("audit write failed")
        return {**settled, "activated": not pending, "activation_pending": bool(pending)}

    @router.post("/payments/reverify")
    async def reverify(body: ReverifyBody, ctx: AdminCtx = Depends(heavy_gate)) -> dict:
        order = await run(store.get_order, body.track_id)
        if not order:
            raise _http(404, "سفارش یافت نشد.", "ORDER_NOT_FOUND")
        if order.get("method") == crypto_payment_service.METHOD:
            raise _http(400, "سفارش تتر با «تطبیق تراکنش» رسیدگی می‌شود.", "WRONG_METHOD")
        result = await asyncio.to_thread(_reverify, body.track_id)
        if result.get("status") == "PAID":
            changed()
        await audit(ctx, "zibal_reverify", body.track_id, body.reason, {"result": result.get("status")})
        return {"status": "ok", "verify_status": result.get("status"), "message": result.get("message"),
                "activation_pending": bool(result.get("activation_pending"))}

    def _reverify(track_id: str) -> dict:
        if zibal_verify is not None:
            return zibal_verify(track_id)
        conn = payment_orders.get_connection()
        try:
            return payment_service.verify_invoice(
                track_id=track_id, order_store=payment_orders.PgOrderStore(conn),
                zibal_verify_fn=zibal_service.verify_payment, activate_fn=do_activate,
                plans=pricing_service.get_calculated_pricing(), entitlement_fn=zibal_service.lookup_entitlement)
        finally:
            conn.close()

    # ---- 4. models and cost -------------------------------------------
    @router.get("/models")
    async def models(_: AdminCtx = Depends(read_gate)) -> dict:
        return {"status": "ok", **await asyncio.to_thread(_models_view)}

    def _models_view() -> dict:
        groups = hostdata.load_keypool_groups()
        mapping = []
        for label, plan in (("guest/free", "FREE"), ("basic", "basic"), ("pro", "pro"), ("premium", "premium"), ("team", "team"),
                            ("legacy VIP", "VIP")):
            group = llm_gateway.model_for(plan)
            mapping.append({"tier": label, "group": group, "fallback_chain": hostdata.fallback_chain(group, groups)})
        tier_groups = {m["group"] for m in mapping}
        fallback_targets = {g for m in mapping for g in m["fallback_chain"]} - tier_groups
        now = time.time()
        records = hostdata.read_cost_records(hostdata.cost_log_path(), now - 86400)
        return {
            "gateway": {"enabled": llm_gateway.enabled(), "configured": llm_gateway.configured(),
                        "default_group": llm_gateway.model()},
            "tier_mapping": mapping, "config_found": bool(groups),
            "last_hour": hostdata.group_stats(records, now - 3600, fallback_targets),
            "last_24h": hostdata.group_stats(records, now - 86400, fallback_targets),
            "cost_log_found": hostdata.cost_log_path().is_file(),
            "note": "fallback = calls served by a group that only appears as a fallback of a tier group; "
                    "empties = successful calls with 0 completion tokens",
            "bakeoff": hostdata.latest_bakeoff(),
        }

    # ---- 5. research, site check, agent tasks --------------------------
    def _purge_jobs() -> None:
        cutoff = time.time() - JOB_TTL_S
        for jid in [j for j, v in jobs.items() if v["finished"] and v["finished"] < cutoff]:
            jobs.pop(jid, None)

    async def _run_job(job_id: str, body: ResearchBody) -> None:
        job = jobs[job_id]
        job["status"], job["started"] = "running", time.time()
        try:
            job["result"] = await asyncio.wait_for(
                do_research(body.query, body.report_type, body.max_sources), timeout=RESEARCH_TIMEOUT_S)
            job["status"] = "done"
        except TimeoutError:
            job["status"], job["error"] = "error", "پژوهش بیش از ۱۵ دقیقه طول کشید و متوقف شد."
        except Exception as exc:  # noqa: BLE001
            logger.warning("research job failed: %s", type(exc).__name__)
            job["status"], job["error"] = "error", f"سرویس پژوهش پاسخ نداد ({type(exc).__name__})."
        finally:
            job["finished"] = time.time()

    @router.post("/research")
    async def research_start(body: ResearchBody, ctx: AdminCtx = Depends(heavy_gate)) -> dict:
        if PRIVATE_DATA_RE.search(body.query):
            raise _http(400, "پژوهش فقط برای پرسش‌های عمومی است؛ شماره تلفن یا کد ملی وارد نکنید.", "PRIVATE_DATA")
        _purge_jobs()
        if sum(1 for j in jobs.values() if j["status"] in ("queued", "running")) >= RESEARCH_MAX_RUNNING:
            raise _http(429, "دو پژوهش در حال اجراست؛ پس از پایان یکی دوباره تلاش کنید.", "BUSY", {"Retry-After": "60"})
        if len(jobs) >= MAX_JOBS:
            raise _http(429, "تعداد پژوهش‌های اخیر زیاد است؛ کمی بعد تلاش کنید.", "TOO_MANY_JOBS", {"Retry-After": "120"})
        job_id = secrets.token_urlsafe(9)
        jobs[job_id] = {"status": "queued", "actor": ctx.actor, "created": time.time(), "started": None,
                        "finished": None, "query": body.query, "report_type": body.report_type,
                        "result": None, "error": None}
        task = asyncio.create_task(_run_job(job_id, body))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        await audit(ctx, "research_start", job_id, body.query[:200])
        return {"status": "ok", "job_id": job_id}

    @router.get("/research/{job_id}")
    async def research_status(job_id: str, ctx: AdminCtx = Depends(read_gate)) -> dict:
        job = jobs.get(job_id) if re.fullmatch(r"[A-Za-z0-9_-]{6,24}", job_id) else None
        if job is None or job["actor"] != ctx.actor:
            raise _http(404, "این پژوهش پیدا نشد (ممکن است منقضی شده باشد).", "NOT_FOUND")
        end = job["finished"] or time.time()
        started = job["started"] or job["created"]
        return {"status": "ok", "job_id": job_id, "state": job["status"], "elapsed_s": int(end - started),
                "timeout_s": RESEARCH_TIMEOUT_S, "query": job["query"], "error": job["error"],
                "stage": {"queued": "در صف", "running": "جست‌وجو، خواندن منابع و نگارش گزارش (بدون گزارش مرحله‌ای از سرویس)",
                          "done": "پایان", "error": "خطا"}[job["status"]],
                "result": job["result"] if job["status"] == "done" else None}

    @router.post("/site-check")
    async def site_check(body: SiteCheckBody, ctx: AdminCtx = Depends(heavy_gate)) -> dict:
        try:
            result = await asyncio.to_thread(do_site, body.url)
        except admin_site_check.SiteCheckError as exc:
            raise _http(400, str(exc), "SITE_CHECK_REFUSED") from exc
        await audit(ctx, "site_check", result.get("requested", body.url)[:128], "site check")
        return {"status": "ok", "report": result}  # nested: the report has its own HTTP "status" field

    @router.post("/agents/tasks")
    async def queue_agent_task(body: TaskBody, ctx: AdminCtx = Depends(heavy_gate)) -> dict:
        try:
            task_id = await asyncio.to_thread(
                do_queue, slug=body.slug, task=body.task, scopes=body.scopes, ladder=list(body.ladder),
                public=body.public, priority=body.priority, actor=ctx.actor)
        except RuntimeError as exc:
            raise _http(502, str(exc)[:300], "QUEUE_FAILED") from exc
        await audit(ctx, "agent_task_queue", f"task:{task_id}", f"slug={body.slug}",
                    {"ladder": body.ladder, "scopes": body.scopes, "public": body.public})
        return {"status": "ok", "task_id": task_id}

    @router.get("/agents/tasks")
    async def agent_tasks(_: AdminCtx = Depends(read_gate)) -> dict:
        return {"status": "ok", **await asyncio.to_thread(hostdata.recent_tasks)}

    # ---- 6. marketing --------------------------------------------------
    @router.get("/marketing")
    async def marketing(_: AdminCtx = Depends(read_gate)) -> dict:
        return {"status": "ok", **await asyncio.to_thread(hostdata.marketing_overview)}

    @router.post("/marketing/decision")
    async def marketing_decision(body: MarketingDecisionBody, ctx: AdminCtx = Depends(write_gate)) -> dict:
        try:
            ok, info = await asyncio.to_thread(hostdata.marketing_decide, body.post_id, body.decision == "approve")
        except RuntimeError as exc:
            raise _http(503, str(exc), "MARKETING_UNAVAILABLE") from exc
        if not ok:
            raise _http(409, f"تغییر وضعیت انجام نشد: {info}", "TRANSITION_REFUSED")
        await audit(ctx, f"mkt_{body.decision}", f"post:{body.post_id}", body.reason or body.decision)
        return {"status": "ok", "post_id": body.post_id, "result": info}

    # ---- 7. system health ----------------------------------------------
    @router.get("/health")
    async def health(_: AdminCtx = Depends(read_gate)) -> dict:
        cont, disk, deploy, host = await asyncio.gather(
            asyncio.to_thread(hostdata.containers), asyncio.to_thread(hostdata.disk_usage),
            asyncio.to_thread(hostdata.last_deploy), asyncio.to_thread(hostdata.host_status))
        return {"status": "ok", "containers": cont, "disk": disk, "last_deploy": deploy, "host": host}

    return router


# ------------------------------------------------------------------ dashboard helpers
_cost_cache: dict[str, Any] = {"until": 0.0, "value": None}


def _cost_windows(starts: dict[str, dt.datetime]) -> dict:
    """LLM calls / error rate / cost per window from the key-pool cost log (cached 60 s: the file can be big)."""
    if _cost_cache["until"] > time.time() and _cost_cache["value"] is not None:
        return _cost_cache["value"]
    cutoff = min(s.timestamp() for s in starts.values())
    records = hostdata.read_cost_records(hostdata.cost_log_path(), cutoff)
    value = hostdata.cost_summary(records, {n: s.timestamp() for n, s in starts.items()})
    _cost_cache.update(until=time.time() + 60, value=value)
    return value


def _usd_toman_rate() -> int | None:
    """Toman per USD used only to put toman revenue next to USD cost; None when unknown."""
    env = (os.environ.get("ADMIN_USD_TOMAN_RATE") or "").strip()
    if env.isdigit() and int(env) > 0:
        return int(env)
    try:
        return int(pricing_service.get_usd_toman_rate()["rate_toman"])
    except Exception:  # noqa: BLE001
        return None
