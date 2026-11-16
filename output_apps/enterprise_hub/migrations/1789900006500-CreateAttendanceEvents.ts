import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Creates attendance_events table for daily attendance and biometric/clock event tracking (T129).
 * Mandatory tenant_id with FORCE RLS (AGENTS.md section 4).
 */
export class CreateAttendanceEvents1789900006500 implements MigrationInterface {
  name = 'CreateAttendanceEvents1789900006500';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "attendance_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" integer NOT NULL REFERENCES "hr_employees"("id") ON DELETE CASCADE,
        "branch_id" integer,
        "occurred_at" timestamptz NOT NULL,
        "kind" character varying(16) NOT NULL,
        "source" character varying(32) NOT NULL,
        "created_by" character varying(64),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_events_tenant_occurred" ON "attendance_events" ("tenant_id", "occurred_at")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_events_tenant_emp_occurred" ON "attendance_events" ("tenant_id", "employee_id", "occurred_at")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_events_tenant_branch" ON "attendance_events" ("tenant_id", "branch_id", "occurred_at")`,
    );

    await enableTenantRls(q, 'attendance_events');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'attendance_events');
    await q.query(`DROP TABLE IF EXISTS "attendance_events"`);
  }
}
