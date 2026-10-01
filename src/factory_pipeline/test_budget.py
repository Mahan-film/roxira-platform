from src.factory_pipeline.budget import can_spend, evaluate, from_summary, render_fa


def test_thresholds_and_persian_labels():
    cases = [(2.39, "ok", "عادی"), (2.40, "warn", "هشدار"), (3.00, "tripped", "متوقف شد")]
    for spent, status, label in cases:
        state = evaluate(spent)
        assert state.status == status
        assert render_fa(state) == f"بودجه: {spent:.2f} از 3.00 دلار — {label}"


def test_can_spend_blocks_overspend_and_tripped_state():
    assert not can_spend(evaluate(2.9), 0.11)
    assert can_spend(evaluate(2.9), 0.10)
    assert not can_spend(evaluate(3.0), 0)


def test_summary_defaults_to_zero():
    state = from_summary({})
    assert (state.spent_usd, state.status) == (0, "ok")


def test_invalid_values_raise_value_error():
    for call in (lambda: evaluate(-1), lambda: evaluate(0, 0), lambda: can_spend(evaluate(0), -1)):
        try:
            call()
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError")
