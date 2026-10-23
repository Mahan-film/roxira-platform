import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_MATCH_WINDOW_DAYS } from '../constants/banking.constants';
import { MatchMethod, StatementLineStatus } from '../enums/banking.enum';

/** بازه تاریخ اختیاری (میلادی ISO). */
export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2024-10-01' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ example: '2024-10-31' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}

export class QueryStatementLinesDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: StatementLineStatus })
  @IsOptional()
  @IsEnum(StatementLineStatus)
  status?: StatementLineStatus;
}

export class QueryBookLinesDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'فقط سطرهای تطبیق‌نخورده', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unmatchedOnly?: boolean;
}

export class AutoMatchDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'پنجره تاریخ (روز)', default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MATCH_WINDOW_DAYS)
  windowDays?: number;
}

export class ManualMatchDto {
  @ApiProperty({ description: 'شناسه سطر سند (fin_journal_entry_lines.id)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  journalLineId: number;
}

export class CreateEntryFromLineDto {
  @ApiProperty({ description: 'کد حساب مقابل (مثلاً هزینه کارمزد بانکی)', example: '5030' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  counterAccountCode: string;

  @ApiPropertyOptional({ description: 'شرح سند (پیش‌فرض: شرح سطر بانک)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class SummaryQueryDto {
  @ApiPropertyOptional({ description: 'تاریخ مغایرت‌گیری (پیش‌فرض امروز)', example: '2024-10-31' })
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

export class StatementLineResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() bankAccountId: number;
  @ApiProperty({ example: '2024-10-06' }) txnDate: string;
  @ApiPropertyOptional({ nullable: true, type: String }) description: string | null;
  @ApiProperty() withdrawal: number;
  @ApiProperty() deposit: number;
  @ApiPropertyOptional({ nullable: true, type: Number }) balance: number | null;
  @ApiPropertyOptional({ nullable: true, type: String }) reference: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) matchedJournalLineId: number | null;
  @ApiPropertyOptional({ nullable: true, enum: MatchMethod }) matchMethod: MatchMethod | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) createdJournalEntryId: number | null;
}

export class BookLineResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() journalEntryId: number;
  @ApiProperty() entryNumber: string;
  @ApiProperty() date: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) description: string | null;
  @ApiProperty() debit: number;
  @ApiProperty() credit: number;
  @ApiPropertyOptional({ nullable: true, type: Number }) matchedStatementLineId: number | null;
}

export class AutoMatchResponseDto {
  @ApiProperty() matched: number;
  @ApiProperty({ description: 'سطرهای دارای چند نامزد هم‌ارز (برای تطبیق دستی)' })
  ambiguous: number;
  @ApiProperty() stillUnmatched: number;
}

export class ReconciliationSummaryDto {
  @ApiProperty() bankAccountId: number;
  @ApiProperty({ example: '2024-10-31' }) asOf: string;
  @ApiProperty({ description: 'مانده دفاتر (بدهکار-مثبت) تا تاریخ' }) bookBalance: number;
  @ApiProperty({ description: 'مانده بانک طبق صورتحساب تا تاریخ' }) bankBalance: number;
  @ApiProperty({ description: 'واریزهای بانک که در دفاتر نیست' }) unmatchedBankDeposits: number;
  @ApiProperty({ description: 'برداشت‌های بانک که در دفاتر نیست' }) unmatchedBankWithdrawals: number;
  @ApiProperty({ description: 'بدهکارهای دفاتر که در بانک نیست (واریز در راه)' }) unmatchedBookDebits: number;
  @ApiProperty({ description: 'بستانکارهای دفاتر که در بانک نیست (چک‌های وصول‌نشده)' }) unmatchedBookCredits: number;
  @ApiProperty({ description: 'مانده بانک + واریز در راه − چک‌های وصول‌نشده' }) adjustedBankBalance: number;
  @ApiProperty({ description: 'مانده دفاتر + واریزهای ثبت‌نشده − برداشت‌های ثبت‌نشده' }) adjustedBookBalance: number;
  @ApiProperty({ description: 'اختلاف تعدیل‌شده (صفر = مغایرت‌گیری کامل)' }) difference: number;
  @ApiProperty() matchedCount: number;
  @ApiProperty() unmatchedStatementCount: number;
  @ApiProperty() unmatchedBookCount: number;
}
