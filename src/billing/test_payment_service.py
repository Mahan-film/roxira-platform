"""Unit tests for output_apps/ecosystem_core/src/billing/payment_service.py (W17).

All Zibal HTTP calls are mocked (no network) via the injected callables
zibal_create_fn/zibal_verify_fn — payment_service.py never talks to
gateway.zibal.ir itself, so nothing here needs the network or a real
Postgres connection (order persistence is a FakeOrderStore below). Safe for
`pytest -m "not integration"`.
"""

from __future__ import annotations

import contextlib
import threading

import pytest

from output_apps.ecosystem_core.src.billing import payment_service

PLANS = {
    "SINGLE_DRAFT": {"name": "خرید لایحه تکی", "price_rial": 6_250_000, "price_toman": 625_000},
    "VIP_MONTHLY_PRO": {
        "name": "اشتراک ماهانه VIP", "price_rial": 35_000_000, "price_toman": 3_500_000,
    },
}


class FakeOrderStore:
    def __init__(self):
        self.orders: dict[str, dict] = {}
        self.mark_paid_calls = 0
        self._lock = threading.RLock()

    @contextlib.contextmanager
    def lock(self, track_id: str):
        with self._lock:
            yield

    def create_pending_order(self, *, track_id, plan_type, amount_rial, phone=None, user_ref=None):
        self.orders[track_id] = {
            "track_id": track_id,
            "plan_type": plan_type,
            "amount_rial": amount_rial,
            "status": "pending",
            "phone": phone,
            "user_ref": user_ref,
            "gateway_ref_number": None,
        }

    def get_order(self, track_id) -> dict | None:
        return self.orders.get(track_id)

    def mark_paid(self, track_id, gateway_ref_number) -> bool:
        order = self.orders.get(track_id)
        if not order or order["status"] not in ("pending", "failed"):
            return False
        order["status"] = "paid"
        order["gateway_ref_number"] = gateway_ref_number
        self.mark_paid_calls += 1
        return True

    def mark_failed(self, track_id) -> None:
        order = self.orders.get(track_id)
        if order and order["status"] in ("pending", "failed"):
            order["status"] = "failed"


class RacingOrderStore(FakeOrderStore):
    """Simulates a concurrent verify call winning the race: mark_paid always
    reports False (as if another request already flipped it), but the
    underlying row really is 'paid' by the time we re-read it -- exercises
    the "re-read and only report PAID if genuinely paid" path."""

    def mark_paid(self, track_id, gateway_ref_number) -> bool:
        order = self.orders.get(track_id)
        if order:
            order["status"] = "paid"
            order["gateway_ref_number"] = gateway_ref_number
        return False


# ---------------------------------------------------------------------------
# payments_live_enabled / crypto_payments_enabled: default OFF
# ---------------------------------------------------------------------------


def test_payments_live_default_off(monkeypatch):
    monkeypatch.delenv("PAYMENTS_LIVE", raising=False)
    assert payment_service.payments_live_enabled() is False


def test_payments_live_on_when_flag_true(monkeypatch):
    monkeypatch.setenv("PAYMENTS_LIVE", "true")
    assert payment_service.payments_live_enabled() is True


def test_crypto_payments_default_off(monkeypatch):
    monkeypatch.delenv("PAYMENTS_CRYPTO_ENABLED", raising=False)
    assert payment_service.crypto_payments_enabled() is False


# ---------------------------------------------------------------------------
# normalize_iranian_mobile
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("09123456789", "09123456789"),
        ("+989123456789", "09123456789"),
        ("00989123456789", "09123456789"),
        ("989123456789", "09123456789"),
        (None, None),
        ("", None),
        ("0812345", None),
        ("not-a-phone", None),
    ],
)
def test_normalize_iranian_mobile(raw, expected):
    assert payment_service.normalize_iranian_mobile(raw) == expected


# ---------------------------------------------------------------------------
# create_invoice: price tampering rejected (server-side pricing only)
# ---------------------------------------------------------------------------


def test_create_invoice_uses_server_side_price_never_client_amount():
    store = FakeOrderStore()
    captured = {}

    def fake_zibal_create(**kwargs):
        captured.update(kwargs)
        return {"success": True, "track_id": "TRK-1", "payment_url": "https://gateway.zibal.ir/start/TRK-1"}

    result = payment_service.create_invoice(
        plan_type="SINGLE_DRAFT",
        phone="09123456789",
        user_ref="usr_1",
        plans=PLANS,
        order_store=store,
        zibal_create_fn=fake_zibal_create,
        order_id_fn=lambda: "ORDER-1",
    )

    assert result["status"] == "SUCCESS"
    assert result["amount_rial"] == PLANS["SINGLE_DRAFT"]["price_rial"]
    # amount sent to Zibal is the server price, never anything the caller could inject
    assert captured["amount_rials"] == PLANS["SINGLE_DRAFT"]["price_rial"]
    assert store.orders["TRK-1"]["amount_rial"] == PLANS["SINGLE_DRAFT"]["price_rial"]


def test_create_invoice_rejects_unknown_plan_type_price_tampering():
    store = FakeOrderStore()

    def fake_zibal_create(**kwargs):  # pragma: no cover - must never be called
        raise AssertionError("Zibal must not be called for an unknown/tampered plan_type")

    with pytest.raises(payment_service.PlanNotFoundError):
        payment_service.create_invoice(
            plan_type="FREE_VIP_HACK",
            phone=None,
            user_ref=None,
            plans=PLANS,
            order_store=store,
            zibal_create_fn=fake_zibal_create,
            order_id_fn=lambda: "ORDER-X",
        )


def test_create_invoice_propagates_zibal_failure():
    store = FakeOrderStore()
    result = payment_service.create_invoice(
        plan_type="SINGLE_DRAFT",
        phone=None,
        user_ref="usr_1",
        plans=PLANS,
        order_store=store,
        zibal_create_fn=lambda **kw: {"success": False, "message": "خطای شبکه"},
        order_id_fn=lambda: "ORDER-2",
    )
    assert result["status"] == "FAILED"
    assert store.orders == {}


# ---------------------------------------------------------------------------
# verify_invoice: amount mismatch fails, idempotent, activates only once
# ---------------------------------------------------------------------------


def _seed_pending(
    store: FakeOrderStore, track_id="TRK-1", amount=6_250_000, plan_type="SINGLE_DRAFT"
):
    store.create_pending_order(
        track_id=track_id,
        plan_type=plan_type,
        amount_rial=amount,
        phone="09123456789",
        user_ref="usr_1",
    )


def test_verify_invoice_amount_mismatch_fails_and_does_not_activate():
    store = FakeOrderStore()
    _seed_pending(store, amount=6_250_000)
    activated = []

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 1_000, "ref_number": "REF-1",
        },
        activate_fn=lambda user_ref, plan_type: activated.append((user_ref, plan_type)),
    )

    assert result["status"] == "FAILED"
    assert store.orders["TRK-1"]["status"] == "failed"
    assert activated == []


def test_verify_invoice_success_activates_once():
    store = FakeOrderStore()
    _seed_pending(store, amount=6_250_000)
    activated = []

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 6_250_000, "ref_number": "REF-1",
        },
        activate_fn=lambda user_ref, plan_type: (
            activated.append((user_ref, plan_type)) or {"persisted": True}
        ),
    )

    assert result["status"] == "PAID"
    assert "activation_pending" not in result
    assert store.orders["TRK-1"]["status"] == "paid"
    assert activated == [("usr_1", "SINGLE_DRAFT")]


def test_verify_invoice_is_idempotent_second_call_does_not_reverify_or_reactivate():
    store = FakeOrderStore()
    _seed_pending(store, amount=6_250_000)
    activated = []
    verify_calls = []

    def fake_verify(tid):
        verify_calls.append(tid)
        return {
            "success": True, "paid": True, "definitive": True,
            "amount": 6_250_000, "ref_number": "REF-1",
        }

    def fake_activate(user_ref, plan_type):
        activated.append((user_ref, plan_type))
        return {"persisted": True}

    first = payment_service.verify_invoice(
        track_id="TRK-1", order_store=store, zibal_verify_fn=fake_verify, activate_fn=fake_activate,
    )
    second = payment_service.verify_invoice(
        track_id="TRK-1", order_store=store, zibal_verify_fn=fake_verify, activate_fn=fake_activate,
    )

    assert first["status"] == "PAID"
    assert second["status"] == "PAID"
    assert verify_calls == ["TRK-1"]  # gateway only called once, not on the idempotent replay
    assert activated == [("usr_1", "SINGLE_DRAFT")]  # activated only once
    assert store.mark_paid_calls == 1


def test_verify_invoice_unknown_track_id_fails():
    store = FakeOrderStore()
    result = payment_service.verify_invoice(
        track_id="DOES-NOT-EXIST",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True, "amount": 1, "ref_number": "x",
        },
        activate_fn=lambda *a: None,
    )
    assert result["status"] == "FAILED"


def test_verify_invoice_gateway_rejects_payment():
    store = FakeOrderStore()
    _seed_pending(store)
    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": False, "definitive": True, "message": "لغو شد",
        },
        activate_fn=lambda *a: None,
    )
    assert result["status"] == "FAILED"
    assert store.orders["TRK-1"]["status"] == "failed"


# ---------------------------------------------------------------------------
# verify_invoice: transient/unknown gateway answer never permanently fails
# a paid order (the bug fixed after PR #53's hub review)
# ---------------------------------------------------------------------------


def test_verify_invoice_transient_error_returns_pending_retry_and_leaves_order_pending():
    store = FakeOrderStore()
    _seed_pending(store)
    activated = []

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": False, "paid": False, "definitive": False, "message": "خطای شبکه",
        },
        activate_fn=lambda *a: activated.append(a),
    )

    assert result["status"] == "PENDING_RETRY"
    # order must NOT be marked failed on a transient/ambiguous answer
    assert store.orders["TRK-1"]["status"] == "pending"
    assert activated == []


def test_verify_invoice_failed_then_paid_recovery():
    """An order that was previously (definitively) marked failed must still
    be recoverable to paid by a later, real verify -- e.g. after a manual
    retry finds the payment actually went through."""
    store = FakeOrderStore()
    _seed_pending(store, amount=6_250_000)
    store.orders["TRK-1"]["status"] = "failed"
    activated = []

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 6_250_000, "ref_number": "REF-1",
        },
        activate_fn=lambda user_ref, plan_type: (
            activated.append((user_ref, plan_type)) or {"persisted": True}
        ),
    )

    assert result["status"] == "PAID"
    assert store.orders["TRK-1"]["status"] == "paid"
    assert activated == [("usr_1", "SINGLE_DRAFT")]


def test_verify_invoice_mark_paid_race_reports_paid_when_genuinely_paid():
    """Two concurrent verify calls for the same track_id: this call's
    mark_paid loses the race (returns False) but the order really is paid
    by the time we re-read it -- must report PAID, not FAILED, and must not
    call activate_fn a second time."""
    store = RacingOrderStore()
    _seed_pending(store, amount=6_250_000)
    activated = []

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 6_250_000, "ref_number": "REF-1",
        },
        activate_fn=lambda user_ref, plan_type: activated.append((user_ref, plan_type)),
    )

    assert result["status"] == "PAID"
    assert activated == []  # never activated by this losing call


def test_verify_invoice_mark_paid_race_reports_failed_when_not_actually_paid():
    """mark_paid returns False and a re-read shows the order is still not
    paid (e.g. it is 'failed') -- must never guess PAID."""

    class StubbornFailedStore(FakeOrderStore):
        def mark_paid(self, track_id, gateway_ref_number) -> bool:
            return False

    store = StubbornFailedStore()
    _seed_pending(store, amount=6_250_000)

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 6_250_000, "ref_number": "REF-1",
        },
        activate_fn=lambda *a: None,
    )

    assert result["status"] == "FAILED"


# ---------------------------------------------------------------------------
# create_invoice: missing identifier -> 400 (nothing to activate)
# ---------------------------------------------------------------------------


def test_create_invoice_requires_an_identifier():
    store = FakeOrderStore()

    def fake_zibal_create(**kwargs):  # pragma: no cover - must never be called
        raise AssertionError("Zibal must not be called with no identifier to activate")

    with pytest.raises(payment_service.MissingIdentifierError):
        payment_service.create_invoice(
            plan_type="SINGLE_DRAFT",
            phone=None,
            user_ref=None,
            plans=PLANS,
            order_store=store,
            zibal_create_fn=fake_zibal_create,
            order_id_fn=lambda: "ORDER-Y",
        )
    assert store.orders == {}


def test_create_invoice_accepts_user_ref_without_phone():
    store = FakeOrderStore()
    result = payment_service.create_invoice(
        plan_type="SINGLE_DRAFT",
        phone=None,
        user_ref="hashed-auth-user-1",
        plans=PLANS,
        order_store=store,
        zibal_create_fn=lambda **kw: {
            "success": True, "track_id": "TRK-2", "payment_url": "https://gateway.zibal.ir/start/TRK-2",
        },
        order_id_fn=lambda: "ORDER-3",
    )
    assert result["status"] == "SUCCESS"


def test_create_invoice_accepts_valid_phone_without_user_ref():
    store = FakeOrderStore()
    result = payment_service.create_invoice(
        plan_type="SINGLE_DRAFT",
        phone="09123456789",
        user_ref=None,
        plans=PLANS,
        order_store=store,
        zibal_create_fn=lambda **kw: {
            "success": True, "track_id": "TRK-3", "payment_url": "https://gateway.zibal.ir/start/TRK-3",
        },
        order_id_fn=lambda: "ORDER-4",
    )
    assert result["status"] == "SUCCESS"


# ---------------------------------------------------------------------------
# verify_invoice: entitlement persist failure -> activation_pending, payment
# stays PAID (never rolled back just because the entitlement write failed)
# ---------------------------------------------------------------------------


def test_verify_invoice_activation_persist_failure_sets_activation_pending():
    store = FakeOrderStore()
    _seed_pending(store, amount=6_250_000)

    result = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 6_250_000, "ref_number": "REF-1",
        },
        activate_fn=lambda user_ref, plan_type: {"persisted": False, "persist_error": "db down"},
    )

    assert result["status"] == "PAID"  # payment itself is never undone
    assert result["activation_pending"] is True
    assert store.orders["TRK-1"]["status"] == "paid"


# ---------------------------------------------------------------------------
# Return-page flow: replay safety, retries, result details, Persian messages
# ---------------------------------------------------------------------------

_PAID_OK = {
    "success": True, "paid": True, "definitive": True,
    "amount": 35_000_000, "ref_number": "REF-9",
}


def _verify(store, activate_fn, track_id="TRK-1", verify_res=None, **kw):
    return payment_service.verify_invoice(
        track_id=track_id,
        order_store=store,
        zibal_verify_fn=lambda tid: verify_res or _PAID_OK,
        activate_fn=activate_fn,
        **kw,
    )


def test_same_order_verified_three_times_activates_exactly_once():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    activated = []

    def activate(user_ref, plan_type):
        activated.append((user_ref, plan_type))
        return {"persisted": True, "expires_at": "2030-01-01T00:00:00+00:00"}

    for _ in range(3):
        assert _verify(store, activate)["status"] == "PAID"
    assert len(activated) == 1
    assert store.mark_paid_calls == 1


def test_paid_result_has_plan_name_level_and_stored_expiry():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")

    def ent(ref):
        return {"plan_type": "VIP_MONTHLY_PRO", "expires_at": "2030-02-01T00:00:00+00:00"}

    first = _verify(
        store, lambda u, p: {"persisted": True, "expires_at": "2030-01-01T00:00:00+00:00"},
        plans=PLANS, entitlement_fn=ent,
    )
    replay = _verify(store, lambda u, p: pytest.fail("re-activated"), plans=PLANS, entitlement_fn=ent)

    for res in (first, replay):
        assert res["plan_name"] == "اشتراک ماهانه VIP"
        assert res["plan_level"] == "pro"
        assert res["expires_at"] == "2030-02-01T00:00:00+00:00"  # stored (stacked) value wins


def test_activation_is_retried_when_persist_fails_transiently():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    calls = []

    def flaky(user_ref, plan_type):
        calls.append(1)
        return {"persisted": len(calls) >= 3}

    res = _verify(store, flaky)
    assert res["status"] == "PAID"
    assert "activation_pending" not in res
    assert len(calls) == 3


def test_activate_fn_exception_does_not_lose_the_paid_order():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")

    def boom(user_ref, plan_type):
        raise RuntimeError("db down")

    res = _verify(store, boom)
    assert res["status"] == "PAID"
    assert res["activation_pending"] is True
    assert store.orders["TRK-1"]["status"] == "paid"


def test_failure_messages_are_persian_never_raw_gateway_english():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    res = _verify(store, lambda u, p: None, verify_res={
        "success": True, "paid": False, "definitive": True, "message": "transaction failed",
    })
    assert res["status"] == "FAILED"
    assert "transaction failed" not in res["message"]

    store2 = FakeOrderStore()
    _seed_pending(store2, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    res2 = _verify(store2, lambda u, p: None, verify_res={
        "success": False, "paid": False, "definitive": False, "message": "timed out",
    })
    assert res2["status"] == "PENDING_RETRY"
    assert "timed out" not in res2["message"]


def test_one_off_purchase_is_not_a_subscription_and_has_no_expiry():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="SINGLE_DRAFT")

    def ent(ref):  # the stored one-off row still has a 30-day expires_at
        return {"plan_type": "SINGLE_DRAFT", "expires_at": "2030-02-01T00:00:00+00:00"}

    res = _verify(
        store, lambda u, p: {"persisted": True, "expires_at": "2030-01-01T00:00:00+00:00"},
        plans=PLANS, entitlement_fn=ent,
    )
    assert res["status"] == "PAID"
    assert res["is_subscription"] is False
    assert res["plan_level"] == "free"  # a draft purchase never grants subscription-level chat
    assert "expires_at" not in res


def test_subscription_purchase_is_flagged_subscription():
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    res = _verify(store, lambda u, p: {"persisted": True}, plans=PLANS,
                  entitlement_fn=lambda r: {"plan_type": "VIP_MONTHLY_PRO",
                                            "expires_at": "2030-02-01T00:00:00+00:00"})
    assert res["is_subscription"] is True
    assert res["expires_at"] == "2030-02-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# T18: Replay/Refresh safety, lock serialization, amount audit, duplicate ref
# ---------------------------------------------------------------------------


def test_refresh_or_replay_never_double_credits_or_reactivates():
    """T18: On page refresh / replay, verify_invoice returns already_verified: True,
    replayed: True, PAID status, and never invokes activate_fn a second time."""
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    activated = []
    gateway_calls = []

    def fake_gateway(tid):
        gateway_calls.append(tid)
        return _PAID_OK

    def fake_activate(user_ref, plan_type):
        activated.append((user_ref, plan_type))
        return {"persisted": True, "expires_at": "2030-01-01T00:00:00+00:00"}

    # First call: user returns from gateway
    res1 = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=fake_gateway,
        activate_fn=fake_activate,
        plans=PLANS,
    )
    assert res1["status"] == "PAID"
    assert res1["already_verified"] is False
    assert res1["replayed"] is False
    assert len(activated) == 1
    assert len(gateway_calls) == 1
    assert store.mark_paid_calls == 1

    # Second call: user refreshes the callback page (F5)
    res2 = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=fake_gateway,
        activate_fn=fake_activate,
        plans=PLANS,
    )
    assert res2["status"] == "PAID"
    assert res2["already_verified"] is True
    assert res2["replayed"] is True
    assert len(activated) == 1  # No double credit!
    assert len(gateway_calls) == 1  # Gateway not re-queried!
    assert store.mark_paid_calls == 1

    # Third call: subsequent replay
    res3 = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=fake_gateway,
        activate_fn=fake_activate,
        plans=PLANS,
    )
    assert res3["status"] == "PAID"
    assert res3["already_verified"] is True
    assert res3["replayed"] is True
    assert len(activated) == 1


def test_concurrent_verify_requests_serialize_and_activate_once():
    """T18: Multiple simultaneous requests (e.g. fast double-click or webhook + browser)
    serialize via lock and execute activate_fn exactly once."""
    import concurrent.futures

    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    activated = []

    def fake_activate(user_ref, plan_type):
        import time
        time.sleep(0.01)  # simulate small delay during activation
        activated.append((user_ref, plan_type))
        return {"persisted": True, "expires_at": "2030-01-01T00:00:00+00:00"}

    def do_verify():
        return payment_service.verify_invoice(
            track_id="TRK-1",
            order_store=store,
            zibal_verify_fn=lambda tid: _PAID_OK,
            activate_fn=fake_activate,
            plans=PLANS,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(do_verify) for _ in range(5)]
        results = [f.result() for f in futures]

    assert all(r["status"] == "PAID" for r in results)
    assert len(activated) == 1
    first_time = [r for r in results if not r.get("already_verified")]
    replayed = [r for r in results if r.get("already_verified")]
    assert len(first_time) == 1
    assert len(replayed) == 4


def test_server_side_amount_zero_or_negative_is_rejected():
    """T18: Gateway returning 0 or invalid amount is rejected and marked failed."""
    store = FakeOrderStore()
    _seed_pending(store, amount=35_000_000, plan_type="VIP_MONTHLY_PRO")
    res = payment_service.verify_invoice(
        track_id="TRK-1",
        order_store=store,
        zibal_verify_fn=lambda tid: {
            "success": True, "paid": True, "definitive": True,
            "amount": 0, "ref_number": "REF-0",
        },
        activate_fn=lambda u, p: pytest.fail("should not activate"),
        plans=PLANS,
    )
    assert res["status"] == "FAILED"
    assert "مبلغ" in res["message"]
    assert store.orders["TRK-1"]["status"] == "failed"


def test_unique_gateway_ref_number_integrity_rejection():
    """T18: If gateway_ref_number is replayed across distinct orders, PgOrderStore.mark_paid
    catches IntegrityError and returns False."""
    from unittest.mock import MagicMock
    psycopg = pytest.importorskip("psycopg")

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_cursor.execute.side_effect = psycopg.IntegrityError("unique constraint violation")

    from output_apps.ecosystem_core.src.billing import payment_orders
    pg_store = payment_orders.PgOrderStore(mock_conn)
    result = pg_store.mark_paid("TRK-DUP", "DUPLICATE-REF-999")
    assert result is False
