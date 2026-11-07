import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { Money } from '../money';

/**
 * DTO خروجی یک سطر سند دوطرفه.
 */
export class JournalEntryLineResponseDto {
  @ApiProperty({ description: 'شناسه سطر' })
  id: number;

  @ApiProperty({ description: 'شناسه حساب' })
  accountId: number;

  @ApiProperty({ description: 'کد حساب' })
  accountCode: string;

  @ApiProperty({ description: 'نام حساب' })
  accountName: string;

  @ApiProperty({ description: 'ارز سطر (کد متعارف)', example: 'IRR' })
  currency: string;

  @ApiProperty({ description: 'مبلغ بدهکار (به ریال — ارز گزارش‌گیری)' })
  debit: Money;

  @ApiProperty({ description: 'مبلغ بستانکار (به ریال — ارز گزارش‌گیری)' })
  credit: Money;

  @ApiProperty({ description: 'مبلغ به ارز مبدأ (amount_fx)', nullable: true })
  amountFx: number | null;

  @ApiProperty({ description: 'نرخ تبدیل ارز مبدأ به ریال', nullable: true })
  fxRate: number | null;

  @ApiProperty({ description: 'کد طرف حساب/تفضیلی', nullable: true })
  partyCode: string | null;

  @ApiProperty({ description: 'شرح سطر', nullable: true })
  description: string | null;
}

/**
 * DTO خروجی سند دفتر روزنامه.
 */
export class JournalEntryResponseDto {
  @ApiProperty({ description: 'شناسه یکتای سند' })
  id: number;

  @ApiProperty({ description: 'شماره سند' })
  entryNumber: string;

  @ApiProperty({ description: 'تاریخ سند' })
  date: Date;

  @ApiProperty({ description: 'شرح سند' })
  description: string;

  @ApiProperty({ enum: JournalEntryStatus, description: 'وضعیت سند' })
  status: JournalEntryStatus;

  @ApiProperty({ description: 'نسخهٔ سند برای قفل ویرایش خوش‌بینانه' })
  version: number;

  @ApiProperty({ description: 'ارز سند (کد متعارف)', example: 'IRR' })
  currency: string;

  @ApiProperty({ description: 'جمع بدهکار سند (به ریال — ارز گزارش‌گیری)' })
  totalDebit: Money;

  @ApiProperty({ description: 'جمع بستانکار سند (به ریال — ارز گزارش‌گیری)' })
  totalCredit: Money;

  @ApiProperty({ enum: Currency, description: 'ارز پایه تجمیع' })
  baseCurrency: Currency;

  @ApiProperty({ description: 'جمع بدهکار سند معادل ارز پایه' })
  baseTotalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار سند معادل ارز پایه' })
  baseTotalCredit: number;

  @ApiProperty({ type: [JournalEntryLineResponseDto], description: 'سطرهای سند' })
  lines: JournalEntryLineResponseDto[];
}

/**
 * DTO خروجی صفحه‌بندی‌شده دفتر روزنامه.
 */
export class PaginatedJournalEntryResponseDto {
  @ApiProperty({ type: [JournalEntryResponseDto] })
  data: JournalEntryResponseDto[];

  @ApiProperty({ description: 'تعداد کل اسناد' })
  total: number;

  @ApiProperty({ description: 'شماره صفحه جاری' })
  page: number;

  @ApiProperty({ description: 'تعداد آیتم در هر صفحه' })
  limit: number;
}