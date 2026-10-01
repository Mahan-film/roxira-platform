def run_checks(solution):
    ledger = {}
    assert solution.claim_step(ledger, "run-1", "extract", 100, 30) is True
    assert solution.claim_step(ledger, "run-1", "extract", 129, 30) is False
    assert ledger[("run-1", "extract")] == 100
    assert solution.claim_step(ledger, "run-1", "extract", 130, 30) is True
    assert solution.claim_step(ledger, "run-1", "index", 130, 30) is True


def check(solution):
    run_checks(solution)
