"""PgAdminStore against a real Postgres. Skipped unless TEST_PG_DSN points at a THROWAWAY database
(it creates the billing/chat tables and writes rows):

    TEST_PG_DSN=postgresql://user@/scratchdb?host=/tmp/sock pytest output_apps/generated_modules/smartjudge/tests/test_admin_store_pg.py
"""
import datetime as dt
import os

import pytest

psycopg = pytest.importorskip("psycopg")
DSN = os.environ.get("TEST_PG_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="TEST_PG_DSN not set (needs a throwaway Postgres)")

from output_apps.ecosystem_core.src.billing import crypto_orders, payment_orders  # noqa: E402
from output_apps.generated_modules.smartjudge import admin_api  # noqa: E402
from output_apps.generated_modules.smartjudge.admin_store import PgAdminStore, StoreError  # noqa: E402

CHAT_DDL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS chat_conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone VARCHAR(20) NOT NULL, title VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS chat_messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE, role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL, metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS email_accounts (user_ref VARCHAR(20) PRIMARY KEY, tenant VARCHAR(32) NOT NULL DEFAULT 'smartjudge',
  email VARCHAR(254) NOT NULL UNIQUE, password_hash TEXT NOT NULL, email_verified_at TIMESTAMPTZ,
  contact_phone VARCHAR(32), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
"""


@pytest.fixture()
def store():
    with psycopg.connect(DSN, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS admin_audit, user_entitlements, crypto_unmatched_tx, payment_orders, "
                    "chat_messages, chat_conversations, email_accounts CASCADE;")
        payment_orders.ensure_schema(conn)
        crypto_orders.ensure_crypto_schema(conn)
        cur.execute(CHAT_DDL)
    return PgAdminStore(lambda: DSN, tenant="smartjudge")


def q(sql, params=()):
    with psycopg.connect(DSN, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def test_grant_extend_revoke_write_audit_in_the_same_transaction(store):
    ref = admin_api.hashed_user_ref("09120000001")
    out = store.apply_entitlement(user_ref=ref, action="grant", plan_type="SJ_PRO_MONTHLY", days=30,
                                  reason="compensation", actor="0912***0009")
    assert out["before"] is None and out["after"]["plan_type"] == "SJ_PRO_MONTHLY"
    ent = store.get_entitlement(ref)
    assert ent["active"] is True and ent["status"] == "ADMIN_GRANT"
    store.apply_entitlement(user_ref=ref, action="extend", plan_type=None, days=10, reason="bonus", actor="0912***0009")
    (days,) = q("SELECT round(extract(epoch FROM (expires_at - activated_at)) / 86400) FROM user_entitlements WHERE user_ref=%s", (ref,))[0]
    assert int(days) == 40
    store.apply_entitlement(user_ref=ref, action="revoke", plan_type=None, days=None, reason="abuse", actor="0912***0009")
    assert store.get_entitlement(ref)["active"] is False
    with pytest.raises(StoreError) as err:
        store.apply_entitlement(user_ref=ref, action="revoke", plan_type=None, days=None, reason="again", actor="x")
    assert err.value.status == 409
    rows = q("SELECT tenant, actor, action, target, reason FROM admin_audit ORDER BY id")
    assert [r[2] for r in rows] == ["entitlement_grant", "entitlement_extend", "entitlement_revoke"]
    assert all(r[0] == "smartjudge" and r[1] == "0912***0009" and r[3] == ref for r in rows)


def test_extend_without_row_changes_nothing(store):
    with pytest.raises(StoreError) as err:
        store.apply_entitlement(user_ref="e" * 16, action="extend", plan_type=None, days=5, reason="why", actor="x")
    assert err.value.status == 404 and q("SELECT count(*) FROM admin_audit")[0][0] == 0


def test_audit_is_filtered_by_server_tenant(store):
    store.write_audit(actor="a", action="x", target="t", reason="r")
    other = PgAdminStore(lambda: DSN, tenant="someone-else")
    assert len(store.list_audit(10)) == 1 and other.list_audit(10) == []


def test_dashboard_orders_listing_and_suspect_flag(store):
    ref = admin_api.hashed_user_ref("09120000001")
    now = dt.datetime.now(dt.timezone.utc)
    q("INSERT INTO payment_orders (track_id, plan_type, amount_rial, status, user_ref, paid_at, gateway_ref_number) "
      "VALUES ('111111','SJ_PRO_MONTHLY',49000000,'paid',%s,now(),'r1')", (ref,))
    q("INSERT INTO payment_orders (track_id, plan_type, amount_rial, status, user_ref, method, amount_usdt, address, "
      "paid_at, created_at, expires_at) VALUES ('USDT_x','SJ_BASIC_MONTHLY',0,'paid',%s,'usdt_trc20','4.001234','TAddr',now(),now(),now())", (ref,))
    q("INSERT INTO chat_conversations (user_phone, title) VALUES ('09120000001','t')")
    q("INSERT INTO chat_messages (conversation_id, role, content) SELECT id,'user','سلام' FROM chat_conversations")
    d = store.dashboard({"today": now - dt.timedelta(days=1)})
    w = d["windows"]["today"]
    assert d["errors"] == [], d["errors"]
    assert w["paid"]["zibal"]["orders"] == 1 and w["paid"]["usdt_trc20"]["amount_usdt"] == "4.001234"
    assert w["active_users"] == 1 and w["new_phone_users"] == 1 and w["questions_by_plan_type"] == {"FREE": 1}
    assert d["pending_activation"] == 2  # both paid orders, no entitlement written yet
    orders = {o["track_id"]: o for o in store.list_orders(method=None, status="paid", limit=10, offset=0)["orders"]}
    assert orders["111111"]["activation_suspect"] is True and orders["USDT_x"]["method"] == "usdt_trc20"
    store.apply_entitlement(user_ref=ref, action="grant", plan_type="SJ_PRO_MONTHLY", days=30, reason="fix it", actor="a")
    assert store.dashboard({"today": now - dt.timedelta(days=1)})["pending_activation"] == 0


def test_crypto_match_is_atomic_and_reuse_safe(store):
    now = dt.datetime.now(dt.timezone.utc)
    q("INSERT INTO payment_orders (track_id, plan_type, amount_rial, status, user_ref, method, amount_usdt, address, created_at, expires_at) "
      "VALUES ('USDT_a','SJ_PRO_MONTHLY',0,'expired','u','usdt_trc20','10.000001','TAddr',%s,%s)", (now, now))
    q("INSERT INTO crypto_unmatched_tx (tx_hash, sender, value_micro, block_ts, reason) VALUES ('tx1','s',10000001,%s,'no_open_invoice')", (now,))
    store.settle_crypto_match(track_id="USDT_a", tx_hash="tx1", actor="a", reason="late", detail={})
    assert q("SELECT status, tx_hash FROM payment_orders WHERE track_id='USDT_a'")[0] == ("paid", "tx1")
    assert q("SELECT resolved FROM crypto_unmatched_tx WHERE tx_hash='tx1'")[0][0] is True
    assert q("SELECT action FROM admin_audit")[0][0] == "crypto_match"
    with pytest.raises(StoreError):  # already paid
        store.settle_crypto_match(track_id="USDT_a", tx_hash="tx1", actor="a", reason="again", detail={})
    q("INSERT INTO payment_orders (track_id, plan_type, amount_rial, status, user_ref, method, amount_usdt, address, created_at, expires_at) "
      "VALUES ('USDT_b','SJ_PRO_MONTHLY',0,'pending','u','usdt_trc20','10.000002','TAddr',%s,%s)", (now, now))
    with pytest.raises(StoreError) as err:  # the same tx can never pay a second order
        store.settle_crypto_match(track_id="USDT_b", tx_hash="tx1", actor="a", reason="reuse", detail={})
    assert err.value.status == 409
    assert q("SELECT status FROM payment_orders WHERE track_id='USDT_b'")[0][0] == "pending"
