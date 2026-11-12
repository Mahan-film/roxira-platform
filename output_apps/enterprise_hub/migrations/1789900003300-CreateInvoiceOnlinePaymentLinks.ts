import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoiceOnlinePaymentLinks1789900003300 implements MigrationInterface {
  name = 'CreateInvoiceOnlinePaymentLinks1789900003300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Table: invoice_payment_gateway_configs
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_payment_gateway_configs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "gateway" varchar(32) NOT NULL DEFAULT 'zibal',
        "encrypted_merchant_id" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_invoice_payment_gateway_configs_tenant_gateway" UNIQUE ("tenant_id", "gateway")
      );
    `);

    // 2. Table: invoice_payment_links
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_payment_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "track_id" varchar(128) NOT NULL,
        "payment_url" varchar(512) NOT NULL,
        "amount" bigint NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "gateway" varchar(32) NOT NULL DEFAULT 'zibal',
        "gateway_ref" varchar(128),
        "card_number" varchar(32),
        "paid_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_invoice_payment_links_track_id" UNIQUE ("track_id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_invoice_payment_links_tenant_invoice" ON "invoice_payment_links" ("tenant_id", "invoice_id");
      CREATE INDEX IF NOT EXISTS "IDX_invoice_payment_links_tenant_gateway_ref" ON "invoice_payment_links" ("tenant_id", "gateway_ref");
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_payment_links_tenant_gateway_ref" ON "invoice_payment_links" ("tenant_id", "gateway_ref") WHERE "gateway_ref" IS NOT NULL;
    `);

    // 3. FORCE ROW LEVEL SECURITY on both tenant tables
    const tables = ['invoice_payment_gateway_configs', 'invoice_payment_links'];
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`DROP POLICY IF EXISTS "${table}_tenant" ON "${table}";`);
      await queryRunner.query(`
        CREATE POLICY "${table}_tenant" ON "${table}"
        FOR ALL
        USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
      `);
    }

    // 4. Narrow SECURITY DEFINER lookup function for pre-tenant callback routing
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.lookup_invoice_payment_tenant_by_track_id(p_track_id text)
      RETURNS TABLE (
        tenant_id uuid,
        invoice_id uuid,
        status varchar
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT tenant_id, invoice_id, status
        FROM public.invoice_payment_links
        WHERE track_id = p_track_id
        LIMIT 1;
      $$;

      DO $$
      DECLARE
        v_owner text;
      BEGIN
        SELECT rolname INTO v_owner FROM pg_roles WHERE rolsuper = true ORDER BY (rolname = 'postgres') DESC, (rolname = 'enterprise_admin') DESC, rolname LIMIT 1;
        IF v_owner IS NOT NULL AND v_owner <> current_user THEN
          EXECUTE format('ALTER FUNCTION public.lookup_invoice_payment_tenant_by_track_id(text) OWNER TO %I', v_owner);
        END IF;
        EXECUTE 'REVOKE ALL ON FUNCTION public.lookup_invoice_payment_tenant_by_track_id(text) FROM PUBLIC';
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          EXECUTE 'GRANT EXECUTE ON FUNCTION public.lookup_invoice_payment_tenant_by_track_id(text) TO roxira_app';
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.lookup_invoice_payment_tenant_by_track_id(text);`);
    await queryRunner.query(`DROP POLICY IF EXISTS "invoice_payment_links_tenant" ON "invoice_payment_links";`);
    await queryRunner.query(`DROP POLICY IF EXISTS "invoice_payment_gateway_configs_tenant" ON "invoice_payment_gateway_configs";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_payment_links";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_payment_gateway_configs";`);
  }
}
