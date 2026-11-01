import { QueryRunner } from 'typeorm';

/**
 * The tenant predicate shared by every tenant policy. A request that did not go through TenantScope
 * has no `app.tenant_id`, `nullif` turns that into NULL and the comparison matches nothing.
 */
export const TENANT_MATCH = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;

/** ENABLE + FORCE row-level security and add one policy for all commands (USING and WITH CHECK). */
export async function enableTenantRls(q: QueryRunner, table: string): Promise<void> {
  await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  await q.query(`DROP POLICY IF EXISTS "${table}_tenant" ON "${table}"`);
  await q.query(`CREATE POLICY "${table}_tenant" ON "${table}" USING (${TENANT_MATCH}) WITH CHECK (${TENANT_MATCH})`);
}

/** Exact inverse of enableTenantRls. */
export async function disableTenantRls(q: QueryRunner, table: string): Promise<void> {
  await q.query(`DROP POLICY IF EXISTS "${table}_tenant" ON "${table}"`);
  await q.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
  await q.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
}
