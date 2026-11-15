import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordUpdatedAtToLookupUserById1789900005100 implements MigrationInterface {
  name = 'AddPasswordUpdatedAtToLookupUserById1789900005100';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION IF EXISTS public.lookup_user_by_id(uuid);`);
    await q.query(String.raw`
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
        updated_at timestamp,
        password_updated_at timestamp
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
               u."lastLoginAt" AS last_login_at, u."createdAt" AS created_at, u."updatedAt" AS updated_at,
               u.password_updated_at
        FROM public.users u
        WHERE u.id = p_user_id
        LIMIT 1;
      END;
      $$;
    `);
    await q.query(`GRANT EXECUTE ON FUNCTION public.lookup_user_by_id(uuid) TO PUBLIC;`);
    await q.query(`GRANT EXECUTE ON FUNCTION public.lookup_user_by_id(uuid) TO roxira_app;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION IF EXISTS public.lookup_user_by_id(uuid);`);
    await q.query(String.raw`
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
    `);
    await q.query(`GRANT EXECUTE ON FUNCTION public.lookup_user_by_id(uuid) TO PUBLIC;`);
    await q.query(`GRANT EXECUTE ON FUNCTION public.lookup_user_by_id(uuid) TO roxira_app;`);
  }
}
