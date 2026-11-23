# Box lane policy: ladder and path scopes (private-flip decision B1)

Applies to lanes L5-L7 on the Linux box. Config: `config/box_lane_policy.json` (paths and step names only, no secrets).
Code: `scripts/infra/server_agents/lane_policy.py`. It is **off unless** the environment of orch/taskq sets
`ROXIRA_LANE_POLICY=<repo>/config/box_lane_policy.json`; without it nothing changes on the Mac, the server or in CI.
Rule source: AGENTS.md section 4a (lanes touch only non-sensitive paths after the private flip).

## 1. Ladder versus key

The box key `box-lanes` (config/key_pool.yaml) may call only `agent-free`, `agent-light-free`, `agent-strong-free`,
`agent-free-paid` and has a 1 USD/day paid cap. Trace of the default ladder `best,free,ds-flash,strong` (checked
2026-11-22 with `lane-run --dry-run`, no model call):

| Step | taskq passes | `lane-run` / `run_task.sh` group | Box key | What actually happens on the box |
|---|---|---|---|---|
| `best` | `--gateway --public --tier best` | `best-all` | **not allowed** | refused locally (exit 3) when the config pins `MODEL_GROUP`, otherwise a 401/403 from the gateway. Either way an attempt is spent |
| `free` | `--gateway --public` (no tier) | `agent-strong-free` intended | allowed | `taskq-runner.sh` passed no tier, so `lane-run` used the config's `TIER`: a config pinned to `light` turned `free` into a second `light` call, or a refusal when `MODEL_GROUP` was pinned too. Now `taskq-runner.sh` adds `--tier strong` when none is given, and a per-call tier decides the group |
| `ds-flash` | `--model ds-flash` | direct OpenRouter | n/a | `taskq-runner.sh` exits 3: the box holds no provider keys. Attempt spent |
| `strong` | `--model $TASKQ_STRONG_ALIAS` | direct OpenRouter | n/a | skipped unless the alias is set; then refused like `ds-flash` |

Each refused step still writes an attempt row, which counts against the 12/day lane cap and the 30/day global cap. A
fresh task on the default ladder therefore burns up to three attempts before it can reach a model.

Fix in this change:
- `light` (group `agent-light-free`) and `paid` (group `agent-free-paid`) are new ladder steps; `taskq.py add` accepts
  them, `run_task.sh --tier paid` and `lane-run --tier paid` map to the paid group.
- The ladder default is configurable: `TASKQ_LADDER` (env) wins, else the `ladder` of the active policy file, else
  `best,free,ds-flash,strong` unchanged. `orch.py` uses the same function, so its dry run prints the ladder it would use.
- Box ladder: **`light,free,paid`**. `light` is the cheapest free group, `free` (= `agent-strong-free`) is the
  stronger free group, `paid` is last. Keep `free` only while the live gateway health check is green (#1092 is closed
  and #1165 merged, but the owner must have applied the key-pool config on the server: see the readiness checklist).
- `lane-run` refuses a group outside `ALLOWED_GROUPS` (default = the box key's four groups) locally, with a clear message.

Paid spend, honestly: every free group already falls back to `agent-free-paid` **inside the gateway** (config/key_pool.yaml
`fallback:`), so ladder order cannot make paid "last". What bounds paid spend is (a) the key's 1 USD/day cap on the
server, (b) the `lane-run` USD cap per lane (0.5 each, 1.5 summed, above the key cap: the server cap binds first).
The explicit `paid` step exists so a task can be sent straight to the paid group on purpose and so the ladder is honest
about it.

## 2. Path scopes (B1)

How scopes work today: `orch.py` passes operator env `ORCH_SCOPE_<LANE>` (comma list) as `--scope` to `taskq add`, and
`run_task.sh` limits OpenCode edits to those paths and fails the run if a changed file is outside (prefix match, **no
globs**), on top of its own deny regex (secrets, `.env`, `data/`, `*.sql`, ...). Issue text never sets scopes.
Gaps this change closes: an empty scope meant the whole repo, and nothing checked a scope against core paths.

With the policy active:
- a lane's scopes come from `ORCH_SCOPE_<LANE>` if set, else the policy table `lanes.<LANE>.scopes`;
- `require_scope: true`: no scope = refused;
- a scope is refused if it is **inside** a denied path, **a parent of** one (e.g. `output_apps/`), contains a denied
  name (`migrations`, `auth`, `billing`, `pricing`, `payment`, `deploy`, `prompts`, ...) anywhere below it (the tree is
  walked), is a glob, contains `..`, or means the whole repo;
- `orch.py` skips every issue of such a lane in `plan()` (shown as `scope policy refuses: ...`), before any claim, label or
  comment. The same gate refuses an unknown ladder step, a direct-provider step on the box, and a missing `TASKQ_RUNNER`
  (without it the queue calls `run_task.sh` directly and bypasses `lane-run`: stop file, caps, key, group allowlist); `taskq.py add` refuses with exit 2 the same way (so hand-queued tasks are covered too);
- a policy file that is set but unreadable fails closed (all lanes refused).

Default scope table (directories that exist in the repo today; each one is checked against the deny-list by a test):

| Lane | Purpose | Default scopes |
|---|---|---|
| L5 | core ledger | `output_apps/enterprise_hub/modules/accounting/acceptance/`, `.../accounting/__fixtures__/`, `docs/accounting/` |
| L6 | generic UI only (country packs are hub-only) | `output_apps/enterprise_hub/frontend/src/components/ui/`, `.../components/layout/` |
| L7 | box, phone, evals | the box docs in `docs/ops/` one by one (`BOX_*.md`, `LINUX_CI_BOX.md`, `BUILDER_EGRESS.md`), `docs/eval/`, `e2e/` |

Deny-list (summary; the file is authoritative): agent rules and hooks (`AGENTS.md`, `CLAUDE.md`, `.claude`, `.github`,
`.githooks`), secrets and data (`data`, `database_snapshots`, `backups`, `.env*`), key pool and model config, **deploy**
(`deploy`, `ops`, `docker`, `nginx*`, `Dockerfile.prod`, compose files, `scripts/ops`, `scripts/infra`, `scripts/ci`,
`scripts/dev`, `scripts/security`; unit files and prompt, payment, key and secret docs inside `docs/ops`, `docs/infra`, `docs/hub`), **billing and pricing** (`src/billing`, `src/roxira_manager/billing`,
`output_apps/ecosystem_core/src/billing`, the pricing API and plans pages), **tax rules** (`modules/tax_compliance`,
`modules/posting_rules`, **every path under `modules/country_packs/`**: all packs, including `de`, `xx` and `my`, count as tax rules), **Smart Judge prompts and logic** (the whole `output_apps/generated_modules/smartjudge`
and `output_apps/smart_judge`), **auth** (`modules/auth`, `modules/access`, `modules/tenants`, frontend `components/auth`,
`middleware.ts`), **payment** (`country_packs/payment_rails`, `paymentgatewayhub`, the judge payment page), **migrations**
(`output_apps/enterprise_hub/migrations`, `test/migrations`, `data_import/migration`), plus `docs/strategy` and `docs/decisions`.

### Limits you must know
- Scopes are prefixes, so co-located spec files (`*.spec.ts` next to ledger sources) **cannot** be allowlisted without
  allowing the source next to them. L5 is therefore narrow on purpose: acceptance tests, fixtures and docs only. Ledger
  logic itself stays with the hubs, which means **L5 (core ledger) cannot do most of its issue queue under B1**. Owner decision.
- `run_task.sh` denies `data/**` outright, so "public-law data" under `data/` is out of reach for lanes by design.
- **Decision (owner/hub, 2026-11-23):** everything under `output_apps/enterprise_hub/modules/country_packs/` (all packs, including `de`)
  counts as tax rules and is B1 core, hub-only. So are Smart Judge core prompts and algorithms, billing, pricing and tax rules.
  L6 therefore keeps only the generic UI scopes; pack work (Germany, Gulf) stays with the hubs.
- The policy limits what a lane may **edit**. It does not hide files from reading (the model still reads the checkout).
- Scopes are enforced by the runner after the fact (changed files outside scope fail the run) and by the OpenCode
  permission overlay (edits outside scope are denied). Neither hides core code from the model: it can still read the
  whole checkout. A sparse checkout for the box is not part of this change.

## 3. Change control
The unit that runs orch must set `ROXIRA_LANE_POLICY`, `TASKQ_RUNNER=<repo>/scripts/ops/ci_box/lane_runner/taskq-runner.sh`,
`TASKQ_BUDGETS=<repo>/scripts/ops/ci_box/lane_runner/lane_budgets.box.json`, `ROXIRA_AGENTS_HOME=<lane state dir>`, `TASKQ_REVIEW=0`,
`TASKQ_NOTIFY=0` (same as `roxira-lane-taskq.service`).

Edit `config/box_lane_policy.json` only through a reviewed PR (it is itself on the deny-list, so no lane can change it).
After an edit run `python3 -m pytest src/ops/test_lane_policy.py` and `python3 scripts/ops/ci_box/lane_runner/lane_readiness.py`.
