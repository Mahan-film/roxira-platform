import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class QueryTaxInspectorPackageDto {
  @ApiProperty({ description: 'سال مالی شمسی (مثلاً ۱۴۰۴ یا ۱۴۰۵)', example: 1404 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  year: number;
}

export interface TaxInspectorSalesReconciliation {
  invoicedSalesCount: number;
  invoicedSalesTotalMinor: string;
  taxableSalesMinor: string;
  exemptSalesMinor: string;
  outputVatMinor: string;
  moadianTransmittedCount: number;
  moadianTransmittedTotalMinor: string;
  ledgerRevenueMinor: string;
  /** مغایرت بین فروش فاکتورها و درآمد ثبت‌شده در دفتر کل */
  salesToLedgerDiscrepancyMinor: string;
  /** مغایرت بین فروش فاکتورها و سامانه مودیان */
  salesToMoadianDiscrepancyMinor: string;
  isConsistent: boolean;
}

export interface TaxInspectorPurchasesReconciliation {
  purchaseDocumentCount: number;
  deductiblePurchasesMinor: string;
  inputVatCreditMinor: string;
  ledgerExpenseMinor: string;
  seasonalReportedPurchasesMinor: string;
}

export interface TaxInspectorVatSummary {
  outputVatMinor: string;
  inputVatCreditMinor: string;
  netTaxPayableMinor: string;
  quarterlyBreakdown: Array<{
    quarter: number;
    quarterLabel: string;
    salesMinor: string;
    outputVatMinor: string;
    purchasesMinor: string;
    inputVatMinor: string;
    netVatMinor: string;
  }>;
}

export interface TaxInspectorBooksAudit {
  totalVouchersCount: number;
  postedVouchersCount: number;
  draftVouchersCount: number;
  isBalanced: boolean;
  /** بررسی توالی و بدون شکاف بودن شماره اسناد قطعی */
  hasNumberingGaps: boolean;
  hasClosingVoucher: boolean;
  closingVoucherNumber?: string | null;
}

export interface TaxInspectorPackageView {
  year: number;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  currency: 'IRR';
  tenantId: string;
  salesReconciliation: TaxInspectorSalesReconciliation;
  purchasesReconciliation: TaxInspectorPurchasesReconciliation;
  vatSummary: TaxInspectorVatSummary;
  booksAudit: TaxInspectorBooksAudit;
  /** هشدارهای ممیزی جهت بررسی پیش از تحویل به ممیز */
  auditAlerts: string[];
}
