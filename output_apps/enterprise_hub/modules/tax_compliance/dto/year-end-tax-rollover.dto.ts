import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';

export class QueryYearEndRolloverDto {
  @ApiProperty({ description: 'سال مالی شمسی (مثلاً ۱۴۰۴ یا ۱۴۰۵)', example: 1404 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  year: number;

  @ApiPropertyOptional({
    description: 'مبلغ هزینه‌های غیرقابل قبول مالیاتی (ریال) ماده ۱۴۷ و ۱۴۸',
    example: '50000000',
  })
  @IsOptional()
  @IsNumberString()
  nonDeductibleExpensesMinor?: string;

  @ApiPropertyOptional({
    description: 'مبلغ معافیت‌های قانونی مالیاتی (ریال) ماده ۱۳۲ و ۱۴۱',
    example: '20000000',
  })
  @IsOptional()
  @IsNumberString()
  taxExemptIncomeMinor?: string;
}

export interface TaxReconciliationView {
  accountingRevenueMinor: string;
  accountingExpensesMinor: string;
  /** سود یا زیان خالص حسابداری قبل از مالیات */
  accountingProfitBeforeTaxMinor: string;
  /** هزینه‌های غیرقابل قبول برگشت‌داده‌شده */
  nonDeductibleExpensesMinor: string;
  /** معافیت‌ها و درآمدهای معاف کسرشده */
  taxExemptIncomeMinor: string;
  /** سود مشمول مالیات پس از تعدیلات قانونی */
  taxableProfitMinor: string;
  /** نرخ مالیات اشخاص حقوقی (ماده ۱۰۵ ق.م.م - ۲۵٪) */
  taxRatePercent: number;
  /** مالیات بر درآمد عملکرد تخمینی سال */
  estimatedCorporateTaxMinor: string;
}

export interface YearEndReadinessChecklistView {
  hasUnpostedDrafts: boolean;
  draftVouchersCount: number;
  hasNumberingGaps: boolean;
  isLedgerBalanced: boolean;
  hasClosingVoucher: boolean;
  temporaryAccountsClosed: boolean;
  /** آیا سیستم از نظر حسابداری و مالیاتی آماده بستن سال مالی است؟ */
  isReadyToClose: boolean;
  blockingReasons: string[];
}

export interface YearEndTaxRolloverView {
  year: number;
  currency: 'IRR';
  tenantId: string;
  taxReconciliation: TaxReconciliationView;
  readinessChecklist: YearEndReadinessChecklistView;
}
