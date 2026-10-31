import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ENTITY_KEY_PATTERN } from './entity-key.pipe';

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
}
