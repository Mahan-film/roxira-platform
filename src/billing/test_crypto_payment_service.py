"""Offline unit tests for the optional USDT-TRC20 checkout (crypto_payment_service.py).

No network, no Postgres: a FakeStore stands in for crypto_orders.PgCryptoOrderStore
and the TronGrid fetch is injected.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from output_apps.ecosystem_core.src.billing import crypto_payment_service as cps
from output_apps.ecosystem_core.src.billing import payment_service

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _tron_address(seed: str) -> str:
    payload = b"\x41" + hashlib.sha256(seed.encode()).digest()[:20]
    raw = payload + hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    n = int.from_bytes(raw, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    return out


OUR = _tron_address("ours")
PLANS = {
    "SJ_PRO_MONTHLY": {"name": "pro", "usd": 10.0, "price_rial": 1},
    "SINGLE_DRAFT": {"name": "draft", "price_rial": 1},
}
T0 = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)


class FakeStore:
    def __init__(self):
        self.orders: dict[str, dict] = {}
        self.flagged: list[dict] = []
        self.tx_hashes: set[str] = set()

    def create_crypto_order(self, order):
        if any(o["status"] == "pending" and o["amount_usdt"] == order["amount_usdt"]
               for o in self.orders.values()):
            return False
        self.orders[order["track_id"]] = dict(order)
        return True

    def get_order(self, track_id):
        return self.orders.get(track_id)

    def list_pending(self):
        return [dict(o) for o in self.orders.values() if o["status"] == "pending"]

    def mark_paid(self, track_id, ref):
        o = self.orders.get(track_id)
        if not o or o["status"] != "pending" or ref in self.tx_hashes:
            return False
        o.update(status="paid", tx_hash=ref, gateway_ref_number=ref)
        self.tx_hashes.add(ref)
        return True

    def tx_used(self, tx_hash):
        return tx_hash in self.tx_hashes

    def flag_unmatched(self, **kw):
        self.flagged.append(kw)

    def sweep_expired(self, before):
        n = 0
        for o in self.orders.values():
            if o["status"] == "pending" and o["expires_at"] < before:
                o["status"] = "expired"
                n += 1
        return n


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("CRYPTO_PAY_ENABLED", "1")
    monkeypatch.setenv("CRYPTO_USDT_TRC20_ADDRESS", OUR)


def _tx(value_micro, when, tx_id="tx1", to=None, contract=cps.USDT_TRC20_CONTRACT):
    return {
        "transaction_id": tx_id, "type": "Transfer", "from": _tron_address("buyer"),
        "to": to or OUR, "value": str(value_micro),
        "block_timestamp": int(when.timestamp() * 1000),
        "token_info": {"address": contract, "decimals": 6, "symbol": "USDT"},
    }


class Activations:
    def __init__(self):
        self.calls = []

    def __call__(self, user_ref, plan_type):
        self.calls.append((user_ref, plan_type))
        return {"persisted": True}


def _invoice(store, suffix=5, now=T0):
    return cps.create_crypto_invoice(plan_type="SJ_PRO_MONTHLY", user_ref="u1", plans=PLANS,
                                     store=store, now=now, suffix_fn=lambda: suffix)


def test_contract_and_test_address_are_valid_base58check():
    assert cps.is_valid_tron_address(cps.USDT_TRC20_CONTRACT)
    assert cps.is_valid_tron_address(OUR)
    assert not cps.is_valid_tron_address(cps.USDT_TRC20_CONTRACT[:-1] + "u")
    assert not cps.is_valid_tron_address("")
    assert not cps.is_valid_tron_address(None)


def test_amount_is_usd_base_plus_unique_suffix():
    store = FakeStore()
    a = _invoice(store, suffix=1)
    assert a["amount_usdt"] == "10.000001"
    assert a["seconds_left"] == 3600 and a["address"] == OUR
    # a colliding suffix is skipped, the next candidate is used
    seq = iter([1, 1, 9999])
    b = cps.create_crypto_invoice(plan_type="SJ_PRO_MONTHLY", user_ref="u2", plans=PLANS,
                                  store=store, now=T0, suffix_fn=lambda: next(seq))
    assert b["amount_usdt"] == "10.009999"


def test_random_suffixes_unique_among_open_invoices():
    store = FakeStore()
    amounts = {_invoice_rand(store)["amount_usdt"] for _ in range(60)}
    assert len(amounts) == 60
    assert all("10.000001" <= a <= "10.009999" for a in amounts)


def _invoice_rand(store):
    return cps.create_crypto_invoice(plan_type="SJ_PRO_MONTHLY", user_ref="u", plans=PLANS,
                                     store=store, now=T0)


def test_plan_without_usd_price_and_anonymous_rejected():
    store = FakeStore()
    with pytest.raises(cps.NoUsdPriceError):
        cps.create_crypto_invoice(plan_type="SINGLE_DRAFT", user_ref="u", plans=PLANS, store=store)
    with pytest.raises(payment_service.PlanNotFoundError):
        cps.create_crypto_invoice(plan_type="NOPE", user_ref="u", plans=PLANS, store=store)
    with pytest.raises(payment_service.MissingIdentifierError):
        cps.create_crypto_invoice(plan_type="SJ_PRO_MONTHLY", user_ref=None, plans=PLANS, store=store)


def test_exact_match_activates_once_and_double_poll_is_idempotent():
    store, act = FakeStore(), Activations()
    inv = _invoice(store)
    transfers = [_tx(10_000_005, T0 + timedelta(minutes=10))]
    fetch = lambda *a, **k: transfers  # noqa: E731
    now = T0 + timedelta(minutes=11)
    s1 = cps.poll_once(store=store, activate_fn=act, fetch_fn=fetch, now=now)
    s2 = cps.poll_once(store=store, activate_fn=act, fetch_fn=fetch, now=now)
    assert s1["paid"] == [inv["track_id"]] and s2["paid"] == []
    assert act.calls == [("u1", "SJ_PRO_MONTHLY")]
    assert store.orders[inv["track_id"]]["tx_hash"] == "tx1"


def test_wrong_amounts_are_flagged_not_activated():
    store, act = FakeStore(), Activations()
    _invoice(store)
    when = T0 + timedelta(minutes=5)
    cps.process_transfers([_tx(9_990_000, when, "under"), _tx(10_500_005, when, "over")],
                          store=store, address=OUR, activate_fn=act)
    assert act.calls == []
    assert {f["tx_hash"] for f in store.flagged} == {"under", "over"}
    assert all(f["reason"] == "near_open_invoice" for f in store.flagged)


def test_expired_invoice_ignored_and_late_tx_not_matched():
    store, act = FakeStore(), Activations()
    _invoice(store)
    late = T0 + timedelta(minutes=61)
    cps.process_transfers([_tx(10_000_005, late)], store=store, address=OUR, activate_fn=act)
    assert act.calls == []
    assert store.flagged[0]["reason"] == "no_open_invoice"
    # before creation is also outside the window
    cps.process_transfers([_tx(10_000_005, T0 - timedelta(seconds=1), "early")],
                          store=store, address=OUR, activate_fn=act)
    assert act.calls == []


def test_swept_expired_order_is_never_paid():
    store, act = FakeStore(), Activations()
    inv = _invoice(store)
    store.sweep_expired(T0 + timedelta(hours=2))
    cps.process_transfers([_tx(10_000_005, T0 + timedelta(minutes=1))], store=store,
                          address=OUR, activate_fn=act)
    assert act.calls == [] and store.orders[inv["track_id"]]["status"] == "expired"


def test_tx_reuse_rejected():
    store, act = FakeStore(), Activations()
    _invoice(store, suffix=5)
    cps.create_crypto_invoice(plan_type="SJ_PRO_MONTHLY", user_ref="u2", plans=PLANS,
                              store=store, now=T0, suffix_fn=lambda: 6)
    when = T0 + timedelta(minutes=3)
    cps.process_transfers([_tx(10_000_005, when, "same")], store=store, address=OUR, activate_fn=act)
    # same tx hash replayed with the other invoice's amount: must not pay it
    cps.process_transfers([_tx(10_000_006, when, "same")], store=store, address=OUR, activate_fn=act)
    assert len(act.calls) == 1


def test_wrong_destination_or_contract_ignored():
    store, act = FakeStore(), Activations()
    _invoice(store)
    when = T0 + timedelta(minutes=1)
    fake_token = _tron_address("fake-token")
    s = cps.process_transfers(
        [_tx(10_000_005, when, "a", to=_tron_address("other")),
         _tx(10_000_005, when, "b", contract=fake_token)],
        store=store, address=OUR, activate_fn=act)
    assert act.calls == [] and s["ignored"] == 2


def test_status_polls_and_enforces_owner():
    store, act = FakeStore(), Activations()
    inv = _invoice(store)
    fetch = lambda *a, **k: [_tx(10_000_005, T0 + timedelta(minutes=2))]  # noqa: E731
    now = T0 + timedelta(minutes=3)
    assert cps.get_status(track_id=inv["track_id"], store=store, activate_fn=act,
                          user_ref="intruder", fetch_fn=fetch, now=now) is None
    res = cps.get_status(track_id=inv["track_id"], store=store, activate_fn=act, plans=PLANS,
                         user_ref="u1", fetch_fn=fetch, now=now)
    assert res["status"] == "PAID" and res["plan_type"] == "SJ_PRO_MONTHLY"
    again = cps.get_status(track_id=inv["track_id"], store=store, activate_fn=act, plans=PLANS,
                           user_ref="u1", fetch_fn=fetch, now=now)
    assert again["status"] == "PAID" and len(act.calls) == 1


def test_status_expired_view():
    store, act = FakeStore(), Activations()
    inv = _invoice(store)
    res = cps.get_status(track_id=inv["track_id"], store=store, activate_fn=act, user_ref="u1",
                         fetch_fn=lambda *a, **k: [], now=T0 + timedelta(minutes=61))
    assert res["status"] == "EXPIRED" and res["seconds_left"] == 0


def test_trongrid_request_shape_and_api_key_header():
    seen = {}

    def get(url, headers):
        seen["url"], seen["headers"] = url, headers
        return {"data": [{"x": 1}], "meta": {"links": {"next": "https://evil.example/x"}}}

    out = cps.fetch_trc20_transfers(OUR, 1234, api_key="K", http_get=get)
    assert out == [{"x": 1}]  # off-host pagination link not followed
    assert seen["url"].startswith(f"https://api.trongrid.io/v1/accounts/{OUR}/transactions/trc20?")
    for part in ("only_confirmed=true", f"contract_address={cps.USDT_TRC20_CONTRACT}",
                 "min_timestamp=1234"):
        assert part in seen["url"]
    assert seen["headers"]["TRON-PRO-API-KEY"] == "K"


@pytest.mark.parametrize("flag,addr", [
    ("", OUR), ("0", OUR), ("1", ""), ("1", "T-not-an-address"),
])
def test_disabled_flag_or_bad_address_is_inert(monkeypatch, flag, addr):
    monkeypatch.setenv("CRYPTO_PAY_ENABLED", flag)
    monkeypatch.setenv("CRYPTO_USDT_TRC20_ADDRESS", addr)
    assert cps.crypto_pay_enabled() is False
    store = FakeStore()
    with pytest.raises(cps.CryptoDisabledError):
        cps.create_crypto_invoice(plan_type="SJ_PRO_MONTHLY", user_ref="u", plans=PLANS, store=store)
    with pytest.raises(cps.CryptoDisabledError):
        cps.get_status(track_id="USDT_x", store=store, activate_fn=Activations())
    with pytest.raises(cps.CryptoDisabledError):
        cps.poll_once(store=store, activate_fn=Activations())
    assert store.orders == {}
