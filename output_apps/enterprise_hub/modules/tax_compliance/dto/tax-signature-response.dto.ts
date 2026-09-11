import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxSubmissionStatus } from '../enums/tax-compliance.enum';

/**
 * DTO خروجی خلاصه یک بسته امضاشده مالیاتی.
 */
export class TaxSignatureResponseDto {
  @ApiProperty({ description: 'شناسه یکتای رکورد امضا (UUID)' })
  id: string;

  @ApiProperty({ description: 'شناسه صورتحساب مرتبط (UUID)' })
  invoiceId: string;

  @ApiProperty({ description: 'شماره صورتحساب مالیاتی' })
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'شناسه یکتای مالیاتی ۲۲ رقمی (TaxID)' })
  taxId: string;

  @ApiProperty({ description: 'الگوریتم هش داده' })
  hashAlgorithm: string;

  @ApiProperty({ description: 'هش داده صورتحساب' })
  dataHash: string;

  @ApiProperty({ description: 'الگوریتم امضای دیجیتال' })
  signatureAlgorithm: string;

  @ApiProperty({ description: 'امضای دیجیتال JWS (Compact)' })
  jwsSignature: string;

  @ApiProperty({ description: 'شناسه کلید امضای مالیاتی' })
  keyId: string;

  @ApiProperty({ description: 'اثر انگشت کلید عمومی' })
  keyFingerprint: string;

  @ApiProperty({ enum: TaxSubmissionStatus, description: 'وضعیت ارسال مالیاتی' })
  status: TaxSubmissionStatus;

  @ApiPropertyOptional({ description: 'شماره مرجع پذیرش سامانه مودیان' })
  referenceNumber: string | null;

  @ApiPropertyOptional({ description: 'پیام خطا در صورت رد شدن بسته' })
  errorMessage: string | null;

  @ApiProperty({ description: 'محتوای QR راستی‌آزمایی سامانه مودیان' })
  qrCodePayload: string;

  @ApiProperty({ description: 'زمان امضا' })
  createdAt: Date;

  @ApiProperty({ description: 'آخرین بروزرسانی وضعیت' })
  updatedAt: Date;
}

/**
 * DTO خروجی کامل بسته امضاشده شامل بسته ارسالی به سامانه مودیان.
 */
export class TaxSignatureDetailResponseDto extends TaxSignatureResponseDto {
  @ApiProperty({
    description: 'بسته کامل JSON امضاشده که به سامانه مودیان ارسال می‌شود',
    type: Object,
  })
  signedPacket: Record<string, unknown>;
}

/**
 * DTO خروجی صفحه‌بندی‌شده فهرست بسته‌های امضاشده.
 */
export class PaginatedTaxSignaturesResponseDto {
  @ApiProperty({ type: [TaxSignatureResponseDto] })
  data: TaxSignatureResponseDto[];

  @ApiProperty({ description: 'تعداد کل رکوردها' })
  total: number;

  @ApiProperty({ description: 'شماره صفحه جاری' })
  page: number;

  @ApiProperty({ description: 'اندازه صفحه' })
  limit: number;
}
