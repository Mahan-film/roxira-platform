"""Offline unit tests for phone cost modeling and abuse caps (T298 / R30).

Covers:
- config/phone_pricing.json effective dates and primary-check flags
- 60/60 carrier rounding vs 1/1 per-second increments
- LiveKit Scale plan fee ($500/mo EU pinning) and 10s minimum duration
- check_phone_costs.py CLI and audit_phone_costs engine
- phone_probes.py read_phone_costs and derive_phone_results (monthly cap & 80% alert)
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECK_COSTS_PATH = ROOT / "scripts/ops/ci_box/check_phone_costs.py"
PHONE_PROBES_PATH = ROOT / "scripts/ops/ci_box/status_page/phone_probes.py"
PRICING_PATH = ROOT / "config/phone_pricing.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestPhoneCostModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cpc = _load("check_phone_costs", CHECK_COSTS_PATH)
        cls.pp = _load("phone_probes", PHONE_PROBES_PATH)

    def test_pricing_config_loaded_and_dates_checked(self):
        cfg = self.cpc.load_pricing_config(PRICING_PATH)
        self.assertIn("effective_dates", cfg)
        dt_ok = datetime(2026, 11, 24, tzinfo=UTC)
        dt_past = datetime(2024, 1, 1, tzinfo=UTC)
        dt_future = datetime(2030, 1, 1, tzinfo=UTC)
        self.assertTrue(self.cpc.is_effective(cfg["effective_dates"], dt_ok))
        self.assertFalse(self.cpc.is_effective(cfg["effective_dates"], dt_past))
        self.assertFalse(self.cpc.is_effective(cfg["effective_dates"], dt_future))

    def test_carrier_60_rounding_vs_second_increment(self):
        carrier_60 = {
            "name": "telnyx",
            "billing_increment_seconds": 60,
            "minimum_duration_seconds": 60,
        }
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(0, carrier_60), 0)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(5, carrier_60), 60)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(60, carrier_60), 60)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(61, carrier_60), 120)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(120, carrier_60), 120)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(121, carrier_60), 180)

        carrier_1 = {
            "name": "easybell",
            "billing_increment_seconds": 1,
            "minimum_duration_seconds": 1,
        }
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(0, carrier_1), 0)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(14, carrier_1), 14)
        self.assertEqual(self.cpc.calculate_carrier_billable_seconds(65, carrier_1), 65)

    def test_livekit_scale_floor_10s(self):
        scale_plan = {
            "name": "Scale",
            "monthly_fee_usd_cents": 50000,
            "minimum_duration_seconds": 10,
        }
        self.assertEqual(self.cpc.calculate_livekit_billable_seconds(0, scale_plan), 0)
        self.assertEqual(self.cpc.calculate_livekit_billable_seconds(4, scale_plan), 10)
        self.assertEqual(self.cpc.calculate_livekit_billable_seconds(10, scale_plan), 10)
        self.assertEqual(self.cpc.calculate_livekit_billable_seconds(35, scale_plan), 35)

    def test_call_cost_breakdown(self):
        cfg = self.cpc.load_pricing_config(PRICING_PATH)
        # 65s call with Telnyx and LiveKit Scale
        cost = self.cpc.calculate_call_cost(
            65,
            cfg,
            carrier_key="telnyx",
            plan_key="livekit_cloud_scale",
            enable_observability=True,
        )
        self.assertEqual(cost["duration_seconds"], 65)
        self.assertEqual(cost["carrier_billable_seconds"], 120)  # 60s rounding
        self.assertEqual(cost["livekit_billable_seconds"], 65)
        self.assertGreater(cost["total_cost_cents"], 3.0)

    def test_audit_phone_costs_normal_and_alert_thresholds(self):
        with tempfile.TemporaryDirectory() as td:
            state_file = Path(td) / "state.json"
            now = datetime(2026, 11, 24, 12, 0, 0, tzinfo=UTC)

            # 1. Absent state file
            res_absent = self.cpc.audit_phone_costs(state_file, PRICING_PATH, now=now)
            self.assertEqual(res_absent["state"], "absent")
            self.assertFalse(res_absent["alert_80"])
            self.assertFalse(res_absent["cap_exceeded"])

            # 2. Normal usage: $500 fixed fee + $100 variable = $600 (60% of $1000 cap)
            state_data = {
                "updatedAt": "2026-11-24T12:00:00Z",
                "currentMonth": "2026-11",
                "monthlyFixedFeeCents": 50000,
                "monthlyVariableCents": 10000,
                "monthlyTotalCents": 60000,
                "dailyUsage": {
                    "2026-11-24": {
                        "totalCalls": 10,
                        "totalConnectedSeconds": 1200,
                        "totalCostCents": 300,
                        "callers": {},
                    }
                },
            }
            state_file.write_text(json.dumps(state_data), encoding="utf-8")

            res_normal = self.cpc.audit_phone_costs(state_file, PRICING_PATH, now=now)
            self.assertEqual(res_normal["state"], "ok")
            self.assertEqual(res_normal["spend_cents"], 60000)
            self.assertEqual(res_normal["ratio"], 0.6)
            self.assertFalse(res_normal["alert_80"])
            self.assertFalse(res_normal["cap_exceeded"])

            # 3. 80% Alert threshold: $500 fixed + $320 variable = $820 (82% of $1000 cap)
            state_data["monthlyVariableCents"] = 32000
            state_data["monthlyTotalCents"] = 82000
            state_file.write_text(json.dumps(state_data), encoding="utf-8")

            res_alert = self.cpc.audit_phone_costs(state_file, PRICING_PATH, now=now)
            self.assertTrue(res_alert["alert_80"])
            self.assertFalse(res_alert["cap_exceeded"])

            # 4. 100% Monthly Cap Exceeded: $1050 (105%)
            state_data["monthlyVariableCents"] = 55000
            state_data["monthlyTotalCents"] = 105000
            state_file.write_text(json.dumps(state_data), encoding="utf-8")

            res_capped = self.cpc.audit_phone_costs(state_file, PRICING_PATH, now=now)
            self.assertTrue(res_capped["alert_80"])
            self.assertTrue(res_capped["cap_exceeded"])

    def test_phone_probes_derive_results_with_costs(self):
        with tempfile.TemporaryDirectory() as td:
            state_file = Path(td) / "state.json"
            now_ts = 1800000000.0  # Unix timestamp

            # Under 80% threshold
            state_data = {
                "updatedAt": "2026-11-24T12:00:00Z",
                "currentMonth": "2026-11",
                "monthlyTotalCents": 55000,
                "dailyUsage": {
                    "2027-01-15": {"totalCalls": 5, "totalConnectedSeconds": 600}
                },
            }
            state_file.write_text(json.dumps(state_data), encoding="utf-8")

            costs = self.pp.read_phone_costs(str(state_file), str(PRICING_PATH), now_ts)
            self.assertEqual(costs["state"], "ok")
            self.assertFalse(costs["alert_80"])
            self.assertFalse(costs["cap_exceeded"])

            phone_snap = {
                "containers": {"sip": {"state": "ok"}},
                "costs": costs,
            }
            results = self.pp.derive_phone_results(phone_snap, {}, now_ts)
            self.assertIn("phone:monthly-spend-cap", results)
            self.assertIn("phone:spend-alert-80", results)
            self.assertIn("phone:daily-caps", results)

            # Both cap and 80% alert should be OK (True)
            self.assertTrue(results["phone:monthly-spend-cap"][0])
            self.assertTrue(results["phone:spend-alert-80"][0])
            self.assertTrue(results["phone:daily-caps"][0])

            # Cross 80% threshold
            costs["alert_80"] = True
            costs["ratio"] = 0.85
            results_80 = self.pp.derive_phone_results(phone_snap, {}, now_ts)
            self.assertFalse(results_80["phone:spend-alert-80"][0])
            self.assertTrue(results_80["phone:monthly-spend-cap"][0])

            # Exceed 100% cap
            costs["cap_exceeded"] = True
            costs["ratio"] = 1.05
            results_100 = self.pp.derive_phone_results(phone_snap, {}, now_ts)
            self.assertFalse(results_100["phone:monthly-spend-cap"][0])

    def test_cli_execution(self):
        # Run CLI --simulate-call
        cmd = [sys.executable, str(CHECK_COSTS_PATH), "--simulate-call", "125", "--json"]
        out = subprocess.check_output(cmd, text=True)
        data = json.loads(out)
        self.assertEqual(data["duration_seconds"], 125)
        self.assertIn("total_cost_cents", data)


if __name__ == "__main__":
    unittest.main()
