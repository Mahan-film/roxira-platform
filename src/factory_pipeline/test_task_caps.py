from src.factory_pipeline.task_caps import CONTINUE, PARK, CapTracker, TaskCaps


def make(**kw):
    t = [0.0]
    return CapTracker(TaskCaps(**kw), clock=lambda: t[0]), t


def test_continue_and_defaults():
    tr, _ = make()
    assert tr.record(1, 1000, 100, 0.01).action == CONTINUE
    assert TaskCaps().max_usd == 0.50


def test_caps_park():
    tr, _ = make(max_turns=2)
    assert tr.record(2, 1, 1, 0).action == CONTINUE
    assert tr.record(3, 1, 1, 0).action == PARK
    tr, _ = make(max_usd=0.1)
    assert tr.record(1, 1, 1, 0.2).parked
    tr, _ = make(max_input_tokens=100)
    assert tr.record(1, 101, 1, 0).parked


def test_wall_clock_injectable():
    tr, t = make(max_wall_seconds=10)
    assert not tr.record(1, 1, 1, 0).parked
    t[0] = 11
    assert "wall" in tr.record(2, 1, 1, 0).reason


def test_token_warning_at_85_percent():
    tr, _ = make(max_input_tokens=1000)
    assert tr.record(1, 849, 0, 0).warnings == ()
    a = tr.record(2, 1, 0, 0)
    assert a.action == CONTINUE and a.warnings


def test_strikes_consecutive_identical_only():
    tr, _ = make()
    assert not tr.record(1, 1, 1, 0, "E1").parked
    assert not tr.record(2, 1, 1, 0, "E1").parked
    assert tr.record(3, 1, 1, 0, "E1").parked
    tr, _ = make()
    for i, sig in enumerate(["E1", "E1", "E2", "E1", "E1"], 1):
        assert not tr.record(i, 1, 1, 0, sig).parked
    tr.record(6, 1, 1, 0, None)
    assert tr.strikes == 0
