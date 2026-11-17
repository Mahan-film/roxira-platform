import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoneyAmount } from '../../accounting/dto/money.validator';
import { MAX_DOC_ROWS } from '../constants/treasury.constants';

/** Largest statement file accepted, in characters of text (about 2 MB). */
export const MAX_STATEMENT_CHARS = 2_000_000;
const MONEY = { oneOf: [{ type: 'number' }, { type: 'string' }], example: '1190.00' };

/** Keeps the raw JSON value so the global implicit conversion cannot turn "false" into true. */
const rawBoolean = () => Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]);

export class ImportBankStatementDto {
  @ApiProperty({ description: 'حساب بانکی که صورتحساب به آن تعلق دارد' })
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @ApiProperty({ description: 'متن فایل CAMT.053 (XML) یا MT940', maxLength: MAX_STATEMENT_CHARS })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STATEMENT_CHARS)
  content: string;

  @ApiPropertyOptional({ enum: ['camt053', 'mt940'], description: 'در صورت ارسال‌نشدن، از روی محتوا تشخیص داده می‌شود' })
  @IsOptional()
  @IsIn(['camt053', 'mt940'])
  format?: 'camt053' | 'mt940';
}

export class QueryBankStatementLinesDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @ApiPropertyOptional({ enum: ['unmatched', 'matched'] })
  @IsOptional()
  @IsIn(['unmatched', 'matched'])
  status?: 'unmatched' | 'matched';

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class StatementAllocationDto {
  @ApiProperty({ description: 'شناسه صورتحساب فروش' })
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ description: 'مبلغی از این واریز که به این صورتحساب تخصیص می‌یابد', ...MONEY })
  @IsMoneyAmount()
  amount: number | string;
}

export class ConfirmStatementMatchDto {
  @ApiPropertyOptional({
    type: [StatementAllocationDto],
    description: 'تخصیص دستی؛ در صورت ارسال‌نشدن، پیشنهاد فعلی سیستم تأیید می‌شود',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOC_ROWS)
  @ValidateNested({ each: true })
  @Type(() => StatementAllocationDto)
  allocations?: StatementAllocationDto[];

  @ApiPropertyOptional({
    description: 'کارمزد بانکی که از همین واریز کسر شده است. مجموع تخصیص‌ها باید برابر مبلغ واریز به‌علاوهٔ کارمزد باشد',
    ...MONEY,
  })
  @IsOptional()
  @IsMoneyAmount()
  fee?: number | string;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  note?: string;
}

export class StatementSuggestionResponseDto {
  @ApiProperty({ enum: ['reference', 'amount_date'] }) rule: string;
  @ApiProperty() auto: boolean;
  @ApiProperty({ description: 'ارجاع دقیق با مبلغ برابر: در رابط کاربری از پیش انتخاب می‌شود؛ ثبت فقط با تأیید کاربر (مگر تنظیم ثبت خودکار روشن باشد)' }) preselected: boolean;
  @ApiProperty({ description: 'کارمزد پیشنهادی (رشتهٔ اعشاری)' }) fee: string;
  @ApiProperty({ type: [Object] }) allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: string }>;
  @ApiProperty() explanation: string;
}

export class StatementMatchResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['reference', 'amount_date', 'manual'] }) rule: string;
  @ApiProperty() auto: boolean;
  @ApiProperty() fee: string;
  @ApiProperty() journalEntryId: number;
  @ApiProperty({ type: Object }) explanation: unknown;
  @ApiProperty({ type: [Object] }) allocations: Array<{ invoiceId: string; invoiceNumber: string | null; amount: string }>;
}

export class BankStatementLineResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bankAccountId: number;
  @ApiProperty() bankTxnId: string;
  @ApiProperty() bookingDate: string;
  @ApiProperty({ nullable: true, type: String }) valueDate: string | null;
  @ApiProperty({ description: 'رشتهٔ اعشاری' }) amount: string;
  @ApiProperty({ enum: ['credit', 'debit'] }) direction: string;
  @ApiProperty({ nullable: true, type: String }) currency: string | null;
  @ApiProperty() reference: string;
  @ApiProperty({ nullable: true, type: String }) counterparty: string | null;
  @ApiProperty({ enum: ['unmatched', 'matched'] }) status: string;
  @ApiPropertyOptional({ type: StatementSuggestionResponseDto, nullable: true }) suggestion?: StatementSuggestionResponseDto | null;
  @ApiPropertyOptional({ type: StatementMatchResponseDto, nullable: true }) match?: StatementMatchResponseDto | null;
}

export class ImportBankStatementResponseDto {
  @ApiProperty() importId: string;
  @ApiProperty({ enum: ['camt053', 'mt940'] }) format: string;
  @ApiProperty() totalLines: number;
  @ApiProperty() newLines: number;
  @ApiProperty({ description: 'سطرهایی که قبلاً وارد شده بودند و دوباره ساخته نشدند' }) duplicateLines: number;
  @ApiProperty({ description: 'سطرهایی که هنگام ورود خودکار تطبیق و ثبت شدند' }) autoMatched: number;
}

export class UpdateStatementSettingsDto {
  @ApiProperty({ description: 'ثبت خودکار سند برای ارجاع دقیق با مبلغ برابر هنگام ورود صورتحساب (پیش‌فرض: خاموش)' })
  @rawBoolean()
  @IsBoolean()
  autoPostExactMatches: boolean;
}

export class StatementSettingsResponseDto {
  @ApiProperty() autoPostExactMatches: boolean;
}
