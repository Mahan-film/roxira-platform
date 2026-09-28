"""Unit tests for output_apps/ecosystem_core/src/billing/pricing_service.py
(W22 — fixed Toman pricing, no USD peg).

Pure functions, no network/DB/FastAPI — reads only os.environ. Safe for
`pytest -m "not integration"`.
"""

from __future__ import annotations

from output_apps.ecosystem_core.src.billing import payment_service, pricing_service


def test_defaults_match_owner_decided_prices():
    plans = pricing_service.get_calculated_pricing()

    assert plans["SINGLE_DRAFT"]["price_toman"] == 100_000
    assert plans["VIP_MONTHLY_PRO"]["price_toman"] == 490_000
    assert plans["VOICE_PACK_10MIN"]["price_toman"] == 63_000
    assert plans["DIASPORA_SPECIAL"]["price_toman"] == 1_015_000


def test_price_rial_is_ten_times_price_toman():
    for plan in pricing_service.get_calculated_pricing().values():
        assert plan["price_rial"] == plan["price_toman"] * 10


def test_env_override_wins_over_default(monkeypatch):
    monkeypatch.setenv("PRICE_TOMAN_SINGLE_DRAFT", "150000")

    plans = pricing_service.get_calculated_pricing()

    assert plans["SINGLE_DRAFT"]["price_toman"] == 150_000
    assert plans["SINGLE_DRAFT"]["price_rial"] == 1_500_000
    # Untouched plans keep their code default.
    assert plans["VIP_MONTHLY_PRO"]["price_toman"] == 490_000


def test_env_override_ignores_blank_non_numeric_and_non_positive(monkeypatch):
    monkeypatch.setenv("PRICE_TOMAN_SINGLE_DRAFT", "   ")
    assert pricing_service.get_calculated_pricing()["SINGLE_DRAFT"]["price_toman"] == 100_000

    monkeypatch.setenv("PRICE_TOMAN_SINGLE_DRAFT", "not-a-number")
    assert pricing_service.get_calculated_pricing()["SINGLE_DRAFT"]["price_toman"] == 100_000

    monkeypatch.setenv("PRICE_TOMAN_SINGLE_DRAFT", "0")
    assert pricing_service.get_calculated_pricing()["SINGLE_DRAFT"]["price_toman"] == 100_000

    monkeypatch.setenv("PRICE_TOMAN_SINGLE_DRAFT", "-5000")
    assert pricing_service.get_calculated_pricing()["SINGLE_DRAFT"]["price_toman"] == 100_000


def test_env_plan_price_toman_default_when_unset(monkeypatch):
    monkeypatch.delenv("PRICE_TOMAN_VOICE_PACK_10MIN", raising=False)
    assert pricing_service.env_plan_price_toman("VOICE_PACK_10MIN", 63_000) == 63_000


class _FakeOrderStore:
    def __init__(self):
        self.orders: dict[str, dict] = {}

    def create_pending_order(self, *, track_id, plan_type, amount_rial, phone=None, user_ref=None):
        self.orders[track_id] = {
            "track_id": track_id,
            "plan_type": plan_type,
            "amount_rial": amount_rial,
        }

    def get_order(self, track_id):
        return self.orders.get(track_id)

    def mark_paid(self, track_id, gateway_ref_number):
        return True

    def mark_failed(self, track_id):
        pass


def test_create_invoice_charges_exactly_the_pricing_matrix_amount(monkeypatch):
    """The amount sent to Zibal (rial) must equal the pricing-matrix's
    price_toman x 10 for the requested plan — never a client-supplied
    amount."""
    monkeypatch.setenv("PRICE_TOMAN_SINGLE_DRAFT", "123000")
    plans = pricing_service.get_calculated_pricing()
    assert plans["SINGLE_DRAFT"]["price_rial"] == 1_230_000

    captured: dict = {}

    def fake_zibal_create_fn(**kwargs):
        captured.update(kwargs)
        return {"success": True, "track_id": "T1", "payment_url": "https://gateway.zibal.ir/start/T1"}

    result = payment_service.create_invoice(
        plan_type="SINGLE_DRAFT",
        phone="09121234567",
        user_ref=None,
        plans=plans,
        order_store=_FakeOrderStore(),
        zibal_create_fn=fake_zibal_create_fn,
        order_id_fn=lambda: "ORDER1",
    )

    assert result["status"] == "SUCCESS"
    assert result["amount_rial"] == plans["SINGLE_DRAFT"]["price_toman"] * 10
    assert captured["amount_rials"] == plans["SINGLE_DRAFT"]["price_toman"] * 10
