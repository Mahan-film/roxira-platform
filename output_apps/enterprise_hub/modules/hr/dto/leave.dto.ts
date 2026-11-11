import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LeaveStatus, LeaveType } from '../enums/hr.enum';

export class CreateLeaveDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @IsInt()
  @Min(1)
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
  @Matches(/^(\d{4}[-/]\d{2}[-/]\d{2})$/, {
    message: 'تاریخ شروع باید به فرمت YYYY/MM/DD یا YYYY-MM-DD باشد',
  })
  startDate: string;

  @ApiProperty({ description: 'تاریخ پایان', example: '1403/05/12' })
  @IsString()
  @MaxLength(16)
  @Matches(/^(\d{4}[-/]\d{2}[-/]\d{2})$/, {
    message: 'تاریخ پایان باید به فرمت YYYY/MM/DD یا YYYY-MM-DD باشد',
  })
  endDate: string;

  @ApiProperty({ description: 'تعداد روز مرخصی', example: 2.5 })
  @IsNumber()
  @Min(0.5)
  @Max(366)
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
}

export class QueryLeaveDto {
  @ApiPropertyOptional({ description: 'شناسه کارمند' })
  @IsOptional()
  @IsInt()
  @Min(1)
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
