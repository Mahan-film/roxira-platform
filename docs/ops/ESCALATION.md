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

## Chat answer escalation (B3, wired in `/chat`)

Module: `output_apps/generated_modules/smartjudge/answer_escalation.py`, called from
`interactive_consult` on the llm_router path only (not voice, not the legacy direct-stream path).
Same flag as above: `SMARTJUDGE_ESCALATION=1` (default off => zero behaviour change, no extra guard call).

Deterministic triggers (no extra model call; the citation guard runs once on the first answer):
`no_valid_citation` (retrieval grounded the answer but the guard validates no article),
`invented_citation` (guard flagged an article), `too_short` (complex question = case files attached
or question >= `SMARTJUDGE_ESCALATION_COMPLEX_CHARS`, default 160; answer < `SMARTJUDGE_ESCALATION_MIN_ANSWER_CHARS`, default 400).

On a trigger the same messages are re-asked once on the `strong` tier (`sensitive=True`, so never
`:free`; ids from `config/models.yaml`). Any failure keeps the first answer. Policy env:
- `SMARTJUDGE_ESCALATION_SCOPE=vip` (default) or `all`; with `all`, non-VIP re-asks are capped by
  `SMARTJUDGE_ESCALATION_DAILY_CAP` (default 50/day, global, Redis via chat_auth.incr). VIP is uncapped.
- `SMARTJUDGE_ESCALATION_MAX_COST_USD` (default 0.05) per re-ask, via the engine's estimate.
- Note: with the default `SMARTJUDGE_ROUTER_TIER_VIP=strong`, VIP already starts on `strong`, so
  nothing escalates for VIP; escalation matters for FREE (scope `all`) or a VIP tier set to `cheap`.
- Logs: `[SMARTJUDGE][ESCALATION] outcome=escalated|capped|failed|empty triggers=a,b` (codes only).

### Measuring the effect with `scripts/eval/legal_gate.py answer` (PAID; do not run casually)
Run the same capped set twice against the same deployment, flipping only the env flag, and compare
the two JSON reports (accuracy checks, citation validity, latency, `--max-cost-usd` hard cap):

    # A: baseline (flag off)
    ROXIRA_EVAL_TOKEN=... python3 scripts/eval/legal_gate.py answer --base-url $URL \
        --confirm-spend --max-cost-usd 1 --json-out /tmp/ans_off.json
    # B: restart the service with SMARTJUDGE_ESCALATION=1 (and SCOPE=all to test a FREE token), then
    ROXIRA_EVAL_TOKEN=... python3 scripts/eval/legal_gate.py answer --base-url $URL \
        --confirm-spend --max-cost-usd 1 --json-out /tmp/ans_on.json

Compare pass rate / cited-article validity / mean latency in the two files; count escalations from the
`[SMARTJUDGE][ESCALATION] outcome=escalated` log lines for the same window to get the cost side.
