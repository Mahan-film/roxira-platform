# Bake-off lab

The owner's headline feature: for one brief, build a small tracer bullet of
each candidate stack, run the **same** acceptance suite on all of them, score
the results on a Pareto frontier, and post a Persian comparison with the
winner. This page describes the run and the existing pieces it reuses. The
scoring core is `src/factory_pipeline/bakeoff.py` (pure, no I/O).

## What counts as a candidate

A candidate is a stack choice for the *same* brief — for example three
different frontend/data stacks. All candidates must be built from the same
spec, the same acceptance suite and the same tool/agent envelope, so the only
difference measured is the stack itself.

Hard caps for one run:

- **At most 3 candidates.**
- **One build at a time** (no parallel builds on the single host).
- **One cost cap per run**, checked before each build with
  `src/factory_pipeline/budget.py`.
- Each candidate is built in its own disposable preview and torn down after.

## Tracer bullet

A tracer bullet is the **smallest vertical slice** of the brief that still
touches every layer of the stack, with exactly **one end-to-end test** that
proves it works. It is not a prototype or a mock: the slice must run for real
in a preview. Example: one Persian form page that validates input on the
client, posts to the backend, persists one row, and passes a single Playwright
E2E test. The point is to measure the stack end to end at the least cost, not
to build the product.

## Run shape

1. Pick the brief and freeze the spec and the acceptance suite (same for all).
2. For each candidate, in order, up to 3:
   - start an isolated preview (`scripts/ops/preview.sh up <slug> <compose>`);
   - build the tracer bullet from the golden template;
   - run the shared acceptance suite (unit + typecheck + one E2E test) and
     record each trial as `{passed, cost_usd, seconds, policy_violations}`;
   - tear the preview down (`scripts/ops/preview.sh down <slug>`).
3. Score the recorded trials with `bakeoff.summarize`, `bakeoff.pareto` and
   `bakeoff.choose`; render with `bakeoff.render_report_fa`.
4. Post the Persian table and winner on the parent issue; keep the raw trials
   in the run ledger.

## Scoring rules (`src/factory_pipeline/bakeoff.py`)

- `summarize(candidate)` → `success_rate`, `median_cost`, `p90_cost`,
  `median_seconds`, `violations_total`.
- `pareto(summaries)` → candidates not dominated on (higher success rate,
  lower p90 cost, lower median time). A candidate with any policy violation is
  **never eligible**.
- `choose(summaries, incumbent=None)` → a challenger replaces the incumbent
  only if its success rate is **strictly higher** and its p90 cost is **no
  higher** than the incumbent's. With no incumbent, the best eligible
  candidate by success rate then cost wins. Returns the winner and Persian
  reason strings.
- `render_report_fa(summaries, winner, reasons, labels=None)` → compact Persian
  comparison table (candidate, success rate, cost, time, violations) plus the
  winner line. `labels` optionally maps names to blinded labels (A/B/C).

## What already exists

The lab is mostly assembly of pieces that are already in the repo:

| Piece | Path | Role in a bake-off |
| --- | --- | --- |
| Preview lifecycle | `scripts/ops/preview.sh` | one isolated preview per candidate, 24 h TTL, one build at a time (see `docs/ops/PREVIEW.md`) |
| Golden templates | `templates/roxira-static-rtl/`, `src/factory_pipeline/template_check.py` | starting point for the tracer bullet and offline template acceptance checks |
| Tournament runner | `scripts/eval_tournament.py` | blinded, repeated trials + a Pareto pass for model tournaments (see `docs/ops/TOURNAMENT.md`) |
| Run ledger | `src/factory_pipeline/run_ledger.py`, `src/factory_pipeline/ledger_comments.py` | redacted per-stage records and cost totals for each candidate build |
| Budget breaker | `src/factory_pipeline/budget.py` | enforces the per-run cost cap |
| Scoring core | `src/factory_pipeline/bakeoff.py` | this task: summary metrics, Pareto frontier, promotion rule, Persian report |

The scoring here is deterministic and model-independent; no LLM judge is an
acceptance authority (docs/research/nextgen/B_selfimprovement_bakeoff_radar.md).
