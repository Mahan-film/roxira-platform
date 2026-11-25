# Full autonomy gap analysis — 2026-10-01

## Scope and verdict

This is a repository-first gap analysis. “Live” means explicitly documented as
run on a real brief/task/release, not merely unit-tested or merged. The current
control plane is a strong, security-minded **issue → isolated Actions runner →
PR → CI/review** design. It is not yet an owner-operated autonomous delivery
system: its first real Factory run is pending, all research secrets are absent,
there is no preview environment, and production deployment is an owner-run SSH
operation rather than a workflow. The delivery tail is therefore the critical
path, not another agent framework.

Repository evidence was read at the 2026-10-01 snapshot. External controls
below use the official GitHub documentation for environments/concurrency and
the OpenRouter key-limit API; those controls must be rechecked when enabled.
[GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
can protect secrets and serialize a deployment, while [OpenRouter keys](https://openrouter.ai/docs/api/api-reference/api-keys/update-keys)
support a USD limit with daily reset.

## 1. Target pipeline, stage by stage

| Stage | What exists today (repository evidence) | Missing for the target | Severity | Owner-only action / automatable |
|---|---|---|---|---|
| Intake | Persian GitHub issue template adds `brief`; a labelled issue triggers research ([PROJECT_FACTORY.md:73-75](../PROJECT_FACTORY.md#L73-L75), [factory-research.yml:16-24](../../.github/workflows/factory-research.yml#L16-L24)). | One central owner console spanning new apps and Smart Judge changes; request classification, tenant/repo choice, SLA and budget confirmation. | Major | Automatable after owner creates/authorizes the GitHub control plane. |
| Research | Multilingual radar, Persian output, `$0.50` argument cap and artifact are wired ([factory-research.yml:90-123](../../.github/workflows/factory-research.yml#L90-L123)). W9 has an offline mode but its three live briefs remain pending ([STRATEGY.md:122](../STRATEGY.md#L122)). | Real search/crawl credentials, a first live evidence-quality evaluation, source retention/citations and degraded-run approval policy. | Blocker | Owner adds six Actions secrets and caps the research key; execution is automatable. |
| Proposal / approval | Persian proposal comment, `/approve` or `approved`, allowlist and Factory kill switch are implemented ([PROJECT_FACTORY.md:74-76](../PROJECT_FACTORY.md#L74-L76), [factory-plan.yml:44-53](../../.github/workflows/factory-plan.yml#L44-L53)). | Recorded choice/budget/architecture approval with an immutable release scope; no owner dashboard outside GitHub. | Major | Approval intentionally remains owner-only; parsing/reporting is automatable. |
| Planning / decomposition | Strong-model planner writes a dependency-ordered plan and at most 15 child issues ([PROJECT_FACTORY.md:76](../PROJECT_FACTORY.md#L76)); its workflow has a 15-minute ceiling ([factory-plan.yml:37-95](../../.github/workflows/factory-plan.yml#L37-L95)). | A checked task contract for ownership (frontend/backend/DB/tests), migration risk, interface contracts, test/preview acceptance and cross-team conflict policy. | Major | Automatable, except owner approval of DB/security/legal scope. |
| Parallel implementation | `agent-task` uses disposable runners, explicit minimal credentials and `agent/*` branches ([agent-task.yml:3-15](../../.github/workflows/agent-task.yml#L3-L15), [agent-task.yml:118-141](../../.github/workflows/agent-task.yml#L118-L141)). The Factory dispatches unblocked tasks after merges ([factory-build.yml:1-32](../../.github/workflows/factory-build.yml#L1-L32)). | No demonstrated multi-task run; cap is a race-prone `gh run list` approximation, not a durable queue; no capability-specific team lanes or merge-conflict resolver. | Blocker | Owner enables W10 and capped key; implementation is automatable within bounded tasks. |
| Review / merge | Trusted-`main` reviewer fetches diff as data and fails closed ([agent-review.yml:10-30](../../.github/workflows/agent-review.yml#L10-L30)); auto-merge is opt-in and sensitive-path restricted ([agent-automerge.yml:3-10](../../.github/workflows/agent-automerge.yml#L3-L10)). | First live reviewer/automerge evidence; required checks do not yet include Undefined names/System inventory ([STATE.md:15-16](../STATE.md#L15-L16)); high-risk PR routing is not a formal policy engine. | Major | Owner sets ruleset and decides auto-merge; review/labeling can automate. |
| Tests, including browser E2E | CI covers PR gates; a daily Playwright smoke runs against production and files an issue on failure ([e2e-smoke.yml:1-7](../../.github/workflows/e2e-smoke.yml#L1-L7), [e2e-smoke.yml:60-108](../../.github/workflows/e2e-smoke.yml#L60-L108)). | No per-PR preview E2E, seeded isolated test data, authenticated/payment-safe flows, cross-browser matrix or release acceptance gate. Known queue records E2E as red ([STATE.md:41-42](../STATE.md#L41-L42)). | Blocker | Automatable; owner supplies non-production test identities/provider sandbox settings if required. |
| Preview environment | Factory v1 writes under `projects/<slug>/`; it does not create another repo ([PROJECT_FACTORY.md:61-67](../PROJECT_FACTORY.md#L61-L67)). | No workflow, host, DNS/routing, ephemeral DB, teardown, preview URL or preview E2E exists. | Blocker | Owner installs/authorizes preview host, wildcard DNS and credentials; lifecycle automatable. |
| Production deploy | `deploy.sh` validates Compose, captures `:prev`, waits for health, refreshes nginx and rolls back container-health failure ([deploy.sh:12-23](../../scripts/ops/deploy.sh#L12-L23), [deploy.sh:182-206](../../scripts/ops/deploy.sh#L182-L206)). | No `deploy-prod.yml`, production environment, restricted deploy transport, SHA/service gate, public acceptance gate or deploy record; deploy is manual/owner-run ([OPERATIONS_RUNBOOK.md:5-13](../OPERATIONS_RUNBOOK.md#L5-L13)). | Blocker | Owner installs forced-command/pull deployer and grants environment/secret access; triggering/verifying can automate. |
| Observe / rollback | Fifteen-minute external uptime probe and daily production smoke open/update issues ([uptime.yml:1-7](../../.github/workflows/uptime.yml#L1-L7), [uptime.yml:67-102](../../.github/workflows/uptime.yml#L67-L102)). `deploy.sh` can roll back container-health failures. | No correlation to deploy SHA, public post-deploy rollback, recovery closing, log/metric alerts, paging, 3-failure/2-recovery policy or off-host monitor. | Major | Monitor install/notification secret are owner-only; probing, incident and bounded rollback can automate. |
| Persian report | `/status` posts Persian task/PR/spend status ([PROJECT_FACTORY.md:77-78](../PROJECT_FACTORY.md#L77-L78), [factory-status.yml:85-95](../../.github/workflows/factory-status.yml#L85-L95)). | No final Persian delivery report tying research, approvals, PRs, preview, deploy, verification, cost and rollback status together. | Major | Fully automatable once durable run evidence exists. |
| Memory / learning | Reviewed Markdown/ADRs are durable source of truth; model registry has live-check metadata ([AGENTIC_TOOLING_RESEARCH_2026-10.md:28-36](AGENTIC_TOOLING_RESEARCH_2026-10.md#L28-L36), [models.yaml:1-19](../../config/models.yaml#L1-L19)). | No immutable Factory run ledger, outcome-to-plan/model feedback, reusable acceptance fixtures, or approval/audit memory across projects. | Major | Automatable; owner approves retention/redaction policy. |

## 2. Real limits and operational blockers

### Not proved live

- W9 research has not run live on its three target briefs; W11 waits for that
  run and W10 owner setup before its first real project ([STRATEGY.md:122-124](../STRATEGY.md#L122-L124)).
  Consequently, Factory research, plan, build dispatch and status have no
  repository-documented end-to-end run; neither do their dependent first-live
  agent review/automerge gates. This is an evidence gap, not a claim that no
  GitHub run exists.
- `e2e-smoke.yml` and `uptime.yml` are scheduled, but this snapshot contains no
  run history proving green execution. E2E is separately listed as red
  ([STATE.md:41-42](../STATE.md#L41-L42)). There is no preview/deploy workflow
  to have run at all; `deploy-prod.yml` is explicitly only a proposed task
  ([AUTONOMY_OPS_RESEARCH_2026-10.md:142-151](AUTONOMY_OPS_RESEARCH_2026-10.md#L142-L151)).

### Secrets, spend, stop controls

- Only `OPENROUTER_AGENT_KEY` exists in Actions. `OPENROUTER_RESEARCH_KEY` and
  `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`,
  `TAVILY_KEYS` are absent, so research receives empty values
  ([SYSTEM_MAP.md:95-111](../SYSTEM_MAP.md#L95-L111)); the workflow consumes all
  six ([factory-research.yml:90-106](../../.github/workflows/factory-research.yml#L90-L106)).
- `FACTORY_ENABLED` and `AGENT_ENABLED` are real pre-checkout kill switches;
  a separate production kill switch is recommended but absent from workflows
  ([factory-research.yml:42-50](../../.github/workflows/factory-research.yml#L42-L50),
  [agent-task.yml:52-64](../../.github/workflows/agent-task.yml#L52-L64)).
- Research has an invocation cap; agent Actions ledger is ephemeral and the
  real cross-run cap is the provider key limit ([agent-task.yml:126-138](../../.github/workflows/agent-task.yml#L126-L138),
  [AGENTS_WORKFORCE.md:164-186](../AGENTS_WORKFORCE.md#L164-L186)). Planning,
  review, status, preview/hosting, Actions minutes and deployment costs lack
  one durable, whole-request budget ledger and circuit breaker.

### Parallelism and permissions

- Local `rx` is limited to three workers, two Claude subagents and one extra
  chat ([STATE.md:5-8](../STATE.md#L5-L8)). Starting two `rx` workers together
  collides on `.git/config`; the Mac is a single, flaky networked machine
  ([OPERATIONS_RUNBOOK.md:15-19](../OPERATIONS_RUNBOOK.md#L15-L19),
  [OPERATIONS_RUNBOOK.md:31-34](../OPERATIONS_RUNBOOK.md#L31-L34)).
- GitHub worker concurrency is default two and is checked by listing live runs,
  so simultaneous starts can pass the check; it also requires manual re-run
  after deferral ([agent-task.yml:27-31](../../.github/workflows/agent-task.yml#L27-L31),
  [agent-task.yml:88-110](../../.github/workflows/agent-task.yml#L88-L110)).
  Provider/network rate limits remain an unmodelled capacity limit.
- The assistant's auto-mode classifier refuses SSH writes, Docker writes,
  secret-store writes and direct merges. The owner must run them or add local
  allow rules ([OPERATIONS_RUNBOOK.md:11-13](../OPERATIONS_RUNBOOK.md#L11-L13),
  [STATE.md:28-34](../STATE.md#L28-L34)). This prevents autonomous server setup
  from this assistant session, by design.

## 3. Dependency-ordered roadmap (25 items maximum)

Each item is one reviewable `rx`-sized change. “Owner” means an external
setting/install only the owner can authorize; every code item includes one
offline test to run in CI before any live enablement.

### Phase 0 — make the existing control plane demonstrably safe

1. **Owner + repo agent:** add `docs/PROJECT_FACTORY.md` preflight evidence
   checklist for the six research secrets, `FACTORY_ENABLED`, W10 variables,
   labels and ruleset; test: `rg -n "OPENROUTER_RESEARCH_KEY|FACTORY_ENABLED" docs/PROJECT_FACTORY.md`.
2. **Repo agent:** add `scripts/factory/preflight.py` and
   `src/factory/test_preflight.py` to return a Persian, redacted missing-control
   report; test: `python3 -m pytest src/factory/test_preflight.py`.
3. **Owner:** create dedicated daily-capped research/agent keys, add the six
   Actions secrets, set `AGENT_ENABLED=true` only for the live trial, and apply
   the required-check ruleset; record names only in `docs/STATE.md`; test:
   `python3 scripts/factory/preflight.py --offline --fixture tests/fixtures/factory-controls.json`.
4. **Owner + repo agent:** run one harmless labelled `agent` issue end-to-end
   and preserve the run/PR links in `docs/STATE.md`; test before enablement:
   `python3 -m pytest src/factory/test_agent_runner.py`.

### Phase 1 — make Factory requests durable and team-shaped

5. **Repo agent:** add `src/factory_pipeline/task_contract.py`,
   `src/factory/test_task_contract.py`, and update
   `output_apps/ecosystem_core/src/factory/factory_plan.py` to require owner,
   allowed paths, interface, migration flag, test, preview gate and stop rule;
   test: `python3 -m pytest src/factory/test_task_contract.py`.
6. **Repo agent:** add `src/factory_pipeline/run_ledger.py`,
   `src/factory/test_run_ledger.py`, and update
   `.github/workflows/factory-research.yml`, `factory-plan.yml`,
   `factory-build.yml`, `factory-status.yml` to persist a redacted run-record
   artifact; test: `python3 -m pytest src/factory/test_run_ledger.py`.
7. **Repo agent:** add `src/factory_pipeline/dispatch_queue.py`,
   `src/factory/test_dispatch_queue.py`, and update `factory_plan.py` plus
   `factory_dispatch_next.py` for idempotent leasing/backoff instead of only
   `gh run list`; test: `python3 -m pytest src/factory/test_dispatch_queue.py`.
8. **Owner + repo agent:** perform one low-risk real brief → proposal → approval
   → plan trial, with Factory still unable to deploy; append evidence to
   `docs/STATE.md`; test: `python3 -m pytest src/factory/test_factory_plan.py`.

### Phase 2 — preview, test and release acceptance

9. **Repo agent:** add `scripts/ops/preview_gate.sh` and
   `src/ops/test_preview_gate.py` for slug/SHA/service allowlisting and teardown
   contract; test: `python3 -m pytest src/ops/test_preview_gate.py`.
10. **Owner + repo agent:** add `.github/workflows/preview.yml`,
    `src/ops/test_preview_workflow_contract.py`, and a `preview` GitHub
    environment; owner installs a restricted preview transport, DNS and an
    isolated database namespace; test: `python3 -m pytest src/ops/test_preview_workflow_contract.py`.
11. **Repo agent:** add `scripts/ops/verify_preview_release.sh`,
    `src/ops/test_verify_preview_release.py`, and `e2e/tests/release.spec.ts`
    for URL receipt, health and browser acceptance; test:
    `python3 -m pytest src/ops/test_verify_preview_release.py`.
12. **Repo agent:** update `.github/workflows/factory-build.yml`,
    `.github/workflows/factory-status.yml` and add
    `src/factory/test_factory_release_state.py` so no task/project reaches
    release-ready before preview/E2E evidence; test:
    `python3 -m pytest src/factory/test_factory_release_state.py`.

### Phase 3 — constrained production delivery and observation

13. **Repo agent:** add `scripts/ops/deploy_gate.sh` and
    `src/ops/test_deploy_gate.py` for `flock`, SHA-ancestor and service
    allowlist/result schema; test: `python3 -m pytest src/ops/test_deploy_gate.py`.
14. **Owner + repo agent:** add `.github/workflows/deploy-prod.yml` and
    `src/ops/test_deploy_workflow_contract.py`; owner creates the `production`
    environment and a forced-command SSH key or pull deployer; test:
    `python3 -m pytest src/ops/test_deploy_workflow_contract.py`.
15. **Repo agent:** add `scripts/ops/verify_public_release.sh` and
    `src/ops/test_verify_public_release.py` for retryable public probes and one
    bounded rollback decision; test: `python3 -m pytest src/ops/test_verify_public_release.py`.
16. **Owner + repo agent:** add `ops/gatus/config.yaml`,
    `src/ops/test_gatus_config.py` and `.github/workflows/availability-incident.yml`;
    owner installs off-host Gatus and notification/webhook secrets; test:
    `python3 -m pytest src/ops/test_gatus_config.py`.

### Phase 4 — scale, reporting and learning

17. **Repo agent:** add `src/factory_pipeline/budget.py`,
    `src/factory/test_budget.py`, and update `.github/workflows/factory-plan.yml`,
    `agent-task.yml`, `agent-review.yml`, `factory-status.yml` for one run-level
    cap and persisted ledger; test: `python3 -m pytest src/factory/test_budget.py`.
18. **Repo agent:** add `output_apps/ecosystem_core/src/factory/factory_report.py`,
    `src/factory/test_factory_report.py`, and update `factory-status.yml` to
    post a final Persian evidence/cost/release report; test:
    `python3 -m pytest src/factory/test_factory_report.py`.
19. **Repo agent:** add `evals/factory/cases.yaml`,
    `src/factory/test_learning_record.py`, and a redacted outcome recorder for
    plan/model/test regressions; test: `python3 -m pytest src/factory/test_learning_record.py`.
20. **Owner + repo agent:** add `.github/workflows/factory-ops-report.yml` and
    `src/factory/test_ops_report_policy.py` for a daily Persian read-only fleet
    report; owner enables its schedule only after two successful releases; test:
    `python3 -m pytest src/factory/test_ops_report_policy.py`.
21. **Owner + repo agent:** add `src/factory_pipeline/repository_bootstrap.py`,
    `src/factory/test_repository_bootstrap.py`, and update
    `output_apps/ecosystem_core/src/factory/factory_plan.py`; owner installs a
    least-privilege GitHub App for separate-repository creation and seeding;
    test: `python3 -m pytest src/factory/test_repository_bootstrap.py`.

## 4. Measurable definition of done

All scenarios require: a unique Factory run ID; preflight green; provider key
limit observed; issue/approval links; plan/task contracts; PR/CI/reviewer URLs;
preview URL and Playwright artifact; production deployment ID/SHA; public probe
result; final Persian report; and a redacted immutable ledger. Any missing item
is a failed delivery, not a “partial autonomous” success.

| Acceptance scenario | Expected stage evidence |
|---|---|
| **A. Add a Persian FAQ page to Smart Judge** | Intake records route/content owner and no migration. Research proposal cites sources in Persian; owner approves. Plan assigns frontend, API/content and tests as separate contracts. Each PR is green and independently reviewed. Preview exposes the FAQ; Playwright proves RTL text, navigation and no console error. Production deploy records only the frontend/service SHA; public `/faq` and `/health` pass. Final Persian report gives URL, PRs, cost and rollback status. |
| **B. Build a standalone todo app with login and DB** | Intake selects isolated repo/project and budget. Research compares stack/auth/DB/hosting with sources and approval. Plan separates schema/migration, backend, frontend, auth, E2E and infra; migration is owner-routed. Preview creates an isolated DB namespace and URL; browser test registers/logs in, creates/completes a todo and confirms tenant isolation. Production evidence includes migration backup/rollback plan, deploy result, public HTTPS/API/browser probes and a Persian operations handoff. |
| **C. Fix a failing test** | Intake attaches reproducible failing command and allowed files. Research is skipped with an explicit “repair” rationale and owner approval policy. One bounded task produces a PR; CI includes the formerly failing test plus regression evidence. Preview is optional only when a user-visible route changes; otherwise the report says “not applicable.” Production deploy is skipped unless a release is requested. Final Persian report states root cause, exact test result, diff/PR, cost and no-deploy rationale. |

### Go/no-go thresholds

- Before Phase 2: one real low-risk Factory task has reached a reviewed green PR
  with a live provider cap and documented cost.
- Before autonomous production: two previewed releases have passed browser E2E;
  deployment/rollback was exercised on a non-production target; production
  remains separately owner-approved until that evidence exists.
- For “several teams”: at least three independent task contracts complete in
  one Factory run without a conflict, cap breach, lost dispatch or manual queue
  repair; concurrency is then raised only after observing runner/provider
  capacity and costs.
