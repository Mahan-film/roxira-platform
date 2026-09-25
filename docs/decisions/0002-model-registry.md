# 2. One model registry, read by product, research and builder agents

Date: 2026-09-25
Status: accepted

## Context

Model ids were hardcoded in several places (`llm_router.py`,
`src/automation/provider_base.py`, `opencode.json`, `AGENTS.md`), so an
OpenRouter price change or retirement meant hunting through the repo, and
each place could silently drift out of sync with the others.

## Decision

`config/models.yaml` is the single source of truth for "which model for
which job" (docs/STRATEGY.md §3). It defines named roles — product tiers
(`free`, `cheap`, `strong`, `stt`, `tts`) and builder roles (`architect`,
`executor`, `reviewer`, `mechanical`) — each with an ordered list of model
ids and prices. `output_apps/generated_modules/smartjudge/model_registry.py`
is the only loader; every reader (the router, `provider_base.py`,
`agent_runner.py`'s `DEFAULT_MODEL`, `opencode.json`'s agents) goes through it
or through `scripts/check_models.py`. No model id is hardcoded elsewhere.

`scripts/check_models.py` diffs the registry against the live OpenRouter
catalogue and fails on a missing *primary* model.
`.github/workflows/model-registry-check.yml` runs it weekly and opens/updates
one issue labelled `model-registry` on drift (missing primary, or a price
move over 20%). It never edits `config/models.yaml` itself — a swap is a
normal PR, gated on the evals (W6 legal eval, one coding smoke task) not
regressing.

## Consequences

- Changing a model id is a one-file edit plus a PR; every reader picks it up.
- The registry can be stale between weekly checks; the check is advisory
  (opens an issue), not a merge gate, and an env var still overrides any
  role's model list at runtime for an emergency swap.
