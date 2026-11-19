import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T206: Per-party encryption keys (`erp_party_keys`) and ciphertext/erasure columns on
 * `erp_parties` so personal data can be crypto-shredded without breaking immutable hash chains.
 */
export class AddPartyCryptoShredding1789900012000 implements MigrationInterface {
  name = 'AddPartyCryptoShredding1789900012000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_party_keys" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "party_id" integer NOT NULL,
        "dek_b64" text NOT NULL,
        "key_version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_party_keys_tenant_party" ON "erp_party_keys" ("tenant_id", "party_id")`,
    );
    await enableTenantRls(q, 'erp_party_keys');

    await q.query(`ALTER TABLE "erp_parties" ADD COLUMN IF NOT EXISTS "pii_ciphertext" text`);
    await q.query(`ALTER TABLE "erp_parties" ADD COLUMN IF NOT EXISTS "erased_at" TIMESTAMP`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "erp_parties" DROP COLUMN IF EXISTS "erased_at"`);
    await q.query(`ALTER TABLE "erp_parties" DROP COLUMN IF EXISTS "pii_ciphertext"`);
    await disableTenantRls(q, 'erp_party_keys');
    await q.query(`DROP TABLE IF EXISTS "erp_party_keys"`);
  }
}
