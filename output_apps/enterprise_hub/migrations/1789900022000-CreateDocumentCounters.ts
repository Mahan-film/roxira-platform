import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/** Gapless document sequence counters per tenant, doc type, channel, fiscal year, and series (T321 / R31). */
export class CreateDocumentCounters1789900022000 implements MigrationInterface {
  name = 'CreateDocumentCounters1789900022000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS "fin_document_counters" (
      "tenant_id" uuid NOT NULL,
      "document_type" character varying(32) NOT NULL DEFAULT 'INVOICE',
      "channel" character varying(32) NOT NULL DEFAULT 'DEFAULT',
      "fiscal_year" integer NOT NULL DEFAULT 0,
      "series" character varying(64) NOT NULL,
      "last_number" bigint NOT NULL DEFAULT 0,
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fin_document_counters" PRIMARY KEY ("tenant_id", "document_type", "channel", "fiscal_year", "series")
    )`);
    await enableTenantRls(q, 'fin_document_counters');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'fin_document_counters');
    await q.query(`DROP TABLE IF EXISTS "fin_document_counters"`);
  }
}
