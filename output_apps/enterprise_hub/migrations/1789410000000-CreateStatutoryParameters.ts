import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  seedEffectiveFrom,
  seedSource,
  STATUTORY_SEEDS,
} from '../modules/hr/statutory/statutory-seed';

/**
 * Versioned statutory parameters (country, fiscal year, effective date), one row per value with
 * its source and a verified flag.
 *
 * `tenant_id IS NULL` marks the platform-wide default seeded here; a tenant's edit is a new row
 * with its own `tenant_id`, so one organisation can never change another's figures. Rows are
 * append-only: an edit inserts the next `version` and history is never lost.
 *
 * The seed and its provenance are in modules/hr/statutory/statutory-seed.ts.
 */
export class CreateStatutoryParameters1789410000000 implements MigrationInterface {
  name = 'CreateStatutoryParameters1789410000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "statutory_parameters" (
        "id" BIGSERIAL PRIMARY KEY,
        "tenant_id" uuid,
        "country" character varying(2) NOT NULL,
        "fiscal_year" integer NOT NULL,
        "param_key" character varying(64) NOT NULL,
        "effective_from" date NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "value" jsonb NOT NULL,
        "source" text NOT NULL,
        "source_kind" character varying(16) NOT NULL,
        "verified" boolean NOT NULL DEFAULT false,
        "created_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_statutory_parameters_source_kind"
          CHECK ("source_kind" IN ('OFFICIAL','REPORT','LEGACY','TENANT')),
        CONSTRAINT "CHK_statutory_parameters_version" CHECK ("version" >= 1)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_statutory_parameters_version" ON "statutory_parameters"
         (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
          "country", "fiscal_year", "param_key", "effective_from", "version")`,
    );
    await q.query(
      `CREATE INDEX "IDX_statutory_parameters_lookup" ON "statutory_parameters"
         ("country", "fiscal_year", "param_key", "effective_from")`,
    );

    for (const seed of STATUTORY_SEEDS) {
      const [fiscalYear, key, value, kind] = seed;
      await q.query(
        `INSERT INTO "statutory_parameters"
           ("tenant_id", "country", "fiscal_year", "param_key", "effective_from", "value",
            "source", "source_kind", "verified", "created_by")
         VALUES (NULL, 'IR', $1, $2, $3, $4::jsonb, $5, $6, $7, 'migration')`,
        [
          fiscalYear,
          key,
          seedEffectiveFrom(fiscalYear),
          JSON.stringify(value),
          seedSource(seed),
          kind,
          kind === 'OFFICIAL',
        ],
      );
    }

    await q.query(`
      CREATE FUNCTION "statutory_parameters_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'statutory_parameters is append-only; insert a new version';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(
      `CREATE TRIGGER "TRG_statutory_parameters_append_only"
         BEFORE UPDATE OR DELETE ON "statutory_parameters"
         FOR EACH ROW EXECUTE FUNCTION "statutory_parameters_append_only"()`,
    );

    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    await q.query(`ALTER TABLE "statutory_parameters" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "statutory_parameters" FORCE ROW LEVEL SECURITY`);
    await q.query(
      `CREATE POLICY "statutory_parameters_read" ON "statutory_parameters" FOR SELECT
         USING ("tenant_id" IS NULL OR ${tenantMatch})`,
    );
    await q.query(
      `CREATE POLICY "statutory_parameters_insert" ON "statutory_parameters" FOR INSERT
         WITH CHECK (${tenantMatch})`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "statutory_parameters"`);
    await q.query(`DROP FUNCTION "statutory_parameters_append_only"()`);
  }
}
