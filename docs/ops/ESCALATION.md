# Quality-gated model escalation

Try the cheap tier first, run a deterministic gate on the answer, and escalate
to a pricier tier only when the gate fails. Opt-in; nothing changes by default.

Pieces
- `src/ops_fallback/escalation.py`: `run_with_escalation` / `arun_with_escalation`
  (tiers resolve via `config/models.yaml` roles; no model ids in code). Stops
  escalating when the next tier would exceed `max_cost_usd`; raises
  `CostCapExceeded` if even the first tier would. `sensitive=True` raises
  `SensitiveFreeTierError` (before any call) if any tier resolves to a
  `non_sensitive_only` role or a `:free`/`openrouter/free` id.
- `src/ops_fallback/gates.py`: `non_empty_min_length`, `valid_json_with_keys`,
  `persian_text_ratio`, `no_unverified_article_numbers`, `banner_present`,
  `latin_digits_only`, `all_of`. Return `(ok, reasons)`; no content echoed.
- `config/escalation.yaml`: per-feature policy (tiers, sensitive, cap, gates).
  `mid` maps to the `strong` role until a dedicated role exists.
- `output_apps/generated_modules/smartjudge/escalation_helper.py`:
  `complete_with_escalation(tiers, messages, gate, *, sensitive, max_cost_usd)`.

Enabling per endpoint (later, one PR each)
1. Set `SMARTJUDGE_ESCALATION=1` in the service environment (default off; when
   off the helper is one plain `llm_router.complete` call on `tiers[0]`).
2. In the endpoint, replace `await llm_router.complete(tier, msgs, sensitive=...)`
   with `await complete_with_escalation(policy_tiers, msgs, gate, sensitive=...,
   max_cost_usd=...)`, taking tiers/cap/sensitive from the feature's entry in
   `config/escalation.yaml`, and build `gate` with `gates.all_of(...)` (pass the
   validated article numbers and the banner at call time).
3. Flag on returns the engine dict: use `out["result"].content`; check
   `out["ok"]`/`out["stopped"]` and handle a failed gate explicitly.
   Flag off returns the `LLMResult` directly, so branch on `escalation_enabled()`.
4. Customer/case features must keep `sensitive=True`; never list `free` there.
