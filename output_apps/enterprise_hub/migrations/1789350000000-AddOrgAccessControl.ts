import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Organisation access control: memberships, branches, departments, roles,
 * invitations, module entitlements, immutable audit log, TOTP, device-aware
 * sessions and the per-tenant 2FA policy.
 *
 * Existing tenants stay fully usable:
 *  - every user that has users.tenant_id gets one membership; OWNER keeps the
 *    `owner` role, MEMBER becomes `legacy_member` (what a member could do before);
 *  - every existing tenant gets every sellable module enabled.
 *
 * users.tenant_id/tenant_role are left untouched (they now mean "last active
 * organisation"), so old code and old tokens keep working.
 *
 * down() drops only what this migration created. It refuses to drop a
 * non-empty audit_log unless ROXIRA_ALLOW_AUDIT_LOG_DROP=1, because that table
 * is meant to be permanent.
 */
export class AddOrgAccessControl1789350000000 implements MigrationInterface {
  name = 'AddOrgAccessControl1789350000000';

  /** Frozen copy of the sellable modules at the time of this migration. */
  private readonly sellable = [
    'accounting', 'banking', 'cheques', 'invoicing', 'tax', 'crm', 'hr',
    'inventory', 'damages', 'data_import', 'assistant',
  ];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await q.query(`ALTER TABLE "tenants" ADD COLUMN "require_2fa" boolean NOT NULL DEFAULT false`);

    await q.query(`
      CREATE TABLE "tenant_branches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "code" character varying(40),
        "parent_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_branches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_branches_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tenant_branches_parent" FOREIGN KEY ("parent_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE INDEX "IDX_tenant_branches_tenant" ON "tenant_branches" ("tenant_id")`);

    await q.query(`
      CREATE TABLE "tenant_departments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid,
        "name" character varying(120) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_departments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_departments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tenant_departments_branch" FOREIGN KEY ("branch_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE INDEX "IDX_tenant_departments_tenant" ON "tenant_departments" ("tenant_id")`);

    await q.query(`
      CREATE TABLE "tenant_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "permissions" text[] NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_roles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_roles_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE INDEX "IDX_tenant_roles_tenant" ON "tenant_roles" ("tenant_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_tenant_roles_tenant_name" ON "tenant_roles" ("tenant_id", "name")`);

    await q.query(`
      CREATE TABLE "tenant_memberships" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role_key" character varying(40) NOT NULL,
        "custom_role_id" uuid,
        "branch_id" uuid,
        "department_id" uuid,
        "branch_scoped" boolean NOT NULL DEFAULT false,
        "status" character varying(12) NOT NULL DEFAULT 'ACTIVE',
        "invited_by" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_memberships_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tenant_memberships_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tenant_memberships_role" FOREIGN KEY ("custom_role_id") REFERENCES "tenant_roles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_tenant_memberships_branch" FOREIGN KEY ("branch_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_tenant_memberships_department" FOREIGN KEY ("department_id") REFERENCES "tenant_departments"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_tenant_memberships_status" CHECK ("status" IN ('ACTIVE','SUSPENDED')),
        CONSTRAINT "CHK_tenant_memberships_custom" CHECK (("role_key" = 'custom') = ("custom_role_id" IS NOT NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_tenant_memberships_tenant_user" ON "tenant_memberships" ("tenant_id", "user_id")`);
    await q.query(`CREATE INDEX "IDX_tenant_memberships_user" ON "tenant_memberships" ("user_id")`);

    await q.query(`
      CREATE TABLE "tenant_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "email" character varying(254),
        "phone" character varying(11),
        "role_key" character varying(40) NOT NULL,
        "custom_role_id" uuid,
        "branch_id" uuid,
        "department_id" uuid,
        "branch_scoped" boolean NOT NULL DEFAULT false,
        "token_hash" character(64) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "accepted_at" TIMESTAMP,
        "accepted_by" uuid,
        "revoked_at" TIMESTAMP,
        "invited_by" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_invitations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_tenant_invitations_no_owner" CHECK ("role_key" <> 'owner')
      )`);
    await q.query(`CREATE UNIQUE INDEX "IDX_tenant_invitations_hash" ON "tenant_invitations" ("token_hash")`);
    await q.query(`CREATE INDEX "IDX_tenant_invitations_tenant" ON "tenant_invitations" ("tenant_id")`);

    await q.query(`
      CREATE TABLE "tenant_module_entitlements" (
        "tenant_id" uuid NOT NULL,
        "module" character varying(40) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updated_by" uuid,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_module_entitlements" PRIMARY KEY ("tenant_id", "module"),
        CONSTRAINT "FK_tenant_module_entitlements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )`);

    await q.query(`
      CREATE TABLE "audit_log" (
        "id" bigserial NOT NULL,
        "tenant_id" uuid,
        "actor_user_id" uuid,
        "action" character varying(80) NOT NULL,
        "resource_type" character varying(60),
        "resource_id" character varying(80),
        "metadata" jsonb,
        "ip" character varying(64),
        "user_agent" character varying(255),
        "prev_hash" character(64),
        "hash" character(64),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX "IDX_audit_log_tenant_created" ON "audit_log" ("tenant_id", "created_at" DESC)`);
    await q.query(`CREATE INDEX "IDX_audit_log_created" ON "audit_log" ("created_at")`);
    await q.query(`
      CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON "audit_log"
      FOR EACH ROW EXECUTE FUNCTION audit_log_immutable()`);
    await q.query(`
      CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable()`);

    // Hash chain: each tenant's rows link to the previous one (see AuditService), so a
    // deleted or edited row is detectable even by someone who bypassed the trigger.
    await q.query(`
      CREATE TABLE "tenant_module_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "module" character varying(40) NOT NULL,
        "requested_by" uuid NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'OPEN',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_module_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_module_requests_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_tenant_module_requests_status" CHECK ("status" IN ('OPEN','DONE','DECLINED'))
      )`);
    await q.query(`CREATE INDEX "IDX_tenant_module_requests_tenant" ON "tenant_module_requests" ("tenant_id")`);

    // Row-level security as a second wall behind the repositories: rows are visible only inside a
    // transaction that ran set_config('app.tenant_id', <tenant>, true) (TenantScope). The setting is
    // transaction-local, so it is safe with PgBouncer transaction pooling.
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    for (const t of ['tenant_branches', 'tenant_departments', 'tenant_roles']) {
      await q.query(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
      await q.query(`CREATE POLICY "${t}_tenant" ON "${t}" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`);
    }
    await q.query(`ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY`);
    await q.query(`CREATE POLICY "audit_log_read" ON "audit_log" FOR SELECT USING (${tenantMatch})`);
    await q.query(`CREATE POLICY "audit_log_append" ON "audit_log" FOR INSERT WITH CHECK (true)`);

    await q.query(`
      CREATE TABLE "user_totp" (
        "user_id" uuid NOT NULL,
        "secret_enc" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "recovery_hashes" text[] NOT NULL DEFAULT '{}',
        "last_used_step" bigint,
        "enabled_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_totp" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_user_totp_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);

    await q.query(`ALTER TABLE "auth_refresh_tokens" ADD COLUMN "user_agent" character varying(255)`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" ADD COLUMN "ip" character varying(64)`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" ADD COLUMN "device_hash" character(64)`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" ADD COLUMN "mfa" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" ADD COLUMN "session_started_at" TIMESTAMP`);

    // ---- backfill: keep every current tenant and member working ------------
    await q.query(`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role_key")
      SELECT u."tenant_id", u."id",
             CASE WHEN u."tenant_role" = 'OWNER' THEN 'owner' ELSE 'legacy_member' END
      FROM "users" u
      JOIN "tenants" t ON t."id" = u."tenant_id"
      ON CONFLICT ("tenant_id", "user_id") DO NOTHING`);
    await q.query(
      `INSERT INTO "tenant_module_entitlements" ("tenant_id", "module", "enabled")
       SELECT t."id", m.module, true FROM "tenants" t CROSS JOIN unnest($1::text[]) AS m(module)
       ON CONFLICT DO NOTHING`,
      [this.sellable],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(`SELECT count(*)::int AS n FROM "audit_log"`)) as Array<{ n: number }>;
    if (rows[0]?.n > 0 && process.env.ROXIRA_ALLOW_AUDIT_LOG_DROP !== '1') {
      throw new Error(
        `Cannot revert: audit_log holds ${rows[0].n} row(s). It is meant to be permanent. ` +
          `Export it first, then rerun with ROXIRA_ALLOW_AUDIT_LOG_DROP=1.`,
      );
    }
    await q.query(`ALTER TABLE "auth_refresh_tokens" DROP COLUMN "session_started_at"`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" DROP COLUMN "mfa"`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" DROP COLUMN "device_hash"`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" DROP COLUMN "ip"`);
    await q.query(`ALTER TABLE "auth_refresh_tokens" DROP COLUMN "user_agent"`);
    await q.query(`DROP TABLE "user_totp"`);
    await q.query(`DROP TABLE "tenant_module_requests"`);
    await q.query(`DROP TRIGGER "audit_log_no_truncate" ON "audit_log"`);
    await q.query(`DROP TRIGGER "audit_log_no_change" ON "audit_log"`);
    await q.query(`DROP TABLE "audit_log"`);
    await q.query(`DROP FUNCTION audit_log_immutable()`);
    await q.query(`DROP TABLE "tenant_module_entitlements"`);
    await q.query(`DROP TABLE "tenant_invitations"`);
    await q.query(`DROP TABLE "tenant_memberships"`);
    await q.query(`DROP TABLE "tenant_roles"`);
    await q.query(`DROP TABLE "tenant_departments"`);
    await q.query(`DROP TABLE "tenant_branches"`);
    await q.query(`ALTER TABLE "tenants" DROP COLUMN "require_2fa"`);
  }
}
