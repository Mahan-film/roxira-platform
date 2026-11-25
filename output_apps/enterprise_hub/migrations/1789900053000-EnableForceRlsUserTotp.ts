import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enable and FORCE Row-Level Security on `user_totp` (docs/security/FORCE_RLS_GAP.md Step 1).
 *
 * `TotpRepository` wraps all queries in a transaction with `SET LOCAL app.user_id`.
 * Fail-closed: queries without `app.user_id` see zero rows and cannot insert/update/delete.
 */
export class EnableForceRlsUserTotp1789900053000 implements MigrationInterface {
  name = 'EnableForceRlsUserTotp1789900053000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE public.user_totp ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE public.user_totp FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS user_totp_user_isolation ON public.user_totp`);
    await q.query(`
      CREATE POLICY user_totp_user_isolation ON public.user_totp
        USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP POLICY IF EXISTS user_totp_user_isolation ON public.user_totp`);
    await q.query(`ALTER TABLE public.user_totp NO FORCE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE public.user_totp DISABLE ROW LEVEL SECURITY`);
  }
}
