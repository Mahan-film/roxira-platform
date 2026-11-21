# Research R19 — open-source reuse map (digest)

Source: the owner's deep-research run R19, stage 1, received 2026-11-17 (stage 2 not yet received). Hub spot-checks the same day against npm and GitHub: dinero.js 2.0.2 (MIT, Mar 2026), oxlint 1.94.0 (MIT), typescript 7.0.2 (Apache-2.0), @gorules/zen-engine 2.1.11 (MIT), vitest 5.1.0, @openfeature/server-sdk 1.23.0 and flagd-provider 0.18.0 (Apache-2.0): all confirmed. Unleash is AGPL-3.0: confirmed (refused). **The report's claim that pgBackRest was archived in April 2026 is false**: the repo is active (pushed 2026-11-16). Our stack today: TypeScript 5.9, Jest 29, ESLint 8 (backend) / 9 (frontend).

## Decisions

| Capability | Verdict for us | Row |
|---|---|---|
| Ledger numbering, hash chain | Build on Postgres (pgcrypto + triggers + per-entity sequencer), as planned. | T178 |
| Money | Keep our bigint `money.ts`. Use Dinero.js only as the source of ISO 4217 exponents and for `allocate` (remainder splitting) where it saves code; no rewrite of existing money code. | T169 |
| Tax rules | **Trial** GoRules ZEN (MIT, Rust core with Node and Python bindings) for effective-dated tax decision tables inside T180; decide after a spike with Iran VAT + EU reverse charge + withholding. | T180 |
| Bank statements | Keep T184's TypeScript parsers (in review); no Python hop. | T184 |
| E-invoicing DE | Mustangproject + KoSIT validator in one JVM sidecar (already planned); cap the heap at 512 MB. | T187 |
| Peppol | Use an access-point provider; phoss-ap only if volume justifies certification. | T175 |
| ZATCA | Build (zatca-xml-js has had no release for over a year). | T174 |
| DATEV | Build in TypeScript from the DATEV spec (pydatev is too small to depend on). | T189 |
| E-Bilanz | Arelle (Apache-2.0) for XBRL validation when T190 starts; ERiC through a thin wrapper of our own. | T190 |
| Fixed assets, inventory costing | Build (no library fits a transactional multi-book ledger). | T183, T195 |
| Reporting layer | Cube Core: deferred (350–600 MB RAM). Revisit when a dimension report takes over 2 s on real data. | — |
| Feature flags | **Adopt** OpenFeature + flagd (Apache-2.0, ~40 MB RAM) for per-tenant and per-country-pack flags. | T203 |
| Error tracking | Done without a container (T199). GlitchTip only if we need a UI later. | T199 |
| Postgres backups | **Adopt** WAL-G for continuous archiving and point-in-time recovery next to the hourly encrypted dumps (RPO from 1 h to minutes). Needs a Postgres restart: owner approval. | T204 |
| Migration lint | Squawk: done (T170, merged). | T170 |
| Toolchain speed | **Adopt** oxlint next to ESLint (ESLint kept only for rules oxlint lacks) and a TypeScript 7 type-check job (`tsgo --noEmit`) beside TS 5.9 until TS 7 passes everywhere; Vitest stays a trial (Jest + NestJS decorators). | T202 |

## Rows
- **T202 Fast toolchain:** oxlint in CI and pre-push for backend and frontend; a TS 7 `--noEmit` job; measured before/after times in the PR. Then switch the main type-check to TS 7 once it passes on both apps.
- **T203 Feature flags:** flagd sidecar (pinned image, <64 MB limit), OpenFeature SDK in NestJS and the Python core, flag file in the repo, tenant and country-pack targeting, a kill-switch convention for new modules.
- **T204 WAL-G:** archive_command to the existing object storage, age/libsodium encryption, a retention policy, a restore-to-time script added to the T198 Mac drill. Enabling it in production needs the owner's go-ahead (Postgres restart).

## Stage 2 (received 2026-11-17)
Stage 2 ran without network access, so its verification column is mostly "unverifiable", and several of its corrections are wrong. Hub checks the same day: Squawk is **Apache-2.0** (not GPL-3.0); Mustangproject **core-2.26.0, 2026-08-25** and ZUGFeRD 2.5.2 (ferd-net.de, see R13) are real; Unleash **is** AGPL-3.0 on main; pgBackRest is active (stage 2 agrees). Facts in the table above stand.

Its list of misses is useful. Status against our code:

| Miss | Our state | Action |
|---|---|---|
| OOM on an 8 GB host as sidecars are added | no per-container memory limits | **T205** limits, OOM priority for Postgres/Redis, RAM alert; bigger server only when RAM > 70% for 7 days |
| tenant vs legal entity | company group (T155) and multi-entity rows exist | gapless numbering and periods per legal entity, not per tenant (T178, T182) |
| period lifecycle, opening balances | fiscal close exists | soft lock, adjustment period, hard close, carry-forward (T178) |
| control accounts posted by hand | not enforced everywhere | `system_posted_only` on AR/AP/inventory/asset control accounts (T178, T195) |
| GDPR erasure vs immutable hash chain | not designed yet | **T206**: no names/IBANs in hash-chained fields; party ids only; personal data in master tables with per-party keys (erasure = destroy the key). Must land before T178's hash chain |
| RLS with PgBouncer transaction mode | verified OK: tenant context uses `set_config(..., true)` (transaction-local) | keep; T207 enforces it |
| AI agents reintroducing float money / missing tenant scope | review desk catches it late | **T207** diff-scoped blocking guards in CI |
| backup keys on the same server | verified OK: the server holds only the age public recipient | keep |
| synchronous sidecar calls holding DB locks | not built yet | e-invoice, ERiC and XBRL calls go through the outbox + BullMQ, never inside a request transaction (T187, T190) |
| ERiC native library thread safety | not built yet | one single-threaded worker container (T190) |

Not taken: a bigger server now (current use about 4 of 7.7 GB; decide on the trigger above, it is the owner's spend), Grafana Cloud.
