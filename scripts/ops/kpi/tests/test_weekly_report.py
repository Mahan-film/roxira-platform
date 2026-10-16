"""Tests for the weekly KPI report aggregation (F7). No network: Umami is a fake fetch, and
the cost log, task queue and deploy state are small fixtures under tmp_path."""

from __future__ import annotations

import json
import sqlite3
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import pytest

KPI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KPI_DIR))

import weekly_report as wr  # noqa: E402

NOW = datetime(2026, 10, 16, 6, 0, tzinfo=timezone.utc)
START = datetime(2026, 10, 9, 6, 0, tzinfo=timezone.utc)
SECRET = "UMAMI-SECRET-TOKEN-DO-NOT-PRINT"


def _epoch(*args: int) -> float:
    return datetime(*args, tzinfo=timezone.utc).timestamp()


# ---------------------------------------------------------------- time parsing
def test_parse_time_accepts_iso_z_offset_and_epoch():
    assert wr.parse_time("2026-10-16T06:00:00Z") == NOW
    assert wr.parse_time("2026-10-16T06:00:00+0000") == NOW  # format written by autodeploy.sh
    assert wr.parse_time(NOW.timestamp()) == NOW
    assert wr.parse_time("2026-10-16T06:00:00") == NOW  # naive means UTC
    assert wr.parse_time("not a date") is None
    assert wr.parse_time(True) is None
    assert wr.parse_time(None) is None


# ---------------------------------------------------------------- LLM cost
def _write_cost_log(path: Path) -> None:
    rows = [
        {"ts": "2026-10-10T10:00:00Z", "model_group": "cheap", "deployment": "d1",
         "success": True, "response_cost": 0.001, "latency_ms": 100},
        {"ts": "2026-10-10T11:00:00Z", "model_group": "cheap", "deployment": "d1",
         "success": False, "response_cost": 0.0005, "latency_ms": 200, "error": "timeout"},
        {"ts": "2026-10-15T09:00:00Z", "model_group": "strong", "deployment": "d2",
         "success": True, "response_cost": 0.01, "latency_ms": 300},
        # outside the window (before START)
        {"ts": "2026-10-01T00:00:00Z", "model_group": "cheap", "deployment": "d1",
         "success": True, "response_cost": 1.0, "latency_ms": 50},
        # after the window end
        {"ts": "2026-10-16T07:00:00Z", "model_group": "cheap", "deployment": "d1",
         "success": True, "response_cost": 1.0, "latency_ms": 50},
    ]
    lines = [json.dumps(r) for r in rows] + ["this is not json"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_cost_section_aggregates_window_only(tmp_path):
    log = tmp_path / "requests.jsonl"
    _write_cost_log(log)
    section = wr.cost_section(str(log), 7, NOW)
    assert section["status"] == "ok"
    agg = section["agg"]
    assert agg["calls"] == 3
    assert agg["success"] == 2
    assert agg["total_cost"] == pytest.approx(0.0115)
    groups = {g["group"]: g for g in agg["groups"]}
    assert groups["cheap"]["calls"] == 2
    assert groups["cheap"]["cost_per_success"] == pytest.approx(0.0015)
    assert groups["strong"]["cost_per_success"] == pytest.approx(0.01)
    assert [d["day"] for d in section["per_day"]] == ["2026-10-10", "2026-10-15"]
    assert section["per_day"][0]["calls"] == 2
    assert section["per_day"][0]["ok"] == 1
    assert section["per_day"][0]["cost"] == pytest.approx(0.0015)


def test_cost_section_missing_log_is_soft(tmp_path):
    section = wr.cost_section(str(tmp_path / "absent.jsonl"), 7, NOW)
    assert section["status"] == "missing"
    assert "absent.jsonl" in section["reason"]


# ---------------------------------------------------------------- agent queue
def _make_taskq(path: Path, with_attempts: bool = True) -> None:
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL, created REAL NOT NULL);
        """
    )
    if with_attempts:
        con.execute("CREATE TABLE attempts (task_id INTEGER, ts REAL NOT NULL, step TEXT)")
    tasks = [
        ("t-done", "done", 1, _epoch(2026, 10, 12, 8)),
        ("t-failed", "failed", 3, _epoch(2026, 10, 13, 8)),
        ("t-old-done", "done", 2, _epoch(2026, 9, 1, 8)),
        ("t-queued", "queued", 0, _epoch(2026, 10, 14, 8)),
        ("t-running", "running", 1, _epoch(2026, 10, 15, 8)),
    ]
    for slug, status, attempts, updated in tasks:
        con.execute(
            "INSERT INTO tasks (slug, status, attempts, updated, created) VALUES (?,?,?,?,?)",
            (slug, status, attempts, updated, updated),
        )
    if with_attempts:
        for task_id, ts in [(1, _epoch(2026, 10, 12, 7)), (2, _epoch(2026, 10, 13, 6)),
                            (2, _epoch(2026, 10, 13, 7)), (2, _epoch(2026, 10, 13, 8)),
                            (3, _epoch(2026, 9, 1, 7))]:
            con.execute("INSERT INTO attempts VALUES (?,?,?)", (task_id, ts, "free"))
    con.commit()
    con.close()


def test_taskq_section_counts_done_failed_and_attempts(tmp_path):
    db = tmp_path / "taskq.db"
    _make_taskq(db)
    section = wr.taskq_section(str(db), START, NOW)
    assert section["available"] is True
    assert section["done"] == 1
    assert section["failed"] == 1
    assert section["attempts"] == 4
    assert section["avg_attempts"] == pytest.approx(2.0)
    assert section["queued"] == 1
    assert section["running"] == 1


def test_taskq_section_missing_attempts_table_is_soft(tmp_path):
    db = tmp_path / "taskq.db"
    _make_taskq(db, with_attempts=False)
    section = wr.taskq_section(str(db), START, NOW)
    assert section["available"] is False
    assert section["reason"] == "OperationalError"


def test_taskq_section_missing_db_is_soft(tmp_path):
    section = wr.taskq_section(str(tmp_path / "nope.db"), START, NOW)
    assert section == {"available": False, "reason": f"no database at {tmp_path / 'nope.db'}"}


def test_taskq_section_never_writes(tmp_path):
    db = tmp_path / "taskq.db"
    _make_taskq(db)
    before = db.read_bytes()
    wr.taskq_section(str(db), START, NOW)
    assert db.read_bytes() == before  # opened with mode=ro: the queue DB is never modified


# ---------------------------------------------------------------- deploys
def test_deploy_section_reads_json_and_jsonl(tmp_path):
    state = tmp_path / "deploy-state"
    state.mkdir()
    (state / "autodeploy-last.json").write_text(
        json.dumps({"time": "2026-10-15T03:00:00+0000", "target": "abc1234", "result": "ok"}),
        encoding="utf-8",
    )
    (state / "history.jsonl").write_text(
        "\n".join([
            json.dumps({"time": "2026-10-12T10:00:00Z", "result": "failed"}),
            json.dumps({"time": "2026-10-11T10:00:00Z", "result": "ok"}),
            json.dumps({"time": "2026-09-01T00:00:00Z", "result": "ok"}),
            "garbage",
        ]) + "\n",
        encoding="utf-8",
    )
    (state / "ignored.txt").write_text("not state", encoding="utf-8")
    section = wr.deploy_section(str(state), START, NOW)
    assert section["available"] is True
    assert section["records_read"] == 4
    assert section["total"] == 3
    assert section["ok"] == 2
    assert section["failed"] == 1
    assert section["last_result"] == "ok"
    assert section["last_time"] == "2026-10-15 03:00 UTC"


def test_deploy_section_missing_dir_is_soft(tmp_path):
    section = wr.deploy_section(str(tmp_path / "none"), START, NOW)
    assert section["available"] is False


# ---------------------------------------------------------------- Umami
def _fake_umami(calls: list[tuple[str, dict, dict]]):
    def fetch(url, headers, params):
        calls.append((url, headers, params))
        if "/websites/ghazi-id/" in url:
            raise urllib.error.HTTPError(url, 401, "Unauthorized", None, None)
        if url.endswith("/stats"):
            return {"visitors": {"value": 12, "prev": 3}, "pageviews": 40}
        if params.get("type") == "url":
            return [{"x": "/chat?case=1", "y": 9}, {"x": "/judge", "y": 4}]
        if params.get("type") == "event":
            return [
                {"x": "chat_started", "y": 5},
                {"x": "answer_shown", "y": 4},
                {"x": "checkout_started", "y": 2},
                {"x": "payment_success", "y": 1},
            ]
        raise AssertionError(f"unexpected call {url} {params}")

    return fetch


def _env(**extra: str) -> dict[str, str]:
    base = {
        "UMAMI_API_TOKEN": SECRET,
        "UMAMI_WEBSITE_ROXIRA": "roxira-id",
        "UMAMI_WEBSITE_GHAZI": "ghazi-id",
        "UMAMI_API_URL": "http://127.0.0.1:3005/umami/",
    }
    base.update(extra)
    return base


def test_umami_section_per_host_and_partial_failure():
    calls: list = []
    cfg = wr.umami_config(_env())
    section = wr.umami_section(cfg, START, NOW, _fake_umami(calls))
    assert section["status"] == "ok"
    roxira = section["sites"]["roxira.ir"]
    assert roxira["visitors"] == 12
    assert roxira["pageviews"] == 40
    assert roxira["top_pages"] == [("/chat", 9), ("/judge", 4)]
    assert roxira["events"]["chat_started"] == 5
    assert roxira["events"]["payment_success"] == 1
    # one broken host must not hide the other one
    assert section["sites"]["ghazihoushmand.ir"] == {"error": "HTTP 401"}
    # the window is passed in epoch milliseconds, and the bearer token is sent as a header
    stat_url, stat_headers, stat_params = calls[0]
    assert stat_url == "http://127.0.0.1:3005/umami/api/websites/roxira-id/stats"
    assert stat_params["startAt"] == int(START.timestamp() * 1000)
    assert stat_params["endAt"] == int(NOW.timestamp() * 1000)
    assert stat_headers["Authorization"] == f"Bearer {SECRET}"


def test_umami_not_configured_makes_no_calls():
    calls: list = []
    assert wr.umami_config({})["status"] == "not configured"
    cfg = wr.umami_config({"UMAMI_WEBSITE_ROXIRA": "x"})
    assert cfg["reason"] == "UMAMI_API_TOKEN unset"
    section = wr.umami_section(cfg, START, NOW, _fake_umami(calls))
    assert section["status"] == "not configured"
    assert calls == []


# ---------------------------------------------------------------- report and rendering
def _build(tmp_path: Path, env: dict[str, str]) -> dict:
    log = tmp_path / "requests.jsonl"
    _write_cost_log(log)
    db = tmp_path / "taskq.db"
    _make_taskq(db)
    state = tmp_path / "state"
    state.mkdir()
    (state / "autodeploy-last.json").write_text(
        json.dumps({"time": "2026-10-15T03:00:00+0000", "result": "ok"}), encoding="utf-8"
    )
    return wr.build_report(
        NOW,
        days=7,
        env=env,
        cost_log=str(log),
        taskq_db=str(db),
        deploy_state=str(state),
        fetch=_fake_umami([]),
    )


def test_build_report_and_render(tmp_path):
    report = _build(tmp_path, _env())
    assert report["window"] == (START, NOW)
    text = wr.render(report)
    assert text.startswith("گزارش هفتگی روکسیرا | 2026-10-09 تا 2026-10-16 (UTC)")
    assert "بازدیدکننده 12" in text
    assert "HTTP 401" in text
    assert "هر تماس موفق $0.005750" in text
    assert "انجام‌شده 1، ناموفق 1" in text
    assert "در بازه: 1 مورد، موفق 1، ناموفق 0" in text
    assert SECRET not in text
    assert len(text) < 3500  # fits the bot message limit after scrub()


def test_render_reports_missing_sources_without_crashing(tmp_path):
    report = wr.build_report(
        NOW,
        env={},
        cost_log=str(tmp_path / "no.jsonl"),
        taskq_db=str(tmp_path / "no.db"),
        deploy_state=str(tmp_path / "no-dir"),
    )
    text = wr.render(report)
    assert "Umami" in text
    assert "در دسترس نیست" in text
    assert SECRET not in text


def test_main_dry_run_prints_and_never_sends(tmp_path, monkeypatch, capsys):
    sent: list[str] = []
    monkeypatch.setattr(wr.notify, "send", lambda text, *a, **k: sent.append(text) or True)
    monkeypatch.delenv("UMAMI_API_TOKEN", raising=False)
    rc = wr.main(["--dry-run", "--cost-log", str(tmp_path / "x.jsonl"),
                  "--taskq-db", str(tmp_path / "x.db"), "--deploy-state", str(tmp_path / "x")])
    assert rc == 0
    assert sent == []
    assert "گزارش هفتگی روکسیرا" in capsys.readouterr().out


def test_main_sends_through_notify_when_not_dry_run(tmp_path, monkeypatch, capsys):
    sent: list[str] = []
    monkeypatch.setattr(wr.notify, "send", lambda text, *a, **k: sent.append(text) or False)
    monkeypatch.delenv("UMAMI_API_TOKEN", raising=False)
    rc = wr.main(["--cost-log", str(tmp_path / "x.jsonl"),
                  "--taskq-db", str(tmp_path / "x.db"), "--deploy-state", str(tmp_path / "x")])
    assert rc == 0
    assert len(sent) == 1
    assert "not sent" in capsys.readouterr().out


def test_main_rejects_non_positive_days(tmp_path):
    with pytest.raises(SystemExit):
        wr.main(["--dry-run", "--days", "0"])


def test_umami_config_logs_in_with_admin_password():
    import weekly_report as wr
    env = {"UMAMI_ADMIN_PASSWORD": "pw", "UMAMI_WEBSITE_GHAZI": "abc"}
    cfg = wr.umami_config(env, login=lambda api, pw: "tok-" + pw)
    assert cfg["status"] == "ok" and cfg["token"] == "tok-pw" and cfg["api"] == "http://127.0.0.1:3005"
