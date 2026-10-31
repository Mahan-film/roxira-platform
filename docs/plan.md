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
