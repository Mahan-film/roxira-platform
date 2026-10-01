def claim_step(ledger, run_id, step, now, ttl_seconds):
    key = (run_id, step)
    if key in ledger:
        return False
    ledger[key] = now
    return True
