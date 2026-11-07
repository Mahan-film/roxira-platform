import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Tenant policy settings (#585): one row per organisation and policy key, tenant scoped.
 *
 * A key is a dotted name from the policy registry; `value` is jsonb so one table holds enum,
 * int and bool values. The registry (not this table) decides what each key means, its group
 * and its safe default; a missing row always means "use the default". Group A keys are fixed
 * and are never stored here. Two group C keys (the price tolerances) live in the existing
 * `erp_purchase_settings` columns instead, so this table only holds the rest.
 *
 * The table carries `tenant_id` and is created with FORCE row-level security. Purely additive.
 *
 * Revert: `down()` disables the policy and drops the table (custom policy values are lost).
 */
export class CreateTenantPolicySettings1789900000400 implements MigrationInterface {
  name = 'CreateTenantPolicySettings1789900000400';

  private readonly table = 'tenant_policy_settings';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_policy_settings" (
        "tenant_id" uuid NOT NULL,
        "key" varchar(80) NOT NULL,
        "value" jsonb NOT NULL,
        "updated_by" varchar(64) NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_policy_settings" PRIMARY KEY ("tenant_id", "key")
      )`);

    await enableTenantRls(q, this.table);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, this.table);
    await q.query(`DROP TABLE IF EXISTS "tenant_policy_settings"`);
  }
}
