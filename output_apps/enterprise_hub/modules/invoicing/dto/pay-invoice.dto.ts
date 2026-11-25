import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * ورودی اختیاری ثبت پرداخت صورتحساب (PATCH invoicing/:id/pay).
 * در صورت ارسال `fundAccountCode`، تسویه به همان حساب صندوق/بانک (دارایی) ثبت می‌شود؛
 * در غیر این صورت نگاشت پیش‌فرض قواعد ثبت (یا تطابق نام) به‌کار می‌رود.
 */
export class PayInvoiceDto {
  @ApiPropertyOptional({
    description:
      'کد حساب صندوق یا بانک (از نوع دارایی) برای ثبت سند تسویه صورتحساب.',
    example: '1102',
    maxLength: 64,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'کد حساب صندوق/بانک باید رشته باشد.' })
  @MinLength(1, { message: 'کد حساب صندوق/بانک نباید خالی باشد.' })
  @MaxLength(64, { message: 'کد حساب صندوق/بانک بیش از حد مجاز طولانی است.' })
  fundAccountCode?: string;
}
