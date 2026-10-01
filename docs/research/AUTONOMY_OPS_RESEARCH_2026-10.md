# Autonomous delivery operations research — 2026-10-01

## Decision in one page

Roxira can make the owner’s central GitHub issue the sole control-plane input:
`brief → research → owner approval → small agent issues → PR/CI/review → GitHub
auto-merge → production deploy → external health observation`.  Keep agents on
ephemeral GitHub runners and keep production as a small, deterministic Compose
host. Do **not** put a coding agent, a broad GitHub token, or a general shell SSH
key on production.

The repository is already unusually close to this model. `agent-task.yml` gates
before checkout on `AGENT_ENABLED` and an actor allow-list, uses a disposable
runner, a pinned OpenCode, a dedicated capped key, and an explicit minimal agent
environment. `agent-review.yml` evaluates only trusted `main` code and fetches
the PR diff as data. `agent-automerge.yml` is opt-in and blocks sensitive paths,
oversized diffs, non-bot provenance, failed CI, and non-low-risk review. The
`factory-*` workflows already turn a labelled brief into research, an approved
plan, dependent tasks, and status. ADR 0003’s size/concurrency/budget ladder
remains the right local policy for Codex CLI/OpenCode via LiteLLM/OmniRoute.

`scripts/ops/deploy.sh` is also the correct primitive: clean-tree fast-forward,
Compose validation, per-service `:prev` image, targeted rebuild/recreate,
health wait, nginx refresh, and rollback of all touched services. It needs a
safe trigger and an external acceptance gate, not a replacement platform.

## 1. One-host continuous deployment

| Pattern | What it gives | Main risk/cost | Fit and decision |
| --- | --- | --- | --- |
| GitHub Actions → forced-command SSH key | Push deployment immediately after merged `main`; server receives only an approved verb such as `deploy <sha> <allowlisted-services>`. | A normal SSH key becomes remote shell access; an inline deploy script is hard to audit. | **Recommended now**, if the key is restricted in `authorized_keys` (`command=…`, `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty`) and the server wrapper validates the SHA/service. Store it only in the `production` environment. |
| Pull deployer (`systemd` path/timer) | Server polls a signed/tagged main commit or GitHub release and invokes local `deploy.sh`; no inbound CI SSH key. | Poll delay; needs a read-only GitHub deploy key/token and idempotent locking. | **Recommended alternative** when the owner prefers no GitHub-to-host connection. A 1–2 minute timer is sufficient; it should consume a `deploy-request` ref/artifact, not arbitrary `main`. |
| Image watcher / Watchtower class | Pulls a newly pushed image and restarts containers. | It cannot understand a multi-service Compose transaction, migration ordering, endpoint acceptance, or Roxira’s `:prev` rollback. Upstream Watchtower is archived and says it is not for production. | **Reject for app deployment.** At most use an actively maintained image notifier for awareness, never autonomous production restart. |
| Kamal | Mature SSH deployer with proxy-mediated container switching/zero-downtime semantics. | Adds Ruby/Kamal config and a second deployment model; its benefit is small on one host where Compose+nginx already works. | **Do not adopt now.** Reconsider only for multi-host/zero-downtime rollout requirements. |
| Coolify or Dokploy | Full PaaS UI/API: Git integration, Compose/Docker support, logs, secrets and retained-image rollback. | Large control plane on the same small host; more privileged surface and a competing source of truth for Compose/nginx/secrets. | **Do not adopt now.** Useful only if an owner explicitly wants a PaaS UI and accepts its operational overhead. |

Docker Compose does not wait for an application to be ready merely because it
started; use real service healthchecks and `service_healthy` dependencies where
needed. GitHub Environments can restrict a production job to `main`, protect its
secrets, serialize production with a concurrency group, and retain deployment
history. They are a control, not a substitute for repository rulesets.

### Recommended deployment contract

1. `agent-automerge.yml` merges only its safe class of PR. A new
   `deploy-prod.yml` runs on that merge (not on arbitrary branch pushes), has
   `production` environment + one global deployment concurrency group, and
   passes the exact merged SHA and changed allowlisted service names.
2. The server wrapper locks with `flock`, verifies the requested SHA is an
   ancestor of `origin/main`, checks its hard-coded service allow-list, then
   runs the existing `scripts/ops/deploy.sh`. It emits a machine-readable
   result containing old/new SHA, services, container IDs, health, and rollback
   result. No user-controlled shell fragment is accepted.
3. Preserve the current in-container health wait, then probe public HTTPS from
   the runner (at least `/health`, changed route, and one read-only legal lookup).
   A failed public probe calls a similarly restricted `rollback <deploy-id>`
   command, marks the GitHub deployment failed, and opens/updates one incident.
4. The emergency/owner path remains documented and separate. The server itself
   must never auto-commit or push operational state; `docs/AGENTS_WORKFORCE.md`
   records why that previous pattern was unsafe.

## 2. Autonomous and scheduled coding patterns

| Pattern | Useful capability | Blast-radius boundary | Roxira recommendation |
| --- | --- | --- | --- |
| Existing Factory + OpenCode | Full issue-to-PR pipeline using the current LiteLLM/OmniRoute lane. | Existing enable flags, actor list, 20-minute job limit, task concurrency cap, OpenRouter key limit, path deny-list, independent review, CI and opt-in merge. | **Primary executor.** First improve persistent spend accounting and keep high-risk paths owner-only. |
| GitHub Agentic Workflows (`gh-aw`) | Markdown agent workflows compiled to ordinary Actions; suited to periodic triage, CI diagnosis, reporting and review. | Read-only/sandboxed agent jobs by default; writes pass through validated, scoped safe-output jobs. | **Good for read-only scheduled operations**, e.g. daily failed-CI and stale-PR diagnosis. Do not replace the proven Factory executor yet; it is technical-preview-era software and had recently retired vulnerable releases. |
| Claude Code Action / Routines | Action can respond to issue/PR events; cloud routines can run on schedules, GitHub events, or an API call. | Use repository allow-lists, exact event filters, a per-routine token, max-cost/timeout policy, no production connector, and PR-only output. Prefer GitHub OIDC/WIF to a static key for the Action. | **Secondary reviewer/incident investigator**, not the main executor: it conflicts with ADR 0003’s quota-saving ladder if allowed to fan out. |
| Codex scheduled tasks / cloud tasks | Recurring or GitHub-event work; worktrees isolate scheduled repository runs from unfinished local work. | Start read-only; choose an isolated worktree; explicit sandbox/approval policy; fixed prompt/skill; budget/cadence; no server credentials. | **Use for advisory maintenance** (daily evidence-only regression/CI report). Have it open an issue or PR, never deploy. Web event tasks need a connected GitHub account; local task runs require the machine/app to be available. |
| OpenHands SDK/automation | Programmatic agents with ephemeral Docker/Kubernetes workspaces and a separate scheduling/webhook layer. | Explicit workspace, tools, model, secrets and dispatch layer—but Roxira must build every guard. | **Do not introduce now.** It overlaps the existing Factory and adds an orchestration platform. |
| Sweep-class GitHub App | Issue/PR mention-to-change workflow, optionally self-hosted. | GitHub App permissions, webhook exposure, model keys and product-specific policy all need separate hardening. Sweep’s original GitHub App is marked deprecated. | **Reject.** The existing PR path is more auditable and tailored to Roxira. |

### Non-negotiable autonomous-agent policy

- One labelled issue or approved Factory task is one bounded objective; include
  allowed files, test command, max changed files/bytes and explicit stop rules.
- Default to read-only reports. Code-writing agents get `contents: write` only
  to an `agent/*` branch; deploy credentials, `.env`, Compose, nginx, systemd,
  migrations, auth/payments/legal inference and `config/models.yaml` require an
  owner-routed PR.
- Keep independent executor/reviewer models, pinned runtimes/actions, a
  concurrency cap, job timeout, real provider-side daily dollar limit, and a
  visible per-run ledger. The kill switch is `AGENT_ENABLED=false` and
  `FACTORY_ENABLED=false`; deployment also has its own `DEPLOY_ENABLED=false`.
- Treat issue/PR/comment text, diffs, logs and web pages as untrusted data.
  Never interpolate them into shell or model instructions without framing and
  bounding; retain the present trusted-`main` review pattern.

## 3. Self-healing and observability for a small team

Use two independent signals: the deploy workflow checks immediately after a
change, while an external monitor checks the public service continuously. Run
the monitor off-host if affordable; a monitor on the same host cannot report a
host/network outage. Gatus is the better configuration-as-code choice here: it
can assert status/body/latency, has failure and recovery thresholds, and its
GitHub alert provider opens an issue then closes it on recovery. Uptime Kuma is
a simple UI-led alternative with HTTPS/TCP/Docker checks and broad notification
support.

Suggested policy:

- Probe `/health`, a frontend page, NestJS API, and the legal lookup separately;
  require 3 consecutive failures before alerting and 2 successes before recovery.
- An alert creates/deduplicates `incident:availability` with endpoint, status,
  last deploy SHA and timestamp; it sends Telegram/email. A scheduled,
  **read-only** agent may summarize logs into that issue, but never restart or
  change code from a log alone.
- Auto-rollback only inside the deployment transaction and only to its recorded
  `:prev` images after the same release fails both container and public gates.
  Never rollback merely because an unrelated periodic monitor is red: investigate
  dependency/DNS/database failure first. Limit rollback to one attempt per SHA
  and page the owner if the rollback itself is unhealthy.
- Record deploy ID/SHA/services and health outcome in the GitHub deployment and
  a server-local append-only log. Use log alerts for repeated container restart,
  Compose health `unhealthy`, nginx 5xx spike, disk pressure, backup failure and
  authentication anomalies; alerts open issues, not autonomous code changes.

## Sources opened (facts observed 2026-10-01)

The star figures are discovery signals, not endorsements; last-commit dates are
the upstream repository activity observed during this research.

| Project/source | Stars; last commit/activity; licence | Why consulted |
| --- | --- | --- |
| [Kamal](https://github.com/basecamp/kamal) | 14.6k; Sep 2026; MIT | SSH deployer/proxy. |
| [Coolify](https://github.com/coollabsio/coolify) | 62.4k; 2026-09-29; Apache-2.0 | PaaS capability and one-host trade-off. |
| [Dokploy](https://github.com/Dokploy/dokploy) | 37.6k; 2026-09-29; Other/unknown in GitHub metadata | PaaS alternative. |
| [Watchtower](https://github.com/containrrr/watchtower) | 24.7k; archived 2025-12-17; Apache-2.0 | Explicit upstream production warning/archival. |
| [gh-aw](https://github.com/github/gh-aw) | 5.3k; pushed within 20h; MIT | Sandboxed/read-only defaults and safe outputs. |
| [Claude Code Action](https://github.com/anthropics/claude-code-action) | 8.9k; 2026-09-30; MIT | GitHub Action and OIDC/WIF setup. |
| [Claude Routines](https://platform.claude.com/docs/en/api/claude-code/routines-fire) | managed service; current; proprietary | Scheduled/GitHub/API triggers. |
| [OpenAI Scheduled tasks](https://learn.chatgpt.com/docs/automations) | managed service; current; proprietary | Codex schedules, events, worktrees and approvals. |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | 1.2k; active Sep 2026; MIT | Ephemeral workspaces/automation separation. |
| [Sweep](https://github.com/sweepai/sweep) | 7.7k; active Sep 2026; Elastic License v2 | Issue-to-PR bot comparison; GitHub App is deprecated. |
| [Gatus](https://github.com/TwiN/gatus) | 12.2k; 2026-09-30; Apache-2.0 | Configurable checks, GitHub incident lifecycle. |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | 92.0k; active 2026; MIT | UI-led monitoring alternative. |

Supporting upstream documentation: [GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Compose health ordering](https://docs.docker.com/compose/how-tos/startup-order), [Gatus alert thresholds and GitHub resolution](https://gatus.io/docs/alerting-getting-started), [GitHub Agentic Workflows](https://github.github.com/gh-aw/introduction/how-they-work/), [Claude routines](https://code.claude.com/docs/en/routines), and [official OpenAI scheduled-task guidance](https://learn.chatgpt.com/docs/automations).

## Ranked, offline-testable next tasks

1. **Value: highest — add `scripts/ops/deploy_gate.sh` and
   `src/ops/test_deploy_gate.py`.** Parse only SHA/service arguments, enforce
   service allow-list/ancestor/lock/result schema, and unit-test all rejects
   without SSH or Docker. **Owner-only:** install it on the host and configure
   the forced-command deploy key (or pull service).
2. **Add `.github/workflows/deploy-prod.yml` and
   `src/ops/test_deploy_workflow_contract.py`.** Make merged-main dispatch,
   environment/concurrency/changed-service filtering and rollback decision pure
   testable logic; the workflow calls no unbounded shell. **Owner-only:** create
   GitHub `production` environment and secret/variable.
3. **Add `scripts/ops/verify_public_release.sh` and
   `src/ops/test_verify_public_release.py`.** Validate required endpoint plan,
   retry thresholds and JSON output with mocked `curl`; deploy calls it after
   Compose health and before success/rollback.
4. **Add `ops/gatus/config.yaml` and `src/ops/test_gatus_config.py`.** Assert
   all four endpoints, 3-failure/2-recovery thresholds and an issue-alert
   template; validate YAML offline. **Owner-only:** install Gatus off-host (or
   on host initially) and supply its least-privilege GitHub token/notification
   secret.
5. **Add `.github/workflows/availability-incident.yml` and
   `src/ops/test_incident_dedup.py`.** Receive a signed monitor webhook,
   deduplicate/open/resolve an incident with deploy SHA metadata, with all event
   parsing unit-tested. **Owner-only:** register the monitor webhook secret.
6. **Add `.github/workflows/agent-ops-report.yml` and
   `src/factory/test_ops_report_policy.py`.** Daily read-only CI/PR/incident
   summary that can only comment/open an issue; test path, permission and
   no-deploy policy. No owner action until enabling the schedule.
