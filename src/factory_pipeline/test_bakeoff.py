from __future__ import annotations

import pytest

from src.factory_pipeline.bakeoff import choose, pareto, render_report_fa, summarize


def _candidate(name, trials):
    return {"name": name, "trials": trials}


def _trial(passed, cost_usd, seconds, policy_violations=0):
    return {
        "passed": passed,
        "cost_usd": cost_usd,
        "seconds": seconds,
        "policy_violations": policy_violations,
    }


def test_summarize_metrics():
    summary = summarize(
        _candidate(
            "alpha",
            [_trial(True, 1.0, 10.0), _trial(False, 3.0, 20.0)],
        )
    )
    assert summary.name == "alpha"
    assert summary.success_rate == pytest.approx(0.5)
    assert summary.median_cost == pytest.approx(2.0)
    assert summary.p90_cost == pytest.approx(2.8)
    assert summary.median_seconds == pytest.approx(15.0)
    assert summary.violations_total == 0
    assert summary.eligible


def test_summarize_empty_trials_is_zeroed():
    summary = summarize(_candidate("empty", []))
    assert summary.success_rate == pytest.approx(0.0)
    assert summary.median_cost == pytest.approx(0.0)
    assert summary.p90_cost == pytest.approx(0.0)
    assert summary.median_seconds == pytest.approx(0.0)
    assert summary.violations_total == 0


def test_summarize_counts_violations_and_marks_ineligible():
    summary = summarize(_candidate("bad", [_trial(True, 1.0, 1.0, policy_violations=2)]))
    assert summary.violations_total == 2
    assert not summary.eligible


def _summary(name, success, cost, seconds, violations=0):
    passed_count = round(success * 10)
    trials = [
        _trial(index < passed_count, cost, seconds, violations) for index in range(10)
    ]
    return summarize(_candidate(name, trials))


def test_pareto_drops_dominated_candidate():
    fast = _summary("fast", 0.5, 1.0, 1.0)
    slow = _summary("slow", 0.5, 2.0, 1.0)
    assert pareto([fast, slow]) == [fast]


def test_pareto_keeps_tradeoff():
    accurate = _summary("accurate", 0.9, 5.0, 3.0)
    cheap = _summary("cheap", 0.4, 1.0, 3.0)
    names = {item.name for item in pareto([accurate, cheap])}
    assert names == {"accurate", "cheap"}


def test_pareto_excludes_policy_violators():
    clean = _summary("clean", 0.5, 2.0, 2.0)
    dirty = _summary("dirty", 0.9, 1.0, 1.0, violations=1)
    assert pareto([clean, dirty]) == [clean]


def test_choose_without_incumbent_prefers_success_then_cost():
    high = _summary("high", 0.9, 5.0, 2.0)
    cheap = _summary("cheap", 0.9, 1.0, 2.0)
    winner, reasons = choose([high, cheap])
    assert winner is not None and winner.name == "cheap"
    assert any("cheap" in reason for reason in reasons)


def test_choose_empty_input_has_no_winner():
    winner, reasons = choose([], incumbent=None)
    assert winner is None
    assert reasons == ["هیچ نامزد واجد شرایطی وجود ندارد."]


def test_choose_all_ineligible_has_no_winner():
    bad = _summary("bad", 1.0, 1.0, 1.0, violations=1)
    winner, reasons = choose([bad])
    assert winner is None
    assert any("نقض سیاست" in reason for reason in reasons)


def test_incumbent_retained_when_not_strictly_better():
    incumbent = _summary("inc", 0.8, 1.0, 2.0)
    equal = _summary("equal", 0.8, 1.0, 2.0)
    winner, reasons = choose([incumbent, equal], incumbent="inc")
    assert winner is incumbent
    assert any("حفظ کرد" in reason for reason in reasons)


def test_incumbent_replaced_on_higher_success_and_cheaper_cost():
    incumbent = _summary("inc", 0.6, 3.0, 2.0)
    challenger = _summary("new", 0.9, 2.0, 2.0)
    winner, reasons = choose([incumbent, challenger], incumbent="inc")
    assert winner is not None and winner.name == "new"
    assert any("را گرفت" in reason for reason in reasons)


def test_incumbent_retained_when_cost_higher():
    incumbent = _summary("inc", 0.6, 1.0, 2.0)
    challenger = _summary("new", 0.9, 2.0, 2.0)
    winner, reasons = choose([incumbent, challenger], incumbent="inc")
    assert winner is incumbent
    assert any("حفظ کرد" in reason for reason in reasons)


def test_incumbent_missing_falls_back_to_best_eligible():
    best = _summary("best", 0.9, 1.0, 1.0)
    winner, reasons = choose([best], incumbent="ghost")
    assert winner is best
    assert any("ghost" in reason for reason in reasons)


def test_persian_report_contains_every_name():
    alpha = _summary("alpha", 0.5, 1.0, 1.0)
    beta = _summary("beta", 0.9, 2.0, 2.0)
    text = render_report_fa([alpha, beta], beta, ["دلیل"])
    assert "alpha" in text
    assert "beta" in text
    assert "برنده: beta" in text
    assert "دلیل" in text


def test_persian_report_uses_blind_labels():
    alpha = _summary("alpha", 0.5, 1.0, 1.0)
    beta = _summary("beta", 0.9, 2.0, 2.0)
    text = render_report_fa([alpha, beta], beta, [], labels={"alpha": "A", "beta": "B"})
    assert "| A |" in text
    assert "| B |" in text
    assert "برنده: B" in text
    assert "alpha" not in text


def test_persian_report_without_winner():
    text = render_report_fa([], None, ["خالی"])
    assert "برنده: ندارد" in text
    assert "خالی" in text
