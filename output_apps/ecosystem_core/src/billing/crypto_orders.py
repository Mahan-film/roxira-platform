#!/usr/bin/env python3
"""Postgres persistence for crypto (USDT TRC20) orders — same ``payment_orders``
table as Zibal (see payment_orders.py), plus nullable columns added lazily.

The ALTER/CREATE statements run ONLY from get_connection() here, which is only
reachable when CRYPTO_PAY_ENABLED=1: with the flag off the schema is untouched.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg

from . import payment_orders

_CRYPTO_SCHEMA_READY = False
_COL_NAMES = (
    "track_id", "plan_type", "amount_rial", "status", "phone", "user_ref", "gateway_ref_number",
    "method", "amount_usdt", "address", "created_at", "expires_at", "tx_hash",
)
_COLS = ", ".join(_COL_NAMES)


def ensure_crypto_schema(conn: Any) -> None:
    with conn.cursor() as cur:
        for ddl in (
            "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS method VARCHAR(16);",
            "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS amount_usdt VARCHAR(32);",
            "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS address VARCHAR(64);",
            "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;",
            "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(80);",
            # a tx pays at most one order
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_tx_hash "
            "ON payment_orders(tx_hash) WHERE tx_hash IS NOT NULL;",
            # exact-amount matching needs the amount unique among OPEN invoices
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_open_usdt_amount "
            "ON payment_orders(address, amount_usdt) "
            "WHERE method = 'usdt_trc20' AND status = 'pending';",
            "CREATE TABLE IF NOT EXISTS crypto_unmatched_tx ("
            " tx_hash VARCHAR(80) PRIMARY KEY, sender VARCHAR(64), value_micro BIGINT NOT NULL,"
            " block_ts TIMESTAMPTZ NOT NULL, reason VARCHAR(32) NOT NULL,"
            " seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved BOOLEAN NOT NULL DEFAULT FALSE);",
        ):
            cur.execute(ddl)


def get_connection() -> Any:
    global _CRYPTO_SCHEMA_READY
    conn = payment_orders.get_connection()
    if not _CRYPTO_SCHEMA_READY:
        ensure_crypto_schema(conn)
        _CRYPTO_SCHEMA_READY = True
    return conn


class PgCryptoOrderStore(payment_orders.PgOrderStore):
    def create_crypto_order(self, order: dict) -> bool:
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO payment_orders (track_id, plan_type, amount_rial, status, "
                    "user_ref, method, amount_usdt, address, created_at, expires_at) "
                    "VALUES (%s,%s,0,'pending',%s,%s,%s,%s,%s,%s);",
                    (order["track_id"], order["plan_type"], order["user_ref"], order["method"],
                     order["amount_usdt"], order["address"], order["created_at"], order["expires_at"]),
                )
            return True
        except psycopg.errors.UniqueViolation:
            return False

    def get_order(self, track_id: str) -> dict | None:
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT {_COLS} FROM payment_orders WHERE track_id = %s;", (track_id,))
            row = cur.fetchone()
        return dict(zip(_COL_NAMES, row, strict=True)) if row else None

    def list_pending(self) -> list[dict]:
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT {_COLS} FROM payment_orders "
                        "WHERE method = 'usdt_trc20' AND status = 'pending';")
            return [dict(zip(_COL_NAMES, r, strict=True)) for r in cur.fetchall()]

    def mark_paid(self, track_id: str, gateway_ref_number: str | None) -> bool:
        """pending -> paid in one UPDATE; tx_hash = gateway_ref_number. A reused tx_hash
        trips the unique index and returns False (never a second activation)."""
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    "UPDATE payment_orders SET status='paid', paid_at=now(), "
                    "gateway_ref_number=%s, tx_hash=%s WHERE track_id=%s "
                    "AND method='usdt_trc20' AND status='pending';",
                    (gateway_ref_number, gateway_ref_number, track_id),
                )
                return cur.rowcount == 1
        except psycopg.errors.UniqueViolation:
            return False

    def tx_used(self, tx_hash: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1 FROM payment_orders WHERE tx_hash = %s;", (tx_hash,))
            return cur.fetchone() is not None

    def flag_unmatched(self, *, tx_hash: str, sender: str, value_micro: int,
                       block_ts: datetime, reason: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO crypto_unmatched_tx (tx_hash, sender, value_micro, block_ts, reason) "
                "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (tx_hash) DO NOTHING;",
                (tx_hash, sender, value_micro, block_ts, reason),
            )

    def sweep_expired(self, before: datetime) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE payment_orders SET status='expired' WHERE method='usdt_trc20' "
                "AND status='pending' AND expires_at < %s;", (before,))
            return cur.rowcount
