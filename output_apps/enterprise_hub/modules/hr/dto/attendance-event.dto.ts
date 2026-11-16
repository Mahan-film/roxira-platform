import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  AttendanceEventKind,
  AttendanceEventSource,
  DailyAttendanceStatus,
} from '../enums/attendance-event.enum';

export class CreateAttendanceEventDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @IsInt()
  @Type(() => Number)
  employeeId: number;

  @ApiProperty({
    description: 'نوع رخداد (ورود یا خروج)',
    enum: AttendanceEventKind,
    example: AttendanceEventKind.IN,
  })
  @IsEnum(AttendanceEventKind)
  kind: AttendanceEventKind;

  @ApiPropertyOptional({
    description: 'تاریخ و زمان وقوع (ISO)',
    example: '2026-11-16T08:30:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ description: 'شناسه شعبه محل تردد', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  branchId?: number;

  @ApiPropertyOptional({
    description: 'منبع ثبت (دستی، پین‌پد یا دستگاه)',
    enum: AttendanceEventSource,
    example: AttendanceEventSource.MANUAL,
  })
  @IsOptional()
  @IsEnum(AttendanceEventSource)
  source?: AttendanceEventSource;

  @ApiPropertyOptional({ description: 'توضیحات یا یادداشت تردد' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class QueryDailyAttendanceDto {
  @ApiProperty({
    description: 'تاریخ مورد نظر به فرمت YYYY-MM-DD',
    example: '2026-11-16',
  })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس شناسه شعبه', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  branchId?: number;
}

export class ImportAttendanceCsvDto {
  @ApiProperty({ description: 'محتوای متنی فایل لاگ یا CSV دستگاه حضور و غیاب' })
  @IsNotEmpty()
  @IsString()
  csvData: string;

  @ApiPropertyOptional({ description: 'شناسه شعبه پیش‌فرض', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  branchId?: number;
}

export class RollupAttendanceDto {
  @ApiProperty({ description: 'سال دوره (مثلاً ۱۴۰۵ یا ۲۰۲۶)', example: 1405 })
  @IsInt()
  @Min(1300)
  @Max(2100)
  @Type(() => Number)
  periodYear: number;

  @ApiProperty({ description: 'ماه دوره (۱ الی ۱۲)', example: 8 })
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  periodMonth: number;

  @ApiPropertyOptional({ description: 'محاسبه کارکرد برای یک کارمند خاص' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  employeeId?: number;
}

export class AttendanceEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  employeeId: number;

  @ApiPropertyOptional()
  branchId: number | null;

  @ApiProperty()
  occurredAt: string;

  @ApiProperty({ enum: AttendanceEventKind })
  kind: AttendanceEventKind;

  @ApiProperty({ enum: AttendanceEventSource })
  source: AttendanceEventSource;

  @ApiPropertyOptional()
  createdBy: string | null;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  createdAt: string;
}

export class DailyAttendanceRecordDto {
  @ApiProperty()
  employeeId: number;

  @ApiProperty()
  employeeNumber: string;

  @ApiProperty()
  fullName: string;

  @ApiPropertyOptional()
  branchId: number | null;

  @ApiProperty({ enum: DailyAttendanceStatus })
  status: DailyAttendanceStatus;

  @ApiPropertyOptional()
  firstIn: string | null;

  @ApiPropertyOptional()
  lastOut: string | null;

  @ApiProperty()
  workedMinutes: number;

  @ApiProperty()
  tardinessMinutes: number;

  @ApiProperty()
  eventsCount: number;
}

export class DailyAttendanceSummaryDto {
  @ApiProperty()
  date: string;

  @ApiPropertyOptional()
  branchId: number | null;

  @ApiProperty()
  totalEmployees: number;

  @ApiProperty()
  presentCount: number;

  @ApiProperty()
  absentCount: number;

  @ApiProperty()
  lateCount: number;

  @ApiProperty()
  onLeaveCount: number;

  @ApiProperty({ type: [DailyAttendanceRecordDto] })
  records: DailyAttendanceRecordDto[];
}

export class ImportAttendanceResultDto {
  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  inserted: number;

  @ApiProperty()
  skipped: number;

  @ApiProperty({ type: [String] })
  errors: string[];
}

export class RollupAttendanceResultDto {
  @ApiProperty()
  periodYear: number;

  @ApiProperty()
  periodMonth: number;

  @ApiProperty()
  processedEmployees: number;

  @ApiProperty()
  updatedRecords: number;
}
