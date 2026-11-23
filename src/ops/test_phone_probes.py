"""Offline tests for scripts/ops/ci_box/status_page/phone_probes.py (work package G, phone line monitoring).

Stdlib unittest, collected by CI (testpaths = src). Fake command runner, synthetic fixtures, temp dirs; no docker, no
network, no ufw log. Modules are loaded lazily in setUpModule so importing this file has no side effects. Fixture
addresses are built at run time (ip()) so that no address literal lives in git.
"""
import importlib.util
import json
import os
import re
import stat
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "scripts/ops/ci_box/status_page"
pp = bs = ba = mc = None
NOW = 1_800_000_000.0


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def setUpModule():
    global pp, bs, ba, mc
    mc = _load("monitor_common", ROOT / "scripts/ops/monitor/monitor_common.py")
    _load("notify", ROOT / "scripts/ops/notify/notify.py")
    pp = _load("phone_probes", PKG / "phone_probes.py")
    bs = _load("box_status", PKG / "box_status.py")
    ba = _load("box_alert", PKG / "box_alert.py")


def ip(*octets):
    return ".".join(str(o) for o in octets)


def iso(ts):
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))


def leaks(text):
    """Things that must never reach a snapshot, alert text or page: dotted quads, long digit runs, call room names."""
    return re.findall(r"\d+\.\d+\.\d+\.\d+|\d{11,}|call-\S+", text)


REG_OK = """
 <Registration/ServerURI..............................>  <Auth....................>  <Status.......>
==========================================================================================

 trunk/sip:carrier.example.invalid                 trunk_auth                  Registered        (exp. 45s)

Objects found: 1
"""
CONTACTS_OK = """
  Contact:  <Aor/ContactUri..............................> <Hash....> <Status> <RTT(ms)..>
==========================================================================================

  Contact:  local_aor/sip:{lo}:5060                 392e9c088c NonQual         nan
  Contact:  trunk_aor/sip:carrier.example.invalid:5060   be602289c9 Avail         4.991

Objects found: 2
"""


def contacts(status="Avail"):
    return CONTACTS_OK.replace("Avail         4.991", f"{status}         4.991").format(lo=ip(127, 0, 0, 1))


PS = ("alpha-redis\tredis:7-alpha\tUp 3 minutes\n"
      "alpha-server\tlivekit/livekit-server:latest\tUp 3 minutes\n"
      "alpha-sip\tlivekit/sip:latest\tUp 3 minutes\n"
      "alpha-bridge\tvendor/asterisk:alpine\tUp 3 minutes (healthy)\n"
      "unrelated\tnginx:1\tUp 1 hour\n")


def fake_runner(overrides=None, restarts=0, logs="x" * 1000, health="healthy"):
    overrides = overrides or {}

    def run(cmd, timeout=20, env=None):
        key = " ".join(cmd)
        for needle, (rc, out) in overrides.items():
            if needle in key:
                return rc, out
        if cmd[:3] == ["docker", "ps", "-a"]:
            return 0, PS
        if cmd[:2] == ["docker", "inspect"]:
            h = health if cmd[-1] == "alpha-bridge" else "none"
            return 0, f"running|{h}|{restarts}|{iso(NOW - 600)}\n"
        if cmd[0] == "sh" and "docker logs" in cmd[2]:
            return 0, f"{len(logs)}\n"
        if cmd[:2] == ["docker", "exec"] and "pjsip show registrations" in key:
            return 0, REG_OK
        if cmd[:2] == ["docker", "exec"] and "pjsip show contacts" in key:
            return 0, contacts()
        if cmd[:2] == ["docker", "exec"] and "core show channels count" in key:
            return 0, "0 active channels\n0 active calls\n0 calls processed\n"
        if cmd[:2] == ["docker", "exec"] and "core show uptime" in key:
            return 0, "System uptime: 530\n"
        if cmd[:2] == ["docker", "exec"] and "find" in key:
            return 0, "0\n"
        if cmd[0] == "systemctl":
            return 0, ("Id=voice-ai-agent.service\nLoadState=loaded\nActiveState=active\nSubState=running\nNRestarts=0\n"
                       "ActiveEnterTimestamp=Sat 2026-11-21 12:58:49 UTC\nResult=success\n\n"
                       "Id=voice-ai-tts.service\nLoadState=loaded\nActiveState=active\nSubState=running\nNRestarts=0\n"
                       "ActiveEnterTimestamp=Sat 2026-11-21 12:58:49 UTC\nResult=success\n")
        return 127, ""
    return run


def ok_http(url, timeout=4.0):
    return {"state": "ok", "text": "HTTP 200", "ms": 5}


def collect(runner=None, prev=None, env=None, http=ok_http):
    env = {"PHONE_SIGNALS_FILE": "/nonexistent/s.json", "PHONE_VOICE_REPORT": "/nonexistent/v.json", **(env or {})}
    return pp.collect_phone(env, NOW, runner or fake_runner(), prev, http)


class ParserTests(unittest.TestCase):
    def test_roles_by_image_not_by_name(self):
        found = pp.parse_ps(PS)
        self.assertEqual(sorted(found), ["bridge", "redis", "server", "sip"])
        self.assertEqual(pp.role_for_image("livekit/sip:latest"), "sip")
        self.assertEqual(pp.role_for_image("livekit/livekit-server:v1"), "server")
        self.assertIsNone(pp.role_for_image("nginx:1"))

    def test_inspect_and_container_ok(self):
        c = pp.parse_inspect("running|healthy|2|2026-11-21T12:58:49.568452078Z")
        self.assertEqual((c["status"], c["health"], c["restarts"]), ("running", "healthy", 2))
        self.assertTrue(c["started"] > 0)
        self.assertTrue(pp.container_ok(c))
        self.assertFalse(pp.container_ok(pp.parse_inspect("running|unhealthy|0|")))
        self.assertFalse(pp.container_ok(pp.parse_inspect("exited|none|0|")))
        self.assertTrue(pp.container_ok(pp.parse_inspect("running|none|0|")))

    def test_registrations(self):
        self.assertEqual(pp.parse_registrations(REG_OK), ["Registered"])
        self.assertEqual(pp.parse_registrations(REG_OK.replace("Registered", "Rejected")), ["Rejected"])
        self.assertEqual(pp.parse_registrations(REG_OK.replace("Registered", "Unregistered")), ["Unregistered"])
        self.assertEqual(pp.parse_registrations("\nObjects found: 0\n"), [])

    def test_contacts_and_qualify(self):
        self.assertEqual(pp.carrier_qualify(pp.parse_contacts(contacts())), {"state": "Avail", "rtt_ms": 4.991})
        self.assertEqual(pp.carrier_qualify(pp.parse_contacts(contacts("Unavail")))["state"], "Unavail")
        self.assertEqual(pp.carrier_qualify(pp.parse_contacts(contacts("NonQual")))["state"], "NonQual")
        only_local = "  Contact:  local_aor/sip:%s:5060   392e9c088c NonQual   nan\n" % ip(127, 0, 0, 1)
        self.assertEqual(pp.carrier_qualify(pp.parse_contacts(only_local))["state"], "none")

    def test_channels_uptime_show_blocks(self):
        self.assertEqual(pp.parse_channels("2 active channels\n1 active call\n7 calls processed\n"), {"active_calls": 1, "calls_processed": 7})
        self.assertEqual(pp.parse_uptime_seconds("System uptime: 530\nLast reload: 530\n"), 530)
        self.assertIsNone(pp.parse_uptime_seconds("nothing"))
        blocks = pp.parse_show_blocks("Id=a.service\nActiveState=active\nNRestarts=4\n\nId=b.service\nActiveState=failed\n")
        self.assertEqual(pp.unit_info(blocks["a.service"])["restarts"], 4)
        self.assertEqual(pp.unit_info(blocks["b.service"])["active"], "failed")

    def test_percentile(self):
        self.assertIsNone(pp.percentile([], 50))
        self.assertEqual(pp.percentile([5652, 8410, 6022, 10158, 4307, 5980, 4958], 50), 5980.0)
        self.assertEqual(pp.percentile([1, 2, 3, 4], 95), 4.0)


class SignalTests(unittest.TestCase):
    def ufw_line(self, ts, src, dpt, proto="UDP"):
        return (f"{iso(ts)} host kernel: [UFW BLOCK] IN=wlan0 OUT= MAC=aa:bb SRC={src} DST={ip(10, 0, 0, 7)} LEN=1194 "
                f"PROTO={proto} SPT=5060 DPT={dpt}\n")

    def test_ufw_counts_only_sip_ports_from_outside(self):
        pub = ip(11, 22, 33, 44)
        text = "".join([
            self.ufw_line(NOW - 60, pub, 5062), self.ufw_line(NOW - 120, pub, 5062),   # carrier retransmits, last hour
            self.ufw_line(NOW - 7200, pub, 5060),                                      # older than 1 h, inside 24 h
            self.ufw_line(NOW - 60, pub, 3702),                                        # not a SIP port
            self.ufw_line(NOW - 60, ip(192, 168, 1, 9), 5062),                         # LAN source
            self.ufw_line(NOW - 60, ip(127, 0, 0, 1), 5062),                           # loopback
            self.ufw_line(NOW - 90000, pub, 5062),                                     # older than 24 h
            "garbage line\n",
        ])
        r = pp.parse_ufw_blocks(text, NOW)
        self.assertEqual((r["drops_1h"], r["drops_24h"]), (2, 3))
        self.assertEqual(r["last_ts"], NOW - 60)
        self.assertEqual(leaks(json.dumps(r)), [])

    def test_ufw_cidr_filter_and_ports(self):
        a, b = ip(11, 22, 33, 44), ip(12, 22, 33, 44)
        text = self.ufw_line(NOW - 10, a, 5062) + self.ufw_line(NOW - 10, b, 5062) + self.ufw_line(NOW - 10, a, 5080)
        only_a = pp.parse_ufw_blocks(text, NOW, pp.DEFAULT_SIP_PORTS, pp.parse_cidrs(ip(11, 22, 0, 0) + "/16"))
        self.assertEqual(only_a["drops_1h"], 1)
        self.assertEqual(pp.parse_ufw_blocks(text, NOW, (5080,))["drops_1h"], 1)
        self.assertEqual(pp.parse_ports("5060, 5070"), (5060, 5070))
        self.assertEqual(pp.parse_ports(""), pp.DEFAULT_SIP_PORTS)

    def journal(self):
        room = "call-_+" + "9" * 12 + "_abcDEF"
        def l(ts, msg):
            return f"{iso(ts)} host node[1]: {msg}\n"
        return "".join([
            l(NOW - 5000, f"12:00:00.000 [{room}] joined; caller = {room}"),
            l(NOW - 4990, f"12:00:10.000 [{room}] agent: \"secret transcript text\" {{"),
            l(NOW - 4989, "  first_audio_ms: 5652,"),
            l(NOW - 4900, "  first_audio_ms: 8410,"),
            l(NOW - 4800, f"12:03:00.000 [{room}] ended (caller hung up) after 243 s"),
            l(NOW - 100, f"12:30:00.000 [{room}] joined; caller = {room}"),
            l(NOW - 200, "voice-ai-agent.service: Failed with result 'exit-code'."),
            l(NOW - 150, "voice-ai-agent.service: Failed with result 'exit-code'."),
            l(NOW - 9000, "voice-ai-agent.service: Failed with result 'exit-code'."),
            "not a journal line\n",
        ])

    def test_agent_journal_keeps_numbers_only(self):
        r = pp.parse_agent_journal(self.journal(), NOW)
        self.assertEqual((r["calls"], r["ended"]), (2, 1))
        self.assertEqual(r["last_call_start"], NOW - 100)
        self.assertEqual(r["last_call_end"], NOW - 4800)
        self.assertEqual(r["first_audio_ms"], [5652, 8410])
        self.assertEqual(r["crash_starts_1h"], 2)
        dumped = json.dumps(r)
        self.assertEqual(leaks(dumped), [])
        self.assertNotIn("secret", dumped)

    def test_build_and_read_signals(self):
        doc = pp.build_signals("", self.journal(), NOW)
        self.assertEqual(sorted(doc), ["agent", "generated", "ufw", "version"])
        self.assertNotIn("ufw", pp.build_signals(None, self.journal(), NOW))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.json"
            self.assertEqual(pp.read_signals(str(p), NOW)["state"], "absent")
            p.write_text("{not json")
            self.assertEqual(pp.read_signals(str(p), NOW)["state"], "unknown")
            p.write_text(json.dumps(doc))
            self.assertEqual(pp.read_signals(str(p), NOW + 60)["state"], "ok")
            s = pp.read_signals(str(p), NOW + 3600)
            self.assertEqual((s["state"], s["age_s"]), ("stale", 3600))

    def test_run_signals_writes_sanitised_file(self):
        with tempfile.TemporaryDirectory() as d:
            ufw = Path(d) / "ufw.log"
            ufw.write_text(self.ufw_line(NOW - 30, ip(11, 22, 33, 44), 5062))
            out = Path(d) / "phone-signals.json"
            rc = pp.run_signals(out, {}, NOW, runner=lambda cmd, timeout=20: (0, self.journal()), ufw_log=str(ufw))
            self.assertEqual(rc, 0)
            self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o644)
            data = json.loads(out.read_text())
            self.assertEqual(data["ufw"]["drops_1h"], 1)
            self.assertEqual(leaks(out.read_text()), [])
            self.assertFalse(list(Path(d).glob("*.tmp")))
            # unreadable sources are left out, not faked
            rc = pp.run_signals(out, {}, NOW, runner=lambda cmd, timeout=20: (1, ""), ufw_log=str(Path(d) / "missing"))
            self.assertEqual(sorted(json.loads(out.read_text())), ["generated", "version"])

    def test_voice_report_contract(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "latest.json"
            self.assertEqual(pp.read_voice_report(str(p), NOW)["state"], "absent")
            p.write_text(json.dumps({"ts": NOW - 7200, "setup_ms": {"p50": 900, "p95": 1500}, "first_audio_ms": {"p50": 1200, "p95": 2400}}))
            r = pp.read_voice_report(str(p), NOW)
            self.assertEqual((r["state"], r["age_s"], r["first_audio_ms"]["p50"]), ("ok", 7200, 1200.0))
            p.write_text("[]")
            self.assertEqual(pp.read_voice_report(str(p), NOW)["state"], "unknown")


class CollectTests(unittest.TestCase):
    def test_healthy_snapshot_has_no_leaks(self):
        ph = collect()
        self.assertEqual(ph["state"], "ok")
        self.assertEqual(sorted(ph["containers"]), ["bridge", "redis", "server", "sip"])
        self.assertEqual(ph["sip"]["registrations"], ["Registered"])
        self.assertEqual(ph["sip"]["qualify"]["state"], "Avail")
        self.assertEqual(ph["sip"]["recording_files"], 0)
        self.assertEqual(sorted(ph["units"]), ["agent", "tts"])
        self.assertEqual(ph["signals"]["state"], "absent")
        self.assertEqual(ph["voice_test"]["state"], "absent")
        text = json.dumps(ph)
        self.assertEqual(leaks(text), [])
        self.assertNotIn("alpha-", text)   # container names are used for one command, never stored
        self.assertNotIn("invalid", text)  # nor the carrier host

    def test_docker_missing_is_unknown_not_failed(self):
        ph = collect(fake_runner({"docker ps": (127, "")}))
        self.assertEqual(ph["state"], "unknown")
        res = pp.derive_phone_results(ph, {}, NOW, {})
        self.assertFalse([k for k in res if k.startswith(("phone:container", "phone:sip", "phone:restart", "phone:log"))])
        self.assertTrue(res["phone:unit:agent"][0])  # units and loopback health do not depend on docker

    def test_docker_down_with_livekit_unreachable_alerts(self):
        bad = lambda url, timeout=4.0: {"state": "failed", "text": "no answer (URLError)", "ms": None}
        res = pp.derive_phone_results(collect(fake_runner({"docker ps": (1, "")}), http=bad), {}, NOW, {})
        self.assertFalse(res["phone:livekit-http"][0])

    def test_nothing_installed_expects_nothing(self):
        nothing = fake_runner({"docker ps": (0, "unrelated\tnginx:1\tUp 1 hour\n"), "systemctl": (0, "")})
        bad = lambda url, timeout=4.0: {"state": "failed", "text": "no answer (URLError)", "ms": None}
        self.assertEqual(pp.derive_phone_results(collect(nothing, http=bad), {}, NOW, {}), {})

    def test_removed_container_fails_instead_of_vanishing(self):
        three = PS.replace("alpha-bridge\tvendor/asterisk:alpine\tUp 3 minutes (healthy)\n", "")
        ph = collect(fake_runner({"docker ps": (0, three)}))
        self.assertEqual(ph["missing_roles"], ["bridge"])
        res = pp.derive_phone_results(ph, {}, NOW, {})
        self.assertFalse(res["phone:container:bridge"][0])
        self.assertNotIn("phone:sip-registration", res)

    def test_log_growth_estimate(self):
        mb = 1048576
        ph = collect(fake_runner(logs="x" * mb))  # the fake shell reports the byte count of stdout+stderr
        self.assertEqual(ph["containers"]["server"]["log_mb_day"], 24.0)
        self.assertEqual(pp.collect_phone({}, NOW, fake_runner({"docker logs": (1, "")}), None, ok_http)["containers"]["sip"].get("log_mb_day"), None)

    def test_last_call_from_counter_memory(self):
        counted = fake_runner({"core show channels count": (0, "0 active calls\n3 calls processed\n")})
        first = collect(counted, prev={"last_calls_processed": 2, "last_call_ts": NOW - 5000, "last_call_source": "x"})
        self.assertEqual((first["last_call_ts"], first["last_call_source"]), (NOW, "bridge call counter"))
        same = collect(counted, prev={"last_calls_processed": 3, "last_call_ts": NOW - 300, "last_call_source": "bridge call counter"})
        self.assertEqual(same["last_call_ts"], NOW - 300)
        reset = collect(fake_runner(), prev={"last_calls_processed": 9, "last_call_ts": NOW - 300, "last_call_source": "y"})
        self.assertEqual(reset["last_call_ts"], NOW - 300)  # counter went down (bridge restarted): not a new call

    def test_signals_feed_last_call_and_first_audio(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.json"
            p.write_text(json.dumps({"generated": NOW - 60, "agent": {"last_call_start": NOW - 4000, "first_audio_ms": [5000, 6000, 7000]}}))
            ph = collect(env={"PHONE_SIGNALS_FILE": str(p)})
            self.assertEqual((ph["last_call_ts"], ph["last_call_source"]), (NOW - 4000, "agent journal"))
            self.assertEqual((ph["first_audio"]["n"], ph["first_audio"]["p50"]), (3, 6000.0))


class DeriveTests(unittest.TestCase):
    def derive(self, ph, state=None, env=None):
        return pp.derive_phone_results(ph, {} if state is None else state, NOW, env or {})

    def test_healthy_is_all_ok_and_off_by_default_checks_absent(self):
        res = self.derive(collect())
        self.assertTrue(res and all(ok for ok, _ in res.values()), res)
        self.assertNotIn("phone:last-call", res)
        self.assertNotIn("phone:ufw-sip-drops", res)  # signals producer not installed: probe off, no false alarm

    def test_registration_and_qualify_failures(self):
        res = self.derive(collect(fake_runner({"pjsip show registrations": (0, REG_OK.replace("Registered", "Rejected"))})))
        self.assertFalse(res["phone:sip-registration"][0])
        self.assertIn("Rejected", res["phone:sip-registration"][1])
        res = self.derive(collect(fake_runner({"pjsip show contacts": (0, contacts("NonQual"))})))
        self.assertFalse(res["phone:sip-qualify"][0])
        res = self.derive(collect(fake_runner({"pjsip show contacts": (0, contacts("Unavail"))})))
        self.assertFalse(res["phone:sip-qualify"][0])

    def test_asterisk_unreachable_is_unknown(self):
        res = self.derive(collect(fake_runner({"docker exec": (1, "")})))
        self.assertNotIn("phone:sip-registration", res)
        self.assertNotIn("phone:sip-qualify", res)

    def test_container_not_running_or_unhealthy(self):
        res = self.derive(collect(fake_runner(health="unhealthy")))
        self.assertFalse(res["phone:container:bridge"][0])
        down = collect(fake_runner({"docker inspect -f": (0, "exited|none|0|\n")}))
        self.assertFalse(self.derive(down)["phone:container:redis"][0])

    def test_restart_loops_need_a_delta(self):
        st = {}
        self.assertTrue(self.derive(collect(fake_runner(restarts=2)), st)["phone:restart-loop:sip"][0])  # first sight
        self.assertFalse(self.derive(collect(fake_runner(restarts=9)), st)["phone:restart-loop:sip"][0])
        self.assertTrue(self.derive(collect(fake_runner(restarts=9)), st)["phone:restart-loop:sip"][0])
        self.assertTrue(self.derive(collect(fake_runner(restarts=0)), st)["phone:restart-loop:sip"][0])  # counter reset

    def test_agent_crash_loop_is_seen_although_unit_is_active(self):
        def units(n):
            return fake_runner({"systemctl": (0, f"Id=voice-ai-agent.service\nLoadState=loaded\nActiveState=active\nSubState=running\nNRestarts={n}\nActiveEnterTimestamp=\n")})
        st = {}
        self.derive(collect(units(100)), st)
        res = self.derive(collect(units(160)), st)
        self.assertTrue(res["phone:unit:agent"][0])           # "active" at the moment of the sample
        self.assertFalse(res["phone:crash-loop:agent"][0])    # but 60 restarts since the last sample
        self.assertNotIn("phone:unit:tts", res)               # unit not present in the show output: no check
        self.assertTrue(self.derive(collect(units(161)), st)["phone:crash-loop:agent"][0])

    def test_http_log_and_recording_checks(self):
        bad = lambda url, timeout=4.0: {"state": "failed", "text": "no answer (URLError)", "ms": None}
        self.assertFalse(self.derive(collect(http=bad))["phone:livekit-http"][0])
        mb = 1048576
        res = self.derive(collect(fake_runner(logs="x" * (6 * mb))))  # 144 MB/day extrapolated
        self.assertFalse(res["phone:log-growth:server"][0])
        res = self.derive(collect(fake_runner(logs="x" * (6 * mb))), env={"PHONE_LOG_MB_DAY": "500"})
        self.assertTrue(res["phone:log-growth:server"][0])
        res = self.derive(collect(fake_runner({"find": (0, "3\n")})))
        self.assertFalse(res["phone:recordings"][0])

    def test_signal_checks(self):
        ph = collect()
        ph["signals"] = {"state": "ok", "age_s": 10, "ufw": {"drops_1h": 6, "drops_24h": 6, "last_ts": NOW - 5}, "agent": {"crash_starts_1h": 40}}
        res = self.derive(ph)
        self.assertFalse(res["phone:ufw-sip-drops"][0])
        self.assertFalse(res["phone:agent-crash-starts"][0])
        ph["signals"] = {"state": "stale", "age_s": 3600}
        res = self.derive(ph)
        self.assertFalse(res["phone:signals-fresh"][0])
        self.assertNotIn("phone:ufw-sip-drops", res)

    def test_last_call_alert_only_when_enabled(self):
        ph = collect()
        ph["signals"] = {"state": "ok", "age_s": 1, "ufw": {"drops_1h": 0}}
        ph["last_call_ts"] = NOW - 50 * 3600
        self.assertNotIn("phone:last-call", self.derive(ph))
        self.assertFalse(self.derive(ph, env={"PHONE_CALL_STALE_H": "48"})["phone:last-call"][0])

    def test_nightly_voice_report_checks(self):
        ph = collect()
        ph["voice_test"] = {"state": "ok", "ts": NOW - 3600, "age_s": 3600, "first_audio_ms": {"p50": 1200.0, "p95": 2000.0}}
        res = self.derive(ph)
        self.assertTrue(res["phone:first-audio"][0] and res["phone:voice-test-fresh"][0])
        ph["voice_test"] = {"state": "ok", "ts": NOW - 40 * 3600, "age_s": 40 * 3600, "first_audio_ms": {"p50": 5600.0}}
        res = self.derive(ph)
        self.assertFalse(res["phone:first-audio"][0])
        self.assertFalse(res["phone:voice-test-fresh"][0])
        self.assertTrue(self.derive(ph, env={"PHONE_FIRST_AUDIO_TARGET_MS": "7000"})["phone:first-audio"][0])


class AlertIntegrationTests(unittest.TestCase):
    def snap(self, ph):
        return {"generated": NOW, "phone": ph}

    def test_failure_only_one_message_then_cooldown_and_no_recovery(self):
        state = {}
        bad = collect(fake_runner({"pjsip show registrations": (0, REG_OK.replace("Registered", "Unregistered"))}))
        lines = ba.step(mc, self.snap(bad), state, NOW)
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("phone:sip-registration: "))
        self.assertEqual(leaks("\n".join(lines)), [])
        ba.mark_sent(state, lines, NOW)
        self.assertEqual(ba.step(mc, self.snap(bad), state, NOW + 600), [])      # same incident: silent
        self.assertEqual(ba.step(mc, self.snap(collect()), state, NOW + 1200), [])  # recovery: silent
        flap = ba.step(mc, self.snap(bad), state, NOW + 1800)                      # fails again inside the 3 h cooldown
        self.assertEqual(flap, [])
        self.assertEqual(len(ba.step(mc, self.snap(bad), state, NOW + 4 * 3600)), 1)

    def test_crash_loop_alert_through_state_machine(self):
        def units(n):
            return collect(fake_runner({"systemctl": (0, f"Id=voice-ai-agent.service\nLoadState=loaded\nActiveState=active\nSubState=running\nNRestarts={n}\nActiveEnterTimestamp=\n")}))
        state = {}
        self.assertEqual(ba.step(mc, self.snap(units(0)), state, NOW), [])
        lines = ba.step(mc, self.snap(units(80)), state, NOW + 300)
        self.assertEqual([x.split(": ")[0] for x in lines], ["phone:crash-loop:agent"])

    def test_snapshot_without_phone_adds_no_checks(self):
        self.assertEqual({k for k in ba.derive_results({"generated": NOW}, {}, NOW) if k.startswith("phone:")}, set())

    def test_missing_env_file_is_a_noop_that_collects_nothing(self):
        class Boom:
            def __getattr__(self, name):
                raise AssertionError("must not be touched")
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(ba.run_once(Path(d) / "nope.env", Path(d) / "st.json", deps=(Boom(), Boom(), Boom())), 0)


class RenderTests(unittest.TestCase):
    def test_section_and_page(self):
        ph = collect()
        ph["signals"] = {"state": "ok", "age_s": 5, "ufw": {"drops_1h": 2, "drops_24h": 6}}
        ph["first_audio"] = {"n": 7, "p50": 5652.0, "p95": 10158.0}
        ph["last_call_ts"], ph["last_call_source"] = NOW - 100, "agent journal"
        html = pp.render_section(ph, bs.e, bs.dot, NOW)
        for word in ("SIP registration", "carrier qualify", "last inbound call", "first audio", "not set up yet", "firewall drops"):
            self.assertIn(word, html)
        self.assertEqual(leaks(html), [])
        page = bs.render_html({"generated": NOW, "generated_iso": "x", "phone": ph})
        self.assertIn("phone line", page)
        self.assertEqual(leaks(page), [])
        self.assertIn("not collected", pp.render_section(None, bs.e, bs.dot, NOW))

    def test_collect_survives_a_broken_phone_source(self):
        snap = bs.collect(env={}, now=NOW, runner=lambda cmd, timeout=20, env=None: (127, ""))
        self.assertIn(snap["phone"]["state"], ("ok", "unknown"))


class UnitFileTests(unittest.TestCase):
    def test_signals_unit_is_not_root_and_is_sandboxed(self):
        text = (PKG / "roxira-phone-signals.service").read_text()
        for must in ("User=roxira-phone", "PrivateNetwork=true", "ProtectSystem=strict", "NoNewPrivileges=true",
                     "SupplementaryGroups=adm systemd-journal", "StateDirectory=roxira-phone"):
            self.assertIn(must, text)
        self.assertNotIn("User=root", text)
        inst = (PKG / "install_phone_signals_root.sh").read_text()
        self.assertIn("--apply", inst)
        self.assertNotRegex(inst, r"(?m)^\s*(ufw|nft|iptables)\s")
        self.assertIn("phone_probes.py", (PKG / "install_user.sh").read_text())


if __name__ == "__main__":
    unittest.main()
