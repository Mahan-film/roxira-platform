import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { HASH_ALGORITHM } from '../constants/tax-compliance.constants';

/**
 * DTO ورودی امضای الکترونیک یک صورتحساب
 * (POST /enterprise-hub/tax-compliance/sign-invoice).
 *
 * تنها `invoiceId` الزامی است؛ الگوریتم هش به‌صورت پیش‌فرض `sha256` است و
 * کلید خصوصی در صورت عدم ارسال از کلید فعال سازمان استفاده می‌شود.
 */
export class SignInvoiceDto {
  @ApiProperty({
    description: 'شناسه یکتای صورتحساب صادرشده (UUID)',
    example: '7ae60f63-48b5-4b4a-b668-4dca7cbf1fb6',
  })
  @IsUUID('4')
  invoiceId: string;

  @ApiPropertyOptional({
    description: 'الگوریتم هش داده صورتحساب',
    enum: [HASH_ALGORITHM],
    default: HASH_ALGORITHM,
  })
  @IsOptional()
  @IsIn([HASH_ALGORITHM])
  hashAlgorithm?: string;

  @ApiPropertyOptional({
    description:
      'کلید خصوصی PEM (PKCS#8) برای امضای موردی؛ در صورت عدم ارسال از کلید فعال مالیاتی سازمان استفاده می‌شود.',
  })
  @IsOptional()
  @IsString()
  @Matches(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, {
    message: 'کلید خصوصی باید در قالب PEM معتبر باشد.',
  })
  privateKeyPem?: string;
}
