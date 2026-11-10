import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class QueryQuarterlyTaxComparisonDto {
  @ApiProperty({ description: 'سال مالی شمسی (مثلاً ۱۴۰۴ یا ۱۴۰۵)', example: 1404 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  year: number;
}

export interface QuarterMetricsView {
  quarter: number;
  labelFa: string;
  periodFrom: string;
  periodTo: string;
  invoicedSalesMinor: string;
  moadianSalesMinor: string;
  ledgerRevenueMinor: string;
  outputVatMinor: string;
  invoicedPurchasesMinor: string;
  ledgerExpensesMinor: string;
  inputVatMinor: string;
  netTaxPayableMinor: string;
  /** مغایرت فروش با دفاتر در این فصل */
  salesToLedgerDiffMinor: string;
  /** مغایرت فروش با سامانه مودیان در این فصل */
  salesToMoadianDiffMinor: string;
}

export interface QuarterlyTaxComparisonView {
  year: number;
  currency: 'IRR';
  tenantId: string;
  quarters: QuarterMetricsView[];
  yearTotal: {
    invoicedSalesMinor: string;
    moadianSalesMinor: string;
    ledgerRevenueMinor: string;
    outputVatMinor: string;
    invoicedPurchasesMinor: string;
    ledgerExpensesMinor: string;
    inputVatMinor: string;
    netTaxPayableMinor: string;
    salesToLedgerDiffMinor: string;
    salesToMoadianDiffMinor: string;
  };
  /** درصد رشد فروش و مالیات فصل به فصل */
  trends: Array<{
    quarter: number;
    salesGrowthPercent: number;
    taxGrowthPercent: number;
  }>;
}
