"""Offline tests for scripts/ops/monitor (alert state, log parsing, PII scrubbing). No network."""

import functools
import importlib.util
import json
import pathlib
import subprocess
import sys
import threading
import time
from http.client import BadStatusLine, IncompleteRead, RemoteDisconnected

import pytest

_DIR = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "ops" / "monitor"

@functools.cache
def _load(name):
    if str(_DIR) not in sys.path:
        sys.path.insert(0, str(_DIR))
    spec = importlib.util.spec_from_file_location(f"_mon_{name}", _DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod



def mc():
    return _load("monitor_common")


def lw():
    return _load("log_watch")


def sc():
    return _load("synthetic_check")


def test_first_ok_is_silent_first_fail_alerts():
    _, a = mc().evaluate({}, {"x": (True, "ok")}, 1000)
    assert a == []
    _, a = mc().evaluate({}, {"x": (False, "boom")}, 1000)
    assert a == [("FAIL", "x", "boom")]


def test_transitions_and_reminder():
    st, a = mc().evaluate({}, {"x": (True, "ok")}, 0)
    st, a = mc().evaluate(st, {"x": (False, "down")}, 100)
    assert [k for k, *_ in a] == ["FAIL"]
    st, a = mc().evaluate(st, {"x": (False, "down")}, 400)  # no spam
    assert a == []
    st, a = mc().evaluate(st, {"x": (False, "down")}, 100 + 2 * 3600)
    assert [k for k, *_ in a] == ["STILL FAILING"]
    st, a = mc().evaluate(st, {"x": (False, "down")}, 100 + 2 * 3600 + 300)
    assert a == []
    st, a = mc().evaluate(st, {"x": (True, "fine")}, 100 + 3 * 3600)
    assert a[0][0] == "RECOVERED" and "down 180 min" in a[0][2]
    st, a = mc().evaluate(st, {"x": (True, "fine")}, 100 + 4 * 3600)
    assert a == []


def test_unrun_checks_keep_state():
    st, _ = mc().evaluate({}, {"chat": (False, "bad")}, 0)
    st2, a = mc().evaluate(st, {"other": (True, "ok")}, 60)
    assert st2["chat"]["ok"] is False and a == []


def test_state_roundtrip(tmp_path):
    p = str(tmp_path / "s" / "state.json")
    mc().save_state(p, {"checks": {"a": {"ok": True}}})
    assert mc().load_state(p)["checks"]["a"]["ok"] is True
    assert mc().load_state(str(tmp_path / "missing.json")) == {}


def test_log_parsing():
    lines = [
        'INFO:     10.0.0.1:5000 - "POST /api/v1/apps/judge/chat HTTP/1.1" 500 Internal Server Error',
        '1.2.3.4 - - [09/Oct/2026:10:00:00 +0000] "POST /api/v1/apps/judge/chat?x=09123456789 HTTP/1.1" 502 150 "-" "UA"',
        'INFO:     10.0.0.1:5000 - "GET /api/v1/users/12345/profile HTTP/1.1" 503 x',
        'INFO:     10.0.0.1:5000 - "GET / HTTP/1.1" 500 x',
        'INFO:     10.0.0.1:5000 - "GET /api/v1/ok HTTP/1.1" 200 OK',
        '[CHAT-TIMING] req=abc stt_ms=0 total_ms=12000',
        '[CHAT-TIMING] req=abd total_ms=4000.5',
        '[CLIENT-ERROR] kind=fetch_failed phone=09123456789 msg=سلام token=abcdefghijklmnopqrstuvwxyz123',
    ]
    s = lw().parse_lines(lines)
    assert s["api_5xx"] == 3
    assert s["timings_s"] == [12.0, 4.0005]
    assert s["client_errors"] == 1
    assert "POST /api/v1/apps/judge/chat 500" in s["top_5xx"]
    assert "GET /api/v1/users/:id/profile 503" in s["top_5xx"]
    assert not any("0912" in k for k in s["top_5xx"])
    assert list(s["top_client"]) == ["fetch_failed"]


def test_percentiles_and_verdicts():
    vals = [float(i) for i in range(1, 101)]
    assert lw().percentile(vals, 50) == 50.0 and lw().percentile(vals, 95) == 95.0
    assert lw().percentile([], 95) is None
    stats = {"api_5xx": 5, "client_errors": 0, "timings_s": [50.0] * 5, "top_5xx": {}, "top_client": {}}
    v = lw().verdicts(stats, 3, 10, 40)
    assert not v["logs:api-5xx"][0] and v["logs:client-errors"][0] and not v["logs:chat-p95"][0]
    stats.update(api_5xx=0, timings_s=[])
    assert all(ok for ok, _ in lw().verdicts(stats, 3, 10, 40).values())


def test_merge_does_not_double_count_5xx():
    a = lw().parse_lines(['"GET /api/x HTTP/1.1" 500 a'])
    b = lw().parse_lines(['"GET /api/x HTTP/1.1" 500 a'])
    assert lw().merge(a, b)["api_5xx"] == 1


def test_scrub_pii():
    raw = ("user 09123456789 +989121234567 Bearer abc.def-ghi eyJhbGciOi.eyJzdWIiOi.sig "
           "token=SECRETVALUE a@b.com 192.168.1.20 aaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    out = mc().scrub(raw, 500)
    for leak in ("09123456789", "9121234567", "abc.def", "eyJhbG", "SECRETVALUE", "a@b.com",
                 "192.168", "aaaaaaaaaaaaaaaaaaaaaaaa"):
        assert leak not in out


def test_summary_has_no_message_text():
    s = lw().parse_lines([
        '[CLIENT-ERROR] kind=network_error message=مهلت تجدیدنظرخواهی',
        '[CLIENT-ERROR] message=مهلت تجدیدنظرخواهی',
    ])
    text = lw().summary_text(s, 1440)
    assert "تجدیدنظرخواهی" not in text and "مهلت" not in text
    assert "network_error" in text and "unknown" in text


@pytest.mark.parametrize("rest, expected", [
    ("kind=network_error message=x y", "network_error"),
    ("kind=judge.chat-timeout_1", "judge.chat-timeout_1"),
    ("message=مهلت تجدیدنظرخواهی", "unknown"),
    ("kind=مهلت تجدیدنظرخواهی", "unknown"),
    ("kind=" + "a" * 41, "unknown"),
    ("kind=" + "a." * 20, "a." * 20),
    ("kind=" + "a" * 40, "unknown"),
    ("kind=a@b.com", "unknown"),
    ("kind=09123456789", "unknown"),
    ("xkind=fake kind=real", "real"),
    ("", "unknown"),
])
def test_client_kind_rules(rest, expected):
    assert lw().client_kind(rest) == expected


class _FakeProc:
    """Stands in for subprocess.Popen: stdout is a lazy line iterator, no .read()."""

    def __init__(self, lines=(), rc=0, hang=False):
        self._rc = rc
        self._hang = hang
        self.killed = threading.Event()
        self.stdout = self._gen(list(lines))

    def _gen(self, lines):
        for line in lines:
            yield line
        while self._hang and not self.killed.is_set():
            time.sleep(0.005)

    def kill(self):
        self.killed.set()

    def wait(self):
        return -9 if self.killed.is_set() else self._rc


def test_stream_container_reads_line_by_line(monkeypatch):
    seen = {}
    lines = [
        '"GET /api/v1/x/12345 HTTP/1.1" 500 a',
        '[CHAT-TIMING] req=a total_ms=2000',
        '[CLIENT-ERROR] kind=net_err message=مهلت',
    ]

    def fake_popen(argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        return _FakeProc(lines)

    def no_run(*a, **k):
        raise AssertionError("subprocess.run must not be used for docker logs")

    monkeypatch.setattr(lw().subprocess, "Popen", fake_popen)
    monkeypatch.setattr(lw().subprocess, "run", no_run)
    stats, partial = lw().stream_container("roxira_app_prod", 1440, 30)
    assert seen["argv"] == ["docker", "logs", "--since", "1440m", "roxira_app_prod"]
    kw = seen["kw"]
    assert kw["stdout"] == subprocess.PIPE and kw["stderr"] == subprocess.STDOUT
    assert kw["text"] is True and kw["errors"] == "replace"
    assert partial is False
    assert stats["api_5xx"] == 1 and stats["timings_s"] == [2.0]
    assert stats["top_client"] == {"net_err": 1}


def test_stream_container_nonzero_exit_raises(monkeypatch):
    monkeypatch.setattr(lw().subprocess, "Popen", lambda argv, **kw: _FakeProc(["x\n"], rc=2))
    with pytest.raises(RuntimeError, match="rc=2"):
        lw().stream_container("c", 10, 30)


def test_stream_container_deadline_kills_and_reports_partial(monkeypatch):
    proc = _FakeProc(['"GET /api/a HTTP/1.1" 500 a\n'], hang=True)
    monkeypatch.setattr(lw().subprocess, "Popen", lambda argv, **kw: proc)
    stats, partial = lw().stream_container("c", 1440, 0.05)
    assert partial is True and proc.killed.is_set()
    assert stats["api_5xx"] == 1


def test_chat_verdicts():
    ok = b'{"reply": "\xd8\xa8\xdb\x8c\xd8\xb3\xd8\xaa \xd8\xb1\xd9\x88\xd8\xb2 (20)"}'
    assert sc().evaluate_chat_reply(200, ok, 5, 45)[0]
    assert not sc().evaluate_chat_reply(500, b"", 1, 45)[0]
    assert not sc().evaluate_chat_reply(200, b"nope", 1, 45)[0]
    assert not sc().evaluate_chat_reply(200, b'{"reply": "  "}', 1, 45)[0]
    assert not sc().evaluate_chat_reply(200, ok, 50, 45)[0]
    assert not sc().evaluate_chat_reply(200, b'{"reply": "hello"}', 1, 45)[0]


def test_chat_due():
    assert sc().chat_due({}, 1000, 15, False)
    assert not sc().chat_due({"last_chat_ts": 1000}, 1000 + 300, 15, False)
    assert sc().chat_due({"last_chat_ts": 1000}, 1000 + 900, 15, False)
    assert sc().chat_due({"last_chat_ts": 1000}, 1001, 15, True)


def test_dry_run_email_prints(capsys):
    assert mc().send_email("subj", "line1", dry_run=True)
    assert "subj" in capsys.readouterr().out


# --- synthetic_check: transport errors and per-check isolation -------------

class _BrokenBody:
    """A response whose body read dies mid-stream (IncompleteRead is not an OSError)."""

    status = 200

    def read(self, n=-1):
        raise IncompleteRead(b"partial", 10)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def offline_monitor(monkeypatch, tmp_path):
    m = sc()
    monkeypatch.setenv("MONITOR_DOMAINS", "example.test")
    monkeypatch.setenv("MONITOR_CHAT_BASE", "https://example.test")
    monkeypatch.setenv("MONITOR_SILENCE_FILE", str(tmp_path / "no-silence"))
    monkeypatch.delenv("MONITOR_CHECK_DISK", raising=False)
    monkeypatch.delenv("MONITOR_SILENCE", raising=False)
    for name in ("BACKUP_SMTP_USER", "BACKUP_SMTP_PASS", "BACKUP_NOTIFY_TO"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    monkeypatch.setattr(m, "check_cert", lambda d, warn: (True, "90 days left"))
    return m, tmp_path / "state.json"


def _all_ok(m, monkeypatch):
    monkeypatch.setattr(m, "check_site", lambda d: (True, "200 in 0.1s"))
    monkeypatch.setattr(m, "check_health", lambda b: (True, "200 in 0.1s"))
    monkeypatch.setattr(m, "check_chat", lambda b: (True, "ok in 1.0s"))


@pytest.mark.parametrize("exc", [RemoteDisconnected("closed"), BadStatusLine("junk")])
def test_http_transport_errors_return_status_zero(monkeypatch, exc):
    def fake_urlopen(req, timeout=None):
        raise exc

    monkeypatch.setattr(sc().urllib.request, "urlopen", fake_urlopen)
    status, body, _ = sc().http("https://example.test/", 5)
    assert status == 0 and body == b""


def test_http_incomplete_read_returns_status_zero(monkeypatch):
    monkeypatch.setattr(sc().urllib.request, "urlopen", lambda req, timeout=None: _BrokenBody())
    status, body, _ = sc().http("https://example.test/", 5)
    assert status == 0 and body == b""


def test_remote_disconnect_on_every_check_fails_run_and_saves_state(monkeypatch, capsys, offline_monitor):
    m, state_path = offline_monitor

    def disconnected(req, timeout=None):
        raise RemoteDisconnected("Remote end closed connection without response")

    monkeypatch.setattr(m.urllib.request, "urlopen", disconnected)
    assert m.main(["--state", str(state_path), "--force-chat"]) == 1
    out = capsys.readouterr().out
    assert "FAIL site:example.test" in out and "FAIL judge-health" in out and "FAIL chat" in out
    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved["checks"]["chat"]["ok"] is False and "last_chat_ts" in saved


def test_incomplete_read_is_a_failed_check_not_a_crash(monkeypatch, capsys, offline_monitor):
    m, state_path = offline_monitor
    monkeypatch.setattr(m.urllib.request, "urlopen", lambda req, timeout=None: _BrokenBody())
    assert m.main(["--state", str(state_path), "--force-chat"]) == 1
    out = capsys.readouterr().out
    assert "FAIL chat" in out and "Traceback" not in out
    assert state_path.exists()


def test_unexpected_exception_fails_only_its_own_check(monkeypatch, capsys, offline_monitor):
    m, state_path = offline_monitor
    _all_ok(m, monkeypatch)
    monkeypatch.setenv("MONITOR_CHECK_DISK", "1")

    def broken_disk(warn):
        raise RuntimeError("boom")

    monkeypatch.setattr(m, "check_disk", broken_disk)
    assert m.main(["--state", str(state_path)]) == 1
    out = capsys.readouterr().out
    assert "FAIL disk:/: unexpected RuntimeError: boom" in out
    assert "OK   judge-health" in out and "OK   site:example.test" in out
    assert json.loads(state_path.read_text(encoding="utf-8"))["checks"]["judge-health"]["ok"] is True


def test_all_checks_ok_exits_zero(monkeypatch, capsys, offline_monitor):
    m, state_path = offline_monitor
    _all_ok(m, monkeypatch)
    assert m.main(["--state", str(state_path), "--force-chat"]) == 0
    assert "FAIL" not in capsys.readouterr().out


def test_state_is_saved_even_when_alerting_raises(monkeypatch, capsys, offline_monitor):
    m, state_path = offline_monitor
    _all_ok(m, monkeypatch)
    monkeypatch.setattr(m, "check_chat", lambda b: (False, "bad reply"))

    def boom(*a, **k):
        raise RuntimeError("evaluate broke")

    monkeypatch.setattr(m.mc, "evaluate", boom)
    assert m.main(["--state", str(state_path), "--force-chat"]) == 1
    assert "Traceback" not in capsys.readouterr().out
    assert json.loads(state_path.read_text(encoding="utf-8"))["last_chat_ts"] > 0
