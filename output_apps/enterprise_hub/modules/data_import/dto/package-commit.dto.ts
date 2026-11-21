import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isSupportedCurrency } from '../../country_packs/currency-exponents';
import { ENTITY_KEY_PATTERN } from './entity-key.pipe';
import { TieOutCategory } from '../analysis/effective-tie-out-config.registry';

const CONTROL_AMOUNT_PATTERN = /^\s*-?\d{1,16}(?:\.\d{1,3})?\s*$/;
const CONTROL_AMOUNT_MESSAGE = 'مبلغ کنترل باید یک عدد اعشاری معتبر (حداکثر ۳ رقم اعشار) باشد.';
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const preserveRawBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown => obj?.[key];

@ValidatorConstraint({ name: 'isIsoCalendarDate', async: false })
class IsIsoCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const match = ISO_DATE_PATTERN.exec(value);
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

  defaultMessage(): string {
    return 'تاریخ asOfDate باید یک تاریخ میلادی معتبر در قالب YYYY-MM-DD باشد.';
  }
}

@ValidatorConstraint({ name: 'isSupportedIsoCurrency', async: false })
class IsSupportedIsoCurrencyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isSupportedCurrency(value);
  }

  defaultMessage(): string {
    return 'کد ارز پشتیبانی نمی‌شود؛ از کدهای استاندارد ISO 4217 استفاده کنید.';
  }
}

/** یک جدول انتخاب‌شده برای commit بستهٔ دیتابیس. */
export class PackageCommitTableDto {
  @IsString()
  name: string;

  // A skipped table may arrive without an entity (null or ""); only imported tables need one.
  @ValidateIf((table: PackageCommitTableDto) => !table.skip)
  @IsString()
  @Matches(ENTITY_KEY_PATTERN, { message: 'کلید موجودیت نامعتبر است.' })
  entity: string;

  @IsObject()
  mapping: Record<string, string | null>;

  @IsOptional()
  @Transform(preserveRawBoolean)
  @IsBoolean()
  skip?: boolean;

  /** ضریب تبدیل مبلغ‌های بدون واحد به ریال: ۱ ریال، ۱۰ تومان، ۱۰۰۰ هزار ریال، … */
  @IsOptional()
  @IsNumber()
  @IsIn([1, 10, 1000, 10000, 1000000, 10000000])
  moneyToRial?: number;
}

/** مبالغ کنترل معین افتتاحیه جهت تطابق در موتور مغایرت‌گیری. */
export class TieOutControlTotalsDto {
  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  trialBalance?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  accountsReceivable?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  accountsPayable?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  inventoryStock?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  bankBalance?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  TRIAL_BALANCE?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  ACCOUNTS_RECEIVABLE?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  ACCOUNTS_PAYABLE?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  INVENTORY_STOCK?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTROL_AMOUNT_PATTERN, { message: CONTROL_AMOUNT_MESSAGE })
  BANK_BALANCE?: string;
}

export function mapControlTotalsDtoToRecord(
  dto?: TieOutControlTotalsDto,
): Partial<Record<TieOutCategory, string | number | bigint>> | undefined {
  if (!dto) {
    return undefined;
  }
  const res: Partial<Record<TieOutCategory, string | number | bigint>> = {};
  if (dto.trialBalance !== undefined) res.TRIAL_BALANCE = dto.trialBalance;
  if (dto.TRIAL_BALANCE !== undefined) res.TRIAL_BALANCE = dto.TRIAL_BALANCE;
  if (dto.accountsReceivable !== undefined) res.ACCOUNTS_RECEIVABLE = dto.accountsReceivable;
  if (dto.ACCOUNTS_RECEIVABLE !== undefined) res.ACCOUNTS_RECEIVABLE = dto.ACCOUNTS_RECEIVABLE;
  if (dto.accountsPayable !== undefined) res.ACCOUNTS_PAYABLE = dto.accountsPayable;
  if (dto.ACCOUNTS_PAYABLE !== undefined) res.ACCOUNTS_PAYABLE = dto.ACCOUNTS_PAYABLE;
  if (dto.inventoryStock !== undefined) res.INVENTORY_STOCK = dto.inventoryStock;
  if (dto.INVENTORY_STOCK !== undefined) res.INVENTORY_STOCK = dto.INVENTORY_STOCK;
  if (dto.bankBalance !== undefined) res.BANK_BALANCE = dto.bankBalance;
  if (dto.BANK_BALANCE !== undefined) res.BANK_BALANCE = dto.BANK_BALANCE;
  return res;
}

/** بدنهٔ درخواست ثبت نهایی بسته. */
export class PackageCommitDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageCommitTableDto)
  tables: PackageCommitTableDto[];

  /**
   * تأیید ثبت با وجود عدم‌تراز در مغایرت‌گیری. فقط وقتی اثر دارد که فراخواننده مدیر پلتفرم یا
   * مالک سازمان باشد؛ سرور خودش تراز را دوباره می‌سنجد و به ادعای کلاینت اعتماد نمی‌کند.
   */
  @IsOptional()
  @Transform(preserveRawBoolean)
  @IsBoolean()
  confirmImbalance?: boolean;

  /** مبالغ کنترل افتتاحیه جهت بررسی و جلوگیری از ورود داده‌های نامتوازن. */
  @IsOptional()
  @ValidateNested()
  @Type(() => TieOutControlTotalsDto)
  controlTotals?: TieOutControlTotalsDto;

  /** تاریخ اثربخشی کنترل‌های افتتاحیه (ISO 'YYYY-MM-DD'). */
  @IsOptional()
  @IsString()
  @Validate(IsIsoCalendarDateConstraint)
  asOfDate?: string;

  /** ارز پایه کنترل‌ها (پیش‌فرض IRR). */
  @IsOptional()
  @IsString()
  @Validate(IsSupportedIsoCurrencyConstraint)
  currency?: string;
}

/** شمارهٔ صفحهٔ سندهای پیشنهادی در بازبینی. */
export class PackageReviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
}
