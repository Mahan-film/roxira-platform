import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsMoneyAmount } from '../../accounting/dto/money.validator';
import { MAX_DUE_WINDOW_DAYS } from '../constants/cheque.constants';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';

const toLatinDigits = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .trim()
    : value;

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class CreateChequeDto {
  @ApiProperty({ enum: ChequeDirection })
  @IsEnum(ChequeDirection)
  direction: ChequeDirection;

  @ApiPropertyOptional({ description: 'شناسه صیاد (۱۶ رقم). ثبت دستی است؛ اتصال زنده به سامانه صیاد وجود ندارد.', example: '1234567890123456' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(toLatinDigits)
  @Matches(/^[0-9]{16}$/, { message: 'شناسه صیاد باید ۱۶ رقم باشد.' })
  sayadNumber?: string;

  @ApiPropertyOptional({ description: 'کاربر اعلام می‌کند چک در سامانه صیاد ثبت/تأیید شده است (تأیید خودکار نیست).' })
  @IsOptional()
  @IsBoolean()
  sayadVerified?: boolean;

  @ApiProperty({ description: 'شماره سری/سریال چک', example: '123456' })
  @Transform(toLatinDigits)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  chequeNumber: string;

  @ApiPropertyOptional({ description: 'نام بانک' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankName?: string;

  @ApiProperty({ description: 'مبلغ (ریال)؛ عدد یا رشته اعشاری دقیق برای مبالغ بزرگ', example: '50000000.00', oneOf: [{ type: 'number' }, { type: 'string' }] })
  @IsMoneyAmount()
  amount: number | string;

  @ApiProperty({ description: 'تاریخ صدور (میلادی ISO؛ رابط کاربری تاریخ شمسی را تبدیل می‌کند)', example: '2026-10-31' })
  @IsISO8601({ strict: true })
  issueDate: string;

  @ApiProperty({ description: 'تاریخ سررسید (میلادی ISO)', example: '2026-12-21' })
  @IsISO8601({ strict: true })
  dueDate: string;

  @ApiProperty({ description: 'صادرکننده (چک دریافتی) یا ذی‌نفع (چک صادرشده)' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  partyName: string;

  @ApiPropertyOptional({ description: 'کد طرف حساب/تفضیلی' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

export class TransitionChequeDto {
  @ApiProperty({ enum: ChequeStatus, description: 'وضعیت مقصد' })
  @IsEnum(ChequeStatus)
  status: ChequeStatus;

  @ApiPropertyOptional({ description: 'تاریخ رویداد (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  eventDate?: string;

  @ApiPropertyOptional({ description: 'نام شخص ثالث؛ برای خرج چک الزامی است' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  spentToName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;
}

export class QueryChequesDto {
  @ApiPropertyOptional({ enum: ChequeDirection })
  @IsOptional()
  @IsEnum(ChequeDirection)
  direction?: ChequeDirection;

  @ApiPropertyOptional({ enum: ChequeStatus })
  @IsOptional()
  @IsEnum(ChequeStatus)
  status?: ChequeStatus;

  @ApiPropertyOptional({ description: 'سررسید از (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'سررسید تا (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueTo?: string;
}

export class QueryDueChequesDto {
  @ApiPropertyOptional({ description: 'تعداد روز پیش‌رو (پیش‌فرض ۳۰)', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DUE_WINDOW_DAYS)
  days?: number;

  @ApiPropertyOptional({ description: 'مبنای محاسبه (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;
}

export class ChequeResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ChequeDirection }) direction: ChequeDirection;
  @ApiProperty({ nullable: true }) sayadNumber: string | null;
  @ApiProperty() sayadVerified: boolean;
  @ApiProperty() chequeNumber: string;
  @ApiProperty({ nullable: true }) bankName: string | null;
  @ApiProperty({ description: 'عدد یا رشته اعشاری دقیق', oneOf: [{ type: 'number' }, { type: 'string' }] }) amount: number | string;
  @ApiProperty() issueDate: string;
  @ApiProperty() dueDate: string;
  @ApiProperty() partyName: string;
  @ApiProperty({ nullable: true }) partyCode: string | null;
  @ApiProperty({ nullable: true }) spentToName: string | null;
  @ApiProperty({ enum: ChequeStatus }) status: ChequeStatus;
  @ApiProperty({ type: [String], description: 'وضعیت‌های مجاز بعدی' }) allowedNext: ChequeStatus[];
  @ApiProperty({ nullable: true }) description: string | null;
}

export class ChequeEventResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ChequeStatus, nullable: true }) fromStatus: ChequeStatus | null;
  @ApiProperty({ enum: ChequeStatus }) toStatus: ChequeStatus;
  @ApiProperty() eventDate: string;
  @ApiProperty({ nullable: true }) journalEntryId: number | null;
  @ApiProperty({ nullable: true }) note: string | null;
}

export class ChequeDetailResponseDto extends ChequeResponseDto {
  @ApiProperty({ type: [ChequeEventResponseDto] }) events: ChequeEventResponseDto[];
}

export class DueChequeDto extends ChequeResponseDto {
  @ApiProperty({ description: 'روز تا سررسید؛ منفی یعنی معوق' }) daysUntilDue: number;
  @ApiProperty() overdue: boolean;
}

export class DueChequesResponseDto {
  @ApiProperty() asOf: string;
  @ApiProperty() until: string;
  @ApiProperty({ type: [DueChequeDto] }) items: DueChequeDto[];
  @ApiProperty({ description: 'جمع چک‌های دریافتی در بازه (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) receivedTotal: number | string;
  @ApiProperty({ description: 'جمع چک‌های صادرشده در بازه (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) issuedTotal: number | string;
}
