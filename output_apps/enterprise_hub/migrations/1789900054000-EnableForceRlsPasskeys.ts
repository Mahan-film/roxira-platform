import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enable and FORCE Row-Level Security on `auth_passkey_credentials`
 * (docs/security/FORCE_RLS_GAP.md Step 2).
 *
 * Adds `public.lookup_passkey_by_credential_id(text)` as SECURITY DEFINER for
 * pre-auth WebAuthn assertion lookup, and enforces `app.user_id` isolation
 * on all direct table access.
 */
export class EnableForceRlsPasskeys1789900054000 implements MigrationInterface {
  name = 'EnableForceRlsPasskeys1789900054000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION public.lookup_passkey_by_credential_id(p_credential_id text)
      RETURNS TABLE (
        id uuid,
        user_id uuid,
        credential_id text,
        public_key text,
        public_key_alg integer,
        sign_count integer,
        transports varchar,
        device_type varchar,
        backed_up boolean,
        label varchar,
        last_used_at timestamp,
        created_at timestamp
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT
          id, user_id, credential_id, public_key, public_key_alg, sign_count,
          transports, device_type, backed_up, label, last_used_at, created_at
        FROM public.auth_passkey_credentials
        WHERE credential_id = p_credential_id
        LIMIT 1;
      $$
    `);

    await q.query(`REVOKE ALL ON FUNCTION public.lookup_passkey_by_credential_id(text) FROM PUBLIC`);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          GRANT EXECUTE ON FUNCTION public.lookup_passkey_by_credential_id(text) TO roxira_app;
        END IF;
      END $$;
    `);

    await q.query(`ALTER TABLE public.auth_passkey_credentials ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE public.auth_passkey_credentials FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS auth_passkey_user_isolation ON public.auth_passkey_credentials`);
    await q.query(`
      CREATE POLICY auth_passkey_user_isolation ON public.auth_passkey_credentials
        USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP POLICY IF EXISTS auth_passkey_user_isolation ON public.auth_passkey_credentials`);
    await q.query(`ALTER TABLE public.auth_passkey_credentials NO FORCE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE public.auth_passkey_credentials DISABLE ROW LEVEL SECURITY`);
    await q.query(`DROP FUNCTION IF EXISTS public.lookup_passkey_by_credential_id(text)`);
  }
}
