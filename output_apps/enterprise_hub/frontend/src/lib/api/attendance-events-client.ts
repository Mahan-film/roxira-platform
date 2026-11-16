import { apiRequest } from "./http-client";
import { API_PROXY_BASE_PATH, HR_RESOURCE_PATH } from "./config";

const BASE = `${API_PROXY_BASE_PATH}/${HR_RESOURCE_PATH}/attendance`;

export enum AttendanceEventKind {
  IN = "in",
  OUT = "out",
}

export enum AttendanceEventSource {
  MANUAL = "manual",
  POS_PIN = "pos_pin",
  DEVICE_IMPORT = "device_import",
}

export enum DailyAttendanceStatus {
  PRESENT = "present",
  ABSENT = "absent",
  LATE = "late",
  ON_LEAVE = "on_leave",
}

export interface AttendanceEventResponseDto {
  id: string;
  tenantId: string;
  employeeId: number;
  branchId: number | null;
  occurredAt: string;
  kind: AttendanceEventKind;
  source: AttendanceEventSource;
  createdBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateAttendanceEventDto {
  employeeId: number;
  kind: AttendanceEventKind;
  occurredAt?: string;
  branchId?: number;
  source?: AttendanceEventSource;
  notes?: string;
}

export interface DailyAttendanceRecordDto {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  branchId: number | null;
  status: DailyAttendanceStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  tardinessMinutes: number;
  eventsCount: number;
}

export interface DailyAttendanceSummaryDto {
  date: string;
  branchId: number | null;
  totalEmployees: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  onLeaveCount: number;
  records: DailyAttendanceRecordDto[];
}

export interface ImportAttendanceResultDto {
  totalRows: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export interface RollupAttendanceResultDto {
  periodYear: number;
  periodMonth: number;
  processedEmployees: number;
  updatedRecords: number;
}

/** ثبت رخداد ورود یا خروج پرسنل — POST /enterprise-hub/hr/attendance/events */
export async function recordAttendanceEvent(
  payload: CreateAttendanceEventDto,
  signal?: AbortSignal,
): Promise<AttendanceEventResponseDto> {
  return apiRequest<AttendanceEventResponseDto>(`${BASE}/events`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** دریافت گزارش وضعیت حضور روزانه — GET /enterprise-hub/hr/attendance/daily */
export async function getDailyAttendanceSummary(
  params: { date: string; branchId?: number },
  signal?: AbortSignal,
): Promise<DailyAttendanceSummaryDto> {
  const searchParams: Record<string, string> = { date: params.date };
  if (params.branchId !== undefined && params.branchId !== null) {
    searchParams.branchId = String(params.branchId);
  }
  return apiRequest<DailyAttendanceSummaryDto>(`${BASE}/daily`, {
    method: "GET",
    searchParams,
    signal,
  });
}

/** بارگذاری لاگ دستگاه حضور و غیاب — POST /enterprise-hub/hr/attendance/import-csv */
export async function importAttendanceCsv(
  payload: { csvData: string; branchId?: number },
  signal?: AbortSignal,
): Promise<ImportAttendanceResultDto> {
  return apiRequest<ImportAttendanceResultDto>(`${BASE}/import-csv`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** تجمیع کارکرد روزانه به کارکرد ماهانه حقوق — POST /enterprise-hub/hr/attendance/rollup */
export async function rollupMonthlyAttendance(
  payload: { periodYear: number; periodMonth: number; employeeId?: number },
  signal?: AbortSignal,
): Promise<RollupAttendanceResultDto> {
  return apiRequest<RollupAttendanceResultDto>(`${BASE}/rollup`, {
    method: "POST",
    body: payload,
    signal,
  });
}
