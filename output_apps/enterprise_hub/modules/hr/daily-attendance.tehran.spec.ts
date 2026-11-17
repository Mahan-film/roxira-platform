import { DailyAttendanceService } from './services/daily-attendance.service';
import { AttendanceEventKind } from './enums/attendance-event.enum';

const TENANT = 'tenant-1';

function makeService(opts: {
  events?: Array<Record<string, unknown>>;
  existing?: Array<Record<string, unknown>>;
  employees?: Array<Record<string, unknown>>;
}) {
  const employees = opts.employees ?? [
    { id: 1, employeeNumber: 'E1', firstName: 'A', lastName: 'B' },
    { id: 2, employeeNumber: 'E2', firstName: 'C', lastName: 'D' },
  ];
  const attendanceRepo = {
    listEventsForDay: jest.fn(async (_t: string, start: Date, end: Date) =>
      (opts.events ?? []).filter(
        (e) =>
          (e.occurredAt as Date) >= start && (e.occurredAt as Date) <= end,
      ),
    ),
    listEventsForRange: jest.fn(async () => opts.events ?? []),
    bulkCreateEvents: jest.fn(async (_t: string, rows: unknown[]) => rows.length),
  };
  const hrRepo = {
    findActiveEmployees: jest.fn(async () => employees),
    listLeaves: jest.fn(async () => []),
    findAttendanceByPeriod: jest.fn(async () => opts.existing ?? []),
    saveAttendance: jest.fn(async () => ({})),
  };
  const service = new DailyAttendanceService(attendanceRepo as never, hrRepo as never);
  return { service, attendanceRepo, hrRepo };
}

describe('DailyAttendanceService Asia/Tehran day handling (T129)', () => {
  it('counts an event at 01:00 Tehran on day D for day D, not D-1', async () => {
    // 01:00 Tehran on 2026-11-17 = 21:30Z on 2026-11-16
    const occurredAt = new Date('2026-11-16T21:30:00.000Z');
    const { service } = makeService({
      events: [{ employeeId: 1, kind: AttendanceEventKind.IN, occurredAt, branchId: null }],
    });

    const day = await service.getDailySummary(TENANT, '2026-11-17');
    expect(day.records.find((r) => r.employeeId === 1)?.eventsCount).toBe(1);

    const prev = await service.getDailySummary(TENANT, '2026-11-16');
    expect(prev.records.find((r) => r.employeeId === 1)?.eventsCount).toBe(0);
  });

  it('rejects malformed or impossible dates', async () => {
    const { service } = makeService({});
    await expect(service.getDailySummary(TENANT, '2026-13-40')).rejects.toThrow();
    await expect(service.getDailySummary(TENANT, 'nope')).rejects.toThrow();
  });

  it('stores CSV row "2026-11-17 08:15" as 04:45Z (Tehran wall time)', async () => {
    const { service, attendanceRepo } = makeService({});
    const res = await service.importCsv(TENANT, 'E1,2026-11-17 08:15,in');
    expect(res.inserted).toBe(1);
    const rows = attendanceRepo.bulkCreateEvents.mock.calls[0][1] as Array<{ occurredAt: Date }>;
    expect(rows[0].occurredAt.toISOString()).toBe('2026-11-17T04:45:00.000Z');
  });

  it('accepts an explicit Z or offset timestamp as an absolute instant', async () => {
    const { service, attendanceRepo } = makeService({});
    const csv = 'E1,2026-11-16T08:10:00Z,in\nE1,2026-11-16T12:00:00+03:30,out';
    const res = await service.importCsv(TENANT, csv);
    expect(res.inserted).toBe(2);
    const rows = attendanceRepo.bulkCreateEvents.mock.calls[0][1] as Array<{ occurredAt: Date }>;
    expect(rows[0].occurredAt.toISOString()).toBe('2026-11-16T08:10:00.000Z');
    expect(rows[1].occurredAt.toISOString()).toBe('2026-11-16T08:30:00.000Z');
  });

  it('rejects impossible calendar dates even with an explicit Z or offset', async () => {
    const { service, attendanceRepo } = makeService({});
    const csv = 'E1,2026-02-30T08:00:00Z,in\nE1,2026-02-30 08:00,in\nE1,2026-04-31T08:00:00+03:30,in';
    const res = await service.importCsv(TENANT, csv);
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(3);
    expect(attendanceRepo.bulkCreateEvents.mock.calls[0][1]).toHaveLength(0);
  });

  it('rejects a CSV with more than the row cap', async () => {
    const { service } = makeService({});
    const csv = Array.from({ length: 10_001 }, () => 'E1,2026-11-17 08:15,in').join('\n');
    await expect(service.importCsv(TENANT, csv)).rejects.toThrow();
  });

  it('rollup skips employees without events and keeps manual night/holiday/absence values', async () => {
    const events = [
      {
        employeeId: 1,
        kind: AttendanceEventKind.IN,
        occurredAt: new Date('2026-11-16T04:30:00.000Z'),
      },
      {
        employeeId: 1,
        kind: AttendanceEventKind.OUT,
        occurredAt: new Date('2026-11-16T14:30:00.000Z'),
      },
    ];
    const { service, hrRepo } = makeService({
      events,
      existing: [
        {
          employeeId: 1,
          nightHours: 7,
          holidayHours: 5,
          absenceDays: 2,
          unpaidLeaveDays: 1,
          notes: 'manual',
        },
        { employeeId: 2, nightHours: 3, holidayHours: 3, absenceDays: 1, unpaidLeaveDays: 0 },
      ],
    });

    const res = await service.rollupMonthly(TENANT, 1405, 8);
    expect(res.updatedRecords).toBe(1);
    expect(hrRepo.saveAttendance).toHaveBeenCalledTimes(1);
    const saved = (hrRepo.saveAttendance.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(saved.employeeId).toBe(1);
    expect(saved.workDays).toBe(1);
    expect(saved.overtimeHours).toBe(2);
    expect(saved.nightHours).toBe(7);
    expect(saved.holidayHours).toBe(5);
    expect(saved.absenceDays).toBe(2);
    expect(saved.unpaidLeaveDays).toBe(1);
    expect(saved.notes).toBe('manual');
  });

  it('rollup groups events by Tehran day (01:00 Tehran is the next day, not the previous)', async () => {
    // Two IN events: 2026-11-16T21:30Z (= 11-17 01:00 Tehran) and 2026-11-17T04:30Z (= 11-17 08:00).
    const events = [
      { employeeId: 1, kind: AttendanceEventKind.IN, occurredAt: new Date('2026-11-16T21:30:00.000Z') },
      { employeeId: 1, kind: AttendanceEventKind.IN, occurredAt: new Date('2026-11-17T04:30:00.000Z') },
    ];
    const { service, hrRepo } = makeService({ events });
    await service.rollupMonthly(TENANT, 1405, 8, 1);
    const saved = (hrRepo.saveAttendance.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(saved.workDays).toBe(1); // same Tehran day
  });
});
