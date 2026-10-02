# Radar decision log

The radar recommends, a human decides. This file is **append-only**: new rows go
at the bottom and earlier rows are never edited or deleted, so the record of
what was tried stays intact.

Append one decision:

```bash
python3 scripts/radar/decision_log.py add \
  --name "DBOS Transact" --url https://github.com/dbos-inc/dbos-transact-py \
  --source github --verdict trial \
  --reason "Postgres-backed durable workflow spike" --owner mac
```

List decisions (optionally by verdict):

```bash
python3 scripts/radar/decision_log.py list
python3 scripts/radar/decision_log.py list --verdict adopt
```

Seeded 2026-10-01 from `docs/research/NEXTGEN_ROADMAP_2026-10.md` section 4.

| date | name | url | source | verdict | reason | owner |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | Postgres run ledger + step claimers | https://docs.dbos.dev/python/tutorials/workflow-tutorial | github | adopt | Postgres-backed durable run state; one Action claims one idempotent step | |
| 2026-10-01 | Spec Kit-shaped artifacts | https://github.github.com/spec-kit/ | github | adopt | Adopt the spec/plan/tasks/acceptance artifact format, not a wholesale install | |
| 2026-10-01 | Agent Skills library | https://github.com/agentskills/agentskills | github | adopt | Version a small internal SKILL.md library and pin every bundled script | |
| 2026-10-01 | MCP allowlist | https://github.com/modelcontextprotocol/modelcontextprotocol | github | adopt | Maintain an allowlisted, expiring MCP manifest; local stdio by default | |
| 2026-10-01 | Compose previews with TTL | https://github.com/e2b-dev/E2B | github | adopt | Compose previews with a hard TTL envelope; Coolify comes later, after plain Compose | |
| 2026-10-01 | Playwright + axe + baselines | https://github.com/dequelabs/axe-core | github | adopt | Deterministic Chromium E2E plus accessibility and visual/ARIA baselines | |
| 2026-10-01 | Trivy | https://github.com/aquasecurity/trivy | github | adopt | Gate PRs on filesystem, secret, and misconfiguration scans with a cache age cap | |
| 2026-10-01 | Gitleaks | https://github.com/gitleaks/gitleaks | github | adopt | Scan full git history, then gate working-tree secret leaks with an allowlist | |
| 2026-10-01 | Copier template | https://github.com/copier-org/copier | github | adopt | One roxira-fullstack template with RTL shell, Nest module, FastAPI, and CI | |
| 2026-10-01 | OPA CLI | https://github.com/open-policy-agent/opa | github | adopt | Policy as a CLI, not a service: deny privileged, host mounts, and latest images | |
| 2026-10-01 | SOPS/age secrets layout | https://github.com/getsops/sops | github | adopt | Encrypted YAML/JSON/ENV config with separate dev/preview/production recipients | |
| 2026-10-01 | Promptfoo gate | https://github.com/promptfoo/promptfoo-action | github | adopt | PR prompt gate with deterministic assertions and an explicit spend cap | |
| 2026-10-01 | DSPy + GEPA (one prompt) | https://github.com/stanfordnlp/dspy | github | adopt | Optimise one bounded proposal-classification prompt against a frozen holdout | |
| 2026-10-01 | GitHub + HN + arXiv radar | https://github.com/HackerNews/API | hackernews | adopt | Daily metadata ingest into a human-ranked shortlist and this decision log | |
| 2026-10-01 | monthly tournament | https://swe-bench-live.github.io/ | github | adopt | Blinded model tournament with three trials and a holdout replay before promotion | |
| 2026-10-01 | DBOS spike | https://github.com/dbos-inc/dbos-transact-py | github | trial | Synthetic research to approval to report workflow with a restart test | |
| 2026-10-01 | gVisor for untrusted workers | https://github.com/google/gvisor | github | trial | Run one disposable coding-agent image under runsc before making it mandatory | |
| 2026-10-01 | Coolify after plain Compose | https://github.com/coollabsio/coolify | github | trial | Deploy one existing Compose app to a non-production hostname and prove rollback | |
| 2026-10-01 | Semgrep custom rules | https://github.com/semgrep/semgrep | github | trial | Focused rules: no frontend secrets, no unsafe shell, required tenant checks | |
| 2026-10-01 | ZAP baseline on previews | https://github.com/zaproxy/zaproxy | github | trial | Weekly passive baseline scan against a disposable preview only, never production | |
| 2026-10-01 | SWE-bench Live (2 tasks) | https://github.com/microsoft/SWE-bench-Live | github | trial | One TypeScript and one Python task on a disposable GitHub runner for calibration | |
| 2026-10-01 | Terminal-Bench (3 tasks) | https://github.com/harbor-framework/terminal-bench | github | trial | Three terminal tasks with a 20-minute and 10 GB cache ceiling; not a CI gate | |
| 2026-10-01 | RouteLLM-style measured escalation | https://github.com/lm-sys/RouteLLM | github | trial | Log 200 anonymised task envelopes before trusting any pretrained router | |
| 2026-10-01 | Inspect AI base package | https://github.com/UKGovernmentBEIS/inspect_ai | github | trial | Base package only with Docker disabled; skip the 35 GB eval collection | |
| 2026-10-01 | AG-UI read-only progress page | https://github.com/ag-ui-protocol/ag-ui | github | trial | Read-only Persian progress page fed by synthetic run status events | |
| 2026-10-01 | llama.cpp fallback | https://github.com/ggml-org/llama.cpp | github | trial | Quantized CPU fallback for low-risk, non-customer tasks only, after measurement | |
| 2026-10-01 | OpenTofu (DNS/firewall only) | https://github.com/opentofu/opentofu | github | trial | Narrow IaC for what cannot live in Compose, with a plan artifact and OPA review | |
| 2026-10-01 | Temporal | https://docs.temporal.io/self-hosted-guide | github | skip | Too much control plane to self-host for one 15 GB host | |
| 2026-10-01 | Inngest | https://github.com/inngest/inngest | github | skip | Self-hosting adds another stateful service and a non-permissive licence | |
| 2026-10-01 | Restate (for now) | https://docs.restate.dev/ai/patterns/multi-agent | manual | skip | Deferred; fallback only if DBOS recovery disappoints, pending licence review | |
| 2026-10-01 | AGNTCY | https://docs.agntcy.org/ | manual | skip | Reference identity demo has 23 services; contrary to a near-zero-cost posture | |
| 2026-10-01 | Kiro | https://kiro.dev/docs/ | manual | skip | Vendor harness and cloud dependency; borrow only the steering idea | |
| 2026-10-01 | Daytona (public repo frozen) | https://github.com/daytonaio/daytona | github | skip | Public repo says core development moved private; poor foundation | |
| 2026-10-01 | Dokploy (license) | https://github.com/Dokploy/dokploy | github | skip | Production use of proprietary code needs a commercial agreement | |
| 2026-10-01 | Firecracker (KVM unverified) | https://github.com/firecracker-microvm/firecracker | github | skip | Needs KVM and image/kernel lifecycle management; unverified on this host | |
| 2026-10-01 | Pulumi | https://github.com/pulumi/pulumi | github | skip | Another language, runtime, and state decision with no benefit over OpenTofu | |
| 2026-10-01 | DGM | https://github.com/jennyzzt/dgm | github | skip | Self-modification risk and search cost; research pattern only | |
| 2026-10-01 | AlphaEvolve | https://arxiv.org/abs/2506.13131 | arxiv | skip | Not a reusable product; adopt only the pattern, never the self-editing pipeline | |
| 2026-10-01 | X scraping | https://developer.twitter.com/ | manual | skip | Pay-per-use API makes a collector uneconomic by default | |
| 2026-10-01 | Telegram scraping | https://telegram.org/tos/content-licensing | manual | skip | Content-licensing terms forbid scraping and AI use without narrow consent | |
| 2026-10-01 | Instagram scraping | https://about.fb.com/news/2021/04/how-we-combat-scraping/ | manual | skip | Meta terms forbid automated collection and actively block scraping | |
| 2026-10-01 | TikTok scraping | https://developers.tiktok.com/products/research-api/ | manual | skip | Research API is limited to eligible academic and non-profit researchers | |
| 2026-10-01 | full Inspect eval install | https://github.com/UKGovernmentBEIS/inspect_evals | github | skip | Eval collection recommends 35 GB free disk, beyond current headroom | |
| 2026-10-01 | AppWorld | https://github.com/StonyBrookNLP/appworld | github | skip | Little overlap with full-stack app construction or Persian UX | |
| 2026-10-01 | BrowserGym | https://github.com/ServiceNow/BrowserGym | github | skip | Site replicas consume too much host capacity; use Playwright previews instead | |
