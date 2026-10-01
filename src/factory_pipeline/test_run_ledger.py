import pytest
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
