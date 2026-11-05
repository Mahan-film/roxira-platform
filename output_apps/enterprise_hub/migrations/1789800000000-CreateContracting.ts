import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Contracting (T3, #227): projects and contracts. A contract is employer-side (we owe a contractor)
 * or contractor-side (we do the work and bill an employer). Both tables carry `tenant_id` and are
 * created with FORCE row-level security; a contract points at its project through a composite
 * (tenant_id, project_id) key so it can never reference another organisation's project. Additive.
 */
export class CreateContracting1789800000000 implements MigrationInterface {
  name = 'CreateContracting1789800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "erp_projects" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" character varying(200) NOT NULL,
        "cost_centre_code" character varying(64),
        "budget" numeric(18,2) NOT NULL DEFAULT 0,
        "start_date" date,
        "end_date" date,
        "status" character varying(16) NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_projects_code" CHECK ("code" <> ''),
        CONSTRAINT "CHK_erp_projects_name" CHECK ("name" <> ''),
        CONSTRAINT "CHK_erp_projects_budget" CHECK ("budget" >= 0),
        CONSTRAINT "CHK_erp_projects_status" CHECK ("status" IN ('active','closed')),
        CONSTRAINT "CHK_erp_projects_dates" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date")
      )`,
    );
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_projects_tenant_code" ON "erp_projects" ("tenant_id", "code")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_projects_tenant_id" ON "erp_projects" ("tenant_id", "id")`);
    await enableTenantRls(q, 'erp_projects');

    await q.query(
      `CREATE TABLE "erp_contracts" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "title" character varying(200) NOT NULL,
        "side" character varying(16) NOT NULL,
        "party_code" character varying(64) NOT NULL,
        "project_id" integer,
        "contract_date" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "advance_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "insurance_type" character varying(24),
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_contracts_code" CHECK ("code" <> ''),
        CONSTRAINT "CHK_erp_contracts_title" CHECK ("title" <> ''),
        CONSTRAINT "CHK_erp_contracts_side" CHECK ("side" IN ('employer','contractor')),
        CONSTRAINT "CHK_erp_contracts_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_erp_contracts_advance" CHECK ("advance_amount" >= 0 AND "advance_amount" <= "amount"),
        CONSTRAINT "CHK_erp_contracts_insurance" CHECK ("insurance_type" IS NULL OR "insurance_type" IN ('MECHANICAL','NON_MECHANICAL','CIVIL_EXECUTIVE','CIVIL_CONSULTING')),
        CONSTRAINT "CHK_erp_contracts_status" CHECK ("status" IN ('draft','active','closed')),
        CONSTRAINT "FK_erp_contracts_project" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "erp_projects" ("tenant_id", "id") ON DELETE RESTRICT
      )`,
    );
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_contracts_tenant_code" ON "erp_contracts" ("tenant_id", "code")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_contracts_tenant_id" ON "erp_contracts" ("tenant_id", "id")`);
    await q.query(`CREATE INDEX "IDX_erp_contracts_tenant_project" ON "erp_contracts" ("tenant_id", "project_id")`);
    await q.query(`CREATE INDEX "IDX_erp_contracts_tenant_side_status" ON "erp_contracts" ("tenant_id", "side", "status")`);
    await enableTenantRls(q, 'erp_contracts');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_contracts');
    await q.query(`DROP TABLE IF EXISTS "erp_contracts"`);
    await disableTenantRls(q, 'erp_projects');
    await q.query(`DROP TABLE IF EXISTS "erp_projects"`);
  }
}
