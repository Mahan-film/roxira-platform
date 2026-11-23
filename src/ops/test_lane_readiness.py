"""Offline tests for scripts/ops/ci_box/lane_runner/lane_readiness.py (the read-only readiness report).

No real gateway, GitHub or systemd: a loopback stub server stands in for the tunnel. The module loads lazily.
"""
import http.server
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
lr = None
SECRET = "placeholder-unit-test-value-123456"


def setUpModule():
    global lr
    spec = importlib.util.spec_from_file_location("lane_readiness", ROOT / "scripts/ops/ci_box/lane_runner/lane_readiness.py")
    lr = importlib.util.module_from_spec(spec)
    sys.modules["lane_readiness"] = lr
    spec.loader.exec_module(lr)


class Stub(http.server.BaseHTTPRequestHandler):
    groups = ["agent-free", "agent-light-free", "agent-strong-free", "agent-free-paid"]
    seen: list = []

    def do_GET(self):  # noqa: N802
        Stub.seen.append((self.path, self.headers.get("Authorization")))
        if self.path.startswith("/health/liveliness"):
            body = b'"I\'m alive!"'
        elif self.path == "/v1/models" and self.headers.get("Authorization") == f"Bearer {SECRET}":
            body = json.dumps({"data": [{"id": g} for g in Stub.groups]}).encode()
        else:
            self.send_response(401)
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802  a readiness run must never POST (that would be a model call)
        Stub.seen.append(("POST " + self.path, None))
        self.send_response(500)
        self.end_headers()

    def log_message(self, *a):
        pass


class ReadinessTest(unittest.TestCase):
    def setUp(self):
        self.srv = http.server.HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)
        self.addCleanup(self.srv.server_close)
        Stub.seen = []
        Stub.groups = ["agent-free", "agent-light-free", "agent-strong-free", "agent-free-paid"]
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "gw.env").write_text(f"KEYPOOL_MASTER_KEY={SECRET}\n")
        self.conf = {"GATEWAY_URL": f"http://127.0.0.1:{self.srv.server_port}/v1", "GATEWAY_ENV": str(self.tmp / "gw.env")}
        self.spec = lr.key_pool_box_key(ROOT)

    def live(self):
        rep = lr.Report()
        lr.check_live_key(rep, self.conf, self.spec, offline=False)
        return rep.items[0]

    def test_box_key_spec_is_read_from_key_pool_yaml(self):
        self.assertEqual(sorted(self.spec["models"]), ["agent-free", "agent-free-paid", "agent-light-free", "agent-strong-free"])
        self.assertLessEqual(self.spec["max_budget_usd"], 1.0)

    def test_live_check_passes_when_key_lists_exactly_the_box_groups(self):
        item = self.live()
        self.assertEqual(item.status, "PASS", item.detail)
        self.assertFalse([p for p, _ in Stub.seen if p.startswith("POST")], "readiness must never POST (no model call)")

    def test_live_check_fails_when_the_key_can_reach_another_group(self):
        Stub.groups.append("best-all")
        item = self.live()
        self.assertEqual(item.status, "FAIL")
        self.assertIn("best-all", item.detail)

    def test_the_key_is_never_printed(self):
        rep = lr.Report()
        lr.check_live_key(rep, self.conf, self.spec, offline=False)
        text = lr.render(rep) + json.dumps([i.__dict__ for i in rep.items])
        self.assertNotIn(SECRET, text)
        self.assertNotIn("placeholder-unit-test", text)

    def test_unreachable_tunnel_is_unknown_not_a_crash(self):
        self.conf["GATEWAY_URL"] = "http://127.0.0.1:9/v1"
        self.assertEqual(self.live().status, "UNKNOWN")

    def test_only_loopback_urls_are_ever_requested(self):
        with self.assertRaises(ValueError):
            lr.http_get("http://203.0.113.5:4181/v1/models", SECRET)

    def test_offline_run_touches_no_network_and_reports_unknown(self):
        rep = lr.Report()
        lr.check_blockers(rep, "o/r", offline=True)
        lr.check_live_key(rep, self.conf, self.spec, offline=True)
        self.assertEqual([i.status for i in rep.items if i.key.startswith("blocker-") or i.key == "live-key"], ["UNKNOWN"] * 3)
        self.assertEqual(Stub.seen, [])

    def test_ladder_and_scope_checks_pass_on_the_shipped_policy(self):
        rep = lr.Report()
        pol = lr.check_ladder(rep, ROOT, self.spec)
        lr.check_scopes(rep, ROOT, pol)
        by = {i.key: i for i in rep.items}
        self.assertEqual(by["ladder"].status, "PASS", by["ladder"].detail)
        self.assertEqual(by["scopes"].status, "PASS", by["scopes"].detail)

    def test_a_ladder_with_a_group_outside_the_key_fails(self):
        rep = lr.Report()
        pol_file = self.tmp / "p.json"
        pol_file.write_text(json.dumps({"ladder": ["best", "light"], "require_scope": True}))
        import os
        old = os.environ.get("ROXIRA_LANE_POLICY")
        os.environ["ROXIRA_LANE_POLICY"] = str(pol_file)
        try:
            lr.check_ladder(rep, ROOT, self.spec)
        finally:
            if old is None:
                os.environ.pop("ROXIRA_LANE_POLICY")
            else:
                os.environ["ROXIRA_LANE_POLICY"] = old
        item = next(i for i in rep.items if i.key == "ladder")
        self.assertEqual(item.status, "FAIL")
        self.assertIn("best->best-all", item.detail)

    def test_report_fails_only_on_fail_items(self):
        rep = lr.Report()
        rep.add("a", "t", "WARN")
        rep.add("b", "t", "UNKNOWN")
        self.assertFalse(rep.failed)
        rep.add("c", "t", "FAIL")
        self.assertTrue(rep.failed)
        self.assertIn("NOT READY", lr.render(rep))


if __name__ == "__main__":
    unittest.main()
