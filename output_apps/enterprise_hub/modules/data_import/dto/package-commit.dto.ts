import { Type } from 'class-transformer';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ENTITY_KEY_PATTERN } from './entity-key.pipe';
import { TieOutCategory } from '../analysis/effective-tie-out-config.registry';

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
  trialBalance?: string;

  @IsOptional()
  @IsString()
  accountsReceivable?: string;

  @IsOptional()
  @IsString()
  accountsPayable?: string;

  @IsOptional()
  @IsString()
  inventoryStock?: string;

  @IsOptional()
  @IsString()
  bankBalance?: string;

  @IsOptional()
  @IsString()
  TRIAL_BALANCE?: string;

  @IsOptional()
  @IsString()
  ACCOUNTS_RECEIVABLE?: string;

  @IsOptional()
  @IsString()
  ACCOUNTS_PAYABLE?: string;

  @IsOptional()
  @IsString()
  INVENTORY_STOCK?: string;

  @IsOptional()
  @IsString()
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
  asOfDate?: string;

  /** ارز پایه کنترل‌ها (پیش‌فرض IRR). */
  @IsOptional()
  @IsString()
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
