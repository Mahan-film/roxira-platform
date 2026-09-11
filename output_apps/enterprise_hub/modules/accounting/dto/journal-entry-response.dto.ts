import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import { JournalEntryStatus } from '../enums/accounting.enum';

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

  @ApiProperty({ enum: Currency, description: 'ارز حساب' })
  currency: Currency;

  @ApiProperty({ description: 'مبلغ بدهکار (به ارز حساب)' })
  debit: number;

  @ApiProperty({ description: 'مبلغ بستانکار (به ارز حساب)' })
  credit: number;

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

  @ApiProperty({ enum: Currency, description: 'ارز سند (مشترک تمام سطرها)' })
  currency: Currency;

  @ApiProperty({ description: 'جمع بدهکار سند (به ارز سند)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار سند (به ارز سند)' })
  totalCredit: number;

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