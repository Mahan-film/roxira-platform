import json
import subprocess
import sys

import pytest

from src.factory_pipeline.delivery_report import render_delivery_report_fa
from src.factory_pipeline.run_ledger import append_event, make_event, read_events, summarize


def test_round_trip_and_corrupt_line(tmp_path):
    path = tmp_path / "ledger" / "events.jsonl"
    event = make_event("run-1", "intake", "started", now="2026-10-01T00:00:00Z", count=2)
    append_event(path, event)
    path.write_text(path.read_text() + "not json\n", encoding="utf-8")
    assert read_events(path) == [event]
def test_rejects_sensitive_fields_and_bad_stage():
    with pytest.raises(ValueError):
        make_event("run-1", "intake", "ok", note="sk-abcdefghijklmnop")
    with pytest.raises(ValueError):
        make_event("run-1", "intake", "ok", prompt="redacted")
    with pytest.raises(ValueError):
        make_event("run-1", "unknown", "ok")
def test_summarize_uses_last_status_and_costs():
    events = [make_event("run-1", "intake", "started", now="a", cost_usd=1.25),
              make_event("run-1", "intake", "ok", now="b"),
              make_event("run-1", "review", "failed", now="c", cost_usd=2)]
    assert summarize(events) == {"run_id": "run-1", "stages": {"intake": "ok", "review": "failed"},
                                 "failed": ["review"], "total_cost_usd": 3.25}


def test_make_event_normalizes_legacy_terminal_statuses():
    assert make_event("run-1", "research", "success", now="a")["status"] == "ok"
    assert make_event("run-1", "research", "failure", now="b")["status"] == "failed"


def test_cli_appends_redacted_event(tmp_path):
    path = tmp_path / "ledger.jsonl"
    result = subprocess.run(
        [sys.executable, "-m", "src.factory_pipeline.run_ledger", "append",
         "--file", str(path), "--run-id", "run-1", "--stage", "research",
         "--status", "success", "--cost-usd", "0.5", "--issue", "267"],
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 0
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "cost_usd": 0.5, "issue": 267, "run_id": "run-1", "stage": "research",
        "status": "ok", "ts": read_events(path)[0]["ts"],
    }
    assert "پژوهش: انجام شد" in render_delivery_report_fa(summarize(read_events(path)))


def test_task_ledger_summary(tmp_path, monkeypatch):
    from datetime import UTC, datetime

    from src.factory_pipeline.run_ledger import (
        append_task_event,
        error_hash,
        make_task_event,
        summarize_days,
        task_ledger_path,
    )
    monkeypatch.setenv("ROXIRA_STATE_DIR", str(tmp_path))
    assert task_ledger_path() == tmp_path / "runs" / "tasks.jsonl"
    now = datetime(2026, 10, 4, tzinfo=UTC)
    for t, kind, kw in [("2026-10-03T00:00:00Z", "step", {"usd": 0.1}),
                        ("2026-10-03T00:01:00Z", "step", {"usd": 0.1}),
                        ("2026-10-03T00:02:00Z", "end", {"status": "merged", "pr": 5})]:
        append_task_event("a", "cheap", "executor", kind, now=t, **kw)
    append_task_event("b", "cheap", "executor", "park", now="2026-10-03T01:00:00Z",
                      reason="max_usd", err_hash=error_hash("boom"))
    append_task_event("old", "cheap", "executor", "end", now="2026-01-01T00:00:00Z")
    s = summarize_days(7, now=now)
    assert s["tasks"] == 2 and s["merged_prs"] == 1
    assert s["usd_per_merged_pr"] == 0.2 and s["park_rate"] == 0.5
    assert s["per_task"]["a"] == {"steps": 2, "wall_s": 120, "usd": 0.2}
    with pytest.raises(ValueError):
        make_task_event("a", "l", "r", "step", prompt="x")
    with pytest.raises(ValueError):
        make_task_event("a", "l", "r", "step", reason="sk-abcdefghijklmnop")


def test_cli_rejects_secrets_and_bad_status(tmp_path):
    path = tmp_path / "ledger.jsonl"
    secret = "sk-abcdefghijklmnop"
    unsafe = subprocess.run(
        [sys.executable, "-m", "src.factory_pipeline.run_ledger", "append",
         "--file", str(path), "--run-id", secret, "--stage", "research", "--status", "started"],
        text=True, capture_output=True, check=False,
    )
    invalid = subprocess.run(
        [sys.executable, "-m", "src.factory_pipeline.run_ledger", "append",
         "--file", str(path), "--run-id", "run-1", "--stage", "research", "--status", "bad"],
        text=True, capture_output=True, check=False,
    )
    assert unsafe.returncode != 0
    assert secret not in unsafe.stderr
    assert invalid.returncode != 0
    assert not path.exists()
