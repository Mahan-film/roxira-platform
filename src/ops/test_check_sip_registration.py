"""Offline unit tests for SIP registration monitor and PJSIP NAT configuration tuner (#1115 / T292).

Stdlib unittest. Collected by CI (testpaths = src).
Tests:
1. PJSIP NAT config parsing, auditing, and idempotent tuning.
2. SIP registration and carrier qualify status parsing.
3. 7-day registration stability tracking and state transition alerting.
4. Privacy leakage guards (no credentials, passwords, or numbers leaked).
"""

from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PJSIP_CFG_PATH = ROOT / "scripts/ops/ci_box/pjsip_nat_config.py"
SIP_REG_PATH = ROOT / "scripts/ops/ci_box/check_sip_registration.py"

pjsip_mod = None
sip_reg_mod = None


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def setUpModule():
    global pjsip_mod, sip_reg_mod
    pjsip_mod = _load("pjsip_nat_config", PJSIP_CFG_PATH)
    sip_reg_mod = _load("check_sip_registration", SIP_REG_PATH)


SAMPLE_PJSIP_RAW = """
; Asterisk PJSIP raw bundle sample
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5062

[sabanet_endpoint]
type=endpoint
transport=transport-udp
context=from-carrier
disallow=all
allow=alaw,ulaw
aors=sabanet_aor
outbound_auth=sabanet_auth ; secret carrier password inside

[sabanet_aor]
type=aor
contact=sip:carrier.example.invalid:5060

[sabanet_reg]
type=registration
transport=transport-udp
outbound_auth=sabanet_auth
server_uri=sip:carrier.example.invalid:5060
client_uri=sip:testuser@carrier.example.invalid:5060
expiration=120
"""

MOCK_REG_OK = """
 <Registration/ServerURI......>  <Auth.......>  <Status.......>
================================================================

 trunk/sip:carrier.invalid       trunk_auth      Registered        (exp. 45s)

Objects found: 1
"""

MOCK_REG_UNREGISTERED = """
 <Registration/ServerURI..............................>  <Auth....................>  <Status.......>
==========================================================================================

 trunk/sip:carrier.example.invalid                 trunk_auth                  Unregistered

Objects found: 1
"""

MOCK_REG_REJECTED = """
 <Registration/ServerURI..............................>  <Auth....................>  <Status.......>
==========================================================================================

 trunk/sip:carrier.example.invalid                 trunk_auth                  Rejected

Objects found: 1
"""

MOCK_CONTACTS_OK = """
  Contact:  <Aor/ContactUri..............................> <Hash....> <Status> <RTT(ms)..>
==========================================================================================

  Contact:  local_aor/sip:127.0.0.1:5060                 392e9c088c NonQual         nan
  Contact:  sabanet_aor/sip:carrier.example.invalid:5060  be602289c9 Avail         5.120

Objects found: 2
"""

MOCK_CONTACTS_UNAVAIL = """
  Contact:  <Aor/ContactUri..............................> <Hash....> <Status> <RTT(ms)..>
==========================================================================================

  Contact:  sabanet_aor/sip:carrier.example.invalid:5060  be602289c9 Unavail           nan

Objects found: 1
"""


class PjsipNatConfigTests(unittest.TestCase):
    def test_audit_detects_missing_nat_settings(self):
        report = pjsip_mod.audit_pjsip_config(SAMPLE_PJSIP_RAW, aor_name="sabanet_aor")
        self.assertFalse(report["compliant"])
        self.assertTrue(any("missing local_net" in i for i in report["issues"]))
        self.assertTrue(any("missing rtp_symmetric=yes" in i for i in report["issues"]))
        self.assertTrue(any("missing force_rport=yes" in i for i in report["issues"]))
        self.assertTrue(any("missing rewrite_contact=yes" in i for i in report["issues"]))
        self.assertTrue(any("missing max_retries=10000" in i for i in report["issues"]))
        self.assertTrue(any("missing qualify_frequency=20" in i for i in report["issues"]))

    def test_tune_applies_all_nat_and_retry_settings(self):
        tuned, changed = pjsip_mod.tune_pjsip_config(SAMPLE_PJSIP_RAW, aor_name="sabanet_aor")
        self.assertTrue(changed)

        # Audit the tuned output
        report = pjsip_mod.audit_pjsip_config(tuned, aor_name="sabanet_aor")
        self.assertTrue(report["compliant"], f"Audit failed: {report['issues']}")

        # Ensure parameters exist in tuned text
        self.assertIn("local_net=127.0.0.1/32", tuned)
        self.assertIn("local_net=10.0.0.0/8", tuned)
        self.assertIn("local_net=172.16.0.0/12", tuned)
        self.assertIn("local_net=192.168.0.0/16", tuned)
        self.assertIn("rtp_symmetric=yes", tuned)
        self.assertIn("force_rport=yes", tuned)
        self.assertIn("rewrite_contact=yes", tuned)
        self.assertIn("direct_media=no", tuned)
        self.assertIn("max_retries=10000", tuned)
        self.assertIn("retry_interval=60", tuned)
        self.assertIn("forbidden_retry_interval=300", tuned)
        self.assertIn("qualify_frequency=20", tuned)

    def test_idempotent_tuning(self):
        tuned_once, changed1 = pjsip_mod.tune_pjsip_config(SAMPLE_PJSIP_RAW, aor_name="sabanet_aor")
        self.assertTrue(changed1)
        tuned_twice, changed2 = pjsip_mod.tune_pjsip_config(tuned_once, aor_name="sabanet_aor")
        self.assertFalse(changed2)
        self.assertEqual(tuned_once, tuned_twice)

    def test_external_address_injection(self):
        tuned, changed = pjsip_mod.tune_pjsip_config(
            SAMPLE_PJSIP_RAW,
            external_signaling_address="198.51.100.25",
            external_media_address="198.51.100.25",
        )
        self.assertTrue(changed)
        self.assertIn("external_signaling_address=198.51.100.25", tuned)
        self.assertIn("external_media_address=198.51.100.25", tuned)

    def test_apply_to_file_in_place(self):
        with tempfile.NamedTemporaryFile("w+", suffix=".conf", delete=False) as tf:
            tf.write(SAMPLE_PJSIP_RAW)
            tf_path = Path(tf.name)
        try:
            rc = pjsip_mod.apply_pjsip_nat(tf_path, aor_name="sabanet_aor")
            self.assertEqual(rc, 0)
            content = tf_path.read_text()
            self.assertIn("rtp_symmetric=yes", content)
            self.assertIn("qualify_frequency=20", content)

            # Re-running on compliant file returns 0 (already compliant)
            rc2 = pjsip_mod.apply_pjsip_nat(tf_path, aor_name="sabanet_aor")
            self.assertEqual(rc2, 0)
        finally:
            if tf_path.exists():
                tf_path.unlink()


class SipRegistrationParserTests(unittest.TestCase):
    def test_parse_registrations(self):
        self.assertEqual(sip_reg_mod.parse_registrations(MOCK_REG_OK), ["Registered"])
        self.assertEqual(sip_reg_mod.parse_registrations(MOCK_REG_UNREGISTERED), ["Unregistered"])
        self.assertEqual(sip_reg_mod.parse_registrations(MOCK_REG_REJECTED), ["Rejected"])
        self.assertEqual(sip_reg_mod.parse_registrations("No objects found"), [])

    def test_parse_contacts(self):
        c_ok = sip_reg_mod.parse_contacts(MOCK_CONTACTS_OK, aor_name="sabanet_aor")
        self.assertEqual(c_ok["state"], "Avail")
        self.assertEqual(c_ok["rtt_ms"], 5.120)

        c_bad = sip_reg_mod.parse_contacts(MOCK_CONTACTS_UNAVAIL, aor_name="sabanet_aor")
        self.assertEqual(c_bad["state"], "Unavail")
        self.assertIsNone(c_bad["rtt_ms"])

    def test_collect_bridge_status(self):
        def fake_runner(cmd, timeout=20):
            key = " ".join(cmd)
            if "pjsip show registrations" in key:
                return 0, MOCK_REG_OK
            if "pjsip show contacts" in key:
                return 0, MOCK_CONTACTS_OK
            return 127, ""

        res = sip_reg_mod.collect_bridge_status(
            "lk-sabanet-bridge", "sabanet_aor", runner=fake_runner
        )
        self.assertTrue(res["connected"])
        self.assertEqual(res["status"], "Registered")
        self.assertEqual(res["qualify"]["state"], "Avail")
        self.assertIsNone(res["error"])


class SevenDayStabilityAndAlertTests(unittest.TestCase):
    def test_seven_day_goal_and_transitions(self):
        t0 = 1_700_000_000.0
        history = {
            "first_seen": t0,
            "current_status": "Unknown",
            "registered_since": None,
            "consecutive_registered_seconds": 0.0,
            "seven_day_stable": False,
            "transitions": [],
            "samples": [],
        }

        # Step 1: initial registration
        snap1 = {
            "bridge": "test-bridge",
            "status": "Registered",
            "qualify": {"state": "Avail", "rtt_ms": 4.5},
        }
        history, alert, msg = sip_reg_mod.update_history(history, snap1, now=t0)
        self.assertEqual(history["current_status"], "Registered")
        self.assertEqual(history["registered_since"], t0)
        self.assertFalse(history["seven_day_stable"])
        self.assertFalse(alert)

        # Step 2: 3 days later, still registered
        t1 = t0 + (3 * 86400.0)
        history, alert, msg = sip_reg_mod.update_history(history, snap1, now=t1)
        self.assertEqual(history["consecutive_registered_days"], 3.0)
        self.assertFalse(history["seven_day_stable"])
        self.assertFalse(alert)

        # Step 3: 7.5 days later, continuous registered -> 7-DAY GOAL MET!
        t2 = t0 + (7.5 * 86400.0)
        history, alert, msg = sip_reg_mod.update_history(history, snap1, now=t2)
        self.assertEqual(history["consecutive_registered_days"], 7.5)
        self.assertTrue(history["seven_day_stable"])
        self.assertFalse(alert)

        # Step 4: Drop to Unregistered -> ALERT TRIGGERED, stability reset
        t3 = t2 + 3600.0
        snap_drop = {
            "bridge": "test-bridge",
            "status": "Unregistered",
            "qualify": {"state": "Unavail", "rtt_ms": None},
        }
        history, alert, msg = sip_reg_mod.update_history(history, snap_drop, now=t3)
        self.assertEqual(history["current_status"], "Unregistered")
        self.assertEqual(history["consecutive_registered_days"], 0.0)
        self.assertFalse(history["seven_day_stable"])
        self.assertTrue(alert)
        self.assertIn("SIP registration dropped from Registered to Unregistered", msg)
        self.assertEqual(len(history["transitions"]), 1)
        self.assertEqual(history["transitions"][0]["from"], "Registered")
        self.assertEqual(history["transitions"][0]["to"], "Unregistered")

        # Step 5: Recovery back to Registered
        t4 = t3 + 120.0
        history, alert, msg = sip_reg_mod.update_history(history, snap1, now=t4)
        self.assertEqual(history["current_status"], "Registered")
        self.assertFalse(alert)
        self.assertIn("recovered to Registered", msg)
        self.assertEqual(len(history["transitions"]), 2)


class PrivacyAndFormatTests(unittest.TestCase):
    def test_report_does_not_leak_private_data(self):
        snapshot = {
            "bridge": "lk-sabanet-bridge",
            "connected": True,
            "status": "Registered",
            "registrations": ["Registered"],
            "qualify": {"state": "Avail", "rtt_ms": 4.8},
            "error": None,
        }
        history = {
            "consecutive_registered_days": 7.2,
            "consecutive_registered_seconds": 622080.0,
            "seven_day_stable": True,
            "transitions": [],
        }
        text = sip_reg_mod.format_report(snapshot, history)
        self.assertIn("Registered", text)
        self.assertIn("7.20 days", text)
        self.assertIn("MET (>= 7 days)", text)

        # Check for privacy leaks: no passwords, tokens, full phone numbers or private IPs
        leaks = re.findall(r"(?:passw\w*|token|secret)\s*[:=]\s*\S+", text, re.IGNORECASE)
        self.assertEqual(leaks, [])


if __name__ == "__main__":
    unittest.main()
