import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** یک جدول انتخاب‌شده برای commit بستهٔ دیتابیس. */
export class PackageCommitTableDto {
  @IsString()
  name: string;

  // A skipped table may arrive without an entity (null or ""); only imported tables need one.
  @ValidateIf((table: PackageCommitTableDto) => !table.skip)
  @IsString()
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
