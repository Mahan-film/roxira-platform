import { ApiProperty } from '@nestjs/swagger';
import { PipelineStage } from '../enums/crm.enums';
import { LeadResponseDto } from './crm-lead-response.dto';

/**
 * آمار یک مرحله از پایپ‌لاین فروش.
 */
export class StageMetricDto {
  @ApiProperty({ enum: PipelineStage, example: PipelineStage.QUALIFIED })
  stage: PipelineStage;

  @ApiProperty({ description: 'تعداد سرنخ در این مرحله', example: 8 })
  count: number;

  @ApiProperty({ description: 'ارزش ریالی سرنخ‌های این مرحله', example: 1200000000 })
  value: number;

  @ApiProperty({ description: 'سهم از کل ارزش پایپ‌لاین (درصد)', example: 24.5 })
  share: number;
}

/**
 * خروجی آمار تحلیلی فروش و پایپ‌لاین
 * (GET /enterprise-hub/crm/stats).
 */
export class LeadStatsResponseDto {
  @ApiProperty({ description: 'کل سرنخ‌ها', example: 42 })
  totalLeads: number;

  @ApiProperty({ description: 'سرنخ‌های مراحل باز', example: 30 })
  openLeads: number;

  @ApiProperty({ description: 'سرنخ‌های برنده‌شده', example: 9 })
  wonLeads: number;

  @ApiProperty({ description: 'سرنخ‌های از دست رفته', example: 3 })
  lostLeads: number;

  @ApiProperty({
    description: 'ارزش ریالی فرصت‌های باز (درآمد بالقوه)',
    example: 7400000000,
  })
  openPipelineValue: number;

  @ApiProperty({ description: 'درآمد تحقق‌یافته (سرنخ‌های برنده)', example: 2100000000 })
  wonRevenue: number;

  @ApiProperty({ description: 'ارزش ریالی فرصت‌های از دست رفته', example: 300000000 })
  lostValue: number;

  @ApiProperty({ description: 'ارزش کل پایپ‌لاین (باز + برنده + باخت)', example: 9800000000 })
  totalPipelineValue: number;

  @ApiProperty({ description: 'میانگین ارزش فرصت', example: 233333333 })
  averageDealValue: number;

  @ApiProperty({ description: 'نرخ تبدیل فروش: برنده‌ها به کل سرنخ‌ها (درصد)', example: 21.4 })
  conversionRate: number;

  @ApiProperty({ description: 'نرخ برد: برنده‌ها به معاملات بسته‌شده (درصد)', example: 75 })
  winRate: number;

  @ApiProperty({ type: [StageMetricDto], description: 'تفکیک آمار به تفکیک مرحله' })
  byStage: StageMetricDto[];
}

/**
 * یک ستون تابلوی کانبان پایپ‌لاین همراه با سرنخ‌های همان مرحله
 * (GET /enterprise-hub/crm/pipeline).
 */
export class PipelineStageGroupDto {
  @ApiProperty({ enum: PipelineStage, example: PipelineStage.NEW })
  stage: PipelineStage;

  @ApiProperty({ example: 12 })
  count: number;

  @ApiProperty({ description: 'ارزش ریالی سرنخ‌های این ستون', example: 1500000000 })
  totalValue: number;

  @ApiProperty({ type: [LeadResponseDto] })
  leads: LeadResponseDto[];
}
