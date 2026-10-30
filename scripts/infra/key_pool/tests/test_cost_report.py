"""Offline tests for cost_report: aggregation, UTC windows, short output."""
from __future__ import annotations

import json
import pathlib
import sys
from datetime import datetime, timezone

import pytest

HERE = pathlib.Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

import cost_report

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


def _ts(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _rec(group, dep, success, cost, latency, ts):
    return {
        "ts": ts, "model_group": group, "deployment": dep, "provider": "groq",
        "prompt_tokens": 1, "completion_tokens": 1, "response_cost": cost,
        "latency_ms": latency, "success": success, "error": "" if success else "RuntimeError",
    }


def _fixture():
    return [
        _rec("agent-strong-free", "d1", True, 0.001, 100, _ts(NOW)),
        _rec("agent-strong-free", "d1", True, 0.002, 300, _ts(NOW)),
        _rec("agent-strong-free", "d2", False, 0.0, 400, _ts(NOW)),
        _rec("product-free", "d3", True, 0.0005, 50, _ts(NOW)),
        _rec("product-free", "d3", True, 0.0005, 70, _ts(NOW)),
    ]


def test_aggregate_groups_and_top_deployments():
    agg = cost_report.aggregate(_fixture())
    assert agg["calls"] == 5 and agg["success"] == 4
    assert agg["total_cost"] == pytest.approx(0.004)

    groups = {g["group"]: g for g in agg["groups"]}
    strong = groups["agent-strong-free"]
    assert strong["calls"] == 3 and strong["success"] == 2
    assert strong["success_pct"] == pytest.approx(66.666, rel=1e-3)
    assert strong["total_cost"] == pytest.approx(0.003)
    assert strong["cost_per_success"] == pytest.approx(0.0015)
    assert strong["p50"] == pytest.approx(300)
    assert strong["p95"] == pytest.approx(390)

    product = groups["product-free"]
    assert product["success_pct"] == pytest.approx(100.0)
    assert product["p50"] == pytest.approx(60)
    assert product["p95"] == pytest.approx(69)

    assert agg["deployments"][0]["deployment"] == "d1"
    assert agg["deployments"][0]["cost"] == pytest.approx(0.003)
    assert [d["deployment"] for d in agg["deployments"]] == ["d1", "d3", "d2"]


def test_load_records_filters_and_skips_bad_lines(tmp_path):
    path = tmp_path / "requests.jsonl"
    records = _fixture() + [_rec("old", "d9", True, 0.5, 10, "2026-09-01T00:00:00Z")]
    path.write_text("\n".join(json.dumps(r) for r in records) + "\nnot json\n", encoding="utf-8")

    assert len(cost_report.load_records(path, now=NOW)) == 6
    assert len(cost_report.load_records(path, today=True, now=NOW)) == 5
    assert len(cost_report.load_records(path, days=1, now=NOW)) == 5
    assert len(cost_report.load_records(path, days=60, now=NOW)) == 6


def test_short_report_caps_lines(tmp_path, capsys):
    path = tmp_path / "requests.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in _fixture()) + "\n", encoding="utf-8")

    text = cost_report.format_report(cost_report.aggregate(_fixture()), "x", short=True)
    assert len(text.splitlines()) <= 12
    assert "top deployments by cost:" in text

    assert cost_report.main(["--file", str(path), "--short"]) == 0
    out = capsys.readouterr().out
    assert len(out.splitlines()) <= 12


# ---- tagged log (answer / feature / tier), fixtures/requests_tagged.jsonl ----------------
TAGGED = HERE.parent / "fixtures" / "requests_tagged.jsonl"
TAGGED_NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


def _tagged():
    return cost_report.load_records(TAGGED, now=TAGGED_NOW)


def test_tier_uses_logged_tier_then_infers():
    assert cost_report.tier_of({"tier": "free", "response_cost": 1.0}) == "free"
    assert cost_report.tier_of({"deployment": "g:openrouter-paid:K:m"}) == "paid"
    assert cost_report.tier_of({"deployment": "g:openrouter-private:K:m"}) == "paid"
    assert cost_report.tier_of({"deployment": "g:groq:K:m", "response_cost": 0.0}) == "free"
    assert cost_report.tier_of({"deployment": "g:groq:K:m", "response_cost": 0.01}) == "paid"
    assert cost_report.tier_of({"deployment": "d1"}) == "unknown"


def test_per_answer_cost_sums_every_call_of_the_answer():
    agg = cost_report.aggregate(_tagged())
    assert agg["calls"] == 7
    ans = agg["answers"]
    assert ans["answers"] == 3  # ans-a (free retry + free), ans-b (paid), ans-c (2 summary chunks)
    assert ans["paid_answers"] == 2
    assert ans["cost_mean"] == pytest.approx(0.006 / 3)
    assert ans["cost_p50"] == pytest.approx(0.002)
    assert ans["cost_max"] == pytest.approx(0.004)
    assert [a["answer_id"] for a in ans["top"]] == ["ans-b", "ans-c", "ans-a"]
    top_a = ans["top"][2]
    assert top_a["calls"] == 2 and top_a["latency"] == pytest.approx(4000) and top_a["success"]
    assert agg["untagged_calls"] == 2


def test_per_feature_and_free_paid_share():
    agg = cost_report.aggregate(_tagged())
    feats = {f["feature"]: f for f in agg["features"]}
    assert set(feats) == {"chat", "contract_summary", "untagged"}
    chat = feats["chat"]
    assert chat["calls"] == 3 and chat["answers"] == 2
    assert chat["total_cost"] == pytest.approx(0.004)
    assert chat["cost_mean"] == pytest.approx(0.002)
    assert chat["latency_p50"] == pytest.approx(5000)  # answers took 4000 ms and 6000 ms
    assert feats["contract_summary"]["cost_mean"] == pytest.approx(0.002)
    assert feats["untagged"]["answers"] == 0
    assert agg["features"][0]["feature"] == "chat"  # most expensive first

    tiers = agg["tiers"]
    assert tiers["free"]["calls"] == 3 and tiers["free"]["cost"] == 0.0
    assert tiers["paid"]["calls"] == 4
    assert tiers["paid"]["cost"] == pytest.approx(0.0062)


def test_full_report_lists_features_and_answers():
    text = cost_report.format_report(cost_report.aggregate(_tagged()), "fixture")
    assert "free vs paid: calls 42.9% free / 57.1% paid" in text
    assert "answers: 3 (2 touched paid)" in text
    assert "per feature:" in text and "contract_summary" in text
    assert "top answers by cost:" in text and "ans-b" in text


def test_weekly_persian_summary(tmp_path, capsys):
    text = cost_report.format_weekly_fa(cost_report.aggregate(_tagged()))
    assert text.startswith("📊 گزارش هفتگی هزینهٔ مدل‌ها (۷ روز اخیر)")
    assert "فراخوانی‌ها: ۷" in text
    assert "سهم مدل‌های رایگان: ۴۲.۹٪" in text
    assert "پاسخ‌ها: ۳" in text
    assert "• chat: ۰.۰۰۴۰ دلار، ۲ پاسخ" in text
    assert not any(ch.isdigit() and ch in "0123456789" for ch in text.replace("chat", ""))
    assert "ans-" not in text  # no answer ids in the owner message

    empty = cost_report.format_weekly_fa(cost_report.aggregate([]))
    assert "هیچ فراخوانی ثبت نشده" in empty

    assert cost_report.main(["--file", str(tmp_path / "missing.jsonl"), "--weekly-fa"]) == 0
    assert "هیچ فراخوانی" in capsys.readouterr().out



def test_weekly_includes_taskq_block(tmp_path, monkeypatch, capsys):
    import sqlite3
    import sys
    import time
    sys.path.insert(0, str(pathlib.Path(cost_report.__file__).resolve().parents[1] / "server_agents"))
    import taskq
    monkeypatch.setenv("TASKQ_DB", str(tmp_path / "q.db"))
    monkeypatch.setenv("ROXIRA_AGENTS_HOME", str(tmp_path))
    assert cost_report.taskq_weekly_fa() == ""  # no DB yet: nothing printed, nothing created
    assert not (tmp_path / "q.db").exists()
    db = taskq.connect()
    db.execute("INSERT INTO tasks (slug, task_file, ladder, status, cost_usd, created, updated, done_ts) "
               "VALUES ('x', 'f', '[]', 'done', 0.25, ?, ?, ?)", (time.time(), time.time(), time.time()))
    db.commit()
    db.close()
    assert cost_report.main(["--file", str(tmp_path / "missing.jsonl"), "--weekly-fa"]) == 0
    out = capsys.readouterr().out
    assert "هزینهٔ هر تسک پذیرفته‌شده" in out and "۰٫۲۵۰۰" in out or "۰.۲۵۰۰" in out
