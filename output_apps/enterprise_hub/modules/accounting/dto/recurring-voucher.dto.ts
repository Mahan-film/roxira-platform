import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_JOURNAL_LINES, MIN_JOURNAL_LINES } from '../constants/accounting.constants';
import { RecurringVoucherFrequency } from '../constants/recurring-voucher.constants';
import { JournalEntryLineDto } from './create-journal-entry.dto';

/** Body of `POST recurring-vouchers`. Lines must balance; the service checks it exactly. */
export class CreateRecurringVoucherDto {
  @ApiProperty({ description: 'نام الگوی سند دوره‌ای', example: 'اجاره ماهانه دفتر' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty({ description: 'شرح سند تولیدشده', example: 'اجاره ماهانه دفتر مرکزی' })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  description: string;

  @ApiProperty({
    type: [JournalEntryLineDto],
    description: 'سطرهای تراز سند (حداقل دو سطر)',
  })
  @IsArray()
  @ArrayMinSize(MIN_JOURNAL_LINES)
  @ArrayMaxSize(MAX_JOURNAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];

  @ApiProperty({
    enum: RecurringVoucherFrequency,
    description: 'دوره تکرار: ماهانه، فصلی یا سالانه (تقویم جلالی)',
  })
  @IsEnum(RecurringVoucherFrequency)
  frequency: RecurringVoucherFrequency;

  @ApiProperty({ description: 'تاریخ اجرای بعدی (ISO 8601، میلادی)', example: '2026-03-21' })
  @IsISO8601()
  nextRunDate: string;

  @ApiPropertyOptional({ description: 'تاریخ پایان تکرار (ISO 8601)؛ خالی یعنی بی‌پایان' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'ثبت و برگشت خودکار تعهد (Accrual) در ابتدای ماه بعد',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoReverse?: boolean;

  @ApiPropertyOptional({ description: 'فعال بودن الگو', default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Body of `PUT recurring-vouchers/:id`; every field is optional, missing ones keep their value. */
export class UpdateRecurringVoucherDto extends PartialType(CreateRecurringVoucherDto) {}

/** Body of `POST recurring-vouchers/run-due`. */
export class RunRecurringVouchersDto {
  @ApiPropertyOptional({
    description: 'تاریخ اجرا (ISO 8601)؛ پیش‌فرض امروز به وقت تهران',
    example: '2026-06-21',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;
}

/** One due item that could not be posted, with the reason and the date it was due. */
export class RecurringVoucherSkippedDto {
  @ApiProperty({ description: 'شناسه الگوی سند دوره‌ای' })
  id: number;

  @ApiProperty({ description: 'تاریخ سررسید (ISO 8601)', example: '2026-03-21' })
  date: string;

  @ApiProperty({ description: 'دلیل نادیده‌گرفتن' })
  reason: string;
}

/** Result of a run-due pass. */
export class RunRecurringVouchersResultDto {
  @ApiProperty({ description: 'تعداد اسناد ایجادشده' })
  created: number;

  @ApiProperty({ description: 'تعداد اسناد برگشت‌خورده' })
  reversed: number;

  @ApiProperty({ type: [RecurringVoucherSkippedDto], description: 'موارد نادیده‌گرفته‌شده' })
  skipped: RecurringVoucherSkippedDto[];
}

/** A recurring voucher template as returned by the API. */
export class RecurringVoucherResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: [JournalEntryLineDto] }) lines: JournalEntryLineDto[];
  @ApiProperty({ enum: RecurringVoucherFrequency }) frequency: RecurringVoucherFrequency;
  @ApiProperty({ description: 'تاریخ اجرای بعدی (ISO 8601)', example: '2026-03-21' })
  nextRunDate: string;
  @ApiProperty({ nullable: true, description: 'تاریخ پایان (ISO 8601)' })
  endDate: string | null;
  @ApiProperty() autoReverse: boolean;
  @ApiProperty() active: boolean;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
