import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isSupportedCurrency } from '../../country_packs/currency-exponents';
import { TieOutControlTotalsDto } from './package-commit.dto';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NON_NEGATIVE_AMOUNT_RE = /^\s*\d{1,16}(?:\.\d{1,3})?\s*$/;

export function isValidCalendarIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

@ValidatorConstraint({ name: 'cutoverCalendarIsoDate', async: false })
class CutoverCalendarIsoDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidCalendarIsoDate(value);
  }
  defaultMessage(): string {
    return 'تاریخ باید یک تاریخ میلادی معتبر در قالب YYYY-MM-DD باشد.';
  }
}

@ValidatorConstraint({ name: 'cutoverSupportedCurrency', async: false })
class CutoverSupportedCurrencyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isSupportedCurrency(value);
  }
  defaultMessage(): string {
    return 'کد ارز پشتیبانی نمی‌شود؛ از کدهای ISO 4217 استفاده کنید.';
  }
}

@ValidatorConstraint({ name: 'cutoverNonNegativeAmount', async: false })
class CutoverNonNegativeAmountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0;
    }
    if (typeof value === 'string') {
      return NON_NEGATIVE_AMOUNT_RE.test(value);
    }
    return false;
  }
  defaultMessage(): string {
    return 'مبلغ بدهکار/بستانکار باید عدد یا رشته اعشاری نامنفی معتبر باشد.';
  }
}

export class CutoverOpeningLineDto {
  @ApiProperty({ example: '1010' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountCode: string;

  @ApiPropertyOptional({ example: 'صندوق' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ example: '1000000' })
  @IsOptional()
  @Validate(CutoverNonNegativeAmountConstraint)
  debit?: string | number;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @Validate(CutoverNonNegativeAmountConstraint)
  credit?: string | number;
}

export class CutoverPreflightRequestDto {
  @ApiProperty({ example: '2026-03-21' })
  @IsString()
  @Validate(CutoverCalendarIsoDateConstraint)
  cutoverDate: string;

  @ApiPropertyOptional({ example: 'IRR', default: 'IRR' })
  @IsOptional()
  @IsString()
  @Validate(CutoverSupportedCurrencyConstraint)
  currency?: string;

  @ApiProperty({ type: [CutoverOpeningLineDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CutoverOpeningLineDto)
  openingBalances: CutoverOpeningLineDto[];

  @ApiPropertyOptional({ type: TieOutControlTotalsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TieOutControlTotalsDto)
  controlTotals?: TieOutControlTotalsDto;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsObject({ each: true })
  salesInvoices?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsObject({ each: true })
  purchaseInvoices?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsObject({ each: true })
  inventoryItems?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsObject({ each: true })
  bankStatements?: Array<Record<string, unknown>>;
}

export class CutoverGoLiveRequestDto extends CutoverPreflightRequestDto {
  @ApiPropertyOptional({ example: '2026-03-20' })
  @IsOptional()
  @IsString()
  @Validate(CutoverCalendarIsoDateConstraint)
  preCutoverLockDate?: string;

  @ApiPropertyOptional({ example: 'LEGACY-', default: 'LEGACY-' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/, {
    message: 'پیشوند سری موروثی فقط می‌تواند شامل حروف انگلیسی، رقم، خط تیره و زیرخط باشد.',
  })
  legacyNumberPrefix?: string;

  @ApiPropertyOptional({ example: 'سند افتتاحیه انتقال به روکسیرا' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class VerifyCutoverLockDto {
  @ApiProperty({ example: '2026-03-20' })
  @IsString()
  @Validate(CutoverCalendarIsoDateConstraint)
  testDate: string;
}

export class CutoverPreflightResponseDto {
  passed: boolean;
  cutoverDate: string;
  currency: string;
  checksRun: number;
  blockersFa: string[];
  tieOut: unknown;
}

export class CutoverGoLiveResponseDto {
  cutoverId: string;
  cutoverDate: string;
  preCutoverLockDate: string;
  openingJournalEntryId: number;
  openingEntryNumber: string;
  periodLockId: number;
  legacyNumberPrefix: string;
  executedBy: string;
}

export class VerifyCutoverLockResponseDto {
  locked: boolean;
  dryCheck: true;
  testDate: string;
  activeCutoverId: string | null;
  preCutoverLockDate: string | null;
  periodLockId: number | null;
}

export class CutoverStatusResponseDto {
  active: boolean;
  cutoverId: string | null;
  cutoverDate: string | null;
  preCutoverLockDate: string | null;
  openingJournalEntryId: number | null;
  periodLockId: number | null;
  legacyNumberPrefix: string | null;
  executedBy: string | null;
}
