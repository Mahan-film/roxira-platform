import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pre-tenant tables Row-Level Security and SECURITY DEFINER lookups (#475 / T29).
 *
 * Tables covered:
 *   1. users
 *   2. auth_refresh_tokens
 *   3. tenant_memberships
 *   4. tenant_invitations
 *   5. tenant_module_entitlements
 *   6. tenant_module_requests
 *   7. contact_messages
 *   8. enterprise_inquiries
 *
 * Enables FORCE RLS on the 8 pre-tenant and auth tables while safeguarding
 * pre-auth login, token rotation, invite redemption, anonymous enterprise inquiry submissions,
 * and tenant-scoped contact message creation
 * (the remaining 29 tables are tracked in RLS_PENDING_ALLOWLIST for per-module rollouts).
 */
export const PRE_TENANT_RLS_TABLES = [
  'users',
  'auth_refresh_tokens',
  'tenant_memberships',
  'tenant_invitations',
  'tenant_module_entitlements',
  'tenant_module_requests',
  'contact_messages',
  'enterprise_inquiries',
] as const;

export class EnableRlsPreTenantTables1789900004100 implements MigrationInterface {
  name = 'EnableRlsPreTenantTables1789900004100';

  public async up(q: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. SECURITY DEFINER Functions (owned by superuser / table owner)
    // -------------------------------------------------------------------------
    await q.query(`
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
        WHERE username = p_username
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
        WHERE login_email = p_email
        LIMIT 1;
      $$;

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
        v_current_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
      BEGIN
        IF v_current_user IS NOT NULL THEN
          IF v_current_user <> p_user_id THEN
            RAISE EXCEPTION 'caller user context does not match target user';
          END IF;
        ELSIF v_current_tenant IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = p_user_id
              AND (
                u.tenant_id = v_current_tenant
                OR u.managed_by_tenant_id = v_current_tenant
                OR EXISTS (
                  SELECT 1 FROM public.tenant_memberships m
                  WHERE m.user_id = u.id AND m.tenant_id = v_current_tenant
                )
              )
          ) THEN
            RAISE EXCEPTION 'caller tenant context is not authorized for target user';
          END IF;
        ELSE
          RAISE EXCEPTION 'caller user or tenant context required';
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

      CREATE OR REPLACE FUNCTION public.lookup_user_by_id_with_password(p_user_id uuid)
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
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
      BEGIN
        IF v_current_user IS NULL OR v_current_user <> p_user_id THEN
          RAISE EXCEPTION 'caller user context does not match target user';
        END IF;
        RETURN QUERY
        SELECT u.id, u.phone, u.username, u.managed_by_tenant_id, u.login_email, u.password_hash, u.password_updated_at,
               u."displayName" AS display_name, u.email, u.role::varchar, u."serviceDomain"::varchar AS service_domain,
               u.tenant_id, u.tenant_role, u."isActive" AS is_active,
               u."lastLoginAt" AS last_login_at, u."createdAt" AS created_at, u."updatedAt" AS updated_at
        FROM public.users u
        WHERE u.id = p_user_id
        LIMIT 1;
      END;
      $$;

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

      CREATE OR REPLACE FUNCTION public.is_refresh_token_family_active(p_family_id uuid, p_user_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.auth_refresh_tokens
          WHERE family_id = p_family_id
            AND user_id = p_user_id
            AND revoked_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP
        );
      $$;

      CREATE OR REPLACE FUNCTION public.revoke_refresh_token_if_active(p_id uuid)
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_affected integer;
        v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
        v_token_user uuid;
      BEGIN
        SELECT user_id INTO v_token_user
        FROM public.auth_refresh_tokens
        WHERE id = p_id;

        IF NOT FOUND THEN
          RETURN false;
        END IF;

        IF v_current_user IS NULL OR v_current_user <> v_token_user THEN
          RAISE EXCEPTION 'caller user context does not match token owner';
        END IF;

        UPDATE public.auth_refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = p_id
          AND revoked_at IS NULL;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.revoke_refresh_token_family(p_family_id uuid)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
        v_family_user uuid;
      BEGIN
        SELECT user_id INTO v_family_user
        FROM public.auth_refresh_tokens
        WHERE family_id = p_family_id
        LIMIT 1;

        IF NOT FOUND THEN
          RETURN;
        END IF;

        IF v_current_user IS NULL OR v_current_user <> v_family_user THEN
          RAISE EXCEPTION 'caller user context does not match token owner';
        END IF;

        UPDATE public.auth_refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE family_id = p_family_id
          AND revoked_at IS NULL;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.delete_expired_refresh_tokens(p_before timestamp)
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_count integer;
        v_limit timestamp := LEAST(p_before, CURRENT_TIMESTAMP);
      BEGIN
        DELETE FROM public.auth_refresh_tokens
        WHERE expires_at < v_limit;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END;
      $$;

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
        IF v_current_user IS NULL OR v_current_user <> p_user_id THEN
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
        LIMIT 1;
      $$;

      CREATE OR REPLACE FUNCTION public.mark_invitation_accepted(p_id uuid, p_user_id uuid, p_tenant_id uuid DEFAULT NULL)
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_affected integer;
        v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
        v_current_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
        v_invitation_tenant uuid;
      BEGIN
        SELECT tenant_id INTO v_invitation_tenant
        FROM public.tenant_invitations
        WHERE id = p_id
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP;

        IF NOT FOUND THEN
          RETURN false;
        END IF;

        IF p_tenant_id IS NULL OR v_invitation_tenant <> p_tenant_id THEN
          RETURN false;
        END IF;

        IF v_current_tenant IS NULL OR v_current_tenant <> v_invitation_tenant THEN
          RAISE EXCEPTION 'caller tenant context does not match target tenant';
        END IF;

        IF v_current_user IS NULL OR v_current_user <> p_user_id THEN
          RAISE EXCEPTION 'caller user context does not match target user';
        END IF;

        UPDATE public.tenant_invitations
        SET accepted_at = CURRENT_TIMESTAMP,
            accepted_by = p_user_id
        WHERE id = p_id
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.lookup_tenant_entitlements(p_tenant_id uuid)
      RETURNS TABLE (
        tenant_id uuid,
        module varchar,
        enabled boolean,
        updated_by uuid,
        updated_at timestamp
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_current_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
      BEGIN
        IF v_current_tenant IS NULL OR v_current_tenant <> p_tenant_id THEN
          RAISE EXCEPTION 'caller tenant context does not match target tenant';
        END IF;
        RETURN QUERY
        SELECT e.tenant_id, e.module, e.enabled, e.updated_by, e.updated_at
        FROM public.tenant_module_entitlements e
        WHERE e.tenant_id = p_tenant_id;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.list_open_module_requests()
      RETURNS TABLE (
        id uuid,
        tenant_id uuid,
        module varchar,
        status varchar,
        requested_by uuid,
        created_at timestamp
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
      BEGIN
        IF v_current_user IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = v_current_user
            AND u.role::text = 'ADMIN'
            AND u."isActive" = true
        ) THEN
          RAISE EXCEPTION 'operator role required';
        END IF;
        RETURN QUERY
        SELECT r.id, r.tenant_id, r.module, r.status, r.requested_by, r.created_at
        FROM public.tenant_module_requests r
        WHERE r.status = 'OPEN'
        ORDER BY r.created_at ASC
        LIMIT 500;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.submit_enterprise_inquiry(
        p_name text,
        p_company text,
        p_phone text,
        p_email text,
        p_message text,
        p_source text DEFAULT NULL,
        p_tenant_id uuid DEFAULT NULL
      )
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_id integer;
      BEGIN
        IF p_tenant_id IS NOT NULL AND (
          nullif(current_setting('app.tenant_id', true), '') IS NULL
          OR p_tenant_id <> nullif(current_setting('app.tenant_id', true), '')::uuid
        ) THEN
          RAISE EXCEPTION 'cannot submit inquiry for a different tenant';
        END IF;

        INSERT INTO public.enterprise_inquiries (
          name, company, phone, email, message, source, tenant_id, created_at, status
        )
        VALUES (
          p_name, p_company, p_phone, p_email, p_message, p_source, p_tenant_id, CURRENT_TIMESTAMP, 'NEW'
        )
        RETURNING id INTO v_id;
        RETURN v_id;
      END;
      $$;

    `);

    await q.query(String.raw`
      CREATE OR REPLACE FUNCTION public.list_enterprise_inquiries(
        p_status text DEFAULT NULL,
        p_search text DEFAULT NULL,
        p_limit integer DEFAULT 50,
        p_offset integer DEFAULT 0
      )
      RETURNS TABLE (
        id integer,
        name varchar,
        company varchar,
        phone varchar,
        email varchar,
        message text,
        source varchar,
        tenant_id uuid,
        status varchar,
        created_at timestamp,
        total_count bigint
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_current_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
        v_escaped_search text;
      BEGIN
        IF v_current_user IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = v_current_user
            AND u.role::text = 'ADMIN'
            AND u."isActive" = true
        ) THEN
          RAISE EXCEPTION 'operator role required';
        END IF;

        IF p_search IS NOT NULL THEN
          v_escaped_search := '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
        END IF;

        RETURN QUERY
        WITH filtered AS (
          SELECT
            e.id, e.name, e.company, e.phone, e.email, e.message, e.source, e.tenant_id, e.status, e.created_at
          FROM public.enterprise_inquiries e
          WHERE (p_status IS NULL OR e.status = p_status)
            AND (
              p_search IS NULL
              OR e.name ILIKE v_escaped_search ESCAPE '\'
              OR e.company ILIKE v_escaped_search ESCAPE '\'
              OR e.email ILIKE v_escaped_search ESCAPE '\'
              OR e.phone ILIKE v_escaped_search ESCAPE '\'
            )
        ),
        counted AS (
          SELECT COUNT(*) AS total FROM filtered
        )
        SELECT
          f.id, f.name, f.company, f.phone, f.email, f.message, f.source, f.tenant_id, f.status, f.created_at,
          c.total
        FROM filtered f, counted c
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT GREATEST(p_limit, 1)
        OFFSET GREATEST(p_offset, 0);
      END;
      $$;
    `);

    // Pin function ownership to superuser (postgres / enterprise_admin / current_user),
    // revoke execute from PUBLIC, and grant to roxira_app if role exists.
    await q.query(`
      DO $$
      DECLARE
        fn text;
        v_owner text;
        funcs text[] := ARRAY[
          'lookup_user_by_phone(text)',
          'lookup_user_by_username(text)',
          'lookup_user_by_login_email(text)',
          'lookup_user_by_id(uuid)',
          'lookup_user_by_id_with_password(uuid)',
          'lookup_refresh_token_by_hash(text)',
          'is_refresh_token_family_active(uuid, uuid)',
          'revoke_refresh_token_if_active(uuid)',
          'revoke_refresh_token_family(uuid)',
          'delete_expired_refresh_tokens(timestamp)',
          'lookup_user_memberships(uuid)',
          'lookup_invitation_by_token_hash(text)',
          'mark_invitation_accepted(uuid, uuid, uuid)',
          'lookup_tenant_entitlements(uuid)',
          'list_open_module_requests()',
          'submit_enterprise_inquiry(text, text, text, text, text, text, uuid)',
          'list_enterprise_inquiries(text, text, integer, integer)'
        ];
      BEGIN
        SELECT rolname INTO v_owner FROM pg_roles WHERE rolsuper = true ORDER BY (rolname = 'postgres') DESC, (rolname = 'enterprise_admin') DESC, rolname LIMIT 1;
        IF v_owner IS NULL THEN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper = true OR rolbypassrls = true)) THEN
            RAISE EXCEPTION 'migration runner % must be a superuser or have BYPASSRLS to own SECURITY DEFINER functions', current_user;
          END IF;
          v_owner := current_user;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          BEGIN
            CREATE ROLE roxira_app NOLOGIN;
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END IF;
        FOREACH fn IN ARRAY funcs LOOP
          IF v_owner <> current_user THEN
            EXECUTE format('ALTER FUNCTION public.%s OWNER TO %I', fn, v_owner);
          END IF;
          EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO roxira_app', fn);
        END LOOP;
      END $$;
    `);

    // -------------------------------------------------------------------------
    // 2. ENABLE + FORCE RLS on all 8 tables
    // -------------------------------------------------------------------------
    for (const table of PRE_TENANT_RLS_TABLES) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }

    // -------------------------------------------------------------------------
    // 3. Granular Row-Level Policies
    // -------------------------------------------------------------------------
    // 3.1 users
    // Membership-based visibility is SELECT-only so a tenant cannot UPDATE/DELETE a user whose
    // home tenant_id / managed_by_tenant_id belongs to another organisation.
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_select" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self_insert" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self_update" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self_delete" ON "users"`);
    await q.query(`
      CREATE POLICY "users_tenant_select" ON "users"
      FOR SELECT
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
      );

      CREATE POLICY "users_tenant_and_self_insert" ON "users"
      FOR INSERT
      WITH CHECK (
        (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
          "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
          OR "managed_by_tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
        ))
        OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "id" = nullif(current_setting('app.user_id', true), '')::uuid)
      );

      CREATE POLICY "users_tenant_and_self_update" ON "users"
      FOR UPDATE
      USING (
        (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
          "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
          OR "managed_by_tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
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

      CREATE POLICY "users_tenant_and_self_delete" ON "users"
      FOR DELETE
      USING (
        (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND (
          "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
          OR "managed_by_tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
        ))
        OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "id" = nullif(current_setting('app.user_id', true), '')::uuid)
      );
    `);

    // 3.2 auth_refresh_tokens
    await q.query(`DROP POLICY IF EXISTS "auth_refresh_tokens_tenant_and_user" ON "auth_refresh_tokens"`);
    await q.query(`
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
    `);

    // 3.3 tenant_memberships
    // Users may SELECT their own memberships; writes/deletes require matching tenant context.
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_tenant_and_user" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_select" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_insert" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_update" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_delete" ON "tenant_memberships"`);
    await q.query(`
      CREATE POLICY "tenant_memberships_select" ON "tenant_memberships"
      FOR SELECT
      USING (
        (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
        OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
      );

      CREATE POLICY "tenant_memberships_insert" ON "tenant_memberships"
      FOR INSERT
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      );

      CREATE POLICY "tenant_memberships_update" ON "tenant_memberships"
      FOR UPDATE
      USING (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      );

      CREATE POLICY "tenant_memberships_delete" ON "tenant_memberships"
      FOR DELETE
      USING (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      );
    `);

    // 3.4 tenant_invitations
    await q.query(`DROP POLICY IF EXISTS "tenant_invitations_tenant" ON "tenant_invitations"`);
    await q.query(`
      CREATE POLICY "tenant_invitations_tenant" ON "tenant_invitations"
      FOR ALL
      USING (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      );
    `);

    // 3.5 tenant_module_entitlements
    await q.query(`DROP POLICY IF EXISTS "tenant_module_entitlements_tenant" ON "tenant_module_entitlements"`);
    await q.query(`
      CREATE POLICY "tenant_module_entitlements_tenant" ON "tenant_module_entitlements"
      FOR ALL
      USING (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      );
    `);

    // 3.6 tenant_module_requests
    await q.query(`DROP POLICY IF EXISTS "tenant_module_requests_tenant" ON "tenant_module_requests"`);
    await q.query(`
      CREATE POLICY "tenant_module_requests_tenant" ON "tenant_module_requests"
      FOR ALL
      USING (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
      );
    `);

    // 3.7 contact_messages
    await q.query(`DROP POLICY IF EXISTS "contact_messages_insert" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_tenant" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_modify" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_delete" ON "contact_messages"`);
    await q.query(`
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
    `);

    // 3.8 enterprise_inquiries
    await q.query(`DROP POLICY IF EXISTS "enterprise_inquiries_insert" ON "enterprise_inquiries"`);
    await q.query(`DROP POLICY IF EXISTS "enterprise_inquiries_tenant" ON "enterprise_inquiries"`);
    await q.query(`
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
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // 1. Drop policies
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_select" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self_insert" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self_update" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self_delete" ON "users"`);
    await q.query(`DROP POLICY IF EXISTS "auth_refresh_tokens_tenant_and_user" ON "auth_refresh_tokens"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_tenant_and_user" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_select" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_insert" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_update" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_delete" ON "tenant_memberships"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_invitations_tenant" ON "tenant_invitations"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_module_entitlements_tenant" ON "tenant_module_entitlements"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_module_requests_tenant" ON "tenant_module_requests"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_insert" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_tenant" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_modify" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "contact_messages_delete" ON "contact_messages"`);
    await q.query(`DROP POLICY IF EXISTS "enterprise_inquiries_insert" ON "enterprise_inquiries"`);
    await q.query(`DROP POLICY IF EXISTS "enterprise_inquiries_tenant" ON "enterprise_inquiries"`);

    // 2. Disable and un-force RLS
    for (const table of [...PRE_TENANT_RLS_TABLES].reverse()) {
      await q.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }

    // 3. Drop lookup and submission functions
    // Note: down() deliberately preserves the function owner and the roxira_app role/grants
    // to prevent breaking shared cluster state or permissions on other pre-existing or co-existing functions.
    await q.query(`
      DROP FUNCTION IF EXISTS public.lookup_user_by_phone(text);
      DROP FUNCTION IF EXISTS public.lookup_user_by_username(text);
      DROP FUNCTION IF EXISTS public.lookup_user_by_login_email(text);
      DROP FUNCTION IF EXISTS public.lookup_user_by_id(uuid);
      DROP FUNCTION IF EXISTS public.lookup_user_by_id_with_password(uuid);
      DROP FUNCTION IF EXISTS public.lookup_refresh_token_by_hash(text);
      DROP FUNCTION IF EXISTS public.is_refresh_token_family_active(uuid, uuid);
      DROP FUNCTION IF EXISTS public.revoke_refresh_token_if_active(uuid);
      DROP FUNCTION IF EXISTS public.revoke_refresh_token_family(uuid);
      DROP FUNCTION IF EXISTS public.delete_expired_refresh_tokens(timestamp);
      DROP FUNCTION IF EXISTS public.lookup_user_memberships(uuid);
      DROP FUNCTION IF EXISTS public.lookup_invitation_by_token_hash(text);
      DROP FUNCTION IF EXISTS public.mark_invitation_accepted(uuid, uuid, uuid);
      DROP FUNCTION IF EXISTS public.mark_invitation_accepted(uuid, uuid);
      DROP FUNCTION IF EXISTS public.lookup_tenant_entitlements(uuid);
      DROP FUNCTION IF EXISTS public.list_open_module_requests();
      DROP FUNCTION IF EXISTS public.submit_enterprise_inquiry(text, text, text, text, text, text, uuid);
      DROP FUNCTION IF EXISTS public.list_enterprise_inquiries(text, text, integer, integer);
    `);
  }
}
