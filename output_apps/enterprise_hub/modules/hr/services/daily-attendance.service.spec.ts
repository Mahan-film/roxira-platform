import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DailyAttendanceService } from './daily-attendance.service';
import {
  AttendanceEventKind,
  AttendanceEventSource,
  DailyAttendanceStatus,
} from '../enums/attendance-event.enum';
import { EmployeeStatus, LeaveStatus } from '../enums/hr.enum';

describe('DailyAttendanceService (T129)', () => {
  let service: DailyAttendanceService;
  let mockAttendanceRepo: any;
  let mockHrRepo: any;

  const tenantId = 't-12345';

  beforeEach(() => {
    mockAttendanceRepo = {
      createEvent: jest.fn(async (tId: string, data: any) => ({
        id: 'ev-uuid-1',
        tenantId: tId,
        employeeId: data.employeeId,
        branchId: data.branchId ?? null,
        occurredAt: data.occurredAt,
        kind: data.kind,
        source: data.source,
        createdBy: data.createdBy ?? null,
        notes: data.notes ?? null,
        createdAt: new Date(),
      })),
      bulkCreateEvents: jest.fn(async (_tId: string, events: any[]) => events.length),
      listEventsForDay: jest.fn(async () => []),
      listEventsForRange: jest.fn(async () => []),
    };

    mockHrRepo = {
      findEmployeeById: jest.fn(async (tId: string, id: number) => {
        if (id === 1) {
          return {
            id: 1,
            tenantId: tId,
            employeeNumber: 'EMP-001',
            firstName: 'رضا',
            lastName: 'رضایی',
            status: EmployeeStatus.ACTIVE,
          };
        }
        return null;
      }),
      findActiveEmployees: jest.fn(async () => [
        {
          id: 1,
          employeeNumber: 'EMP-001',
          firstName: 'رضا',
          lastName: 'رضایی',
          status: EmployeeStatus.ACTIVE,
        },
        {
          id: 2,
          employeeNumber: 'EMP-002',
          firstName: 'سارا',
          lastName: 'احمدی',
          status: EmployeeStatus.ACTIVE,
        },
        {
          id: 3,
          employeeNumber: 'EMP-003',
          firstName: 'علی',
          lastName: 'کریمی',
          status: EmployeeStatus.ACTIVE,
        },
      ]),
      listLeaves: jest.fn(async () => []),
      saveAttendance: jest.fn(async () => ({})),
    };

    service = new DailyAttendanceService(mockAttendanceRepo, mockHrRepo);
  });

  describe('recordEvent', () => {
    it('records a clock-in event successfully', async () => {
      const res = await service.recordEvent(
        tenantId,
        {
          employeeId: 1,
          kind: AttendanceEventKind.IN,
          occurredAt: '2026-11-16T08:15:00.000Z',
          branchId: 10,
          source: AttendanceEventSource.MANUAL,
        },
        'user-admin',
      );

      expect(res.id).toBe('ev-uuid-1');
      expect(res.employeeId).toBe(1);
      expect(res.kind).toBe(AttendanceEventKind.IN);
      expect(res.branchId).toBe(10);
      expect(res.createdBy).toBe('user-admin');
      expect(mockAttendanceRepo.createEvent).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when employee does not exist', async () => {
      await expect(
        service.recordEvent(tenantId, {
          employeeId: 999,
          kind: AttendanceEventKind.IN,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException on invalid occurredAt date string', async () => {
      await expect(
        service.recordEvent(tenantId, {
          employeeId: 1,
          kind: AttendanceEventKind.IN,
          occurredAt: 'invalid-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDailySummary', () => {
    it('calculates daily status: present, late, on-leave, and absent', async () => {
      // Employee 1: on time (04:45 UTC = 08:15 Tehran time)
      // Employee 2: late (05:40 UTC = 09:10 Tehran time)
      // Employee 3: on approved leave
      mockAttendanceRepo.listEventsForDay.mockResolvedValueOnce([
        {
          id: 'ev-1',
          employeeId: 1,
          branchId: 1,
          occurredAt: new Date('2026-11-16T04:45:00.000Z'),
          kind: AttendanceEventKind.IN,
        },
        {
          id: 'ev-2',
          employeeId: 1,
          branchId: 1,
          occurredAt: new Date('2026-11-16T13:30:00.000Z'),
          kind: AttendanceEventKind.OUT,
        },
        {
          id: 'ev-3',
          employeeId: 2,
          branchId: 1,
          occurredAt: new Date('2026-11-16T05:40:00.000Z'),
          kind: AttendanceEventKind.IN,
        },
      ]);

      mockHrRepo.listLeaves.mockResolvedValueOnce([
        {
          id: 1,
          employeeId: 3,
          startDate: '2026-11-15',
          endDate: '2026-11-17',
          status: LeaveStatus.APPROVED,
        },
      ]);

      const summary = await service.getDailySummary(tenantId, '2026-11-16', 1);

      expect(summary.totalEmployees).toBe(3);
      expect(summary.presentCount).toBe(2); // 1 present on time + 1 late
      expect(summary.lateCount).toBe(1);
      expect(summary.onLeaveCount).toBe(1);
      expect(summary.absentCount).toBe(0);

      const emp1 = summary.records.find((r) => r.employeeId === 1);
      expect(emp1?.status).toBe(DailyAttendanceStatus.PRESENT);
      expect(emp1?.workedMinutes).toBe(525);

      const emp2 = summary.records.find((r) => r.employeeId === 2);
      expect(emp2?.status).toBe(DailyAttendanceStatus.LATE);
      expect(emp2?.tardinessMinutes).toBeGreaterThan(0);

      const emp3 = summary.records.find((r) => r.employeeId === 3);
      expect(emp3?.status).toBe(DailyAttendanceStatus.ON_LEAVE);
    });
  });

  describe('importCsv', () => {
    it('imports ZKTeco biometric CSV log and bulk inserts events', async () => {
      const csv = `
        EmployeeNumber,DateTime,Kind,BranchId
        EMP-001,2026-11-16 08:00:00,in,1
        EMP-001,2026-11-16 17:00:00,out,1
        EMP-002,2026-11-16 09:15:00,0,1
      `.trim();

      const res = await service.importCsv(tenantId, csv, 1, 'admin');

      expect(res.totalRows).toBe(4);
      expect(res.inserted).toBe(3);
      expect(res.skipped).toBe(0);
      expect(mockAttendanceRepo.bulkCreateEvents).toHaveBeenCalledTimes(1);
    });

    it('reports skipped rows when employee is not found', async () => {
      const csv = `
        UNKNOWN-999,2026-11-16 08:00:00,in
      `.trim();

      const res = await service.importCsv(tenantId, csv);
      expect(res.inserted).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors.length).toBeGreaterThan(0);
    });
  });

  describe('rollupMonthly', () => {
    it('aggregates events into monthly totals and calls saveAttendance', async () => {
      mockAttendanceRepo.listEventsForRange.mockResolvedValueOnce([
        {
          id: 'ev-1',
          employeeId: 1,
          occurredAt: new Date('2026-11-16T04:30:00.000Z'),
          kind: AttendanceEventKind.IN,
        },
        {
          id: 'ev-2',
          employeeId: 1,
          occurredAt: new Date('2026-11-16T14:30:00.000Z'),
          kind: AttendanceEventKind.OUT,
        },
      ]);

      const res = await service.rollupMonthly(tenantId, 1405, 8, 1);

      expect(res.periodYear).toBe(1405);
      expect(res.periodMonth).toBe(8);
      expect(res.updatedRecords).toBe(1);
      expect(mockHrRepo.saveAttendance).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          employeeId: 1,
          periodYear: 1405,
          periodMonth: 8,
          workDays: 1,
          overtimeHours: 2, // 10h total - 8h standard = 2h overtime
        }),
      );
    });
  });
});
