import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1,
  TEST_T2,
} from '../../test/support/test-pg';
import { AttendanceEventsRepository } from './repositories/attendance-events.repository';
import { HrRepository } from './repositories/hr.repository';
import { DailyAttendanceService } from './services/daily-attendance.service';
import { AttendanceEventKind, AttendanceEventSource } from './enums/attendance-event.enum';
import { EmployeeStatus } from './enums/hr.enum';

describePg('attendance_events table and RLS on real PostgreSQL (T129)', () => {
  let testDb: TestDatabaseContext;
  let attendanceRepo: AttendanceEventsRepository;
  let hrRepo: HrRepository;
  let dailyService: DailyAttendanceService;

  let empT1Id: number;
  let empT2Id: number;

  beforeAll(async () => {
    testDb = await createTestDatabase('daily_attendance');
    attendanceRepo = new AttendanceEventsRepository(testDb.scope);
    hrRepo = new HrRepository(testDb.scope, testDb.app);
    dailyService = new DailyAttendanceService(attendanceRepo, hrRepo);

    // Seed active employee for Tenant 1
    const [empT1] = await testDb.scope.run(TEST_T1, async (m) => {
      return m.query(
        `INSERT INTO hr_employees (
           tenant_id, employee_number, first_name, last_name, national_id,
           mobile, job_title, department, employee_status, hire_date
         ) VALUES ($1, 'EMP-T1-01', 'احمد', 'رضایی', '0011111111', '09121111111', 'کارشناس', 'فنی', 'ACTIVE', '2026-01-01')
         RETURNING id`,
        [TEST_T1],
      );
    });
    empT1Id = empT1.id;

    // Seed active employee for Tenant 2
    const [empT2] = await testDb.scope.run(TEST_T2, async (m) => {
      return m.query(
        `INSERT INTO hr_employees (
           tenant_id, employee_number, first_name, last_name, national_id,
           mobile, job_title, department, employee_status, hire_date
         ) VALUES ($1, 'EMP-T2-01', 'مریم', 'کاظمی', '0022222222', '09122222222', 'مدیر', 'مالی', 'ACTIVE', '2026-01-01')
         RETURNING id`,
        [TEST_T2],
      );
    });
    empT2Id = empT2.id;
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('verifies non-superuser roxira_app role and FORCE RLS on attendance_events', async () => {
    const roleCheck = await testDb.app.query(
      `SELECT current_user, usesuper FROM pg_user WHERE usename = current_user`,
    );
    expect(roleCheck[0].current_user).toBe('roxira_app');
    expect(roleCheck[0].usesuper).toBe(false);

    const rlsCheck = await testDb.owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname = 'attendance_events'`,
    );
    expect(rlsCheck[0].relrowsecurity).toBe(true);
    expect(rlsCheck[0].relforcerowsecurity).toBe(true);
  });

  it('records attendance events and enforces strict tenant isolation under RLS', async () => {
    const eventT1 = await dailyService.recordEvent(
      TEST_T1,
      {
        employeeId: empT1Id,
        kind: AttendanceEventKind.IN,
        occurredAt: '2026-11-16T04:45:00.000Z',
        source: AttendanceEventSource.MANUAL,
        branchId: 1,
      },
      'admin-t1',
    );
    expect(eventT1.id).toBeDefined();
    expect(eventT1.tenantId).toBe(TEST_T1);

    const eventT2 = await dailyService.recordEvent(
      TEST_T2,
      {
        employeeId: empT2Id,
        kind: AttendanceEventKind.IN,
        occurredAt: '2026-11-16T05:00:00.000Z',
        source: AttendanceEventSource.POS_PIN,
        branchId: 2,
      },
      'pos-t2',
    );
    expect(eventT2.id).toBeDefined();
    expect(eventT2.tenantId).toBe(TEST_T2);

    // Tenant 1 only sees Tenant 1's events
    const summaryT1 = await dailyService.getDailySummary(TEST_T1, '2026-11-16', 1);
    expect(summaryT1.records.some((r) => r.employeeId === empT1Id)).toBe(true);
    expect(summaryT1.records.some((r) => r.employeeId === empT2Id)).toBe(false);

    // Tenant 2 only sees Tenant 2's events
    const summaryT2 = await dailyService.getDailySummary(TEST_T2, '2026-11-16', 2);
    expect(summaryT2.records.some((r) => r.employeeId === empT2Id)).toBe(true);
    expect(summaryT2.records.some((r) => r.employeeId === empT1Id)).toBe(false);

    // Direct query on app connection without tenant scope returns 0 rows
    const rawRows = await testDb.app.query(`SELECT * FROM attendance_events`);
    expect(rawRows).toHaveLength(0);
  });

  it('rolls up daily events into hr_attendances for monthly payroll', async () => {
    // Record clock-out for Tenant 1 employee to produce 8h worked
    await dailyService.recordEvent(
      TEST_T1,
      {
        employeeId: empT1Id,
        kind: AttendanceEventKind.OUT,
        occurredAt: '2026-11-16T14:45:00.000Z', // 10 hours later => 2h overtime
        source: AttendanceEventSource.MANUAL,
      },
      'admin-t1',
    );

    const rollupResult = await dailyService.rollupMonthly(TEST_T1, 1405, 8, empT1Id);
    expect(rollupResult.updatedRecords).toBe(1);

    const attendances = await hrRepo.listAttendances(TEST_T1, {
      periodYear: 1405,
      periodMonth: 8,
      employeeId: empT1Id,
    });
    expect(attendances.length).toBeGreaterThanOrEqual(1);
    expect(attendances[0].workDays).toBe(1);
    expect(attendances[0].overtimeHours).toBe(2);
  });
});
