# Fallback chains

When one provider or key fails (401/402/403/429/5xx/timeout), the next step in a
named chain is tried.

- Config: `config/fallback_chains.yaml` (provider ids + env var NAMES, chain
  order, `allow_free_tier`). No key values, no model ids; models stay in
  `config/models.yaml`, chains reference its roles (`role: cheap|strong|stt`).
- Engine: `src/ops_fallback/chains.py` (`run_with_fallback`, `Cooldown`
  circuit breaker: 3 consecutive failures open a step for 60 s, in memory).
  The `attempts` trail has step names and status codes only.
- Loader: `src/ops_fallback/loader.py` skips steps whose env vars are unset.
- Inspect: `python3 scripts/dev/show_chains.py` (ACTIVE / SKIPPED(no key)).
- Search: `src/ops_fallback/search_adapter.py::search_with_fallback(query)`
  wraps Tavily, Brave, Exa. Jina has no search client in `src/automation` yet,
  so it is skipped until one exists. Empty results count as a failure.

## Rules

- `allow_free_tier: false` means no `:free` model may be used on that chain.
  Case data must only use chains with this flag (AGENTS.md section 4).
- Never log anything but the `attempts` trail.

## Wiring llm_router.py (later task)

1. In `llm_router.py`, resolve the model for the chain `role` via
   `model_registry`; get the step list with
   `active_steps(load_config(), "llm_cheap")`.
2. Wrap the single-provider HTTP call as `call(step)`: build base URL and key
   for that provider (OpenRouter, Mistral, SambaNova and OmniRoute are all
   OpenAI-compatible; endpoints are in `scripts/dev/check_keys.py`), and on a
   non-2xx response raise `StepFailure(resp.status_code)`; on timeout raise
   `StepFailure(None)`.
3. Call `run_with_fallback(steps, call, cooldown=MODULE_LEVEL_COOLDOWN)`; keep
   one module-level `Cooldown` so the breaker persists across requests.
4. Each provider needs its own model id for the role (provider-specific ids
   belong in `config/models.yaml`); skip steps lacking one.
5. Catch `AllStepsFailed` and surface `exc.attempts` (safe to log).
