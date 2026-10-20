"""Postgres repository for the owner admin console (admin_api.py).

Persistence only: every statement is parameterised and every query that touches the audit table is
filtered by the SERVER-configured tenant (``ADMIN_TENANT``, default ``smartjudge``), never by a value
the client sent. Business rules (who may call, what is valid) live in admin_api.py.

Tables used:
  admin_audit        created here (idempotent, same convention as payment_orders.py): who did what, to whom,
                     why and when. Has a ``tenant`` ownership column.
  user_entitlements  the table the payment flow writes (same DDL as zibal_service._persist_entitlement).
  payment_orders, crypto_unmatched_tx, email_accounts, chat_conversations, chat_messages: read; the first
                     two are also updated by the crypto match action.

Every read path degrades per query: a missing table or column yields ``None`` plus a note in ``errors``,
so one absent table never blanks the whole console.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from collections.abc import Callable
from typing import Any

import psycopg

logger = logging.getLogger("admin_store")

DEFAULT_TENANT = "smartjudge"
_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")

# same pseudonymous id the payment flow uses for user_entitlements.user_ref / chat rows
_REF_SQL = "substr(encode(sha256(convert_to('smartjudge:' || {col}, 'UTF8')), 'hex'), 1, 16)"

ENTITLEMENT_DDL = """
CREATE TABLE IF NOT EXISTS user_entitlements (
    user_ref VARCHAR(128) PRIMARY KEY,
    plan_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

AUDIT_DDL = """
CREATE TABLE IF NOT EXISTS admin_audit (
    id BIGSERIAL PRIMARY KEY,
    tenant VARCHAR(32) NOT NULL DEFAULT 'smartjudge',
    actor VARCHAR(64) NOT NULL,
    action VARCHAR(48) NOT NULL,
    target VARCHAR(128) NOT NULL,
    reason TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit (ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit (target);
"""

# A paid order is "activation suspect" when it was paid in the last 3 days and its owner has neither an
# active entitlement nor one updated since the payment (a lower-level purchase made while a higher plan
# runs is not written on purpose, which is why an active plan clears the flag). The payment flow does not
# persist an activation_pending flag, so this is a heuristic the owner should confirm in the Users tab.
SUSPECT_SQL = (
    "o.status = 'paid' AND o.paid_at > now() - interval '3 days' AND NOT EXISTS ("
    "SELECT 1 FROM user_entitlements e WHERE e.user_ref = COALESCE(o.user_ref, o.phone) "
    "AND (e.expires_at > now() OR e.updated_at >= o.paid_at - interval '10 minutes'))")


class StoreError(RuntimeError):
    """A business-rule failure the API maps to a 4xx (``status`` = HTTP code, ``message`` = Persian text)."""

    def __init__(self, status: int, message: str, code: str = "ADMIN_ERROR"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, (dt.datetime, dt.date)) else value


def _rows(cur, names: tuple[str, ...]) -> list[dict]:
    return [{k: _iso(v) for k, v in zip(names, row, strict=True)} for row in cur.fetchall()]


class PgAdminStore:
    """All SQL for the admin console. One short-lived autocommit connection per call."""

    def __init__(self, dsn_fn: Callable[[], str], tenant: str = DEFAULT_TENANT):
        self._dsn_fn = dsn_fn
        self.tenant = tenant
        self._ready = False
        self._cols: dict[str, set[str]] = {}

    # ----------------------------------------------------------------- plumbing
    def _conn(self, *, autocommit: bool = True):
        conn = psycopg.connect(self._dsn_fn(), connect_timeout=5, autocommit=autocommit)
        if not self._ready:
            with conn.cursor() as cur:
                cur.execute(AUDIT_DDL)
                cur.execute(ENTITLEMENT_DDL)
            if not autocommit:
                conn.commit()
            self._ready = True
        return conn

    def _columns(self, conn, table: str) -> set[str]:
        if not _IDENT.match(table):
            raise ValueError("bad table name")
        cached = self._cols.get(table)
        if cached:
            return cached
        with conn.cursor() as cur:
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = %s;", (table,))
            cols = {r[0] for r in cur.fetchall()}
        if cols:
            self._cols[table] = cols
        return cols

    @staticmethod
    def _safe(errors: list[str], label: str, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except psycopg.Error as exc:
            errors.append(f"{label}: {type(exc).__name__}")
            return None

    # ---------------------------------------------------------------- dashboard
    def dashboard(self, windows: dict[str, dt.datetime]) -> dict:
        """Per-window user/question/order numbers plus live subscription counts. ``windows`` maps a
        name (today / d7 / d30) to its UTC start."""
        errors: list[str] = []
        out: dict[str, Any] = {"windows": {}, "subscriptions": None, "errors": errors}
        with self._conn() as conn:
            cols = self._columns(conn, "payment_orders")
            has_crypto = {"method", "amount_usdt"} <= cols
            method_expr = "COALESCE(method, 'zibal')" if "method" in cols else "'zibal'"
            usdt_expr = "COALESCE(sum(amount_usdt::numeric), 0)" if "amount_usdt" in cols else "0"
            ref_sql = _REF_SQL.format(col="c.user_phone")

            for name, since in windows.items():
                w: dict[str, Any] = {}

                def one(sql: str, params: tuple, *, cur_conn=conn) -> list:
                    with cur_conn.cursor() as cur:
                        cur.execute(sql, params)
                        return cur.fetchall()

                w["new_email_users"] = self._safe(errors, f"{name}.new_email_users", lambda: int(
                    one("SELECT count(*) FROM email_accounts WHERE created_at >= %s;", (since,))[0][0]))
                w["new_phone_users"] = self._safe(errors, f"{name}.new_phone_users", lambda: int(one(
                    "SELECT count(*) FROM (SELECT user_phone FROM chat_conversations "
                    "WHERE user_phone NOT LIKE 'em\\_%%' GROUP BY user_phone "
                    "HAVING min(created_at) >= %s) t;", (since,))[0][0]))
                w["active_users"] = self._safe(errors, f"{name}.active_users", lambda: int(one(
                    "SELECT count(DISTINCT c.user_phone) FROM chat_messages m "
                    "JOIN chat_conversations c ON c.id = m.conversation_id "
                    "WHERE m.role = 'user' AND m.created_at >= %s;", (since,))[0][0]))
                w["questions_by_plan_type"] = self._safe(errors, f"{name}.questions", lambda: {
                    str(p): int(n) for p, n in one(
                        "SELECT COALESCE(CASE WHEN e.expires_at > now() THEN e.plan_type END, 'FREE'), "
                        "count(*) FROM chat_messages m "
                        "JOIN chat_conversations c ON c.id = m.conversation_id "
                        f"LEFT JOIN user_entitlements e ON e.user_ref = {ref_sql} "
                        "WHERE m.role = 'user' AND m.created_at >= %s GROUP BY 1;", (since,))})
                paid = self._safe(errors, f"{name}.paid_orders", lambda: one(
                    f"SELECT {method_expr}, count(*), COALESCE(sum(amount_rial), 0), {usdt_expr} "
                    "FROM payment_orders WHERE status = 'paid' AND paid_at >= %s GROUP BY 1;", (since,)))
                w["paid"] = {
                    str(m): {"orders": int(n), "amount_rial": int(rial), "amount_usdt": str(usdt)}
                    for m, n, rial, usdt in (paid or [])
                } if paid is not None else None
                w["orders_by_status"] = self._safe(errors, f"{name}.orders_by_status", lambda: {
                    str(s): int(n) for s, n in one(
                        "SELECT status, count(*) FROM payment_orders WHERE created_at >= %s "
                        "GROUP BY 1;", (since,))})
                out["windows"][name] = w

            out["subscriptions"] = self._safe(errors, "subscriptions", lambda: {
                str(p): int(n) for p, n in self._fetch(
                    conn, "SELECT plan_type, count(*) FROM user_entitlements "
                          "WHERE expires_at > now() GROUP BY 1;", ())})
            out["crypto_columns"] = has_crypto
            out["pending_activation"] = self._safe(errors, "pending_activation", lambda: int(
                self._fetch(conn, self._suspect_count_sql(cols), ())[0][0]))
        return out

    @staticmethod
    def _fetch(conn, sql: str, params: tuple) -> list:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    @staticmethod
    def _suspect_count_sql(cols: set[str]) -> str:
        return ("SELECT count(*) FROM payment_orders o WHERE " + SUSPECT_SQL + ";")

    # -------------------------------------------------------------------- users
    def email_user_ref(self, email: str) -> str | None:
        with self._conn() as conn:
            try:
                rows = self._fetch(conn, "SELECT user_ref FROM email_accounts WHERE email = %s;", (email,))
            except psycopg.errors.UndefinedTable:
                return None  # e-mail accounts were never enabled
        return rows[0][0] if rows else None

    def get_entitlement(self, user_ref: str) -> dict | None:
        with self._conn() as conn:
            rows = self._fetch(
                conn, "SELECT plan_type, status, activated_at, expires_at, updated_at, expires_at > now() "
                      "FROM user_entitlements WHERE user_ref = %s;", (user_ref,))
        if not rows:
            return None
        return dict(zip(("plan_type", "status", "activated_at", "expires_at", "updated_at", "active"),
                        (_iso(v) for v in rows[0]), strict=True))

    def orders_for_user(self, user_ref: str, limit: int = 5) -> list[dict]:
        names = ("track_id", "plan_type", "status", "amount_rial", "created_at", "paid_at")
        with self._conn() as conn:
            cols = self._columns(conn, "payment_orders")
            if not cols:
                return []  # no payment ever created
            extra = ", method" if "method" in cols else ""
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT track_id, plan_type, status, amount_rial, created_at, paid_at{extra} "
                    "FROM payment_orders WHERE user_ref = %s OR phone = %s ORDER BY id DESC LIMIT %s;",
                    (user_ref, user_ref, limit))
                return _rows(cur, names + (("method",) if extra else ()))

    def apply_entitlement(self, *, user_ref: str, action: str, plan_type: str | None, days: int | None,
                          reason: str, actor: str, now: dt.datetime | None = None) -> dict:
        """grant / extend / revoke one entitlement and write the audit row in ONE transaction."""
        now = now or dt.datetime.now(dt.timezone.utc)
        with self._conn(autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT plan_type, status, activated_at, expires_at FROM user_entitlements "
                    "WHERE user_ref = %s FOR UPDATE;", (user_ref,))
                row = cur.fetchone()
                before = (None if row is None else
                          {"plan_type": row[0], "status": row[1], "expires_at": _iso(row[3])})
                if action in ("grant", "extend") and not days or action == "grant" and not plan_type:
                    raise StoreError(400, "پلن یا مدت نامعتبر است.", "BAD_ACTION")
                if action == "grant":
                    new = (plan_type, "ADMIN_GRANT", now, now + dt.timedelta(days=days))
                elif action == "extend":
                    if row is None:
                        raise StoreError(404, "برای این کاربر اشتراکی ثبت نشده است؛ از «اعطا» استفاده کنید.",
                                         "NO_ENTITLEMENT")
                    base = row[3] if row[3] > now else now
                    new = (row[0], "ADMIN_EXTEND", row[2], base + dt.timedelta(days=days))
                elif action == "revoke":
                    if row is None or row[3] <= now:
                        raise StoreError(409, "اشتراک فعالی برای لغو وجود ندارد.", "NOTHING_TO_REVOKE")
                    new = (row[0], "ADMIN_REVOKED", row[2], now)
                else:  # pragma: no cover - the API validates the action
                    raise StoreError(400, "عملیات نامعتبر است.", "BAD_ACTION")
                cur.execute(
                    "INSERT INTO user_entitlements (user_ref, plan_type, status, activated_at, expires_at, "
                    "updated_at) VALUES (%s, %s, %s, %s, %s, now()) ON CONFLICT (user_ref) DO UPDATE SET "
                    "plan_type = EXCLUDED.plan_type, status = EXCLUDED.status, "
                    "activated_at = EXCLUDED.activated_at, expires_at = EXCLUDED.expires_at, "
                    "updated_at = now();", (user_ref, *new))
                after = {"plan_type": new[0], "status": new[1], "expires_at": _iso(new[3])}
                self._audit(cur, actor, f"entitlement_{action}", user_ref, reason,
                            {"before": before, "after": after, "days": days})
            conn.commit()
        return {"before": before, "after": after}

    # ----------------------------------------------------------------- payments
    def list_orders(self, *, method: str | None, status: str | None, limit: int, offset: int) -> dict:
        errors: list[str] = []
        with self._conn() as conn:
            cols = self._columns(conn, "payment_orders")
            has_method = "method" in cols
            sel = ["o.track_id", "o.plan_type", "o.amount_rial", "o.status", "o.phone", "o.user_ref",
                   "o.created_at", "o.paid_at", "o.gateway_ref_number",
                   "COALESCE(o.method, 'zibal')" if has_method else "'zibal'",
                   "o.amount_usdt" if "amount_usdt" in cols else "NULL",
                   "o.expires_at" if "expires_at" in cols else "NULL",
                   "o.tx_hash" if "tx_hash" in cols else "NULL",
                   "(" + SUSPECT_SQL + ")"]
            names = ("track_id", "plan_type", "amount_rial", "status", "phone", "user_ref", "created_at",
                     "paid_at", "gateway_ref_number", "method", "amount_usdt", "expires_at", "tx_hash",
                     "activation_suspect")
            where, params = [], []
            if status:
                where.append("o.status = %s")
                params.append(status)
            if method:
                if has_method:
                    where.append("COALESCE(o.method, 'zibal') = %s")
                    params.append(method)
                elif method != "zibal":
                    where.append("FALSE")
            sql = (f"SELECT {', '.join(sel)} FROM payment_orders o "
                   f"{'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY o.id DESC LIMIT %s OFFSET %s;")
            try:
                with conn.cursor() as cur:
                    cur.execute(sql, (*params, limit, offset))
                    rows = _rows(cur, names)
            except psycopg.Error as exc:
                errors.append(f"orders: {type(exc).__name__}")
                rows = []
        return {"orders": rows, "errors": errors}

    def get_order(self, track_id: str) -> dict | None:
        names = ("track_id", "plan_type", "amount_rial", "status", "phone", "user_ref", "method",
                 "amount_usdt", "address", "created_at", "expires_at", "tx_hash")
        with self._conn() as conn:
            cols = self._columns(conn, "payment_orders")
            sel = ", ".join(n if n in cols else "NULL" for n in names)
            with conn.cursor() as cur:
                cur.execute(f"SELECT {sel} FROM payment_orders WHERE track_id = %s;", (track_id,))
                rows = _rows(cur, names)
        return rows[0] if rows else None

    def list_unmatched(self, limit: int = 100) -> dict:
        errors: list[str] = []
        names = ("tx_hash", "sender", "value_micro", "block_ts", "reason", "seen_at")
        rows: list[dict] = []
        with self._conn() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT tx_hash, sender, value_micro, block_ts, reason, seen_at "
                        "FROM crypto_unmatched_tx WHERE NOT resolved ORDER BY seen_at DESC LIMIT %s;", (limit,))
                    rows = _rows(cur, names)
            except psycopg.errors.UndefinedTable:
                errors.append("crypto_unmatched_tx: table not created (crypto checkout never enabled)")
            except psycopg.Error as exc:
                errors.append(f"unmatched: {type(exc).__name__}")
        return {"unmatched": rows, "errors": errors}

    def get_unmatched(self, tx_hash: str) -> dict | None:
        names = ("tx_hash", "sender", "value_micro", "block_ts", "reason", "resolved")
        with self._conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute("SELECT tx_hash, sender, value_micro, block_ts, reason, resolved "
                                "FROM crypto_unmatched_tx WHERE tx_hash = %s;", (tx_hash,))
                except psycopg.errors.UndefinedTable:
                    return None
                rows = _rows(cur, names)
        return rows[0] if rows else None

    def settle_crypto_match(self, *, track_id: str, tx_hash: str, actor: str, reason: str,
                            detail: dict) -> dict:
        """Mark the order paid with this tx, resolve the unmatched row, write the audit row: one
        transaction. A reused tx hash (unique index) or an amount collision aborts everything."""
        with self._conn(autocommit=False) as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT status FROM payment_orders WHERE track_id = %s FOR UPDATE;", (track_id,))
                    row = cur.fetchone()
                    if row is None:
                        raise StoreError(404, "سفارش یافت نشد.", "ORDER_NOT_FOUND")
                    if row[0] == "expired":
                        cur.execute("UPDATE payment_orders SET status = 'pending' "
                                    "WHERE track_id = %s AND status = 'expired';", (track_id,))
                    elif row[0] != "pending":
                        raise StoreError(409, "فقط سفارش در انتظار یا منقضی قابل تطبیق است.", "BAD_ORDER_STATUS")
                    cur.execute(
                        "UPDATE payment_orders SET status = 'paid', paid_at = now(), gateway_ref_number = %s, "
                        "tx_hash = %s WHERE track_id = %s AND method = 'usdt_trc20' AND status = 'pending';",
                        (tx_hash, tx_hash, track_id))
                    if cur.rowcount != 1:
                        raise StoreError(409, "سفارش تتر در انتظار پیدا نشد.", "ORDER_NOT_MATCHABLE")
                    cur.execute("UPDATE crypto_unmatched_tx SET resolved = TRUE WHERE tx_hash = %s;", (tx_hash,))
                    self._audit(cur, actor, "crypto_match", track_id, reason, {**detail, "tx_hash": tx_hash})
                conn.commit()
            except psycopg.errors.UniqueViolation as exc:
                conn.rollback()
                raise StoreError(409, "این تراکنش قبلاً به سفارش دیگری وصل شده یا مبلغ با سفارش باز دیگری "
                                      "تداخل دارد.", "TX_OR_AMOUNT_CONFLICT") from exc
            except StoreError:
                conn.rollback()
                raise
        return {"track_id": track_id, "tx_hash": tx_hash}

    # -------------------------------------------------------------------- audit
    @staticmethod
    def _audit_sql() -> str:
        return ("INSERT INTO admin_audit (tenant, actor, action, target, reason, detail) "
                "VALUES (%s, %s, %s, %s, %s, %s::jsonb);")

    def _audit(self, cur, actor: str, action: str, target: str, reason: str, detail: dict) -> None:
        cur.execute(self._audit_sql(), (self.tenant, actor[:64], action[:48], target[:128], reason,
                                        json.dumps(detail, ensure_ascii=False, default=str)))

    def write_audit(self, *, actor: str, action: str, target: str, reason: str, detail: dict | None = None) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            self._audit(cur, actor, action, target, reason, detail or {})

    def list_audit(self, limit: int = 50, target: str | None = None) -> list[dict]:
        names = ("id", "actor", "action", "target", "reason", "detail", "ts")
        sql = ("SELECT id, actor, action, target, reason, detail, ts FROM admin_audit WHERE tenant = %s "
               + ("AND target = %s " if target else "") + "ORDER BY id DESC LIMIT %s;")
        params: tuple = (self.tenant, target, limit) if target else (self.tenant, limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return _rows(cur, names)
