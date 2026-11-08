import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Report builder templates (#592 Item 5 / T5):
 *   - `tenant_report_templates`: user-defined report configurations (dataset, whitelisted columns,
 *     filters, groupings, aggregates) saved per tenant.
 *   - Protected with `ENABLE` + `FORCE ROW LEVEL SECURITY`.
 *   - Reversible `down()`.
 */
export class CreateReportTemplates1789900001500 implements MigrationInterface {
  name = 'CreateReportTemplates1789900001500';

  private readonly table = 'tenant_report_templates';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_report_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(128) NOT NULL,
        "description" text NULL,
        "dataset" varchar(64) NOT NULL,
        "config" jsonb NOT NULL,
        "created_by" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_report_templates" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_report_templates_lookup"
        ON "tenant_report_templates" ("tenant_id", "dataset", "created_at" DESC)
    `);

    await enableTenantRls(q, this.table);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, this.table);
    await q.query(`DROP TABLE IF EXISTS "tenant_report_templates"`);
  }
}
