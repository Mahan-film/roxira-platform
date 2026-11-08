import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { SayadRegistrationStatus } from '../sayad/sayad';

export class QueryChequeMaturityDto {
  @ApiPropertyOptional({
    description: 'جهت چک: دریافتی (received)، پرداختی (issued) یا همه (all)',
    enum: ['received', 'issued', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  direction?: 'received' | 'issued' | 'all';

  @ApiPropertyOptional({
    description: 'تاریخ مبنای گزارش سررسید (YYYY-MM-DD)، پیش‌فرض: امروز',
    example: '2026-11-08',
  })
  @IsOptional()
  @IsString()
  asOfDate?: string;

  @ApiPropertyOptional({
    description: 'فیلتر بر اساس نام بانک',
    example: 'ملت',
  })
  @IsOptional()
  @IsString()
  bankName?: string;
}

export interface ChequeMaturityItemView {
  id: number;
  chequeNumber: string;
  sayadNumber: string | null;
  sayadRegistrationStatus: SayadRegistrationStatus;
  direction: ChequeDirection;
  status: ChequeStatus;
  bankName: string | null;
  partyName: string;
  partyCode: string | null;
  amountMinor: string;
  dueDate: string;
  issueDate: string;
  daysToDue: number;
}

export interface ChequeMaturityBucketView {
  bucketKey: string;
  labelFa: string;
  minDays?: number;
  maxDays?: number;
  count: number;
  totalAmountMinor: string;
  items: ChequeMaturityItemView[];
}

export interface BankChequeMaturityView {
  bankName: string;
  count: number;
  totalAmountMinor: string;
}

export interface PartyChequeMaturityView {
  partyName: string;
  partyCode: string | null;
  count: number;
  totalAmountMinor: string;
}

export interface ChequeMaturityReportView {
  asOfDate: string;
  direction: 'received' | 'issued' | 'all';
  currency: 'IRR';
  summary: {
    totalCount: number;
    totalAmountMinor: string;
    overdueCount: number;
    overdueAmountMinor: string;
    todayCount: number;
    todayAmountMinor: string;
    upcomingCount: number;
    upcomingAmountMinor: string;
    /** میانگین وزنی روزهای سررسید (مثبت یعنی آتی، منفی یعنی معوق) */
    weightedAverageDays: number;
  };
  /** سطل‌های سن‌بندی سررسید */
  buckets: Record<string, ChequeMaturityBucketView>;
  /** تفکیک بر اساس بانک */
  byBank: BankChequeMaturityView[];
  /** ۱۰ طرف‌حساب با بیشترین مانده چک */
  topParties: PartyChequeMaturityView[];
  /** تفکیک بر اساس وضعیت صیاد */
  bySayadStatus: Record<string, { count: number; totalAmountMinor: string }>;
}
