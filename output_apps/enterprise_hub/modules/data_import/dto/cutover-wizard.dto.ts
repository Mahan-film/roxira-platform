import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TieOutControlTotalsDto } from './package-commit.dto';
import { TieOutItemReportDto, TieOutSummaryDto } from './package-response.dto';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** سطر مانده افتتاحیه برای ثبت در سند افتتاحیه کات‌اوور */
export class CutoverOpeningBalanceLineDto {
  @ApiProperty({ description: 'کد حساب کل/معین/تفصیلی', example: '1010' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  accountCode: string;

  @ApiPropertyOptional({ description: 'مبلغ بدهکار (ریال/واحد خرد)', example: 1000000 })
  @IsOptional()
  debit?: number | string | bigint;

  @ApiPropertyOptional({ description: 'مبلغ بستانکار (ریال/واحد خرد)', example: 0 })
  @IsOptional()
  credit?: number | string | bigint;

  @ApiPropertyOptional({ description: 'شرح سطر افتتاحیه', example: 'مانده افتتاحیه بانک ملی' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

/** درخواست بررسی پیش‌پرواز کات‌اوور و تطبیق‌های تراز */
export class CutoverPreflightRequestDto {
  @ApiProperty({
    description: 'تاریخ شروع دوره عملیاتی جدید (Go-Live Date)',
    example: '2026-03-21',
  })
  @Matches(DATE_REGEX, { message: 'cutoverDate must be in format YYYY-MM-DD' })
  cutoverDate: string;

  @ApiPropertyOptional({
    description: 'تاریخ پایان دوره قفل پیش از کات‌اوور (پیش‌فرض: یک روز قبل از کات‌اوور)',
    example: '2026-03-20',
  })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'preCutoverLockDate must be in format YYYY-MM-DD' })
  preCutoverLockDate?: string;

  @ApiPropertyOptional({
    description: 'ارقام کنترلی سرفصل‌ها جهت تطبیق با دفاتر کمکی (AR, AP, Stock, Bank)',
    type: TieOutControlTotalsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TieOutControlTotalsDto)
  controlTotals?: TieOutControlTotalsDto;

  @ApiPropertyOptional({
    description: 'سطرهای مانده افتتاحیه جهت تطبیق تراز کل',
    type: [CutoverOpeningBalanceLineDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CutoverOpeningBalanceLineDto)
  openingBalances?: CutoverOpeningBalanceLineDto[];
}

/** پاسخ پیش‌پرواز کات‌اوور و وضعیت سبز بودن تطبیق‌ها */
export class CutoverPreflightResponseDto {
  @ApiProperty({ description: 'آیا تمام تطبیق‌ها سبز هستند و اجازه Go-Live وجود دارد؟' })
  @IsBoolean()
  allGreen: boolean;

  @ApiProperty({ description: 'آیا شرایط ورود به عملیات زنده فراهم است؟' })
  @IsBoolean()
  canGoLive: boolean;

  @ApiProperty({
    description: 'گزارش تفصیلی موارد بررسی‌شده (TB, AR, AP, Stock, Bank)',
    type: [TieOutItemReportDto],
  })
  items: TieOutItemReportDto[];

  @ApiProperty({
    description: 'موارد دارای عدم تطبیق یا مغایرت',
    type: [TieOutItemReportDto],
  })
  discrepancies: TieOutItemReportDto[];

  @ApiProperty({ description: 'پیام‌های خطای مسدودکننده', type: [String] })
  blockersFa: string[];
}

/** درخواست اجرای نهایی کات‌اوور و ورود به عملیات زنده (Go-Live) */
export class CutoverGoLiveRequestDto {
  @ApiProperty({
    description: 'تاریخ شروع دوره عملیاتی جدید (Go-Live Date)',
    example: '2026-03-21',
  })
  @Matches(DATE_REGEX, { message: 'cutoverDate must be in format YYYY-MM-DD' })
  cutoverDate: string;

  @ApiPropertyOptional({
    description: 'تاریخ پایان دوره قفل پیش از کات‌اوور',
    example: '2026-03-20',
  })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'preCutoverLockDate must be in format YYYY-MM-DD' })
  preCutoverLockDate?: string;

  @ApiPropertyOptional({
    description: 'پیشوند شماره‌گذاری اسناد و صورتحساب‌های پیشین در سری موروثی (R32 D5)',
    default: 'LEGACY-',
    example: 'LEGACY-',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  legacyNumberPrefix?: string;

  @ApiPropertyOptional({
    description: 'ارقام کنترلی سرفصل‌ها جهت تطبیق نهایی',
    type: TieOutControlTotalsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TieOutControlTotalsDto)
  controlTotals?: TieOutControlTotalsDto;

  @ApiPropertyOptional({
    description: 'سطرهای سند افتتاحیه (در صورت ثبت هم‌زمان با کات‌اوور)',
    type: [CutoverOpeningBalanceLineDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CutoverOpeningBalanceLineDto)
  openingBalances?: CutoverOpeningBalanceLineDto[];
}

/** پاسخ اجرای موفقیت‌آمیز کات‌اوور */
export class CutoverGoLiveResponseDto {
  @ApiProperty({ description: 'وضعیت اجرای کات‌اوور', example: 'completed' })
  status: 'completed' | 'blocked';

  @ApiProperty({ description: 'آیا عملیات زنده فعال شد؟' })
  isGoLiveActive: boolean;

  @ApiProperty({ description: 'تاریخ اجرای کات‌اوور', example: '2026-03-21' })
  cutoverDate: string;

  @ApiProperty({ description: 'تاریخ پایان قفل پیش از کات‌اوور', example: '2026-03-20' })
  preCutoverLockDate: string;

  @ApiProperty({ description: 'شناسه قفل دوره حسابداری ایجادشده', example: 12 })
  periodLockId: number;

  @ApiPropertyOptional({ description: 'شناسه سند افتتاحیه ثبت‌شده', example: 105 })
  openingJournalEntryId?: number;

  @ApiProperty({ description: 'پیشوند سری اسناد قدیمی موروثی', example: 'LEGACY-' })
  legacyNumberPrefix: string;

  @ApiProperty({ description: 'خلاصه نتایج تطبیق‌های تراز', type: TieOutSummaryDto })
  tieOutSummary: TieOutSummaryDto;
}

/** درخواست تأیید و آزمایش قفل دوره پیش از کات‌اوور با تلاش ثبت سند */
export class VerifyCutoverLockDto {
  @ApiPropertyOptional({
    description: 'تاریخ آزمایشی برای تلاش ثبت سند (باید در دوره قفل باشد)',
    example: '2026-03-20',
  })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'attemptDate must be in format YYYY-MM-DD' })
  attemptDate?: string;
}

/** پاسخ آزمون راستی‌آزمایی قفل دوره */
export class VerifyCutoverLockResponseDto {
  @ApiProperty({ description: 'آیا قفل دوره با رد ثبت سند اثبات شد؟' })
  verified: boolean;

  @ApiProperty({ description: 'نوع خطای دریافتی جهت اعتبارسنجی', example: 'PeriodLockedException' })
  errorType: string;

  @ApiProperty({ description: 'پیام توضیح نتیجه آزمون' })
  message: string;
}

/** وضعیت فعلی کات‌اوور مستأجر */
export class CutoverStatusResponseDto {
  @ApiProperty({ description: 'آیا کات‌اوور قبلاً تکمیل و دوره عملیاتی فعال شده است؟' })
  isGoLiveActive: boolean;

  @ApiPropertyOptional({ description: 'تاریخ کات‌اوور فعال' })
  cutoverDate?: string;

  @ApiPropertyOptional({ description: 'تاریخ قفل فعال پیش از کات‌اوور' })
  preCutoverLockDate?: string;

  @ApiPropertyOptional({ description: 'شناسه قفل دوره فعال' })
  periodLockId?: number;

  @ApiPropertyOptional({ description: 'پیشوند سری اسناد موروثی' })
  legacyNumberPrefix?: string;
}
