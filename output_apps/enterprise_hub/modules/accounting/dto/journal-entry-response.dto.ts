import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ description: 'مبلغ بدهکار (ریال)' })
  debit: number;

  @ApiProperty({ description: 'مبلغ بستانکار (ریال)' })
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

  @ApiProperty({ description: 'جمع بدهکار سند (ریال)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار سند (ریال)' })
  totalCredit: number;

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