import { ApiProperty } from '@nestjs/swagger';
import { PipelineStage } from '../enums/crm.enums';

/**
 * خروجی اطلاعات یک سرنخ فروش CRM.
 */
export class LeadResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'سارا محمدی' })
  fullName: string;

  @ApiProperty({ example: 'sara.mohammadi@example.com' })
  email: string;

  @ApiProperty({ example: '09121234567', nullable: true })
  phone: string | null;

  @ApiProperty({ example: 'شرکت فناوری روکسیرا', nullable: true })
  company: string | null;

  @ApiProperty({ enum: PipelineStage, example: PipelineStage.NEW })
  pipelineStage: PipelineStage;

  @ApiProperty({ description: 'ارزش ریالی برآوردی فرصت', example: 250000000 })
  estimatedValue: number;

  @ApiProperty({ example: 'کارشناس فروش ۱', nullable: true })
  owner: string | null;

  @ApiProperty({ description: 'سابقه یادداشت‌ها', nullable: true })
  notes: string | null;

  @ApiProperty({ description: 'تعداد سوابق تماس ثبت‌شده', example: 3 })
  contactCount: number;

  @ApiProperty({ example: '2026-09-11T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-11T10:00:00.000Z' })
  updatedAt: Date;
}

/**
 * خروجی صفحه‌بندی‌شده فهرست سرنخ‌ها.
 */
export class PaginatedLeadsResponseDto {
  @ApiProperty({ type: [LeadResponseDto] })
  data: LeadResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
