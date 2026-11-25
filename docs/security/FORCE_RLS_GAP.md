# T200 Prerequisites: Tables Without `FORCE ROW LEVEL SECURITY`

> **Status:** Read-only audit on `origin/main` (2026-11-24). No migrations or code changes in this report; follow-up migrations are separate tasks.

## 1. Executive Summary & Reconciliation with `STATE.md` / `ARCHITECTURE.md`

`docs/STATE.md` (`docs/STATE.md:52`) and `docs/ARCHITECTURE.md` (`docs/ARCHITECTURE.md:158`) cite **"21 tables without FORCE RLS"** from an earlier snapshot (`#1009`, `docs/ops/APP_DB_ROLE.md:88-96`).

A live schema audit on a fresh PostgreSQL 17 database migrated with all TypeORM migrations (`npm run migration:run` in `output_apps/enterprise_hub`) shows:

- **146 tables** in schema `public` (`pg_class` with `relkind IN ('r', 'p')` and `NOT relispartition`).
- **141 tables** have `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` (`relforcerowsecurity = true`), including **all 139 tables with a `tenant_id` column** (enforced by `scripts/dev/rls_coverage.sh:40-54` in CI).
- **5 TypeORM-managed tables** lack `FORCE ROW LEVEL SECURITY` (`relforcerowsecurity = false`). All 5 are explicitly tracked in `scripts/dev/rls_allowlist.txt:4-8`.
- **6 Python-owned / ecosystem user-scoped tables** (`chat_conversations`, `chat_messages`, `support_tickets`, `payment_orders`, `user_entitlements`, `user_retrial_requests`) are not created by TypeORM migrations; they receive `ENABLE + FORCE ROW LEVEL SECURITY` conditionally via `roxira_apply_user_scoped_rls()` (`output_apps/enterprise_hub/migrations/1789900012500-EnableUserScopedRlsSmartJudge.ts:25-115`) and at Python startup via `ensure_user_scoped_rls()` (`output_apps/generated_modules/smartjudge/user_rls.py:115`).
- **Legacy / Python-only non-`tenant_id` tables** listed in the 2026-10-31 production audit (`docs/ops/APP_DB_ROLE.md:95`: `accounting_accounts`, `crypto_unmatched_tx`, `email_accounts`, `fin_invoices`, `journal_entries`, `system_users`, plus `legal_*` and `graph_*` public-law tables) are not created by TypeORM migrations and remain on `enterprise_admin` (Python services / legacy) rather than `roxira_app`.

---

## 2. TypeORM-Managed Tables Without `FORCE ROW LEVEL SECURITY` (5 Tables)

| Table | `ENABLE RLS` | `FORCE RLS` | Owner / Key Column | Why Not Forced Today |
|---|---|---|---|---|
| `auth_passkey_credentials` | `false` | `false` | `user_id` | Read during WebAuthn login/assertion by `credential_id` before any user or tenant session exists (`LESSONS.md` #7; `scripts/dev/rls_allowlist.txt:6`). |
| `user_totp` | `false` | `false` | `user_id` | Read during 2FA verification at login before a tenant context is established (`LESSONS.md` #7; `scripts/dev/rls_allowlist.txt:7`). |
| `receipt_bot_processed_updates` | `true` | `false` | `(bot_id, update_id)` | Telegram webhook dedupe written before a tenant is resolved; has `ENABLE RLS` with no permissive policies and is accessed via `SECURITY DEFINER` function `receipt_bot_claim_update` (`scripts/dev/rls_allowlist.txt:8`, `1789900003900-CreateReceiptBotIntegration.ts:140-174`). |
| `tenants` | `false` | `false` | `id` (self-keyed) | Tenant registry itself; read before tenant context exists (login, slug lookup, onboarding, cross-tenant entitlements/admin, bulk import sweep) (`scripts/dev/rls_allowlist.txt:5`). |
| `migrations` | `false` | `false` | — | TypeORM migration bookkeeping table; contains no tenant data (`scripts/dev/rls_allowlist.txt:4`). `roxira_app` has read-only access (`docs/ops/APP_DB_ROLE.md:10`). |

---

## 3. Callers Blocking `FORCE RLS` (Verified with `git grep`)

### 3.1 `auth_passkey_credentials` (`PasskeyCredentialEntity`)
- **Entity & Module:**
  - `output_apps/enterprise_hub/modules/auth/entities/passkey-credential.entity.ts:17-18` (`@Entity({ name: 'auth_passkey_credentials' })`)
  - `output_apps/enterprise_hub/modules/auth/auth.module.ts:12,50,75`
- **Repository (`PasskeyRepository` — uses `@InjectRepository(PasskeyCredentialEntity)` without `TenantScope`):**
  - `output_apps/enterprise_hub/modules/auth/repositories/passkey.repository.ts:11-39` (`findByCredentialId`, `findByUserId`, `create`, `save`)
- **Service Callers (`WebAuthnService`):**
  - `output_apps/enterprise_hub/modules/auth/services/webauthn.service.ts:185` (`findByUserId` during registration options)
  - `output_apps/enterprise_hub/modules/auth/services/webauthn.service.ts:242` (`findByUserId` during authentication options)
  - `output_apps/enterprise_hub/modules/auth/services/webauthn.service.ts:343,348` (`findByCredentialId` + `create` during registration verify)
  - `output_apps/enterprise_hub/modules/auth/services/webauthn.service.ts:406,445` (`findByCredentialId` + `save` during authentication verify — **pre-auth, no `user_id` or `tenant_id` in session**)
  - `output_apps/enterprise_hub/modules/auth/services/webauthn.service.ts:470` (`findByUserId` when listing credentials)

### 3.2 `user_totp` (`UserTotpEntity`)
- **Entity & Module:**
  - `output_apps/enterprise_hub/modules/auth/entities/user-totp.entity.ts:4-5` (`@Entity({ name: 'user_totp' })`)
  - `output_apps/enterprise_hub/modules/auth/auth.module.ts:14,52,81`
- **Repository (`TotpRepository` — uses `@InjectRepository(UserTotpEntity)` without `TenantScope`):**
  - `output_apps/enterprise_hub/modules/auth/repositories/totp.repository.ts:8-15` (`find`, `save`, `advanceStep`, `remove`)
- **Service Callers (`TotpService`):**
  - `output_apps/enterprise_hub/modules/auth/services/totp.service.ts:36` (`find` — `isEnabled`)
  - `output_apps/enterprise_hub/modules/auth/services/totp.service.ts:41,44` (`find` + `save` — enrollment setup)
  - `output_apps/enterprise_hub/modules/auth/services/totp.service.ts:57,65` (`find` + `save` — enrollment confirm)
  - `output_apps/enterprise_hub/modules/auth/services/totp.service.ts:77,83,88` (`find` + `advanceStep` + `save` — login 2FA verification, **pre-tenant**, `userId` known from primary auth step)
  - `output_apps/enterprise_hub/modules/auth/services/totp.service.ts:94` (`remove` — disable 2FA)

### 3.3 `receipt_bot_processed_updates`
- **Migration & `SECURITY DEFINER` Function:**
  - `output_apps/enterprise_hub/migrations/1789900003900-CreateReceiptBotIntegration.ts:143-174` (creates table, `ENABLE ROW LEVEL SECURITY`, and `receipt_bot_claim_update(p_bot_id text, p_update_id bigint)` as `SECURITY DEFINER`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO roxira_app` at `:179,188`)
- **Repository Caller:**
  - `output_apps/enterprise_hub/modules/integrations/receipt_bot/repositories/receipt-bot.repository.ts:156` (`SELECT receipt_bot_claim_update($1, $2) AS claimed`)
- **Note:** Because `receipt_bot_claim_update` is `SECURITY DEFINER` owned by the table owner (`enterprise_admin`), adding `FORCE ROW LEVEL SECURITY` would block even the `SECURITY DEFINER` function unless the table has a policy or the function's owner has `BYPASSRLS` (which `enterprise_admin` has in prod, but a non-superuser migration owner in tests does not).

### 3.4 `tenants` (`TenantEntity`)
- **Entity & Repository (`TenantsRepository` — uses `@InjectRepository(TenantEntity)` without `TenantScope`):**
  - `output_apps/enterprise_hub/modules/tenants/entities/tenant.entity.ts:19`
  - `output_apps/enterprise_hub/modules/tenants/repositories/tenants.repository.ts:14-57` (`create`, `findById`, `findBySlug`, `updateName`, `listAll`)
  - `output_apps/enterprise_hub/modules/tenants/services/tenants.service.ts:25-64`
- **Cross-Module & Pre-Tenant Callers:**
  - `output_apps/enterprise_hub/modules/access/controllers/entitlements-admin.controller.ts:22` (platform operator cross-tenant admin)
  - `output_apps/enterprise_hub/modules/access/services/access.service.ts:42`
  - `output_apps/enterprise_hub/modules/access/services/entitlements.service.ts:32`
  - `output_apps/enterprise_hub/modules/access/services/invitations.service.ts:44` (pre-tenant invite lookup)
  - `output_apps/enterprise_hub/modules/access/services/organizations.service.ts:20-21`
  - `output_apps/enterprise_hub/modules/country_packs/country-pack.resolver.ts:15` (per-request pack lookup)
  - `output_apps/enterprise_hub/modules/invoicing/services/invoicing.service.ts:150`
  - `output_apps/enterprise_hub/modules/invoicing/services/pos-sale.service.ts:46`
  - `output_apps/enterprise_hub/modules/data_import/bulk/bulk-import.repository.ts:310` (`SELECT id FROM tenants` — background sweep across all tenants)

---

## 4. Already-Forced Pre-Tenant & Python-Owned Tables (Reference)

These tables were previously unforced in `docs/ops/APP_DB_ROLE.md:92-95` and now have `FORCE ROW LEVEL SECURITY` in `origin/main`:

1. **Pre-tenant auth/onboarding tables (8 tables):** `users`, `auth_refresh_tokens`, `tenant_memberships`, `tenant_invitations`, `tenant_module_entitlements`, `tenant_module_requests`, `contact_messages`, `enterprise_inquiries` — forced by `output_apps/enterprise_hub/migrations/1789900004100-EnableRlsPreTenantTables.ts:21-30` using `SECURITY DEFINER` lookup functions (`lookup_user_by_phone`, `lookup_user_by_username`, `lookup_user_by_login_email`, etc.) and `app.user_id` / `app.tenant_id` policies.
2. **Python-owned user-scoped tables (6 tables):** `chat_conversations`, `chat_messages`, `support_tickets`, `payment_orders`, `user_entitlements`, `user_retrial_requests` — forced by `roxira_apply_user_scoped_rls()` (`1789900012500-EnableUserScopedRlsSmartJudge.ts:25-115`) and `ensure_user_scoped_rls()` (`output_apps/generated_modules/smartjudge/user_rls.py:115`) using `app.current_user_ref`. Note: `admin_store.py:140-370` queries these tables across users using the Python service's owner connection (`enterprise_admin`).

---

## 5. Safest Enabling Order

1. **Step 1 — `user_totp` (lowest risk):**
   - `TotpService` always receives a resolved `userId` (`totp.service.ts:36-94`).
   - Wrap `TotpRepository` queries in a user-scoped transaction (`SET LOCAL app.user_id = $1`), add `ENABLE + FORCE ROW LEVEL SECURITY` with `user_id = NULLIF(current_setting('app.user_id', true), '')::uuid`, and remove `user_totp` from `scripts/dev/rls_allowlist.txt`.
2. **Step 2 — `auth_passkey_credentials`:**
   - `findByUserId`, `create`, `save` have `userId`; only `findByCredentialId` (`webauthn.service.ts:343,406`) runs before `userId` is known.
   - Add a `SECURITY DEFINER` lookup function (matching the pattern in `1789900004100-EnableRlsPreTenantTables.ts`) for `findByCredentialId`, scope the remaining `PasskeyRepository` methods with `app.user_id`, add `ENABLE + FORCE ROW LEVEL SECURITY`, and remove `auth_passkey_credentials` from `scripts/dev/rls_allowlist.txt`.
3. **Step 3 — `receipt_bot_processed_updates` (keep `ENABLE RLS`, optional `FORCE`):**
   - Already protected by `ENABLE ROW LEVEL SECURITY` with zero policies (`1789900003900-CreateReceiptBotIntegration.ts:154`), so `roxira_app` cannot read or write it directly and must call `receipt_bot_claim_update`.
   - Only enable `FORCE ROW LEVEL SECURITY` if paired with an explicit policy or role-targeted bypass; otherwise keep as-is in `rls_allowlist.txt`.
4. **Step 4 — `tenants` (last, or keep allowlisted):**
   - `tenants` has legitimate pre-tenant (`findBySlug`, `invitations.service.ts:44`), onboarding (`create`), and cross-tenant (`entitlements-admin.controller.ts:22`, `bulk-import.repository.ts:310`) callers.
   - Keep `tenants` in `scripts/dev/rls_allowlist.txt` for T200 cutover (`#831`), or introduce `SECURITY DEFINER` slug/admin helpers before adding `FORCE RLS` (`id = app.tenant_id`).
5. **Step 5 — `migrations` (never force):**
   - TypeORM bookkeeping table with no tenant data; permanently exempt in `scripts/dev/rls_allowlist.txt:4`.

---

## 6. Offline Test List

Existing offline / PostgreSQL tests covering RLS and the allowlist:
- `scripts/dev/rls_coverage.sh` (verified via `scripts/dev/fresh_db_migrate.sh`) — validates all `tenant_id` tables have `ENABLE + FORCE RLS` + `app.tenant_id` policy, and validates `scripts/dev/rls_allowlist.txt`.
- `output_apps/enterprise_hub/test/rls/rls-coverage-gate.pg.spec.ts` — unit/PG spec for `rls_coverage.sh` failure modes.
- `output_apps/enterprise_hub/modules/access/rls/tenant-rls-all-tables.pg.spec.ts` — verifies cross-tenant isolation across tenant tables as `roxira_app`.
- `output_apps/enterprise_hub/modules/access/rls/pre-tenant-rls.pg.spec.ts` — verifies `FORCE RLS` + `SECURITY DEFINER` pre-auth lookups on the 8 pre-tenant tables as `roxira_app`.
- `output_apps/enterprise_hub/modules/integrations/receipt_bot/receipt-bot.pg.spec.ts` — verifies `receipt_bot_claim_update` and `REVOKE ALL FROM PUBLIC` as `roxira_app` (`:71,178-187`).
- `output_apps/generated_modules/smartjudge/tests/test_user_scoped_rls.py` — verifies Python `ensure_user_scoped_rls()` DDL generation for the 6 user-scoped tables.

New offline PG specs required when implementing Steps 1–2:
- `user_totp.pg.spec.ts` (as `roxira_app`): cross-user isolation (`app.user_id` mismatch returns null/0 rows) + 2FA login verification flow without `app.tenant_id`.
- `passkey-rls.pg.spec.ts` (as `roxira_app`): cross-user isolation on `findByUserId`/`save` + `SECURITY DEFINER` `findByCredentialId` during unauthenticated WebAuthn assertion.
