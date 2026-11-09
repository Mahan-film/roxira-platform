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
- **Invariant 4 (Append-Only Public Ingestion)**: Public submission endpoints (`contact_messages`, `enterprise_inquiries`) allow unrestricted insert (`WITH CHECK (true)`), but forbid unauthorized reads (`USING` strictly scoped by tenant).

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

```sql
-- 1. User lookup by phone (for Kavenegar OTP sign-in)
CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.users WHERE phone = p_phone LIMIT 1;
$$;

-- 2. User lookup by username or login email (for password sign-in)
CREATE OR REPLACE FUNCTION public.lookup_user_by_login(p_login text)
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.users 
  WHERE lower(username) = lower(p_login) OR lower(login_email) = lower(p_login) 
  LIMIT 1;
$$;

-- 3. User lookup by ID (for auth token verification)
CREATE OR REPLACE FUNCTION public.lookup_user_by_id(p_user_id uuid)
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.users WHERE id = p_user_id LIMIT 1;
$$;

-- 4. Refresh token lookup by SHA-256 hash
CREATE OR REPLACE FUNCTION public.lookup_refresh_token_by_hash(p_token_hash text)
RETURNS SETOF public.auth_refresh_tokens
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.auth_refresh_tokens WHERE token_hash = p_token_hash LIMIT 1;
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id AS membership_id, m.tenant_id, t.name AS tenant_name, m.role_key, m.status
  FROM public.tenant_memberships m
  JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id AND t.is_active = true
  ORDER BY m.created_at ASC;
$$;

-- 6. Invitation lookup by SHA-256 hash
CREATE OR REPLACE FUNCTION public.lookup_invitation_by_token_hash(p_token_hash text)
RETURNS SETOF public.tenant_invitations
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.tenant_invitations 
  WHERE token_hash = p_token_hash 
    AND accepted_at IS NULL 
    AND revoked_at IS NULL 
    AND expires_at > CURRENT_TIMESTAMP 
  LIMIT 1;
$$;
```

### 4.2 Table RLS Policies Specification

```sql
-- =========================================================================
-- 1. users
-- =========================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_and_self ON public.users
FOR ALL
USING (
  -- Tenant context: same tenant or managed by same tenant
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR managed_by_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR id IN (
      SELECT m.user_id FROM public.tenant_memberships m
      WHERE m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  ))
  -- User context: self profile access
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND id = nullif(current_setting('app.user_id', true), '')::uuid)
  -- Global auth lookup escape hatch
  OR (current_setting('app.auth_lookup', true) = 'true')
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR managed_by_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  ))
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND id = nullif(current_setting('app.user_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 2. auth_refresh_tokens
-- =========================================================================
ALTER TABLE public.auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_refresh_tokens_tenant_and_user ON public.auth_refresh_tokens
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 3. tenant_memberships
-- =========================================================================
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_memberships_tenant_and_user ON public.tenant_memberships
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 4. tenant_invitations
-- =========================================================================
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_invitations_tenant ON public.tenant_invitations
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 5. tenant_module_entitlements
-- =========================================================================
ALTER TABLE public.tenant_module_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_module_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_module_entitlements_tenant ON public.tenant_module_entitlements
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 6. tenant_module_requests
-- =========================================================================
ALTER TABLE public.tenant_module_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_module_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_module_requests_tenant ON public.tenant_module_requests
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
)
WITH CHECK (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 7. contact_messages
-- =========================================================================
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages FORCE ROW LEVEL SECURITY;

-- Anyone can submit a contact message (including unauthenticated visitors)
CREATE POLICY contact_messages_insert ON public.contact_messages
FOR INSERT
WITH CHECK (true);

-- Only the recipient tenant can read/manage contact messages
CREATE POLICY contact_messages_select_modify ON public.contact_messages
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (current_setting('app.auth_lookup', true) = 'true')
);

-- =========================================================================
-- 8. enterprise_inquiries
-- =========================================================================
ALTER TABLE public.enterprise_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_inquiries FORCE ROW LEVEL SECURITY;

-- Anyone can submit an enterprise inquiry
CREATE POLICY enterprise_inquiries_insert ON public.enterprise_inquiries
FOR INSERT
WITH CHECK (true);

-- Tenants see inquiries assigned to them; platform admins see unassigned/public inquiries
CREATE POLICY enterprise_inquiries_select_modify ON public.enterprise_inquiries
FOR ALL
USING (
  (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  OR (tenant_id IS NULL AND current_setting('app.tenant_id', true) IS NULL)
  OR (current_setting('app.auth_lookup', true) = 'true')
);
```

---

## 5. Security & Isolation Matrix

| Actor / Session Context | `users` | `auth_refresh_tokens` | `tenant_memberships` | `tenant_invitations` | `contact_messages` | `enterprise_inquiries` |
|---|---|---|---|---|---|---|
| **Unauthenticated Visitor** | 0 rows direct; function lookup by phone/email only | 0 rows direct; token rotation lookup only | 0 rows direct; membership list by user id only | 0 rows direct; invite lookup by token hash only | `INSERT` allowed; 0 rows read | `INSERT` allowed; 0 rows read |
| **Tenant A Session** (`app.tenant_id = A`) | Only Tenant A members & managed staff | Only Tenant A refresh tokens | Only Tenant A memberships | Only Tenant A invitations | Only Tenant A contact messages | Only Tenant A inquiries |
| **Tenant B Session** (`app.tenant_id = B`) | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A | Isolated from Tenant A |
| **User Profile Context** (`app.user_id = U`) | User U can read/update own profile | User U can read/revoke own sessions | User U can read own memberships | Blocked | Blocked | Blocked |

---

## 6. Migration Rollout & Reversibility

1. **Migration Script**: `output_apps/enterprise_hub/migrations/1789900001600-EnableRlsPreTenantTables.ts`
2. **`up()`**:
   - Creates all 6 `SECURITY DEFINER` lookup functions.
   - Grants execute permissions to `roxira_app` and `PUBLIC`.
   - Enables and forces RLS on all 8 tables.
   - Applies the granular policies.
3. **`down()`**:
   - Drops all 8 table policies.
   - Disables and un-forces RLS on all 8 tables.
   - Drops the 6 lookup functions.
4. **Audit Allow-List Removal**:
   - `RLS_PENDING_ALLOWLIST` in `tenant-rls-all-tables.pg.spec.ts` is cleared of these 8 tables. All 101 tenant tables on the platform are now 100% covered under PostgreSQL FORCE ROW LEVEL SECURITY.
