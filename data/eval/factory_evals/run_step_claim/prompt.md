# Idempotent run-step claimer

Implement `claim_step(ledger, run_id, step, now, ttl_seconds)` in `starter.py`. `ledger` is a mutable dictionary. Claim a `(run_id, step)` key by saving `now` and returning `True` when it has never been claimed or its prior claim is at least `ttl_seconds` old. Otherwise return `False` and do not change the stored timestamp. This must be deterministic: `now` is supplied by the caller.
