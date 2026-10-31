# Plan

Lightweight, file-scoped task memory (W12, docs/STRATEGY.md §4). This is a
checklist, not a design doc — keep entries short and link elsewhere for detail.

## How to use this file

- Before any change touching more than 3 files, add a checklist item here
  first: a one-line goal, the file list, and the plan. See the
  `feature-plan` skill (`.claude/skills/feature-plan/`).
- Check items off (`- [x]`) as they land, in the same PR that does the work.
- Move a finished item's one-line summary to `docs/progress.md` instead of
  deleting it, so the history survives.
- Do not duplicate `docs/STRATEGY.md` §5 (the workstream table) — this file
  is for the current slice of work inside a workstream, not the workstream
  list itself.

## Universal import (data_import readers) — design, 2026-10-31

Goal: drag-and-drop of nearly any accounting export into `/app/import`, parsed **without executing customer code**.
Honest scope is the table in `docs/IMPORT_SUPPORT.md` (generated from `support-matrix.ts`, checked by a spec).

**Core idea.** Every source becomes a `ParsedPackage` (paged tables) — the contract the analysis, mapping,
commit, undo pipeline already uses. New code is only a *reader layer* in front of it plus guards around it.

1. **Pluggable readers** (`modules/data_import/readers/`): `FormatReader { id, detect(head, name) → 0..1, read(buffer) }`.
   `detectFormat` scores every reader on the *content* (magic bytes, structure, markers); the extension is only a
   tie-break. Readers: csv/tsv/semicolon, fixed-width TXT, JSON, XML, ODS, XLS (BIFF8 via own CFB reader), DBF,
   XLSX, ZIP (recurses through the same registry, depth 1), SQLite, SQLite-dialect SQL (existing worker),
   MySQL/MariaDB dump, PostgreSQL dump (incl. COPY blocks), QuickBooks IIF, OFX/QBO, multi-file folder drop.
   Dumps are **tokenised, never executed** (no sql.js, no DB): statement splitter + VALUES/COPY row parser,
   every other statement ignored, caps on rows/cells/bytes.
2. **Guide-only formats** (detected, rejected with a Persian how-to): Access `.mdb/.accdb`, MSSQL `.bak/.mdf/.ldf`,
   PostgreSQL custom `PGDMP`, Iran System encoded text. No pure-JS Jet or MTF reader is safe/testable here, and we
   will not guess an Iran System table (wrong table = silently wrong names).
3. **MSSQL `.bak/.mdf` sandbox design (not implemented).** Needs a disposable microVM/container (Daytona or a
   throwaway Docker on a separate host): `--network none`, read-only rootfs, 2 CPU / 2 GB RAM / 5 GB disk cap, 5 min
   wall clock, uid≠root, file copied in, SQL Server restores it, a fixed export script writes CSV (no customer SQL
   is run in prod/API), CSVs come back as ZIP through the normal pipeline, VM destroyed. Blockers: SQL Server
   Linux image licence + ≥2 GB RAM (the prod box is small) → must run off-box. Until then: Persian guide.
4. **Persian layer** (`readers/persian/`): encoding detection (BOM, UTF-8 validity, UTF-16, Windows-1256 via
   `TextDecoder`, Iran System *detected only*), Arabic ي/ك vs Persian ی/ک report + normalisation, Persian/Arabic
   digits, ZWNJ, Jalali vs Gregorian column detection, rial vs toman detection (header words, ISO code, never a silent
   convert: `unknown` ⇒ asked in the UI; table-level toman ⇒ ×10 at commit).
5. **Chunked resumable upload** (`services/chunked-upload.service.ts`): `POST uploads` (init), `PUT uploads/:id/chunks/:n`
   (raw body, ≤ 8 MB, written at its offset on disk), `GET uploads/:id` (what is missing → resume), `POST uploads/:id/complete`
   (size + optional sha256, magic-byte detection from the head only) → `POST packages/from-uploads` for folder/multi-file.
   Safety: per-file cap 120 MB, per-package 200 MB, tmp-root cap 2 GB, free-disk floor 4 GB (`statfs`), one active parse
   at a time, TTL sweep reuses the package store sweeper. Memory: readers take a Buffer, so the parse cap equals the
   per-file cap; streaming readers for >120 MB is future work.
6. **Reconciliation after preview** (`analysis/reconciliation.ts`, `POST packages/:id/reconcile`): per selected table row
   counts, debit/credit totals, per-voucher imbalance, opening-balance totals, in-file duplicates, unmapped columns,
   money unit. **Commit is blocked** when any imbalance exists unless `confirmImbalance=true` *and* the caller is
   platform admin or tenant OWNER (server re-computes; client cannot skip). Undo is the existing batch undo.
7. **Source profiles + mapping memory.** Profiles only where headers are provable. Iranian products (Sepidar, Hamkaran,
   Rahkaran, Mahak): **no verified export headers exist in the repo or public search (docs/IMPORT_SOURCE_PRODUCTS.md), so
   none are shipped** — the framework and tests exist, the list stays empty until someone attaches a real export.
   Global heuristic profiles (QuickBooks IIF/OFX by spec; Xero, Odoo, ERPNext, Sage by header sets) are labelled
   "heuristic". Learned mapping memory per tenant: table `data_import_mapping_memory` (tenant_id, header signature,
   entity, mapping) — a repeat upload of the same layout is pre-mapped. LLM sample cells are masked
   (`masking.ts`: digits→9, letters→x, emails/phones/IDs fully masked) before any call; routing stays the registry’s.
8. **Fixtures** under `__fixtures__/formats/` (generated by `scripts/generate-format-fixtures.ts`, checked in, small) plus
   hostile samples: zip bomb, XML billion-laughs/XXE, deeply nested JSON, DBF lying about record count, XLS with
   huge SST count, SQL with `ATTACH`/stacked statements, path-traversal ZIP names, CSV formula cells, 10 MB single cell.
9. **Not claimed:** continuous sync, live connection to any accounting product, MSSQL/Access reading.

Files: `readers/**`, `analysis/reconciliation.ts`, `analysis/record-builder.ts`, `services/chunked-upload.service.ts`,
`services/package-reconciliation.service.ts`, `services/mapping-memory.service.ts`, `entities/import-mapping-memory.entity.ts`,
`migrations/*-CreateImportMappingMemory.ts`, `masking.ts`, `support-matrix.ts`, controller/DTO/module edits,
frontend `package-import-wizard.tsx` + `import-support-table.tsx` + client, `docs/IMPORT_SUPPORT.md`.


### Universal import — status and NOT done (2026-10-31)

Done in the PR: everything in items 1–9 above except the MSSQL sandbox implementation (design only) and
Access/MSSQL/Iran System reading (Persian guides). Tests: `readers/*.spec.ts`, `universal-import.spec.ts`,
`support-matrix.spec.ts`; fixtures from an independent writer (SheetJS) under `__fixtures__/`.

Researched suggestions received later, **not implemented, each needs doc/licence verification first**:
- Direct resumable upload to R2 (presigned multipart) so big files skip server disk — needs bucket CORS + token
  that can write (the R2 token is currently read-only, see STATE).
- Disposable sandbox (Daytona first) for `.bak/.mdf`: network off, `RESTORE FILELISTONLY` + `WITH MOVE` path remap,
  triggers/CLR disabled, export to CSV/Parquet. SQL Server image licence + ≥2 GB RAM: must run off the 12 GB prod box.
- Normalise to Parquet and reconcile with DuckDB under a memory cap (would remove the in-memory 120 MB parse cap).
- Postgres savepoint dry-run commit on a direct (non-transaction-pooled) connection.
- Sepidar playbook from verified public catalog names; Iran System decoding via an `iran-encoding`-style library
  (check licence; keep any GPL code in a separate process).
- Streaming readers for files above 120 MB; XLSX multi-sheet; MT940/CAMT.053.
Backend has no ESLint config in this repo (`npm run lint` cannot run); tsc, jest, `nest build` and the
frontend tsc/eslint/build were run.

## Open items (seeded from docs/STRATEGY.md §5, 2026-09-25)

- [ ] W6: ingest the 3 owner-supplied legal-corpus files (Civil Procedure
      1379, Cheque Law 1397, Dispute Councils 1402), then re-run the eval;
      switch production to `iran_laws_v2` only if citation accuracy clearly
      beats 16.7%. Owner-run (server + files).
- [ ] W7: measure STT/LLM/TTS p50, then streaming TTS; target p50 < 2s.
      Depends on W5.
- [ ] W9: live run of the deep-research agent on the 3 briefs
      (`docs/research/LIVE_RUN.md`, budget ≤ $1.50). Owner-run.
- [ ] W10: owner setup — capped `OPENROUTER_AGENT_KEY` secret, `AGENT_ENABLED`
      repo variable, branch protection on `main`, one low-risk `agent`-labelled
      issue run end to end.
- [ ] W11: Project Factory — depends on the W9 live run and W10 setup above.
- [ ] W12 (this workstream): "cheap hands, open memory" — opencode.json
      non-interactive permissions, `model-registry-check.yml`, plan/progress/
      decisions memory, `feature-plan`/`review-diff` skills, post-edit lint
      hook. See `docs/decisions/0002-model-registry.md`.
- [ ] W13: builder token & cost ledger, daily $ cap, cheap-first routing with
      escalation, prompt caching, weekly Persian cost report. Depends on W5, W10.
- [ ] W5: flip the `cheap` tier flag on, once the W6 eval passes.
- [ ] W21b: glassmorphism design tokens + app shell. Add glass CSS
      variables/Tailwind theme entries/utilities in frontend
      `src/app/globals.css` (three elevations + fallbacks), then apply only to
      the shell: page background (`src/app/chat/page.tsx`,
      `src/app/judge/page.tsx`), header (`src/components/layout/ghazi-header.tsx`),
      footer (`src/components/layout/enamad-footer.tsx`), and chat composer
      (`src/components/chat/chat-shell.tsx`). Update frontend `DESIGN.md`.
      Verify `npm run build` + `npx tsc --noEmit`.

## Bank statement reconciliation assistant (accounting suite, branch on PR 902)

Goal: a customer with several banks uploads a statement (Excel/CSV/PDF); the system checks it is the
right account and period, matches it to the ledger, asks short questions about the rest, and posts
only what is safe. Everything under `output_apps/enterprise_hub/modules/banking/recon/` (new files;
`data_import`, `accounting` and the legacy banking flow are not edited, only imported from).

### Pipeline

1. **Upload** `recon/parse/` – sniff kind, reuse `parseCsv/parseXlsx/parsePdf` (read-only reuse; a
   header-locator callback captures the title rows so bank/account/IBAN/period can be read). Per-bank
   profiles (`profiles/bank-profiles.ts`) list the column layouts accepted automatically; any other
   layout returns `needs_mapping` with the guessed columns and the user maps them once (saved as a
   tenant template keyed by the header fingerprint). Statement text is data: capped lengths, control
   characters stripped, never interpolated into queries/prompts unmasked.
2. **Prerequisites** `recon/prerequisites.ts` (pure) – IBAN checksum + bank id, account match by IBAN →
   number, bank-vs-account bank, period (header vs rows), overlap/duplicate file (sha256), opening
   balance continuity vs previous import/ledger opening, running-balance arithmetic. Output is a list
   of checks `ok | warn | ask | block`; `ask` needs a recorded confirmation; unknown account → guided
   create (bank account + ledger account) via existing `BankingService.createAccount`.
3. **Matching** `recon/matching/` (pure, BigInt minor units, stored as BIGINT rial): stages exact →
   reference/cheque/Sayad → date tolerance → one-to-many / many-to-one (bounded subset sum). Result
   groups `matched` (confidence ≥ tenant threshold, unambiguous) / `suggested` / `unmatched`, each with
   confidence and reasons. Book lines already matched elsewhere (legacy flow or earlier session) are
   excluded.
4. **Classification** `recon/classify/` – rules (fees/SMS with tenant thresholds, keywords for sale,
   purchase, partner current account, payroll, loan, tax, own-account transfer), counterparty
   extraction, real/legal person type, tenant history and tenant rules. LLM use is only an optional
   port behind `maskForLlm` (account numbers, IBANs, names, phone/national ids masked); this PR wires
   no model.
5. **Questions** `recon/questions.ts` – one short question per unresolved item, choices + evidence,
   optional attached document (type allowlist, 5 MB, sha256). An answer creates/updates a tenant rule.
6. **Posting** `recon/posting.service` – drafts by default (`fin_bank_recon_drafts`); batch approve
   (tenant admin) posts through `AccountingService.createJournalEntry` (period locks → 423 per item,
   not a batch failure); auto-post only for fee rules and only if `auto_post_fees` is on; correction
   = `reverseJournalEntry` + unmatch; every step writes `fin_bank_recon_audit` (append-only).
7. **Report** `recon/report/` – reconciliation statement (ledger balance, bank balance, deposits in
   transit, outstanding withdrawals, bank-only items, adjusted balances, difference), snapshot per
   period (`fin_bank_recon_reports`), export `xlsx` (own minimal writer, no new dependency), `csv`,
   and print-ready `html` for PDF (no Persian-capable PDF library in the repo; see PR notes).

### Tables (migration 1789372000000, all with `tenant_id`, every query tenant-scoped)

`fin_bank_recon_sessions`, `fin_bank_recon_items` (BIGINT rial), `fin_bank_recon_matches`,
`fin_bank_recon_rules`, `fin_bank_recon_settings`, `fin_bank_recon_drafts`,
`fin_bank_recon_attachments`, `fin_bank_recon_reports`, `fin_bank_recon_audit`.

### Out of scope / follow-ups

Frontend wizard (API first; the existing `/app/accounting/bank` page is untouched), real bank sample
files to promote profiles from `synthetic` to `verified`, LLM-assisted classification, integration
with `ai-bookkeeper` drafts and `universal-import` parsers once they land.

### Checklist

- [x] design (this section)
- [x] pure core (parse, profiles, prerequisites, matcher, classifier, questions, report, xlsx)
- [x] migration + repository + service + controller (raw SQL repository, no entities)
- [x] fixtures (7 banks, csv/xlsx/pdf) and tests; classification eval
- [ ] tsc, lint, build, jest banking; PR with owner policy questions
## Org access control: accounts, structure, permissions, security (2026-10-31)

Branch `claude/quirky-agnesi-1069f0` (on top of `feat/password-auth` commit f31d08c3).
Goal: one person can belong to many organisations, staff are invited (never asked for an
organisation name), every suite endpoint is decided server-side by one guard, modules are
sold per tenant, and security events are auditable. No prices anywhere.

### Decisions

1. **Membership replaces `users.tenant_id` as the source of truth.** New `tenant_memberships`
   (tenant_id, user_id, role, optional branch/department, status). `users.tenant_id/tenant_role`
   stay as "last active organisation" so old code and old tokens keep working.
2. **JWT is only a selector.** The token carries `sub`, `sid` (session = refresh family),
   `tenantId` (active org), `mfa`. `AccessGuard` re-checks session, membership, role
   permissions, tenant entitlement and 2FA policy from the database (15 s in-process cache,
   so revoke/suspend takes effect within seconds) and overwrites `request.user.tenantId/
   tenantRole` with the verified values. A client-supplied or stale tenant id cannot grant access.
3. **Signup creates no organisation.** `POST /org` creates one later (caller becomes owner).
   An invitation link/token joins an existing org. `organizationName` stays optional.
4. **One guard, default deny.** `AccessGuard` (global, after JwtAuthGuard) requires every
   non-public route to declare a policy: `@Public()`, `@AuthOnly()` (signed-in, any/no org),
   `@Roles(ADMIN)` (platform operator), or `@ModuleAccess(module)` on the class. The action is
   derived from the verb (GET=read, POST/PUT/PATCH/DELETE=create) unless `@RequireAction(a)`
   overrides it (approve, post, export, admin). A route with no policy is refused, and a
   reflection test fails CI if one is added.
5. **Catalogue in code** (`permissions/catalogue.ts`): modules x actions {read, create, approve,
   post, export, admin}. System roles are code constants (owner, admin, accountant, sales,
   cheque_reviewer, hr, read_only, plus hidden `legacy_member`). Custom roles live in
   `tenant_roles` (tenant-scoped, permission list validated against the catalogue, and a
   granter may only hand out permissions they hold themselves).
6. **Entitlements** `tenant_module_entitlements(tenant_id, module, enabled)`. Written only by
   platform operators (`@Roles(ADMIN)`, screen `/app/admin/entitlements`); tenant owners get a
   read-only list. Checked by the same guard: module not enabled => 403 `MODULE_NOT_ENTITLED`.
   Core modules (`members`, `security`, `audit`) are never gated. New tenants get
   `DEFAULT_TENANT_MODULES` (env, default none). No price column exists.
7. **Branch scoping (optional).** A membership may carry `branch_id` and `branch_scoped`. The
   guard exposes `request.access.branchId`; members/departments endpoints enforce it now. Suite
   tables have no branch column yet, so module repositories adopt it as a follow-up.
8. **Security.** TOTP (RFC 6238, secret AES-256-GCM encrypted with `TOTP_ENC_KEY`/JWT-derived
   fallback, 10 hashed recovery codes). A passkey sign-in counts as strong 2FA. Login with a
   TOTP-enabled account returns an `mfaToken` challenge, completed by `/auth/login/mfa`.
   Org policy `tenants.require_2fa` blocks suite access for sessions with `mfa=false` (403
   `MFA_REQUIRED`) until the user enrols. Sessions = refresh-token families with device label,
   IP, last used; list and revoke. New-device login sends an email alert. Existing Redis
   lockout stays; lockout and failures are audited. Optional HIBP k-anonymity breach check
   (`PASSWORD_BREACH_CHECK=1`, fail-open), scrypt hashing unchanged.
9. **Audit log** `audit_log` (append-only; DB trigger rejects UPDATE/DELETE/TRUNCATE), always
   carries tenant_id. A global interceptor records every mutating suite request (method, route,
   status, actor; never bodies) and services record semantic events. Admins read it at
   `GET /org/audit` (`audit:read`).
10. **Migration `1789350000000-AddOrgAccessControl`**: creates tables; backfills one membership
    per user with a tenant (`OWNER` -> owner, `MEMBER` -> `legacy_member`, which equals what a
    member could do before: crm and the assistant); enables every module for every
    existing tenant; installs the audit trigger. Idempotent; `down` drops only what it created.

### File list

Backend (`output_apps/enterprise_hub`):
- `migrations/1789350000000-AddOrgAccessControl.ts`
- `modules/access/`: `catalogue.ts`, `decorators.ts`, `access.guard.ts`, `access.service.ts`,
  `entities/*` (membership, branch, department, role, invitation, entitlement, audit),
  `repositories/*`, `services/{members,invitations,roles,structure,entitlements,audit}.service.ts`,
  `controllers/{org,invitations,entitlements-admin}.controller.ts`, `audit.interceptor.ts`,
  `access.module.ts`, DTOs, specs.
- `modules/auth/`: TOTP + sessions + switch-tenant + mfa login (`totp.service.ts`,
  `sessions.service.ts`, controller routes), signup without org, `inviteToken`, alerts.
- Existing controllers: class-level `@ModuleAccess`, `@RequireAction` on approve/post/export
  handlers, remove `requireTenantAdmin` calls; `tenants.controller` delegates to access module.
- `security/global-guards.ts` (guard order), `app.module.ts`.
- Tests: `permissions/permission-matrix.spec.ts` (+ snapshot), `access.guard.spec.ts`,
  `test/access-control.e2e-spec.ts` (tenant isolation, invite flow, audit immutability),
  `test/migrations/verify-access-control-migration.sh`.

Frontend (`frontend/src`): `app/app/settings/{members,security,audit}`, `app/app/admin/entitlements`,
`app/app/onboarding`, `app/invite/[token]`, org switcher in `components/app/app-shell.tsx`,
`lib/api/access-client.ts` (+ permission-aware nav), signup dialog org name optional.
Browser spec: `e2e/app/07-members-roles.spec.ts`.

### Additions agreed during the build (owner messages 2026-10-31)

- **Trial switch**: `ALL_MODULES_ENABLED` (default `true`) opens every module to every tenant. Setting it
  to `false` hands over to the stored `tenant_module_entitlements` (all enabled for existing tenants by the
  migration), so ending the trial needs no migration. `DEFAULT_TENANT_MODULES` sets what new tenants get.
- **Module catalogue with dependencies** (`MODULE_DEPENDENCIES`: hr, banking, invoicing need accounting;
  cheques need banking; tax needs invoicing), enforced when a module is enabled or disabled. An "add modules"
  page (`/app/settings/modules`) lets an owner *request* a module (`tenant_module_requests`); Roxira staff
  enable it. Not-enabled modules are hidden from navigation, command search and the dashboard and closed in the API.
- **Tenant context in the database**: `TenantScope` runs repository calls in a transaction that starts with
  `set_config('app.tenant_id', <tenant>, true)` (transaction-local, PgBouncer-transaction-pooling safe).
  Row-level security (FORCE) on branches, departments, roles and audit reads uses that setting. Not applied to
  memberships/invitations/entitlements/requests (they are looked up across tenants by design: login, invite token, operator screens).
- **Hash-chained audit log**: each tenant's rows carry `prev_hash`/`hash` (sha256 over a canonical row), appended
  under a per-tenant advisory lock; `GET /org/audit/verify` reports the first broken row. App role has no UPDATE/DELETE policy; trigger blocks it for everyone else.

### Done means

- [x] permission matrix test over every controller (reflection) + snapshot (`modules/access/permission-matrix.spec.ts`)
- [x] tenant isolation tests (unit + real Postgres, also as a non-superuser owner so RLS is exercised) (`test/access-control.e2e-spec.ts`)
- [x] migration up/down/up on a throwaway DB with legacy data (`test/migrations/verify-access-control-migration.sh`)
- [x] browser spec for invite + role limits (`e2e/app/07-members-roles.spec.ts`; Chromium run against `test/support/dev-harness.ts`)
- [x] `tsc`, `nest build`, jest, frontend tsc/eslint/webpack build green

### Config added

`ALL_MODULES_ENABLED`, `DEFAULT_TENANT_MODULES`, `TOTP_ENC_KEY` (falls back to a key derived from `JWT_SECRET`),
`PASSWORD_BREACH_CHECK=1` (optional k-anonymity check), `PORTAL_URL_IR/NET` (invite links).

### Open owner questions (defaults chosen)

- "Owner-only entitlement screen" = Roxira platform operator (`UserRole.ADMIN`); tenant owners
  cannot self-enable modules. Say so if you meant the tenant owner.
- New tenants start with no business modules until enabled (`DEFAULT_TENANT_MODULES`).
- Phone invitations return the link to the inviter (no SMS template exists for invites yet).
