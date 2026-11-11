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
 * Completes 100% FORCE RLS coverage across all tables containing a tenant_id column
 * on the platform while safeguarding pre-auth login, token rotation, invite redemption,
 * and anonymous public form submissions.
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

export class EnableRlsPreTenantTables1789900002300 implements MigrationInterface {
  name = 'EnableRlsPreTenantTables1789900002300';

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

      CREATE OR REPLACE FUNCTION public.lookup_user_by_login(p_login text)
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
        WHERE lower(username) = lower(p_login) OR lower(login_email) = lower(p_login)
        ORDER BY (lower(username) = lower(p_login)) DESC, id ASC
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
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT id, phone, username, managed_by_tenant_id, login_email,
               "displayName" AS display_name, email, role::varchar, "serviceDomain"::varchar AS service_domain,
               tenant_id, tenant_role, "isActive" AS is_active,
               "lastLoginAt" AS last_login_at, "createdAt" AS created_at, "updatedAt" AS updated_at
        FROM public.users
        WHERE id = p_user_id
        LIMIT 1;
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
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT id, phone, username, managed_by_tenant_id, login_email, password_hash, password_updated_at,
               "displayName" AS display_name, email, role::varchar, "serviceDomain"::varchar AS service_domain,
               tenant_id, tenant_role, "isActive" AS is_active,
               "lastLoginAt" AS last_login_at, "createdAt" AS created_at, "updatedAt" AS updated_at
        FROM public.users
        WHERE id = p_user_id
          AND (
            nullif(current_setting('app.user_id', true), '') IS NULL
            OR id = nullif(current_setting('app.user_id', true), '')::uuid
          )
        LIMIT 1;
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

      CREATE OR REPLACE FUNCTION public.revoke_refresh_token_if_active(p_id uuid)
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_affected integer;
      BEGIN
        UPDATE public.auth_refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = p_id AND revoked_at IS NULL;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.revoke_refresh_token_family(p_family_id uuid)
      RETURNS void
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        UPDATE public.auth_refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE family_id = p_family_id AND revoked_at IS NULL;
      $$;

      CREATE OR REPLACE FUNCTION public.delete_expired_refresh_tokens(p_before timestamp)
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_count integer;
      BEGIN
        DELETE FROM public.auth_refresh_tokens
        WHERE expires_at < p_before;
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

      CREATE OR REPLACE FUNCTION public.mark_invitation_accepted(p_id uuid, p_user_id uuid)
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_affected integer;
      BEGIN
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
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT tenant_id, module, enabled, updated_by, updated_at
        FROM public.tenant_module_entitlements
        WHERE tenant_id = p_tenant_id
          AND (
            nullif(current_setting('app.tenant_id', true), '') IS NULL
            OR p_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
          );
      $$;

      CREATE OR REPLACE FUNCTION public.lookup_membership(p_tenant_id uuid, p_user_id uuid)
      RETURNS TABLE (
        id uuid,
        tenant_id uuid,
        user_id uuid,
        role_key varchar,
        custom_role_id uuid,
        branch_id uuid,
        department_id uuid,
        branch_scoped boolean,
        status varchar,
        invited_by uuid,
        created_at timestamp,
        updated_at timestamp
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT id, tenant_id, user_id, role_key, custom_role_id, branch_id, department_id,
               branch_scoped, status, invited_by, created_at, updated_at
        FROM public.tenant_memberships
        WHERE tenant_id = p_tenant_id AND user_id = p_user_id
          AND (
            nullif(current_setting('app.user_id', true), '') IS NULL
            OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
          )
          AND (
            nullif(current_setting('app.tenant_id', true), '') IS NULL
            OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
          )
        LIMIT 1;
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
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT id, tenant_id, module, status, requested_by, created_at
        FROM public.tenant_module_requests
        WHERE status = 'OPEN'
        ORDER BY created_at ASC
        LIMIT 500;
      $$;

      CREATE OR REPLACE FUNCTION public.submit_contact_message(
        p_tenant_id uuid,
        p_sender_name text,
        p_sender_phone text,
        p_sender_email text,
        p_subject text,
        p_message text,
        p_lead_id integer DEFAULT NULL
      )
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        v_id integer;
      BEGIN
        INSERT INTO public.contact_messages (
          tenant_id, sender_name, sender_phone, sender_email, subject, message, lead_id, created_at
        )
        VALUES (
          p_tenant_id, p_sender_name, p_sender_phone, p_sender_email, p_subject, p_message, p_lead_id, CURRENT_TIMESTAMP
        )
        RETURNING id INTO v_id;
        RETURN v_id;
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

    // Pin function ownership to superuser (postgres / enterprise_admin / current_user),
    // revoke execute from PUBLIC, and grant to roxira_app if role exists.
    await q.query(`
      DO $$
      DECLARE
        fn text;
        v_owner text;
        funcs text[] := ARRAY[
          'lookup_user_by_phone(text)',
          'lookup_user_by_login(text)',
          'lookup_user_by_id(uuid)',
          'lookup_user_by_id_with_password(uuid)',
          'lookup_refresh_token_by_hash(text)',
          'revoke_refresh_token_if_active(uuid)',
          'revoke_refresh_token_family(uuid)',
          'delete_expired_refresh_tokens(timestamp)',
          'lookup_user_memberships(uuid)',
          'lookup_invitation_by_token_hash(text)',
          'mark_invitation_accepted(uuid, uuid)',
          'lookup_tenant_entitlements(uuid)',
          'lookup_membership(uuid, uuid)',
          'list_open_module_requests()',
          'submit_contact_message(uuid, text, text, text, text, text, integer)',
          'submit_enterprise_inquiry(text, text, text, text, text, text, uuid)'
        ];
      BEGIN
        SELECT rolname INTO v_owner FROM pg_roles WHERE rolsuper = true ORDER BY (rolname = 'postgres') DESC, (rolname = 'enterprise_admin') DESC, rolname LIMIT 1;
        IF v_owner IS NULL THEN
          v_owner := current_user;
        END IF;
        FOREACH fn IN ARRAY funcs LOOP
          EXECUTE format('ALTER FUNCTION public.%s OWNER TO %I', fn, v_owner);
          EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO roxira_app', fn);
          END IF;
        END LOOP;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO roxira_app';
        END IF;
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
    await q.query(`DROP POLICY IF EXISTS "users_tenant_and_self" ON "users"`);
    await q.query(`
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
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_tenant_and_user" ON "tenant_memberships"`);
    await q.query(`
      CREATE POLICY "tenant_memberships_tenant_and_user" ON "tenant_memberships"
      FOR ALL
      USING (
        (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
        OR (nullif(current_setting('app.user_id', true), '') IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
      )
      WITH CHECK (
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
    await q.query(`DROP POLICY IF EXISTS "auth_refresh_tokens_tenant_and_user" ON "auth_refresh_tokens"`);
    await q.query(`DROP POLICY IF EXISTS "tenant_memberships_tenant_and_user" ON "tenant_memberships"`);
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
    await q.query(`
      DROP FUNCTION IF EXISTS public.lookup_user_by_phone(text);
      DROP FUNCTION IF EXISTS public.lookup_user_by_login(text);
      DROP FUNCTION IF EXISTS public.lookup_user_by_id(uuid);
      DROP FUNCTION IF EXISTS public.lookup_user_by_id_with_password(uuid);
      DROP FUNCTION IF EXISTS public.lookup_refresh_token_by_hash(text);
      DROP FUNCTION IF EXISTS public.revoke_refresh_token_if_active(uuid);
      DROP FUNCTION IF EXISTS public.revoke_refresh_token_family(uuid);
      DROP FUNCTION IF EXISTS public.delete_expired_refresh_tokens(timestamp);
      DROP FUNCTION IF EXISTS public.lookup_user_memberships(uuid);
      DROP FUNCTION IF EXISTS public.lookup_invitation_by_token_hash(text);
      DROP FUNCTION IF EXISTS public.mark_invitation_accepted(uuid, uuid);
      DROP FUNCTION IF EXISTS public.lookup_tenant_entitlements(uuid);
      DROP FUNCTION IF EXISTS public.lookup_membership(uuid, uuid);
      DROP FUNCTION IF EXISTS public.list_open_module_requests();
      DROP FUNCTION IF EXISTS public.submit_contact_message(uuid, text, text, text, text, text, integer);
      DROP FUNCTION IF EXISTS public.submit_enterprise_inquiry(text, text, text, text, text, text, uuid);
    `);
  }
}
