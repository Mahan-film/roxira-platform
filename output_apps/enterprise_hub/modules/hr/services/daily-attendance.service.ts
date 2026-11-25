import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceEventsRepository, NewAttendanceEvent } from '../repositories/attendance-events.repository';
import { HrRepository } from '../repositories/hr.repository';
import { AttendanceEventEntity } from '../entities/attendance-event.entity';
import {
  AttendanceEventKind,
  AttendanceEventSource,
  DailyAttendanceStatus,
} from '../enums/attendance-event.enum';
import { EmployeeStatus, LeaveStatus } from '../enums/hr.enum';
import {
  AttendanceEventResponseDto,
  CreateAttendanceEventDto,
  DailyAttendanceRecordDto,
  DailyAttendanceSummaryDto,
  ImportAttendanceResultDto,
  RollupAttendanceResultDto,
} from '../dto/attendance-event.dto';
import { jalaliMonthEnd, jalaliMonthStart } from './jalali-period';
import {
  parseTehranWallTime,
  tehranDateOf,
  tehranDayWindow,
} from './tehran-time';

export const MAX_IMPORT_ROWS = 10_000;

/**
 * Sums paired chronological IN -> OUT intervals in rounded minutes.
 * Returns null when no valid IN -> OUT pair exists on the day.
 */
function computeNetWorkedMinutes(
  events: ReadonlyArray<Pick<AttendanceEventEntity, 'kind' | 'occurredAt'>>,
): number | null {
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  let openInMs: number | null = null;
  let totalMs = 0;
  let pairedCount = 0;
  for (const ev of ordered) {
    const ts = ev.occurredAt.getTime();
    if (ev.kind === AttendanceEventKind.IN) {
      if (openInMs === null) {
        openInMs = ts;
      }
    } else if (ev.kind === AttendanceEventKind.OUT) {
      if (openInMs !== null && ts > openInMs) {
        totalMs += ts - openInMs;
        pairedCount++;
        openInMs = null;
      }
    }
  }
  // money-ok: converting duration from milliseconds to minutes, not currency
  return pairedCount > 0 ? Math.round(totalMs / 60000) : null;
}

@Injectable()
export class DailyAttendanceService {
  constructor(
    private readonly attendanceRepo: AttendanceEventsRepository,
    private readonly hrRepo: HrRepository,
  ) {}

  /**
   * Records a clock-in or clock-out event for an employee.
   */
  async recordEvent(
    tenantId: string,
    dto: CreateAttendanceEventDto,
    createdBy?: string,
  ): Promise<AttendanceEventResponseDto> {
    const employee = await this.hrRepo.findEmployeeById(tenantId, dto.employeeId);
    if (!employee) {
      throw new NotFoundException(`کارمند با شناسه ${dto.employeeId} یافت نشد.`);
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (isNaN(occurredAt.getTime())) {
      throw new BadRequestException('فرمت تاریخ و زمان معتبر نیست.');
    }

    const event = await this.attendanceRepo.createEvent(tenantId, {
      employeeId: dto.employeeId,
      branchId: dto.branchId ?? null,
      occurredAt,
      kind: dto.kind,
      source: dto.source ?? AttendanceEventSource.MANUAL,
      createdBy: createdBy ?? null,
      notes: dto.notes ?? null,
    });

    return {
      id: event.id,
      tenantId: event.tenantId,
      employeeId: event.employeeId,
      branchId: event.branchId,
      occurredAt: event.occurredAt.toISOString(),
      kind: event.kind,
      source: event.source,
      createdBy: event.createdBy,
      notes: event.notes,
      createdAt: event.createdAt.toISOString(),
    };
  }

  /**
   * Compiles daily attendance per branch, showing present, absent, late, and on-leave.
   */
  async getDailySummary(
    tenantId: string,
    dateStr: string,
    branchId?: number,
  ): Promise<DailyAttendanceSummaryDto> {
    // The day is the Asia/Tehran calendar day, not the UTC day.
    const window = tehranDayWindow(dateStr);
    if (!window) {
      throw new BadRequestException(`تاریخ نامعتبر است: ${dateStr}`);
    }
    const startOfDay = window.start;
    // listEventsForDay is inclusive on the upper bound, so step back 1 ms from the next midnight.
    const endOfDay = new Date(window.end.getTime() - 1);

    // 1. Fetch active employees
    const employees = await this.hrRepo.findActiveEmployees(tenantId);

    // 2. Fetch events on that day
    const events = await this.attendanceRepo.listEventsForDay(
      tenantId,
      startOfDay,
      endOfDay,
      branchId,
    );

    // 3. Fetch approved leaves
    const leaves = await this.hrRepo.listLeaves(tenantId, {});
    const approvedLeaves = leaves.filter(
      (l) =>
        l.status === LeaveStatus.APPROVED &&
        l.startDate <= dateStr &&
        l.endDate >= dateStr,
    );
    const leaveEmpIds = new Set(approvedLeaves.map((l) => l.employeeId));

    // Group events by employee
    const eventsByEmp = new Map<number, typeof events>();
    for (const ev of events) {
      const arr = eventsByEmp.get(ev.employeeId) ?? [];
      arr.push(ev);
      eventsByEmp.set(ev.employeeId, arr);
    }

    const records: DailyAttendanceRecordDto[] = [];
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let onLeaveCount = 0;

    for (const emp of employees) {
      const empEvents = eventsByEmp.get(emp.id) ?? [];
      const inEvents = empEvents.filter((e) => e.kind === AttendanceEventKind.IN);
      const outEvents = empEvents.filter((e) => e.kind === AttendanceEventKind.OUT);

      const firstIn = inEvents.length > 0 ? inEvents[0].occurredAt : null;
      const lastOut = outEvents.length > 0 ? outEvents[outEvents.length - 1].occurredAt : null;

      let status = DailyAttendanceStatus.ABSENT;
      let workedMinutes = 0;
      let tardinessMinutes = 0;

      if (firstIn) {
        // Standard start threshold: 08:30 Tehran time (Asia/Tehran)
        // Resolves official Asia/Tehran timezone correctly accounting for historical DST and current non-DST
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Tehran',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        }).formatToParts(firstIn);
        const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
        const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
        const tehranMinutes = (hour === 24 ? 0 : hour) * 60 + minute;
        const shiftStartMinutes = 8 * 60 + 30; // 08:30

        if (tehranMinutes > shiftStartMinutes) {
          tardinessMinutes = tehranMinutes - shiftStartMinutes;
          status = DailyAttendanceStatus.LATE;
          lateCount++;
          presentCount++; // Late is still counted as present at work
        } else {
          status = DailyAttendanceStatus.PRESENT;
          presentCount++;
        }

        const netMinutes = computeNetWorkedMinutes(empEvents);
        workedMinutes = netMinutes !== null ? netMinutes : 480; // Standard full day assumption when checked in without OUT
      } else if (leaveEmpIds.has(emp.id)) {
        status = DailyAttendanceStatus.ON_LEAVE;
        onLeaveCount++;
      } else {
        status = DailyAttendanceStatus.ABSENT;
        absentCount++;
      }

      records.push({
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        fullName: `${emp.firstName} ${emp.lastName}`.trim(),
        branchId: empEvents[0]?.branchId ?? branchId ?? null,
        status,
        firstIn: firstIn ? firstIn.toISOString() : null,
        lastOut: lastOut ? lastOut.toISOString() : null,
        workedMinutes,
        tardinessMinutes,
        eventsCount: empEvents.length,
      });
    }

    return {
      date: dateStr,
      branchId: branchId ?? null,
      totalEmployees: employees.length,
      presentCount,
      absentCount,
      lateCount,
      onLeaveCount,
      records,
    };
  }

  /**
   * Imports biometric device attendance logs (ZKTeco CSV / text format).
   */
  async importCsv(
    tenantId: string,
    csvData: string,
    defaultBranchId?: number,
    createdBy?: string,
  ): Promise<ImportAttendanceResultDto> {
    const lines = csvData
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بار درون‌ریزی مجاز است.`,
      );
    }

    if (lines.length === 0) {
      return { totalRows: 0, inserted: 0, skipped: 0, errors: ['فایل خالی است.'] };
    }

    // Preload employees for fast lookups by number or ID
    const employees = await this.hrRepo.findActiveEmployees(tenantId);
    const empByNum = new Map<string, number>();
    const empById = new Set<number>();
    for (const emp of employees) {
      empByNum.set(emp.employeeNumber.trim(), emp.id);
      empById.add(emp.id);
    }

    const eventsToInsert: NewAttendanceEvent[] = [];
    const errors: string[] = [];
    let skipped = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip header if detected
      if (
        i === 0 &&
        (line.toLowerCase().includes('employee') ||
          line.toLowerCase().includes('badgenumber') ||
          line.includes('کارمند') ||
          line.includes('پرسنلی'))
      ) {
        continue;
      }

      // Split by comma, tab, or semicolon
      const parts = line.split(/[,;\t]+/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length < 2) {
        skipped++;
        errors.push(`خط ${i + 1}: ردیف ناقص است.`);
        continue;
      }

      const rawIdentifier = parts[0];
      const rawDateTime = parts[1];
      const rawKind = parts[2] ? parts[2].toLowerCase() : 'in';
      const rawBranch = parts[3] ? parseInt(parts[3], 10) : defaultBranchId;

      // Match employee: biometric exports carry badge/employeeNumber; fall back to exact numeric PK id only if no number matches.
      let resolvedEmpId: number | undefined;
      if (empByNum.has(rawIdentifier)) {
        resolvedEmpId = empByNum.get(rawIdentifier);
      } else if (/^\d+$/.test(rawIdentifier)) {
        const parsedId = Number(rawIdentifier);
        if (empById.has(parsedId)) {
          resolvedEmpId = parsedId;
        }
      }

      if (!resolvedEmpId) {
        skipped++;
        errors.push(`خط ${i + 1}: کارمند با شناسه یا کد «${rawIdentifier}» یافت نشد.`);
        continue;
      }

      // Parse timestamp: device logs carry Asia/Tehran wall time
      const parsedDate = parseTehranWallTime(rawDateTime);
      if (!parsedDate) {
        skipped++;
        errors.push(`خط ${i + 1}: تاریخ یا زمان نامعتبر است: ${rawDateTime}`);
        continue;
      }

      // Normalize kind: 0 / in / ورود -> IN; 1 / out / خروج -> OUT
      let kind = AttendanceEventKind.IN;
      if (rawKind === '1' || rawKind === 'out' || rawKind === 'خروج') {
        kind = AttendanceEventKind.OUT;
      }

      eventsToInsert.push({
        employeeId: resolvedEmpId,
        branchId: isNaN(rawBranch as number) ? null : rawBranch,
        occurredAt: parsedDate,
        kind,
        source: AttendanceEventSource.DEVICE_IMPORT,
        createdBy: createdBy ?? 'device_import',
        notes: `Imported from line ${i + 1}`,
      });
    }

    const inserted = await this.attendanceRepo.bulkCreateEvents(tenantId, eventsToInsert);

    return {
      totalRows: lines.length,
      inserted,
      skipped,
      errors: errors.slice(0, 10), // Limit returned errors for clean responses
    };
  }

  /**
   * Aggregates daily events into monthly payroll totals in hr_attendances.
   */
  async rollupMonthly(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
    employeeId?: number,
  ): Promise<RollupAttendanceResultDto> {
    const startPeriod = jalaliMonthStart(periodYear, periodMonth);
    const endPeriod = jalaliMonthEnd(periodYear, periodMonth);

    // 1. Fetch all attendance events in the month (Asia/Tehran days, last day included)
    const rangeStart = tehranDayWindow(startPeriod.toISOString().slice(0, 10));
    const rangeEnd = tehranDayWindow(endPeriod.toISOString().slice(0, 10));
    if (!rangeStart || !rangeEnd) {
      throw new BadRequestException('دوره نامعتبر است.');
    }
    const events = await this.attendanceRepo.listEventsForRange(
      tenantId,
      rangeStart.start.toISOString(),
      new Date(rangeEnd.end.getTime() - 1).toISOString(),
      employeeId,
    );

    // 2. Fetch employees to process
    const allActive = await this.hrRepo.findActiveEmployees(tenantId);
    const targetEmployees = employeeId
      ? allActive.filter((e) => e.id === employeeId)
      : allActive;

    // Group events by employee and by day (YYYY-MM-DD)
    const empDayMap = new Map<number, Map<string, AttendanceEventEntity[]>>();
    for (const ev of events) {
      const dayKey = tehranDateOf(ev.occurredAt);
      let dayMap = empDayMap.get(ev.employeeId);
      if (!dayMap) {
        dayMap = new Map();
        empDayMap.set(ev.employeeId, dayMap);
      }
      const dayEvents = dayMap.get(dayKey) ?? [];
      dayEvents.push(ev);
      dayMap.set(dayKey, dayEvents);
    }

    let updatedRecords = 0;

    // Existing monthly rows: the rollup merges into them and never touches fields it does not compute.
    const existingRows = await this.hrRepo.findAttendanceByPeriod(
      tenantId,
      periodYear,
      periodMonth,
    );
    const existingByEmp = new Map(existingRows.map((r) => [r.employeeId, r]));

    for (const emp of targetEmployees) {
      const dayMap = empDayMap.get(emp.id);
      // Employees without events in the month are left untouched.
      if (!dayMap || dayMap.size === 0) continue;

      let workDays = 0;
      let totalOvertimeHours = 0;

      for (const [, dayEvents] of dayMap.entries()) {
        const hasIn = dayEvents.some((e: AttendanceEventEntity) => e.kind === AttendanceEventKind.IN);

        if (hasIn) {
          workDays++;
          const netMinutes = computeNetWorkedMinutes(dayEvents);
          if (netMinutes !== null && netMinutes > 480) {
            totalOvertimeHours += (netMinutes - 480) / 60;
          }
        }
      }

      // Only workDays and overtimeHours are derived from events. Night/holiday hours, absence and
      // unpaid leave have no event-based source here, so existing (manual) values are carried over.
      const existing = existingByEmp.get(emp.id);
      await this.hrRepo.saveAttendance(tenantId, {
        employeeId: emp.id,
        periodYear,
        periodMonth,
        workDays,
        overtimeHours: parseFloat(totalOvertimeHours.toFixed(2)),
        nightHours: existing?.nightHours ?? 0,
        holidayHours: existing?.holidayHours ?? 0,
        absenceDays: existing?.absenceDays ?? 0,
        unpaidLeaveDays: existing?.unpaidLeaveDays ?? 0,
        notes:
          existing?.notes ??
          `محاسبه خودکار کارکرد از رخدادهای تردد ماه ${periodMonth}/${periodYear}`,
      });
      updatedRecords++;
    }

    return {
      periodYear,
      periodMonth,
      processedEmployees: targetEmployees.length,
      updatedRecords,
    };
  }
}
