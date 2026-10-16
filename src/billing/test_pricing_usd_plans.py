"""4-tier USD plans: conversion, rounding, rate bounds, 7-day snapshot, legacy keys. Offline."""

from __future__ import annotations

import json
import time

import pytest

from output_apps.ecosystem_core.src.billing import payment_service, pricing_service as ps

NEW_KEYS = [f"SJ_{lv}_{p}" for lv in ("BASIC", "PRO", "PREMIUM") for p in ("MONTHLY", "YEARLY")]


@pytest.fixture
def live(monkeypatch, tmp_path):
    """Rate logic with a fake live source and an isolated snapshot file (no env override)."""
    monkeypatch.delenv("SMARTJUDGE_USD_TOMAN_RATE", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_HOST", raising=False)
    monkeypatch.setenv("SMARTJUDGE_USD_RATE_FILE", str(tmp_path / "rate.json"))
    ps.reset_rate_cache_for_tests()
    calls = {"n": 0, "result": (300_000, "TETHERLAND")}

    def fake():
        calls["n"] += 1
        return calls["result"]

    monkeypatch.setattr(ps, "_fetch_live_rate", fake)
    yield calls
    ps.reset_rate_cache_for_tests()


def test_new_plans_priced_from_usd(monkeypatch):
    plans = ps.get_calculated_pricing()  # conftest pins the rate at 280,000
    assert plans["SJ_BASIC_MONTHLY"]["price_toman"] == 1_120_000
    assert plans["SJ_PRO_MONTHLY"]["price_toman"] == 2_800_000
    assert plans["SJ_PREMIUM_MONTHLY"]["price_toman"] == 8_120_000
    for key in NEW_KEYS:
        p = plans[key]
        assert p["name"] and p["price_rial"] == p["price_toman"] * 10
        assert p["level"] in ("basic", "pro", "premium") and p["usd"] > 0
        assert p["period_days"] == (365 if key.endswith("YEARLY") else 30)


def test_yearly_is_ten_months_and_365_days():
    plans = ps.get_calculated_pricing()
    for lv in ("BASIC", "PRO", "PREMIUM"):
        m, y = plans[f"SJ_{lv}_MONTHLY"], plans[f"SJ_{lv}_YEARLY"]
        assert y["usd"] == m["usd"] * 10
        assert y["period_days"] == 365


def test_rounding_to_nearest_10000():
    assert ps.usd_to_toman(4, 283_000) == 1_130_000  # 1,132,000 -> 1,130,000
    assert ps.usd_to_toman(4, 286_000) == 1_140_000  # 1,144,000 -> 1,140,000
    assert ps.usd_to_toman(10, 284_999) == 2_850_000  # 2,849,990
    assert ps.usd_to_toman(0.0001, 100_000) == 10_000  # floor of 10,000


def test_price_usd_env_override(monkeypatch):
    monkeypatch.setenv("PRICE_USD_SJ_BASIC_MONTHLY", "5")
    assert ps.get_calculated_pricing()["SJ_BASIC_MONTHLY"]["price_toman"] == 1_400_000
    monkeypatch.setenv("PRICE_USD_SJ_BASIC_MONTHLY", "junk")
    assert ps.get_calculated_pricing()["SJ_BASIC_MONTHLY"]["price_toman"] == 1_120_000


def test_price_toman_env_pins_new_plan(monkeypatch):
    monkeypatch.setenv("PRICE_TOMAN_SJ_PRO_MONTHLY", "2500000")
    assert ps.get_calculated_pricing()["SJ_PRO_MONTHLY"]["price_toman"] == 2_500_000


def test_legacy_keys_unchanged():
    plans = ps.get_calculated_pricing()
    assert plans["SINGLE_DRAFT"]["price_toman"] == 100_000
    assert plans["VOICE_PACK_10MIN"]["price_toman"] == 63_000
    assert plans["VIP_MONTHLY_PRO"]["price_toman"] == 490_000
    assert plans["DIASPORA_SPECIAL"]["price_toman"] == 1_015_000


def test_env_rate_override_and_bounds(live, monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_USD_TOMAN_RATE", "400000")
    assert ps.get_usd_toman_rate()["rate_toman"] == 400_000
    assert live["n"] == 0
    for bad in ("99999", "1000001", "abc", "-5"):  # out of bounds -> ignored, live source used
        monkeypatch.setenv("SMARTJUDGE_USD_TOMAN_RATE", bad)
        ps.reset_rate_cache_for_tests()
        assert ps.get_usd_toman_rate()["rate_toman"] == 300_000


def test_live_rate_out_of_bounds_falls_back(live):
    live["result"] = None
    assert ps.get_usd_toman_rate() == {"rate_toman": 280_000, "source": "FALLBACK", "snapshot_ts": None}


def test_fetch_live_rate_rejects_bounds_and_fallback_source(monkeypatch):
    class Engine:
        def __init__(self, info):
            self.info = info

        def get_live_usd_rate(self):
            return self.info

    import output_apps.generated_modules.smartjudge.currency_engine as ce

    monkeypatch.setattr(ce, "currency_engine", Engine({"rate_toman": 85_000, "source": "INITIAL_FALLBACK"}))
    assert ps._fetch_live_rate() is None
    monkeypatch.setattr(ce, "currency_engine", Engine({"rate_toman": 5_000_000, "source": "TETHERLAND"}))
    assert ps._fetch_live_rate() is None
    monkeypatch.setattr(ce, "currency_engine", Engine({"rate_toman": 290_000, "source": "TETHERLAND"}))
    assert ps._fetch_live_rate() == (290_000, "TETHERLAND")


def test_snapshot_taken_once_per_seven_days(live, tmp_path):
    assert ps.get_usd_toman_rate()["rate_toman"] == 300_000
    live["result"] = (350_000, "TETHERLAND")
    assert ps.get_usd_toman_rate()["rate_toman"] == 300_000  # unchanged, no refetch
    assert live["n"] == 1
    # a fresh process (empty memory) reads the file snapshot, still no refetch
    ps.reset_rate_cache_for_tests()
    assert ps.get_usd_toman_rate()["rate_toman"] == 300_000
    assert live["n"] == 1
    # older than 7 days -> refetched
    ps.reset_rate_cache_for_tests()
    f = tmp_path / "rate.json"
    snap = json.loads(f.read_text())
    snap["ts"] = time.time() - ps.RATE_SNAPSHOT_TTL_S - 10
    f.write_text(json.dumps(snap))
    assert ps.get_usd_toman_rate()["rate_toman"] == 350_000
    assert live["n"] == 2


def test_stale_snapshot_used_when_live_fails(live, tmp_path):
    (tmp_path / "rate.json").write_text(json.dumps(
        {"rate": 310_000, "source": "TETHERLAND", "ts": time.time() - ps.RATE_SNAPSHOT_TTL_S - 100}))
    live["result"] = None
    info = ps.get_usd_toman_rate()
    assert info["rate_toman"] == 310_000 and info["source"].endswith("_STALE")


def test_fallback_is_not_persisted(live, tmp_path):
    live["result"] = None
    assert ps.get_usd_toman_rate()["rate_toman"] == 280_000
    assert not (tmp_path / "rate.json").exists()


class _Store:
    def __init__(self):
        self.orders = {}

    def create_pending_order(self, *, track_id, plan_type, amount_rial, phone=None, user_ref=None):
        self.orders[track_id] = {"plan_type": plan_type, "amount_rial": amount_rial}


def test_create_invoice_charges_exactly_the_new_plan_price():
    plans = ps.get_calculated_pricing()
    captured = {}

    def zibal(**kw):
        captured.update(kw)
        return {"success": True, "track_id": "T9", "payment_url": "https://gateway.zibal.ir/start/T9"}

    res = payment_service.create_invoice(
        plan_type="SJ_PRO_YEARLY", phone="09121234567", user_ref=None, plans=plans,
        order_store=_Store(), zibal_create_fn=zibal, order_id_fn=lambda: "O1")
    assert res["status"] == "SUCCESS"
    assert captured["amount_rials"] == plans["SJ_PRO_YEARLY"]["price_toman"] * 10 == res["amount_rial"]


def test_plan_level_derivation():
    assert ps.plan_level("SJ_BASIC_MONTHLY") == "basic"
    assert ps.plan_level("SJ_PRO_YEARLY") == "pro"
    assert ps.plan_level("SJ_PREMIUM_MONTHLY") == "premium"
    for legacy in ("VIP_MONTHLY_PRO", "VIP", "PRO", "PREMIUM", "ENTERPRISE"):
        assert ps.plan_level(legacy) == "pro"
    for one_off in ("SINGLE_DRAFT", "VOICE_PACK_10MIN", "DIASPORA_SPECIAL", "", None):
        assert ps.plan_level(one_off) == "free"
    assert ps.highest_level(["basic", "premium", "pro"]) == "premium"
    assert ps.highest_level([]) == "free"


def test_activation_period(monkeypatch):
    from output_apps.ecosystem_core.src.billing import zibal_service

    monkeypatch.setattr(zibal_service, "_persist_entitlement", lambda **kw: True)
    yearly = zibal_service.activate_user_subscription("u1", "SJ_PRO_YEARLY")
    monthly = zibal_service.activate_user_subscription("u1", "SJ_PRO_MONTHLY")
    legacy = zibal_service.activate_user_subscription("u1", "VIP_MONTHLY_PRO")
    import datetime as dt

    def days(r):
        return round((dt.datetime.fromisoformat(r["expires_at"]) - dt.datetime.fromisoformat(r["activated_at"])).days)

    assert (days(yearly), days(monthly), days(legacy)) == (365, 30, 30)
