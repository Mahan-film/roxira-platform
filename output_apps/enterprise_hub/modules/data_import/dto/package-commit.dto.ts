import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
}

/** بدنهٔ درخواست ثبت نهایی بسته. */
export class PackageCommitDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageCommitTableDto)
  tables: PackageCommitTableDto[];
}
