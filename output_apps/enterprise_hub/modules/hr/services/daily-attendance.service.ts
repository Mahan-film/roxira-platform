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
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
    if (isNaN(startOfDay.getTime())) {
      throw new BadRequestException(`تاریخ نامعتبر است: ${dateStr}`);
    }

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

        if (lastOut && lastOut.getTime() > firstIn.getTime()) {
          workedMinutes = Math.round((lastOut.getTime() - firstIn.getTime()) / 60000);
        } else {
          // Standard full day assumption when checked in
          workedMinutes = 480;
        }
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

      // Match employee
      let resolvedEmpId: number | undefined;
      const parsedNum = parseInt(rawIdentifier, 10);
      if (!isNaN(parsedNum) && empById.has(parsedNum)) {
        resolvedEmpId = parsedNum;
      } else if (empByNum.has(rawIdentifier)) {
        resolvedEmpId = empByNum.get(rawIdentifier);
      }

      if (!resolvedEmpId) {
        skipped++;
        errors.push(`خط ${i + 1}: کارمند با شناسه یا کد «${rawIdentifier}» یافت نشد.`);
        continue;
      }

      // Parse timestamp
      const parsedDate = new Date(rawDateTime.replace(' ', 'T'));
      if (isNaN(parsedDate.getTime())) {
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

    // 1. Fetch all attendance events in the month
    const events = await this.attendanceRepo.listEventsForRange(
      tenantId,
      startPeriod.toISOString(),
      endPeriod.toISOString(),
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
      const dayKey = ev.occurredAt.toISOString().slice(0, 10);
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

    for (const emp of targetEmployees) {
      const dayMap = empDayMap.get(emp.id) ?? new Map<string, AttendanceEventEntity[]>();
      let workDays = 0;
      let totalOvertimeHours = 0;

      for (const [, dayEvents] of dayMap.entries()) {
        const inEvents = dayEvents.filter((e: AttendanceEventEntity) => e.kind === AttendanceEventKind.IN);
        const outEvents = dayEvents.filter((e: AttendanceEventEntity) => e.kind === AttendanceEventKind.OUT);

        if (inEvents.length > 0) {
          workDays++;
          const firstIn = inEvents[0].occurredAt;
          const lastOut = outEvents.length > 0 ? outEvents[outEvents.length - 1].occurredAt : null;

          if (lastOut && lastOut.getTime() > firstIn.getTime()) {
            const hours = (lastOut.getTime() - firstIn.getTime()) / (1000 * 3600);
            if (hours > 8.0) {
              totalOvertimeHours += hours - 8.0;
            }
          }
        }
      }

      // Standard work days in month (typically 30)
      const standardMonthDays = 30;
      const absenceDays = Math.max(0, standardMonthDays - workDays);

      await this.hrRepo.saveAttendance(tenantId, {
        employeeId: emp.id,
        periodYear,
        periodMonth,
        workDays,
        overtimeHours: parseFloat(totalOvertimeHours.toFixed(2)),
        absenceDays,
        nightHours: 0,
        holidayHours: 0,
        unpaidLeaveDays: 0,
        notes: `محاسبه خودکار کارکرد از رخدادهای تردد ماه ${periodMonth}/${periodYear}`,
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
