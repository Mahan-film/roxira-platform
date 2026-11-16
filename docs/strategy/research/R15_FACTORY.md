# Research R15 — software factory: speed and quality (digest)

Source: the owner's deep-research run R15, stage 1 (Persian report) and stage 2 (English self-review), received 2026-11-17. Most of the report's numbers are models (Little's law, a Monte Carlo batching simulation, a Playwright sharding cost table) or vendor-published studies (Mergify, Faros, Macroscope). They are useful for direction, not as facts. The stage 2 review said so itself.

## Assumptions in the report that do not hold for us
- **Private repo.** Our repo is public. GitHub's native merge queue is available to us now (no Enterprise Cloud), and Actions minutes are free. We already use the native queue.
- **German company.** Stage 2 assumed a German employer (works council, German tax, R&D credit). Not our case. Its EU AI Act and GDPR points belong to the DE product pack (R13), not to the factory.
- **Training on our code.** The repo is public MIT, so "the provider trains on our code" is not a risk for us. Secrets never go to a model (AGENTS.md §4).
- **Alembic.** We have no Alembic. Our migrations are SQL/TypeORM files with numeric ids.
- **Paid review tools** (Greptile, CodeRabbit, Macroscope). Our review desk is a cross-family LLM on the free-first key pool. We keep it and fix its freshness instead.

## Facts worth keeping

| Fact | Status | Use |
|---|---|---|
| Piling up open PRs is itself the main source of rebase conflicts; queue wait grows with WIP (Little's law). | model plus DORA 2024/2025 (older than 12 months) | Confirms the WIP limit we adopted on 2026-11-16. |
| AI-assisted PRs broke main about half as often as human ones (1.9% vs 4.4%); PRs green alone still break main on merge in about 5% of private-repo merges. | Mergify report, July 2026 (vendor study, no causality) | The merge queue's re-test is worth its time. |
| Faros 2026 (22,000 developers): at high AI adoption, bugs per developer +54%, incidents per merged PR more than 3×, 31% more code reaching production unreviewed. | Faros primary blog (stage 2) | Quality gates must be deterministic, not "the model said OK". |
| AI-written tests can reach 97% mutation score while asserting the buggy behaviour. | TestMu, 6 small functions (toy study) | Tests for money logic come from the spec, written before the code. |
| Playwright `--only-changed` does not follow imports. | verified (Playwright release notes) | T168 must map paths to specs itself, not rely on that flag. |
| Sharding Playwright 4 ways with blob reports cuts an 11-minute run to about 4–5 minutes. | model | Added to T168. |
| GitHub stacked PRs are GA (6 Oct 2026); the queue merges a stack as one group and keeps approvals on unchanged code. | verified (GitHub changelog) | Allowed only for 2–3 layer forced chains (migration → backend → UI). |
| Squawk (Postgres migration linter, Apache-2.0 or MIT) has a `require-lock-timeout` rule. MigrationPilot (MIT) has 112 rules. Atlas moved its linter to a paid plan. | verified (repos) | Squawk in CI (T170). |
| Stripe's agents: deterministic steps (lint, test) forced between model steps; at most 2 CI fix rounds, then a human. | blog dates verified; the 2-round cap from secondary summaries | Lane rule: 2 CI fix rounds, then a hand-off comment. |
| Model price cliffs: Gemini 3.6/3.7 Flash introductory price ends 31 Dec 2026 (USD 1.50 / 7.50 per 1M from 1 Jan 2027); Gemini Code Assist ends 31 Mar 2027; OpenAI merges ChatGPT and Codex allowances in December 2026. | verified (Google and OpenAI pages, stage 2) | Re-check prices in `config/models.yaml` before 1 Jan 2027 (added to T161). |

## Decisions

**Adopt now (no cost):**
1. **Lane prompt v6** (next round): a PR stays draft until the local pre-push CI is green; at most 2 CI fix rounds, then post the hand-off block and move on; stacked PRs only for 2–3 layer forced chains. WIP stays 3 per lane; we lower it to 2 if the open-PR count stays above 15 for a week.
2. **T168 amended:** 4 Playwright shards with blob-report merge in the `merge_group` run; PRs run the path-mapped specs plus the smoke set.
3. **T170** Squawk migration lint plus a migration-id check in CI.
4. **T171** hotspot files become generated: per-module manifests for the permission matrix, `app.module.ts` imports and the navigation menu.
5. **T172** review desk freshness: review only non-draft PRs, keyed on the head SHA; a force-push marks the old review outdated; measure reviewer precision on 100 PRs.
6. **T173** property-based tests (fast-check) for ledger invariants, and a diff-scoped mutation report (Stryker) on the accounting module, report-only at first.

**Refused (revisit trigger in brackets):**
- Mergify or Trunk instead of the native queue (more than 3 queue ejections a day for a week).
- Turborepo, Nx, Bazel (CI on PRs above 15 minutes after T168).
- Paid AI reviewers (review desk precision below 50% on the 100-PR sample).
- Devin, Graphite, Aviator, Cursor team plans (none; overlap with what we run).
