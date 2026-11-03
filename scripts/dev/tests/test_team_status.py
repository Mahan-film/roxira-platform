"""Offline tests for scripts/dev/team_status.py (fixture dicts only, no network)."""

import importlib.util
import json
import pathlib
from datetime import UTC, datetime

_p = pathlib.Path(__file__).resolve().parents[1] / "team_status.py"
_spec = importlib.util.spec_from_file_location("team_status", _p)
ts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ts)

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


def pr(n, branch, login="mahansudo", draft=False, idle=1.0, body="", title="t"):
    return {
        "number": n,
        "title": title,
        "author": login,
        "draft": draft,
        "branch": branch,
        "actor": ts.classify_actor(branch, login),
        "age_h": idle,
        "idle_h": idle,
        "body": body,
        "labels": [],
    }


def issue(n, idle, who=("mahansudo",)):
    return {
        "number": n,
        "title": f"i{n}",
        "assignees": list(who),
        "idle_h": idle,
        "labels": ["in-progress"],
    }


def test_classify_actor():
    assert ts.classify_actor("agent/opencode/fix-x", "bot") == "agent:opencode"
    assert ts.classify_actor("relay/sync", "x") == "relay"
    assert ts.classify_actor("dependabot/npm/y", "dependabot[bot]") == "dependabot"
    assert ts.classify_actor("mahansudo/12-foo", "mahansudo") == "mahansudo"


def test_stale_thresholds():
    prs = [
        pr(1, "agent/cc/a", draft=True, idle=3),
        pr(2, "mahansudo/b", draft=True, idle=3),
        pr(3, "mahan-films/c", draft=True, idle=30),
        pr(4, "agent/cc/d", draft=True, idle=1),
    ]
    got = {s["number"]: s for s in ts.find_stale([], prs)}
    assert set(got) == {1, 3}
    assert got[1]["limit_h"] == 2 and got[3]["limit_h"] == 24


def test_stale_issue_uses_linked_pr_and_override():
    i = issue(10, 5)
    p = pr(11, "agent/cc/x", draft=True, idle=5, body="Closes #10")
    s = ts.find_stale([i], [p])
    assert [x["number"] for x in s] == [10]  # the draft PR is folded into the issue
    assert ts.find_stale([issue(10, 5)], []) == []  # human issue, 5 h < 24 h
    assert len(ts.find_stale([issue(10, 5)], [], override=4)) == 1


def test_overlaps():
    got = ts.find_overlaps({1: ["a", "b"], 2: ["b", "c"], 3: ["c"]})
    assert got == {"b": [1, 2], "c": [2, 3]}


def test_parse_deploy_state():
    d = ts.parse_deploy_state(
        json.dumps({"status": "failed", "sha": "abc", "finished_at": "t", "log": "/x.log"})
    )
    assert deploy_ok(d) is False and d["log"] == "/x.log"
    assert ts.deploy_failed(ts.parse_deploy_state('{"ok": true}')) is False


def deploy_ok(d):
    return not ts.deploy_failed(d)


def test_next_actions_text():
    data = {
        "deploy": {"result": "failed", "target": "abc", "log": "/root/deploy-state/x.log"},
        "sites": [
            {"url": "https://roxira.net/", "ok": False, "status": 502},
            {"url": "https://roxira.ir/", "ok": True, "status": 200},
        ],
        "overlaps": {"docs/a.md": [5, 6]},
        "stale": [
            {
                "kind": "issue",
                "number": 7,
                "owner": "bob",
                "idle_h": 30,
                "limit_h": 24,
                "title": "t",
            }
        ],
        "prs": [pr(8, "mahansudo/x"), pr(5, "mahansudo/y"), pr(9, "mahansudo/z", draft=True)],
    }
    acts = ts.next_actions(data)
    assert acts[0].startswith("Prod deploy failed: read /root/deploy-state/x.log")
    assert "Site https://roxira.net/ returned 502." in acts
    assert "Resolve overlap on docs/a.md between #5 and #6." in acts
    assert any(a.startswith("Release stale claim #7 (owner bob, idle 30 h): run") for a in acts)
    assert any(a.startswith("Review and merge #8 (ready, no conflicts)") for a in acts)
    assert not any("#5 (ready" in a or "#9 (ready" in a for a in acts)


def test_next_actions_idle():
    assert "Nothing urgent" in ts.next_actions({"prs": []})[0]


def test_short_report_limit():
    data = {
        "now": NOW,
        "main_sha": "a" * 40,
        "deploy": None,
        "sites": [],
        "issues": [],
        "prs": [],
        "stale": [],
        "overlaps": {},
        "merged": [],
        "actions": ["x" * 200] * 50,
    }
    assert len(ts.render_short(data)) <= ts.TELEGRAM_MAX


def _run_stub(monkeypatch, result=None, exc=None):
    calls = []

    def fake(cmd, **kw):
        calls.append((cmd, kw))
        if exc:
            raise exc
        return result

    monkeypatch.setattr(ts.subprocess, "run", fake)
    return calls


def test_send_telegram_via_ssh_success(monkeypatch):
    import subprocess

    calls = _run_stub(monkeypatch, result=subprocess.CompletedProcess([], 0, "", ""))
    assert ts.send_telegram_via_ssh("hello", "roxira-prod") is True
    cmd, kw = calls[0]
    assert cmd[0] == "ssh" and "roxira-prod" in cmd and cmd[-1] == ts.REMOTE_NOTIFY_CMD
    assert kw["input"] == "hello" and kw["timeout"] == 60


def test_send_telegram_via_ssh_nonzero(monkeypatch):
    import subprocess

    _run_stub(monkeypatch, result=subprocess.CompletedProcess([], 255, "", "denied"))
    assert ts.send_telegram_via_ssh("x", "h") is False


def test_send_telegram_via_ssh_timeout(monkeypatch):
    import subprocess

    _run_stub(monkeypatch, exc=subprocess.TimeoutExpired("ssh", 60))
    assert ts.send_telegram_via_ssh("x", "h") is False
