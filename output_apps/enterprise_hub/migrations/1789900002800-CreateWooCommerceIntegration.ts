import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWooCommerceIntegration1789900002800 implements MigrationInterface {
  name = 'CreateWooCommerceIntegration1789900002800';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create woocommerce_configs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "woocommerce_configs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "store_url" varchar(500) NOT NULL,
        "consumer_key_encrypted" text NOT NULL,
        "consumer_secret_encrypted" text NOT NULL,
        "webhook_secret" varchar(128) NOT NULL,
        "auto_sync_orders" boolean NOT NULL DEFAULT true,
        "auto_sync_stock" boolean NOT NULL DEFAULT true,
        "last_sync_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_woocommerce_configs_tenant" UNIQUE ("tenant_id")
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "woocommerce_configs" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "woocommerce_configs" FORCE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`
      DROP POLICY IF EXISTS "woocommerce_configs_tenant" ON "woocommerce_configs";
      CREATE POLICY "woocommerce_configs_tenant" ON "woocommerce_configs"
        FOR ALL
        USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
    `);

    // 2. Create woocommerce_sync_logs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "woocommerce_sync_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "direction" varchar(32) NOT NULL,
        "status" varchar(16) NOT NULL,
        "external_id" varchar(128) NOT NULL,
        "internal_id" varchar(128),
        "payload_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wc_sync_logs_tenant_created"
        ON "woocommerce_sync_logs" ("tenant_id", "created_at" DESC);
      CREATE INDEX IF NOT EXISTS "IDX_wc_sync_logs_tenant_ext"
        ON "woocommerce_sync_logs" ("tenant_id", "direction", "external_id");
    `);

    await queryRunner.query(`
      ALTER TABLE "woocommerce_sync_logs" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "woocommerce_sync_logs" FORCE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`
      DROP POLICY IF EXISTS "woocommerce_sync_logs_tenant" ON "woocommerce_sync_logs";
      CREATE POLICY "woocommerce_sync_logs_tenant" ON "woocommerce_sync_logs"
        FOR ALL
        USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS "woocommerce_sync_logs_tenant" ON "woocommerce_sync_logs"`);
    await queryRunner.query(`ALTER TABLE "woocommerce_sync_logs" NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "woocommerce_sync_logs" DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP TABLE IF EXISTS "woocommerce_sync_logs"`);

    await queryRunner.query(`DROP POLICY IF EXISTS "woocommerce_configs_tenant" ON "woocommerce_configs"`);
    await queryRunner.query(`ALTER TABLE "woocommerce_configs" NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "woocommerce_configs" DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP TABLE IF EXISTS "woocommerce_configs"`);
  }
}
