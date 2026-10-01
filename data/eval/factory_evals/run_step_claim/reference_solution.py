def claim_step(ledger, run_id, step, now, ttl_seconds):
    key = (run_id, step)
    claimed_at = ledger.get(key)
    if claimed_at is not None and now - claimed_at < ttl_seconds:
        return False
    ledger[key] = now
    return True
