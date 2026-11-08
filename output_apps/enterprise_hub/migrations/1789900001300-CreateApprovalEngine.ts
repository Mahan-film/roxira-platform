import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Table-driven approval engine (#584 item 5 / T2 in #592):
 *   1. `tenant_approval_rules`: ordered approval steps per resource_type with integer minor-unit
 *      amount thresholds (`min_amount_minor`, `max_amount_minor`), required approver role/user,
 *      maker-checker flag (`require_distinct_approver`), and BullMQ escalation timeout/target.
 *   2. `tenant_approval_delegations`: time-bounded authority delegations (`starts_at`..`ends_at`,
 *      optional `resource_type` and `max_amount_minor`, revocable).
 *   3. `tenant_approval_requests`: pending/decided approval instances with snapshotted steps,
 *      escalation timer (`escalation_due_at`), and JSONB payload (e.g., Group B policy changes).
 *   4. `tenant_approval_step_decisions`: append-only step-by-step decisions (`APPROVED`,
 *      `REJECTED`, `ESCALATED`) including delegation provenance (`delegated_from_user_id`).
 *
 * Every table carries `tenant_id` and is protected with `ENABLE` + `FORCE ROW LEVEL SECURITY`.
 */
export class CreateApprovalEngine1789900001300 implements MigrationInterface {
  name = 'CreateApprovalEngine1789900001300';

  private readonly tables = [
    'tenant_approval_rules',
    'tenant_approval_delegations',
    'tenant_approval_requests',
    'tenant_approval_step_decisions',
  ] as const;

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_approval_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "resource_type" varchar(64) NOT NULL,
        "step_order" integer NOT NULL,
        "min_amount_minor" bigint NOT NULL DEFAULT 0,
        "max_amount_minor" bigint NULL,
        "approver_role" varchar(64) NOT NULL,
        "approver_user_id" varchar(64) NULL,
        "escalation_after_minutes" integer NULL,
        "escalate_to_role" varchar(64) NULL,
        "require_distinct_approver" boolean NOT NULL DEFAULT true,
        "active" boolean NOT NULL DEFAULT true,
        "created_by" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_approval_rules" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tenant_approval_rules_step" UNIQUE ("tenant_id", "resource_type", "step_order", "min_amount_minor"),
        CONSTRAINT "CHK_tenant_approval_rules_step_order" CHECK ("step_order" >= 1),
        CONSTRAINT "CHK_tenant_approval_rules_amount" CHECK (
          "min_amount_minor" >= 0 AND ("max_amount_minor" IS NULL OR "max_amount_minor" >= "min_amount_minor")
        ),
        CONSTRAINT "CHK_tenant_approval_rules_escalation" CHECK (
          "escalation_after_minutes" IS NULL OR "escalation_after_minutes" > 0
        )
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_approval_rules_lookup"
        ON "tenant_approval_rules" ("tenant_id", "resource_type", "active", "step_order")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_approval_delegations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "delegator_user_id" varchar(64) NOT NULL,
        "delegator_role" varchar(64) NOT NULL,
        "delegate_user_id" varchar(64) NOT NULL,
        "resource_type" varchar(64) NULL,
        "max_amount_minor" bigint NULL,
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "reason" text NOT NULL,
        "revoked_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_approval_delegations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_tenant_approval_delegations_distinct" CHECK ("delegator_user_id" <> "delegate_user_id"),
        CONSTRAINT "CHK_tenant_approval_delegations_window" CHECK ("ends_at" > "starts_at"),
        CONSTRAINT "CHK_tenant_approval_delegations_amount" CHECK ("max_amount_minor" IS NULL OR "max_amount_minor" >= 0)
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_approval_delegations_delegate"
        ON "tenant_approval_delegations" ("tenant_id", "delegate_user_id", "starts_at", "ends_at")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_approval_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "resource_type" varchar(64) NOT NULL,
        "resource_id" varchar(128) NOT NULL,
        "amount_minor" bigint NOT NULL DEFAULT 0,
        "requested_by" varchar(64) NOT NULL,
        "requested_by_role" varchar(64) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'PENDING',
        "current_step" integer NOT NULL DEFAULT 1,
        "total_steps" integer NOT NULL DEFAULT 1,
        "steps_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "escalation_due_at" timestamptz NULL,
        "escalated_count" integer NOT NULL DEFAULT 0,
        "decided_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_approval_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_tenant_approval_requests_status" CHECK (
          "status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')
        ),
        CONSTRAINT "CHK_tenant_approval_requests_amount" CHECK ("amount_minor" >= 0),
        CONSTRAINT "CHK_tenant_approval_requests_steps" CHECK ("current_step" >= 1 AND "total_steps" >= 1)
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_approval_requests_status"
        ON "tenant_approval_requests" ("tenant_id", "status", "escalation_due_at")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_approval_requests_resource"
        ON "tenant_approval_requests" ("tenant_id", "resource_type", "resource_id")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_approval_step_decisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "request_id" uuid NOT NULL,
        "step_order" integer NOT NULL,
        "decision" varchar(16) NOT NULL,
        "actor_user_id" varchar(64) NOT NULL,
        "actor_role" varchar(64) NOT NULL,
        "delegated_from_user_id" varchar(64) NULL,
        "comment" text NULL,
        "decided_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_approval_step_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_approval_step_decisions_request"
          FOREIGN KEY ("request_id") REFERENCES "tenant_approval_requests"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_tenant_approval_step_decisions_kind" CHECK (
          "decision" IN ('APPROVED', 'REJECTED', 'ESCALATED')
        ),
        CONSTRAINT "CHK_tenant_approval_step_decisions_order" CHECK ("step_order" >= 1)
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_approval_step_decisions_request"
        ON "tenant_approval_step_decisions" ("tenant_id", "request_id", "step_order")
    `);

    for (const table of this.tables) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(q, table);
      await q.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
