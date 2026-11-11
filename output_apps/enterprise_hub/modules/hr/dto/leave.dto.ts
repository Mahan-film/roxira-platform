import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { LeaveStatus, LeaveType } from '../enums/hr.enum';

export class CreateLeaveDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @IsInt()
  @Type(() => Number)
  employeeId: number;

  @ApiProperty({
    enum: LeaveType,
    description: 'نوع مرخصی (استحقاقی، بدون حقوق، استعلاجی، مناسبتی)',
    example: LeaveType.ANNUAL,
  })
  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @ApiProperty({ description: 'تاریخ شروع', example: '1403/05/10' })
  @IsString()
  @MaxLength(16)
  startDate: string;

  @ApiProperty({ description: 'تاریخ پایان', example: '1403/05/12' })
  @IsString()
  @MaxLength(16)
  endDate: string;

  @ApiProperty({ description: 'تعداد روز مرخصی', example: 2.5 })
  @IsNumber()
  @Min(0.5)
  @Type(() => Number)
  days: number;

  @ApiPropertyOptional({ description: 'توضیحات یا علت مرخصی' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class ReviewLeaveDto {
  @ApiProperty({
    enum: LeaveStatus,
    description: 'وضعیت جدید مرخصی (APPROVED یا REJECTED)',
    example: LeaveStatus.APPROVED,
  })
  @IsEnum(LeaveStatus)
  status: LeaveStatus;

  @ApiPropertyOptional({ description: 'تأییدکننده (توسط سیستم از توکن JWT کاربر تعیین می‌شود)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  approvedBy?: string;
}

export class QueryLeaveDto {
  @ApiPropertyOptional({ description: 'شناسه کارمند' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  employeeId?: number;

  @ApiPropertyOptional({ enum: LeaveStatus, description: 'وضعیت بررسی' })
  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;
}

export class LeaveResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  employeeId: number;

  @ApiPropertyOptional()
  employeeName?: string;

  @ApiPropertyOptional()
  employeeNumber?: string;

  @ApiProperty({ enum: LeaveType })
  leaveType: LeaveType;

  @ApiProperty()
  leaveTypeLabel: string;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;

  @ApiProperty()
  days: number;

  @ApiProperty({ enum: LeaveStatus })
  status: LeaveStatus;

  @ApiProperty()
  statusLabel: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional()
  approvedBy?: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
