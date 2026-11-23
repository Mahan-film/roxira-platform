"""Tests for scripts/ops/ci_box/status_page (box_status.py collector parsing, box_alert.py alert state machine).

Stdlib unittest, collected by CI (testpaths = src). Offline: fake command runner, synthetic fixtures, temp dirs.
Modules are loaded lazily in setUpModule so importing this file has no side effects.
"""
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "scripts/ops/ci_box/status_page"
bs = ba = mc = None
NOW = 1_800_000_000.0  # fixed clock


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def setUpModule():
    global bs, ba, mc
    mc = _load("monitor_common", ROOT / "scripts/ops/monitor/monitor_common.py")
    _load("notify", ROOT / "scripts/ops/notify/notify.py")
    bs = _load("box_status", PKG / "box_status.py")
    ba = _load("box_alert", PKG / "box_alert.py")


def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


class ParseTests(unittest.TestCase):
    def test_parse_show_and_classify(self):
        props = bs.parse_show("LoadState=loaded\nActiveState=active\nSubState=running\nResult=success\nExecMainStatus=0\n")
        self.assertEqual(bs.classify_unit(props, "service")["state"], "ok")
        failed = bs.parse_show("LoadState=loaded\nActiveState=failed\nSubState=failed\nResult=exit-code\n")
        self.assertEqual(bs.classify_unit(failed, "oneshot")["state"], "failed")
        self.assertIn("exit-code", bs.classify_unit(failed, "oneshot")["text"])

    def test_not_installed_and_never_ran_are_neutral(self):
        nf = bs.parse_show("LoadState=not-found\nActiveState=inactive\nSubState=dead\n")
        self.assertEqual(bs.classify_unit(nf, "oneshot")["state"], "neutral")
        idle = bs.parse_show("LoadState=loaded\nActiveState=inactive\nSubState=dead\nResult=success\nExecMainExitTimestamp=\n")
        self.assertEqual(bs.classify_unit(idle, "oneshot")["state"], "neutral")
        ran = bs.parse_show("LoadState=loaded\nActiveState=inactive\nSubState=dead\nResult=success\nExecMainExitTimestamp=Sat 2026-11-21 22:10:58 UTC\nExecMainStatus=0\n")
        self.assertEqual(bs.classify_unit(ran, "oneshot")["state"], "ok")
        off = bs.parse_show("LoadState=loaded\nActiveState=inactive\nSubState=dead\nUnitFileState=disabled\n")
        self.assertEqual(bs.classify_unit(off, "timer")["state"], "neutral")

    def test_stopped_long_running_service_is_failed(self):
        props = bs.parse_show("LoadState=loaded\nActiveState=inactive\nSubState=dead\nResult=success\n")
        self.assertEqual(bs.classify_unit(props, "service")["state"], "failed")

    def test_collect_units_uses_runner_and_survives_errors(self):
        calls = []

        def fake(cmd, timeout=20, env=None):
            calls.append(cmd)
            return (1, "") if "roxira-bridge.service" in cmd else (0, "LoadState=loaded\nActiveState=active\nSubState=running\n")

        out = bs.collect_units(fake)
        self.assertEqual(out["roxira-bridge.service"]["state"], "unknown")
        self.assertEqual(out["roxira-gateway-tunnel.service"]["state"], "ok")
        self.assertTrue(all(c[:3] == ["systemctl", "--user", "show"] for c in calls))  # read-only verbs only

    def test_meminfo_loadavg(self):
        m = bs.parse_meminfo("MemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n")
        self.assertEqual(m["used_pct"], 75.0)
        self.assertEqual(bs.parse_meminfo("")["used_pct"], None)
        self.assertEqual(bs.parse_loadavg("0.10 0.20 0.30 1/200 999"), [0.1, 0.2, 0.3])
        self.assertEqual(bs.parse_loadavg("garbage"), [])

    def test_runners_and_box_status(self):
        payload = {"runners": [{"name": "r1", "status": "online", "busy": True, "labels": [{"name": "self-hosted"}]}, "junk"]}
        r = bs.parse_runners(payload)
        self.assertEqual(r, [{"name": "r1", "status": "online", "busy": True, "labels": ["self-hosted"]}])
        self.assertEqual(bs.parse_runners({"message": "Not Found"}), [])
        self.assertEqual(bs.parse_box_status("== services\nxray:   active\ndocker: active\nrunner: inactive\n== disk\n"),
                         {"xray": "active", "docker": "active", "runner": "inactive"})
        self.assertEqual(bs.parse_box_status("sudo: a password is required"), {})

    def test_collect_runners_legacy_unknown_without_sudo(self):
        def fake(cmd, timeout=20, env=None):
            if cmd[0] == "gh":
                return 0, json.dumps({"runners": []})
            return 1, ""

        out = bs.collect_runners({"STATUS_REPO": "o/r"}, fake)
        self.assertEqual(out["registered"], {"state": "ok", "runners": []})
        self.assertEqual(out["legacy"]["state"], "unknown")  # never reported as "inactive"

    def test_docker_ps(self):
        text = "a\tUp 9 hours\nb\tUp 2 hours (healthy)\nc\tUp 1 hour (unhealthy)\nd\tExited (1) 3 hours ago\n"
        got = {x["name"]: x["state"] for x in bs.parse_docker_ps(text)}
        self.assertEqual(got, {"a": "ok", "b": "ok", "c": "failed", "d": "failed"})

    def test_backup_stamp(self):
        self.assertEqual(bs.parse_backup_stamp("2026-11-21T03:20:00Z OK snapshots=3"), bs.parse_ts("2026-11-21T03:20:00Z"))
        self.assertIsNone(bs.parse_backup_stamp(""))
        self.assertIsNone(bs.parse_backup_stamp("2026-11-21T03:20:00Z FAILED"))

    def test_collect_backups_missing_is_not_an_error(self):
        out = bs.collect_backups({"STATUS_BACKUP_STAMP": "/nonexistent/stamp"}, NOW)
        self.assertEqual(out["items"][0]["present"], False)
        self.assertIsNone(out["items"][0]["ts"])

    def test_bwrap_version_check(self):
        self.assertEqual(bs.parse_bwrap_version("bubblewrap 0.11.1\n"), (0, 11, 1))
        self.assertIsNone(bs.parse_bwrap_version("garbage"))
        cases = {"bubblewrap 0.11.1": "warn", "bubblewrap 0.11.2": "ok", "bubblewrap 0.12.0": "ok", "bubblewrap 0.9.0": "warn"}
        for out, state in cases.items():
            self.assertEqual(bs.collect_sandbox(lambda cmd, t=10, o=out: (0, o))["state"], state, out)
        self.assertEqual(bs.collect_sandbox(lambda cmd, t=10: (127, ""))["state"], "unknown")
        self.assertEqual(bs.collect_sandbox(lambda cmd, t=10: (0, "nope"))["state"], "unknown")

    def test_tick_log(self):
        text = ("old line\nroxira-orch tick DRY-RUN (nothing written; pass --apply)\n"
                "WOULD CLAIM #12 lane L5 wave-rank 0 key k: 'Title'\n    done when: 'x'\nskip #13 lane L5: WIP\n")
        t = bs.parse_tick_log(text)
        self.assertEqual(t["mode"], "dry-run")
        self.assertEqual(len(t["claims"]), 1)
        self.assertEqual(t["skips"], ["skip #13 lane L5: WIP"])
        self.assertEqual(bs.parse_tick_log("nothing here"), {})


class CostTests(unittest.TestCase):
    def rows(self):
        return [
            {"ts": iso(NOW - 60), "lane": "l5", "cost_usd": "0.400000", "status": "ok"},
            {"ts": iso(NOW - 30), "lane": "l5", "cost_usd": None, "status": "failed"},
            {"ts": iso(NOW - 20), "lane": "l5", "cost_usd": "9", "status": "skipped_bot"},   # not an attempt
            {"ts": iso(NOW - 3 * 86400), "lane": "l6", "cost_usd": "0.1", "status": "ok"},
            {"ts": "bad", "lane": "l6", "cost_usd": "1", "status": "ok"},
        ]

    def test_sum_cost(self):
        out = bs.sum_cost(self.rows(), NOW)
        self.assertEqual(out["today"]["l5"], {"usd": 0.4, "attempts": 2})
        self.assertNotIn("l6", out["today"])
        self.assertEqual(sum(d["attempts"] for d in out["days"].values()), 3)

    def test_build_cost_vs_caps_and_no_double_count(self):
        cfg = {"default": {"usd_per_day": 0.25, "attempts_per_day": 6}, "lanes": {"l5": {"usd_per_day": 0.5, "attempts_per_day": 12}}}
        orch_rows = [{"ts": iso(NOW - 60), "lane": "L5", "cost_usd": "0.4", "exit": "done"}]
        out = bs.build_cost(self.rows(), orch_rows, cfg, NOW, 1.0)
        self.assertAlmostEqual(out["lanes"]["l5"]["usd"], 0.4)  # same run in both logs counted once
        self.assertAlmostEqual(out["lanes"]["l5"]["usd_ratio"], 0.8)
        self.assertAlmostEqual(out["total_ratio"], 0.4)

    def test_bad_numbers(self):
        self.assertEqual(bs._dec("nan"), 0.0)
        self.assertEqual(bs._dec(-1), 0.0)
        self.assertEqual(bs._dec("abc"), 0.0)


class OrchTests(unittest.TestCase):
    def test_not_installed(self):
        with tempfile.TemporaryDirectory() as d:
            out = bs.collect_orch({"ORCH_HOME": str(Path(d) / "nope")}, NOW, lambda *a, **k: (1, ""))
        self.assertEqual(out["state"], "neutral")

    def test_reads_state_without_writing(self):
        with tempfile.TemporaryDirectory() as d:
            db = sqlite3.connect(Path(d) / "orch.db")
            db.executescript("""CREATE TABLE jobs (key TEXT PRIMARY KEY, issue INTEGER, lane TEXT, status TEXT, task_id INTEGER, lease_until REAL, result_sha TEXT, pr INTEGER, created REAL, updated REAL);
            CREATE TABLE breaker (lane TEXT PRIMARY KEY, fails INTEGER, open_until REAL);
            CREATE TABLE cooldowns (provider TEXT PRIMARY KEY, until REAL);
            INSERT INTO jobs VALUES ('k',7,'L5','reported',1,NULL,'abc',99,1,%f);
            INSERT INTO breaker VALUES ('L5',3,%f),('L6',0,0);""" % (NOW - 100, NOW + 3000))
            db.commit()
            db.close()
            before = sorted(p.name for p in Path(d).iterdir())
            out = bs.collect_orch({"ORCH_HOME": d}, NOW, lambda *a, **k: (0, "roxira-orch tick DRY-RUN\nnothing to claim\n"))
            after = sorted(p.name for p in Path(d).iterdir())
        self.assertEqual(before, after)  # no -wal/-shm/KILL files created by the read
        self.assertEqual(out["jobs"][0]["issue"], 7)
        self.assertEqual({b["lane"]: b["open"] for b in out["breakers"]}, {"L5": True, "L6": False})
        self.assertTrue(out["last_tick"]["nothing"])


class RenderTests(unittest.TestCase):
    def test_render_escapes_and_has_no_script(self):
        snap = {"generated": NOW, "generated_iso": "x",
                "units": {"u": {"label": "<script>alert(1)</script>", "state": "failed", "text": "a&b"}},
                "containers": {"state": "ok", "containers": [{"name": "<b>x", "state": "ok", "status": "Up"}]}}
        page = bs.render_html(snap)
        self.assertNotIn("<script", page.lower())
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("http-equiv=\"refresh\"", page)
        self.assertNotIn("http://", page.replace("http-equiv", ""))  # no external asset

    def test_render_empty_snapshot_does_not_crash(self):
        self.assertIn("Box status", bs.render_html({}))

    def test_atomic_write(self):
        with tempfile.TemporaryDirectory() as d:
            bs.atomic_write(Path(d) / "sub" / "i.html", "hi")
            self.assertEqual((Path(d) / "sub" / "i.html").read_text(), "hi")
            self.assertEqual([p.name for p in (Path(d) / "sub").iterdir()], ["i.html"])


def snap(**kw):
    base = {"units": {}, "system": {"disks": [{"path": "/", "used_pct": 40.0}, {"path": "/srv/data", "used_pct": 10.0}]},
            "runners": {"registered": {"state": "ok", "runners": [{"name": "r1", "status": "online", "busy": False, "labels": []}]}},
            "orch": {"state": "neutral"}, "cost": {"lanes": {"l5": {"usd": 0.1, "cap_usd": 0.5, "usd_ratio": 0.2}}, "total_usd": 0.1,
                                                      "daily_cap_usd": 1.0, "total_ratio": 0.1},
            "tunnel": {"state": "ok", "text": "alive"}}
    base.update(kw)
    return base


TUNNEL_UP = {"roxira-gateway-tunnel.service": {"state": "ok", "label": "tunnel", "text": "running"}}


class AlertDeriveTests(unittest.TestCase):
    def test_healthy_has_no_failures(self):
        res = ba.derive_results(snap(units=TUNNEL_UP), {}, NOW)
        self.assertTrue(all(ok for ok, _ in res.values()))

    def test_tunnel_down_only_when_installed(self):
        down = {"state": "failed", "text": "no answer"}
        self.assertNotIn("tunnel", ba.derive_results(snap(tunnel=down), {}, NOW))  # unit absent: nobody expects it
        self.assertFalse(ba.derive_results(snap(units=TUNNEL_UP, tunnel=down), {}, NOW)["tunnel"][0])

    def test_disk_threshold(self):
        s = snap(system={"disks": [{"path": "/", "used_pct": 85.0}, {"path": "/srv/data", "used_pct": 84.9}]})
        res = ba.derive_results(s, {}, NOW)
        self.assertFalse(res["disk:/"][0])
        self.assertTrue(res["disk:/srv/data"][0])

    def test_timer_failed_neutral_and_unknown(self):
        units = {"a": {"state": "failed", "label": "a", "text": "failed"}, "b": {"state": "neutral"}, "c": {"state": "unknown"}}
        res = ba.derive_results(snap(units=units), {}, NOW)
        self.assertFalse(res["unit:a"][0])
        self.assertNotIn("unit:b", res)
        self.assertNotIn("unit:c", res)

    def test_runner_grace_is_ten_minutes(self):
        off = snap(runners={"registered": {"state": "ok", "runners": [{"name": "r1", "status": "offline", "busy": False, "labels": []}]}})
        state = {}
        self.assertTrue(ba.derive_results(off, state, NOW)["runner:r1"][0])          # just seen offline
        self.assertTrue(ba.derive_results(off, state, NOW + 599)["runner:r1"][0])
        self.assertFalse(ba.derive_results(off, state, NOW + 601)["runner:r1"][0])   # more than 10 min
        self.assertTrue(ba.derive_results(snap(), state, NOW + 700)["runner:r1"][0])  # back online clears the clock
        self.assertNotIn("r1", state["runner_since"])

    def test_runner_api_error_is_omitted(self):
        res = ba.derive_results(snap(runners={"registered": {"state": "unknown", "error": "gh"}}), {}, NOW)
        self.assertFalse(any(k.startswith("runner:") for k in res))

    def test_orch_breaker(self):
        s = snap(orch={"state": "ok", "jobs": [], "breakers": [{"lane": "L5", "fails": 3, "open": True}, {"lane": "L6", "fails": 0, "open": False}]})
        res = ba.derive_results(s, {}, NOW)
        self.assertFalse(res["orch-breaker:L5"][0])
        self.assertTrue(res["orch-breaker:L6"][0])
        self.assertFalse(any(k.startswith("orch-breaker") for k in ba.derive_results(snap(), {}, NOW)))  # orch not installed

    def test_cost_at_80_percent(self):
        s = snap(cost={"lanes": {"l5": {"usd": 0.4, "cap_usd": 0.5, "usd_ratio": 0.8}}, "total_usd": 0.4, "daily_cap_usd": 1.0, "total_ratio": 0.4})
        res = ba.derive_results(s, {}, NOW)
        self.assertFalse(res["cost:l5"][0])
        self.assertTrue(res["cost:total"][0])
        self.assertEqual(ba.derive_results(snap(cost={"state": "unknown"}), {}, NOW).get("cost:total"), None)


class AlertStateMachineTests(unittest.TestCase):
    def run_steps(self, snaps_and_times, cooldown=None):
        cooldown = ba.COOLDOWN_S if cooldown is None else cooldown
        state, out = {}, []
        for s, t in snaps_and_times:
            lines = ba.step(mc, s, state, t, cooldown)
            out.append(lines)
            ba.mark_sent(state, lines, t)  # delivery succeeded
        return out, state

    def disk(self, pct):
        return snap(system={"disks": [{"path": "/", "used_pct": pct}]})

    def test_one_message_per_incident(self):
        out, _ = self.run_steps([(self.disk(50), NOW), (self.disk(90), NOW + 300), (self.disk(91), NOW + 600), (self.disk(92), NOW + 3 * 86400)])
        self.assertEqual([len(x) for x in out], [0, 1, 0, 0])  # no repeat, not even after days

    def test_no_recovery_message(self):
        out, _ = self.run_steps([(self.disk(90), NOW), (self.disk(50), NOW + 300)])
        self.assertEqual([len(x) for x in out], [1, 0])

    def test_flap_within_cooldown_is_not_resent(self):
        seq = [(self.disk(90), NOW), (self.disk(50), NOW + 300), (self.disk(90), NOW + 600), (self.disk(50), NOW + 900),
               (self.disk(90), NOW + 4 * 3600)]
        out, _ = self.run_steps(seq, cooldown=3 * 3600)
        self.assertEqual([len(x) for x in out], [1, 0, 0, 0, 1])  # second new incident inside cooldown suppressed; later one allowed

    def test_first_sight_failure_alerts(self):
        out, _ = self.run_steps([(self.disk(95), NOW)])
        self.assertEqual(len(out[0]), 1)

    def test_failed_send_is_retried_then_stops(self):
        state = {}
        lines = ba.step(mc, self.disk(90), state, NOW)
        self.assertEqual(len(lines), 1)          # send fails: mark_sent not called
        lines = ba.step(mc, self.disk(90), state, NOW + 300)
        self.assertEqual(len(lines), 1)          # pending, retried
        ba.mark_sent(state, lines, NOW + 300)
        self.assertEqual(ba.step(mc, self.disk(90), state, NOW + 600), [])

    def test_recovery_drops_pending(self):
        state = {}
        ba.step(mc, self.disk(90), state, NOW)   # never delivered
        self.assertEqual(ba.step(mc, self.disk(50), state, NOW + 300), [])
        self.assertEqual(state["pending"], {})

    def test_unknown_does_not_clear_or_open(self):
        state = {}
        ba.step(mc, self.disk(90), state, NOW)
        ba.mark_sent(state, ["disk:/: x"], NOW)
        ba.step(mc, snap(system={"disks": []}), state, NOW + 300)  # source gone: omitted
        self.assertFalse(state["checks"]["disk:/"]["ok"])           # still the same incident, no new message later
        self.assertEqual(ba.step(mc, self.disk(90), state, NOW + 600), [])

    def test_runner_offline_message_after_grace(self):
        off = snap(runners={"registered": {"state": "ok", "runners": [{"name": "r1", "status": "offline", "busy": False, "labels": []}]}})
        out, _ = self.run_steps([(off, NOW), (off, NOW + 300), (off, NOW + 700), (off, NOW + 1000)])
        self.assertEqual([len(x) for x in out], [0, 0, 1, 0])


class AlertRunTests(unittest.TestCase):
    def deps(self, sent, ok=True):
        class Notify:
            @staticmethod
            def send(text, *a, **k):
                sent.append(text)
                return ok

        class BS:
            @staticmethod
            def collect():
                return snap(system={"disks": [{"path": "/", "used_pct": 99.0}]})

        return mc, Notify, BS

    def test_missing_env_file_is_a_noop(self):
        with tempfile.TemporaryDirectory() as d:
            sent = []
            rc = ba.run_once(Path(d) / "missing.env", Path(d) / "state.json", deps=self.deps(sent))
            self.assertEqual(rc, 0)
            self.assertEqual(sent, [])
            self.assertFalse((Path(d) / "state.json").exists())

    def test_loose_mode_or_empty_values_are_a_noop(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / "t.env"
            env.write_text("TELEGRAM_BOT_TOKEN=abc\nTELEGRAM_CHAT_ID=1\n")
            os.chmod(env, 0o644)
            self.assertIsNone(ba.read_credentials(env)[0])
            os.chmod(env, 0o600)
            self.assertEqual(ba.read_credentials(env)[0], {"token": "abc", "chat_id": "1"})
            env.write_text("TELEGRAM_BOT_TOKEN=\nTELEGRAM_CHAT_ID=\n")
            self.assertIsNone(ba.read_credentials(env)[0])
            env.write_text("NOTIFY_BOT_TOKEN='t'\nexport NOTIFY_CHAT_ID=\"2\"\n")
            self.assertEqual(ba.read_credentials(env)[0], {"token": "t", "chat_id": "2"})

    def test_warning_does_not_print_values(self):
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / "t.env"
            env.write_text("TELEGRAM_BOT_TOKEN=SECRETVALUE\nTELEGRAM_CHAT_ID=424242\n")
            os.chmod(env, 0o666)
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(err):
                ba.run_once(env, Path(d) / "s.json", deps=self.deps([]))
            self.assertNotIn("SECRETVALUE", err.getvalue())
            self.assertNotIn("424242", err.getvalue())
            self.assertIn("warning", err.getvalue())

    def test_sends_once_and_persists_state(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / "t.env"
            env.write_text("TELEGRAM_BOT_TOKEN=abc\nTELEGRAM_CHAT_ID=1\n")
            os.chmod(env, 0o600)
            sent = []
            state = Path(d) / "state.json"
            ba.run_once(env, state, deps=self.deps(sent), now=NOW)
            ba.run_once(env, state, deps=self.deps(sent), now=NOW + 300)
            self.assertEqual(len(sent), 1)
            self.assertIn("disk:/", sent[0])
            self.assertNotIn("abc", sent[0])

    def test_failed_send_keeps_pending_on_disk(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / "t.env"
            env.write_text("TELEGRAM_BOT_TOKEN=abc\nTELEGRAM_CHAT_ID=1\n")
            os.chmod(env, 0o600)
            sent = []
            state = Path(d) / "state.json"
            ba.run_once(env, state, deps=self.deps(sent, ok=False), now=NOW)
            ba.run_once(env, state, deps=self.deps(sent, ok=True), now=NOW + 300)
            ba.run_once(env, state, deps=self.deps(sent, ok=True), now=NOW + 600)
            self.assertEqual(len(sent), 2)  # failed once, delivered once, then quiet

    def test_dry_run_sends_and_saves_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / "t.env"
            env.write_text("TELEGRAM_BOT_TOKEN=abc\nTELEGRAM_CHAT_ID=1\n")
            os.chmod(env, 0o600)
            sent = []
            ba.run_once(env, Path(d) / "s.json", dry_run=True, deps=self.deps(sent), now=NOW)
            self.assertEqual(sent, [])
            self.assertFalse((Path(d) / "s.json").exists())


class RepoHygieneTests(unittest.TestCase):
    def test_no_ips_hosts_or_secrets_in_pack(self):
        import re
        pat = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
        for p in PKG.iterdir():
            if p.suffix in (".py", ".sh", ".service", ".timer", ".example") or p.name.endswith(".env.example"):
                text = p.read_text(encoding="utf-8")
                for ip in pat.findall(text):
                    self.assertIn(ip, ("127.0.0.1",), f"{p.name}: {ip}")

    def test_timers_are_off_the_hour(self):
        for name in ("roxira-status-collect.timer", "roxira-status-alert.timer"):
            cal = [x for x in (PKG / name).read_text().splitlines() if x.startswith("OnCalendar=")][0]
            self.assertNotIn(":0/", cal)
            self.assertNotIn(":00", cal)


if __name__ == "__main__":
    unittest.main()
