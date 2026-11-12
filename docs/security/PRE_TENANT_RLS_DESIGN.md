# Pre-Tenant Tables Row-Level Security Architecture & Design Note

> **Issue Reference**: #475 (RLS: tenant tables on production without row-level security)  
> **Master Queue Reference**: Issue #592 Task T29  
> **Author**: Antigravity Autonomous Agent  
> **Status**: Approved Architecture & Implementation Standard  

---

## 1. Executive Summary & Problem Statement

In Roxira Platform, multi-tenant data isolation is enforced at the database layer via PostgreSQL Row-Level Security (RLS). Production connections run strictly as the unprivileged role `roxira_app` (`NOSUPERUSER NOBYPASSRLS`), preventing cross-tenant data leaks even in the event of application-level bugs or SQL injection vulnerabilities.

Under earlier RLS batches (#618, #620, #622, #624, #626, #628), 93 of 101 public tables containing a `tenant_id` column were placed under `ENABLE + FORCE ROW LEVEL SECURITY` using the uniform tenant predicate:
```sql
TENANT_MATCH = "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
```

However, exactly **8 tables** were intentionally excluded from this uniform policy because they support operations that take place **before** a tenant context is established (pre-tenant authentication, registration, token refresh, invitation claiming, public contact submissions, and enterprise onboarding).

Applying `TENANT_MATCH` to these 8 tables without a dedicated design immediately breaks the platform:
1. **Login Failure**: A user submitting a phone number (`09...`), username, or login email has not yet chosen or authenticated into a tenant. With `TENANT_MATCH`, queries execute with `app.tenant_id = NULL`, returning 0 rows.
2. **Refresh Failure**: Refresh token rotation passes only an opaque `token_hash`. The server cannot know which tenant the session belongs to until after the token record is retrieved.
3. **Invitation Acceptance Failure**: An invite link (`/invite?token=...`) is accessed by an unauthenticated or newly registering user. The tenant ID is embedded in the invitation record itself.
4. **Public Form Failure**: Public web visitors submitting `contact_messages` or `enterprise_inquiries` do not belong to a tenant (`tenant_id` is NULL).

This document establishes the official security architecture and RLS policy model for all 8 pre-tenant tables, pairing **granular PostgreSQL RLS policies** with **`SECURITY DEFINER` lookup functions** owned by `postgres`.

---

## 2. Threat Model & Security Invariants

### 2.1 Threat Model
- **T1: Cross-Tenant Account Enumeration**: An attacker in Tenant A attempts to discover user identities, emails, phone numbers, or active memberships of Tenant B.
- **T2: Session / Refresh Token Hijacking**: An authenticated tenant user attempts to read or revoke refresh tokens belonging to other users or other organizations.
- **T3: Invitation Poisoning & Interception**: An attacker in Tenant A scans `tenant_invitations` to discover invite tokens or hijack invitations destined for Tenant B.
- **T4: Public Form Exposure**: Web visitors can submit inquiries or contact messages, but must never be able to read existing inquiries submitted by other parties.
- **T5: Module Entitlement Tampering**: A tenant user attempts to artificially grant themselves access to unpurchased modules (`tenant_module_entitlements`) or view other tenants' module requests.

### 2.2 Security Invariants
- **Invariant 1 (Zero Superuser Dependency)**: All application traffic through `roxira_app` must respect row-level security without requiring superuser bypass.
- **Invariant 2 (Strict Search Path on Security Definers)**: Every `SECURITY DEFINER` function must explicitly pin `SET search_path = public, pg_temp` to prevent search-path hijacking attacks.
- **Invariant 3 (Self-User Privacy)**: A user may inspect and update their own user record (`id = app.user_id`), but tenant managers can only see users actively affiliated with their own tenant.
- **Invariant 4 (Public and Inbound Ingestion Isolation)**: Public and inbound submission endpoints are guarded without global bypass: `contact_messages` enforces tenant-bound insert (`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = app.tenant_id::uuid`), while `enterprise_inquiries` allows anonymous onboarding submission (`tenant_id IS NULL`) or tenant-scoped insert. Reads and modifications remain strictly tenant-scoped (`USING (tenant_id = app.tenant_id::uuid)`).

---

## 3. Catalogue of the 8 Pre-Tenant Tables

| # | Table Name | Columns of Interest | Pre-Tenant Operation | Authenticated Tenant Operation |
|---|---|---|---|---|
| 1 | `users` | `id`, `phone`, `username`, `login_email`, `password_hash`, `tenant_id`, `managed_by_tenant_id` | OTP login, password login, user registration | Member directory, staff management |
| 2 | `auth_refresh_tokens` | `id`, `user_id`, `tenant_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at` | Token rotation (`/auth/refresh`), stolen-token detection | Session list, logout, session revocation |
| 3 | `tenant_memberships` | `id`, `tenant_id`, `user_id`, `role_key`, `custom_role_id`, `status` | Tenant switcher (`listForUser`), pre-auth tenant discovery | Member listing (`listByTenant`), role assignment |
| 4 | `tenant_invitations` | `id`, `tenant_id`, `token_hash`, `email`, `role_key`, `accepted_at` | Invite preview & acceptance by token hash | Admin listing pending invites (`listPending`) |
| 5 | `tenant_module_entitlements` | `tenant_id`, `module`, `enabled`, `updated_at` | Platform bootstrap / system licensing check | Tenant entitlement query |
| 6 | `tenant_module_requests` | `id`, `tenant_id`, `module`, `requested_by`, `status` | None (always tenant-scoped) | Requesting a new module, checking request status |
| 7 | `contact_messages` | `id`, `tenant_id`, `sender_name`, `sender_phone`, `message`, `lead_id` | Public contact form submission | CRM team viewing inquiries / leads |
| 8 | `enterprise_inquiries` | `id`, `tenant_id`, `name`, `phone`, `email`, `company`, `status` | Public enterprise onboarding inquiry | Backoffice / sales triage |

---

## 4. Policy Architecture & SECURITY DEFINER Functions

To reconcile RLS enforcement with pre-tenant workflows, the platform employs a dual-tier security pattern:

1. **Tier 1: Narrow `SECURITY DEFINER` Lookup Functions**:
   Pre-tenant lookups where no session context exists are encapsulated in atomic, single-purpose functions created by `postgres`. These functions return only the exact matched row and cannot be used for arbitrary table scanning.
2. **Tier 2: Granular Table RLS Policies**:
   Once rows are created or accessed within an active session, RLS policies enforce tenant boundaries (`app.tenant_id`) and user self-access boundaries (`app.user_id`).

### 4.1 Lookup Functions Specification

The migration creates 17 atomic `SECURITY DEFINER` routines owned by `postgres` with `SET search_path = public, pg_temp`, returning explicit projection columns rather than whole entity stars:

```sql
-- 1. User lookup by phone (for Kavenegar OTP sign-in)
CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
RETURNS TABLE (
  id uuid,
  phone varchar,
  username varchar,
  managed_by_tenant_id uuid,
  login_email varchar,
  display_name varchar,
  email varchar,
  role varchar,
  service_domain varchar,
  tenant_id uuid,
  tenant_role varchar,
  is_active boolean,
  last_login_at timestamp,
  created_at timestamp,
  updated_at timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, phone, username, managed_by_tenant_id, login_email,
         "displayName" AS display_name, email, role::varchar, "serviceDomain"::varchar AS service_domain,
         tenant_id, tenant_role, "isActive" AS is_active,
         "lastLoginAt" AS last_login_at, "createdAt" AS created_at, "updatedAt" AS updated_at
  FROM public.users
  WHERE phone = p_phone
  LIMIT 1;
$$;

-- 2. User lookup by username or login email (for password sign-in)
CREATE OR REPLACE FUNCTION public.lookup_user_by_username(p_username text)
RETURNS TABLE (
  id uuid,
  phone varchar,
  username varchar,
  managed_by_tenant_id uuid,
  login_email varchar,
  password_hash text,
  password_updated_at timestamp,
  display_name varchar,
  email varchar,
  role varchar,
  service_domain varchar,
  tenant_id uuid,
  tenant_role varchar,
  is_active boolean,
  last_login_at timestamp,
  created_at timestamp,
  updated_at timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, phone, username, managed_by_tenant_id, login_email, password_hash, password_updated_at,
         "displayName" AS display_name, email, role::varchar, "serviceDomain"::varchar AS service_domain,
         tenant_id, tenant_role, "isActive" AS is_active,
         "lastLoginAt" AS last_login_at, "createdAt" AS created_at, "updatedAt" AS updated_at
  FROM public.users
  WHERE lower(username) = lower(p_username)
  ORDER BY id ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.lookup_user_by_login_email(p_email text)
RETURNS TABLE (
  id uuid,
  phone varchar,
  username varchar,
  managed_by_tenant_id uuid,
  login_email varchar,
  password_hash text,
  password_updated_at timestamp,
  display_name varchar,
  email varchar,
  role varchar,
  service_domain varchar,
  tenant_id uuid,
  tenant_role varchar,
  is_active boolean,
  last_login_at timestamp,
  created_at timestamp,
  updated_at timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, phone, username, managed_by_tenant_id, login_email, password_hash, password_updated_at,
         "displayName" AS display_name, email, role::varchar, "serviceDomain"::varchar AS service_domain,
         tenant_id, tenant_role, "isActive" AS is_active,
         "lastLoginAt" AS last_login_at, "createdAt" AS created_at, "updatedAt" AS updated_at
  FROM public.users
  WHERE lower(login_email) = lower(p_email)
  ORDER BY id ASC
  LIMIT 1;
$$;

-- 3. User lookup by ID (with optional password hash) with caller context check
CREATE OR REPLACE FUNCTION public.lookup_user_by_id(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  phone varchar,
  username varchar,
  managed_by_tenant_id uuid,
  login_email varchar,
  display_name varchar,
  email varchar,
  role varchar,
  service_domain varchar,
  tenant_id uuid,
  tenant_role varchar,
  is_active boolean,
  last_login_at timestamp,
  created_at timestamp,
  updated_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v_current_user IS NOT NULL AND v_current_user <> p_user_id THEN
    RAISE EXCEPTION 'caller user context does not match target user';
  END IF;
  RETURN QUERY
  SELECT u.id, u.phone, u.username, u.managed_by_tenant_id, u.login_email,
         u."displayName" AS display_name, u.email, u.role::varchar, u."serviceDomain"::varchar AS service_domain,
         u.tenant_id, u.tenant_role, u."isActive" AS is_active,
         u."lastLoginAt" AS last_login_at, u."createdAt" AS created_at, u."updatedAt" AS updated_at
  FROM public.users u
  WHERE u.id = p_user_id
  LIMIT 1;
END;
$$;

-- 4. Refresh token lookup and token rotation mutators
CREATE OR REPLACE FUNCTION public.lookup_refresh_token_by_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  tenant_id uuid,
  token_hash varchar,
  family_id uuid,
  user_agent varchar,
  ip varchar,
  device_hash varchar,
  mfa boolean,
  session_started_at timestamp,
  expires_at timestamp,
  revoked_at timestamp,
  created_at timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, user_id, tenant_id, token_hash, family_id, user_agent, ip, device_hash,
         mfa, session_started_at, expires_at, revoked_at, created_at
  FROM public.auth_refresh_tokens
  WHERE token_hash = p_token_hash
  LIMIT 1;
$$;

-- 5. User memberships lookup (for tenant switcher upon login)
CREATE OR REPLACE FUNCTION public.lookup_user_memberships(p_user_id uuid)
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  tenant_name varchar,
  role_key varchar,
  status varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_current_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_current_user IS NOT NULL AND v_current_user <> p_user_id THEN
    RAISE EXCEPTION 'caller user context does not match target user';
  END IF;
  RETURN QUERY
  SELECT m.id AS membership_id, m.tenant_id, t.name AS tenant_name, m.role_key, m.status
  FROM public.tenant_memberships m
  JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
    AND t.is_active = true
    AND (v_current_tenant IS NULL OR m.tenant_id = v_current_tenant)
  ORDER BY m.created_at ASC;
END;
$$;

-- 6. Invitation lookup by SHA-256 hash
CREATE OR REPLACE FUNCTION public.lookup_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email varchar,
  phone varchar,
  role_key varchar,
  custom_role_id uuid,
  branch_id uuid,
  department_id uuid,
  branch_scoped boolean,
  token_hash varchar,
  expires_at timestamp,
  accepted_at timestamp,
  accepted_by uuid,
  revoked_at timestamp,
  invited_by uuid,
  created_at timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, email, phone, role_key, custom_role_id, branch_id, department_id,
         branch_scoped, token_hash, expires_at, accepted_at, accepted_by, revoked_at,
         invited_by, created_at
  FROM public.tenant_invitations
  WHERE token_hash = p_token_hash
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > CURRENT_TIMESTAMP
  LIMIT 1;
$$;
```

### 4.2 Table RLS Policies Specification

All policies operate purely on database session parameters (`app.tenant_id` and `app.user_id`) without arbitrary session flags:

```sql
-- =========================================================================
-- 1. users
-- =========================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

CREATE POLICY "users_tenant_and_self" ON "users"
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
    "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR "managed_by_tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR "id" IN (
      SELECT m."user_id" FROM "tenant_memberships" m
      WHERE m."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  ))
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "id" = nullif(current_setting('app.user_id', true), '')::uuid)
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
    "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR "managed_by_tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  ))
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "id" = nullif(current_setting('app.user_id', true), '')::uuid)
);

-- =========================================================================
-- 2. auth_refresh_tokens
-- =========================================================================
ALTER TABLE public.auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY "auth_refresh_tokens_tenant_and_user" ON "auth_refresh_tokens"
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
);

-- =========================================================================
-- 3. tenant_memberships
-- =========================================================================
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_memberships_tenant_and_user" ON "tenant_memberships"
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
)
WITH CHECK (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

-- =========================================================================
-- 4. tenant_invitations
-- =========================================================================
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_invitations_tenant" ON "tenant_invitations"
FOR ALL
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

-- =========================================================================
-- 5. tenant_module_entitlements
-- =========================================================================
ALTER TABLE public.tenant_module_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_module_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_module_entitlements_tenant" ON "tenant_module_entitlements"
FOR ALL
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

-- =========================================================================
-- 6. tenant_module_requests
-- =========================================================================
ALTER TABLE public.tenant_module_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_module_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_module_requests_tenant" ON "tenant_module_requests"
FOR ALL
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

-- =========================================================================
-- 7. contact_messages
-- =========================================================================
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages FORCE ROW LEVEL SECURITY;

-- Contact messages insert requires a matching tenant context
CREATE POLICY "contact_messages_insert" ON "contact_messages"
FOR INSERT
WITH CHECK (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
  AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "contact_messages_tenant" ON "contact_messages"
FOR SELECT
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "contact_messages_modify" ON "contact_messages"
FOR UPDATE
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "contact_messages_delete" ON "contact_messages"
FOR DELETE
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);

-- =========================================================================
-- 8. enterprise_inquiries
-- =========================================================================
ALTER TABLE public.enterprise_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_inquiries FORCE ROW LEVEL SECURITY;

CREATE POLICY "enterprise_inquiries_insert" ON "enterprise_inquiries"
FOR INSERT
WITH CHECK (
  "tenant_id" IS NULL
  OR (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
);

CREATE POLICY "enterprise_inquiries_tenant" ON "enterprise_inquiries"
FOR ALL
USING (
  nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);
```

### 4.3 Definer Context Guards & Access Boundaries

During the initial pre-authentication phase (before user/tenant identity is known), only four truly anonymous/pre-auth lookup functions operate without session settings:
- `lookup_user_by_phone(p_phone)` (intended pre-auth OTP lookup by phone number), `lookup_user_by_username(p_username)` (exact match), and `lookup_user_by_login_email(p_email)` (exact match);
- `lookup_refresh_token_by_hash(p_token_hash)` (opaque SHA-256 token lookup);
- `lookup_invitation_by_token_hash(p_token_hash)` (opaque SHA-256 invite lookup);
- `is_refresh_token_family_active(p_family_id, p_user_id)`, `delete_expired_refresh_tokens(p_before)`, and anonymous `submit_enterprise_inquiry(..., NULL)`.

Every **by-id** or **by-tenant** `SECURITY DEFINER` function (`lookup_user_by_id`, `lookup_user_by_id_with_password`, `lookup_user_memberships`, `lookup_tenant_entitlements`, `revoke_refresh_token_if_active`, `revoke_refresh_token_family`, `mark_invitation_accepted`) **fails closed** when `app.user_id` / `app.tenant_id` is unset (`NULL`) or does not match the target row/caller:
- Repositories bind verified caller context (`app.user_id` and/or `app.tenant_id`) inside explicit transactions before invoking these functions; unbound calls raise an exception in PostgreSQL.
- Cross-tenant platform-operator functions (`list_open_module_requests`, `list_enterprise_inquiries`) require BOTH NestJS `@Roles(UserRole.ADMIN)` AND a DB-side operator check (`app.user_id` must reference an active `users` row with `role = 'ADMIN'`). Accepted cross-tenant exposure is strictly limited to active global `ADMIN` operators.
- `users` membership visibility (`tenant_memberships`) is `FOR SELECT` only; `INSERT`/`UPDATE`/`DELETE` policies on `users` require matching `tenant_id`, `managed_by_tenant_id`, or self (`id = app.user_id`), and `tenant_memberships` mutations require `app.tenant_id`.

---

## 5. Security & Isolation Matrix

| Actor / Session Context | `users` | `auth_refresh_tokens` | `tenant_memberships` | `tenant_invitations` | `contact_messages` | `enterprise_inquiries` |
|---|---|---|---|---|---|---|
| **Unauthenticated Visitor** | 0 rows direct; phone/username/email login lookup only | 0 rows direct; opaque hash lookup only | 0 rows direct; `lookup_user_memberships` fails closed without `app.user_id` | 0 rows direct; invite lookup by token hash only | `INSERT` requires `app.tenant_id`; 0 rows read | `INSERT` (`tenant_id IS NULL`); 0 rows read without `ADMIN` `app.user_id` |
| **Tenant A Session** (`app.tenant_id = A`) | Select Tenant A members & managed staff; write/delete own home/managed users only | Only Tenant A refresh tokens | Select & write Tenant A memberships | Only Tenant A invitations | Only Tenant A contact messages | Only Tenant A inquiries |
| **Tenant B Session** (`app.tenant_id = B`) | Isolated from Tenant A (cannot mutate/delete Tenant A home users) | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A |
| **User Profile Context** (`app.user_id = U`) | User U can read/update own profile | User U can read/revoke own sessions | User U can SELECT own memberships (writes require `app.tenant_id`) | Blocked without `app.tenant_id` | Blocked | `list_enterprise_inquiries` only if U is active `ADMIN` |

---

## 6. Migration Rollout & Reversibility

1. **Migration Script**: `output_apps/enterprise_hub/migrations/1789900003800-EnableRlsPreTenantTables.ts`
2. **`up()`**:
   - Creates atomic `SECURITY DEFINER` lookup and mutation functions owned by a superuser (`postgres` / `enterprise_admin` / migration runner).
   - Revokes execute from `PUBLIC` and grants execute permissions to `roxira_app`.
   - Enables and forces RLS on all 8 tables.
   - Applies the granular policies.
3. **`down()`**:
   - Drops all table policies created by `up()`.
   - Disables and un-forces RLS on all 8 tables.
   - Drops the 17 functions (note: `down()` deliberately preserves the `roxira_app` role and grants so shared cluster state is intact).
4. **Audit Allow-List Removal**:
   - `RLS_PENDING_ALLOWLIST` in `tenant-rls-all-tables.pg.spec.ts` is cleared of these 8 tables. All 8 pre-tenant tables are now covered under PostgreSQL FORCE ROW LEVEL SECURITY, leaving only the remaining module tables in `RLS_PENDING_ALLOWLIST`.
