#!/usr/bin/env python3
"""Postgres persistence for real payment orders (W17).

No migration tool exists for this Python/FastAPI layer (the TypeORM migrations
under output_apps/enterprise_hub/migrations/ are for the separate NestJS app).
The rest of this layer's schema (see output_apps/smart_judge/src/graphrag/
init_graphrag_schema.py) is created the same way: idempotent
``CREATE TABLE IF NOT EXISTS`` run at startup / first use. This module follows
that convention rather than introducing a new migration tool for one table.

``payment_orders`` is the durable record of a Zibal invoice: it is created
pending at invoice time (server-computed amount only) and transitions to
paid/failed at verify time. ``mark_paid`` is the idempotency guard: it only
updates a row that is still 'pending' or 'failed' (never one already 'paid'),
so a repeated verify call (Zibal can call back more than once, and a user can
reload the callback page) never re-activates or double-counts a payment. A
row can be 'failed' and still recoverable to 'paid': a transient verify
error never marks an order failed (see payment_service.verify_invoice's
"definitive" check) — 'failed' only happens on a definitive not-paid answer
or an amount mismatch, and Zibal can still be re-verified successfully later
(e.g. after a manual retry), which is exactly the failed -> paid recovery
this allows.
"""
from __future__ import annotations

import os
from typing import Any

import psycopg

from src.roxira_config import postgres_dsn

_SCHEMA_READY = False


def _dsn() -> str:
    """PgBouncer/Postgres DSN from the environment via the central W2 config.

    ``DATABASE_URL`` wins if set (matches the pattern already used elsewhere
    in this layer, e.g. output_apps/ecosystem_core/src/mcp_server/tenant_tools.py).
    Otherwise build it from POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB via
    src.roxira_config.postgres_dsn, against the in-container Postgres service
    name smartjudge_module.py already uses for POSTGRES_DSN.
    """
    return os.environ.get("DATABASE_URL") or postgres_dsn(
        host=os.environ.get("POSTGRES_HOST", "roxira_postgres_prod"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
    )


def ensure_schema(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS payment_orders (
                id BIGSERIAL PRIMARY KEY,
                track_id VARCHAR(64) NOT NULL UNIQUE,
                plan_type VARCHAR(64) NOT NULL,
                amount_rial BIGINT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                user_ref VARCHAR(128),
                phone VARCHAR(32),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                paid_at TIMESTAMPTZ,
                gateway_ref_number VARCHAR(64)
            );
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_payment_orders_status "
            "ON payment_orders(status);"
        )


def get_connection() -> Any:
    """A ready-to-use connection with the schema guaranteed to exist.

    Schema creation is attempted at most once per process (best effort;
    ``CREATE TABLE IF NOT EXISTS`` is itself idempotent so a race between
    workers is harmless).
    """
    global _SCHEMA_READY
    conn = psycopg.connect(_dsn(), autocommit=True)
    if not _SCHEMA_READY:
        ensure_schema(conn)
        _SCHEMA_READY = True
    return conn


class PgOrderStore:
    """Adapter over a psycopg connection exposing the store protocol that
    output_apps/ecosystem_core/src/billing/payment_service.py expects
    (see PaymentOrderStore there / FakeOrderStore in the tests)."""

    def __init__(self, conn: Any):
        self._conn = conn

    def create_pending_order(
        self,
        *,
        track_id: str,
        plan_type: str,
        amount_rial: int,
        phone: str | None = None,
        user_ref: str | None = None,
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO payment_orders "
                "(track_id, plan_type, amount_rial, status, phone, user_ref) "
                "VALUES (%s, %s, %s, 'pending', %s, %s) "
                "ON CONFLICT (track_id) DO NOTHING;",
                (track_id, plan_type, amount_rial, phone, user_ref),
            )

    def get_order(self, track_id: str) -> dict | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT track_id, plan_type, amount_rial, status, phone, "
                "user_ref, gateway_ref_number FROM payment_orders "
                "WHERE track_id = %s;",
                (track_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        cols = [
            "track_id", "plan_type", "amount_rial", "status", "phone",
            "user_ref", "gateway_ref_number",
        ]
        return dict(zip(cols, row, strict=False))

    def mark_paid(self, track_id: str, gateway_ref_number: str | None) -> bool:
        """Returns True only if THIS call transitioned pending/failed -> paid.
        Atomic single UPDATE: a row already 'paid' never matches the WHERE
        clause, so a race between two verify calls can make at most one of
        them return True."""
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE payment_orders SET status = 'paid', paid_at = now(), "
                "gateway_ref_number = %s WHERE track_id = %s "
                "AND status IN ('pending', 'failed');",
                (gateway_ref_number, track_id),
            )
            return cur.rowcount == 1

    def mark_failed(self, track_id: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE payment_orders SET status = 'failed' "
                "WHERE track_id = %s AND status = 'pending';",
                (track_id,),
            )
