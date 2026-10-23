import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/** مقادیر مجاز نگاشت: شناسه فیلد (رشته) یا null برای ستون بی‌تطبیق. */
function isValidEntityFieldMapping(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (field) => field === null || typeof field === 'string',
  );
}

export function IsEntityFieldMapping(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isEntityFieldMapping',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown): boolean =>
          isValidEntityFieldMapping(value),
        defaultMessage: (): string =>
          'نگاشت ستون‌ها باید مقادیر رشته‌ای یا null داشته باشد.',
      },
    });
  };
}

/** فیلد اختیاری `entity` برای بارگذاری چندبخشی پیش‌نمایش عمومی. */
export class PreviewRequestDto {
  @ApiPropertyOptional({ description: 'کلید موجودیت (اختیاری، برای اجبار)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entity?: string;
}

/**
 * ورودی تأیید و ورود نهایی برای یک موجودیت
 * (POST /enterprise-hub/data-import/commit).
 */
export class EntityCommitDto {
  @ApiProperty({ description: 'شناسه بارگذاری بازگشتی از preview' })
  @IsUUID('4', { message: 'شناسه بارگذاری نامعتبر است.' })
  uploadId: string;

  @ApiProperty({ description: 'کلید موجودیت مقصد', example: 'hr-employees' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  entity: string;

  @ApiProperty({
    description: 'نگاشت نهایی ستون‌ها به فیلدهای موجودیت',
    type: Object,
    example: { 'کد ملی': 'nationalId', نام: 'firstName' },
  })
  @IsObject({ message: 'نگاشت ستون‌ها باید یک شیء باشد.' })
  @IsEntityFieldMapping()
  mapping: Record<string, string | null>;

  @ApiPropertyOptional({
    description: 'حساب بانکی مقصد (فقط برای موجودیت bank-statement)',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'شناسه حساب بانکی نامعتبر است.' })
  @Min(1)
  bankAccountId?: number;
}
