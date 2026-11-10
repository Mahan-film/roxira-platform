import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Attendance, leave, and staff loans (T67 / #230 Line 15).
 *
 * Adds:
 *   - `hr_attendances`: monthly timesheet per employee (work days, overtime, night, holiday, absence)
 *   - `hr_leaves`: leave requests and approvals (annual, unpaid, sick, special)
 *   - `hr_staff_loans`: staff loans with instalment deduction from payroll
 *
 * All tables have `tenant_id` and strict FORCE row-level security enabled.
 */
export class CreateHrAttendanceLeaveLoans1789900002400 implements MigrationInterface {
  name = 'CreateHrAttendanceLeaveLoans1789900002400';

  private static readonly TABLES = [
    'hr_attendances',
    'hr_leaves',
    'hr_staff_loans',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. hr_attendances
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hr_attendances" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "employee_id" integer NOT NULL,
        "period_year" integer NOT NULL,
        "period_month" integer NOT NULL,
        "work_days" numeric(5,2) NOT NULL DEFAULT 30,
        "overtime_hours" numeric(8,2) NOT NULL DEFAULT 0,
        "night_hours" numeric(8,2) NOT NULL DEFAULT 0,
        "holiday_hours" numeric(8,2) NOT NULL DEFAULT 0,
        "absence_days" numeric(5,2) NOT NULL DEFAULT 0,
        "unpaid_leave_days" numeric(5,2) NOT NULL DEFAULT 0,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_attendances_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_hr_attendances_tenant_employee_period"
          UNIQUE ("tenant_id", "employee_id", "period_year", "period_month"),
        CONSTRAINT "FK_hr_attendances_employee"
          FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_attendances_tenant_period" ON "hr_attendances" ("tenant_id", "period_year", "period_month")`,
    );

    // 2. hr_leaves
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hr_leaves" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "employee_id" integer NOT NULL,
        "leave_type" character varying(32) NOT NULL DEFAULT 'ANNUAL',
        "start_date" character varying(16) NOT NULL,
        "end_date" character varying(16) NOT NULL,
        "days" numeric(5,2) NOT NULL DEFAULT 1,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "description" text,
        "approved_by" character varying(128),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_leaves_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_hr_leaves_employee"
          FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_leaves_tenant_employee" ON "hr_leaves" ("tenant_id", "employee_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_leaves_tenant_status" ON "hr_leaves" ("tenant_id", "status")`,
    );

    // 3. hr_staff_loans
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hr_staff_loans" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "employee_id" integer NOT NULL,
        "loan_number" character varying(64) NOT NULL,
        "title" character varying(128) NOT NULL,
        "principal_amount" numeric(18,2) NOT NULL,
        "instalment_amount" numeric(18,2) NOT NULL,
        "total_instalments" integer NOT NULL,
        "paid_instalments" integer NOT NULL DEFAULT 0,
        "remaining_amount" numeric(18,2) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'ACTIVE',
        "start_date" character varying(16),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_staff_loans_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_hr_staff_loans_tenant_number"
          UNIQUE ("tenant_id", "loan_number"),
        CONSTRAINT "FK_hr_staff_loans_employee"
          FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_staff_loans_tenant_employee" ON "hr_staff_loans" ("tenant_id", "employee_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_staff_loans_tenant_status" ON "hr_staff_loans" ("tenant_id", "status")`,
    );

    // Enable RLS
    for (const table of CreateHrAttendanceLeaveLoans1789900002400.TABLES) {
      await enableTenantRls(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...CreateHrAttendanceLeaveLoans1789900002400.TABLES].reverse()) {
      await disableTenantRls(queryRunner, table);
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
