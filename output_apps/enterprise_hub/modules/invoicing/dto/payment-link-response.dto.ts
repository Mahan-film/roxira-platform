import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePaymentLinkDto {
  @ApiPropertyOptional({
    description: 'شماره همراه خریدار جهت هدایت مستقیم در درگاه',
    example: '09121234567',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16)
  mobile?: string;

  @ApiPropertyOptional({
    description: 'توضیحات اختیاری تراکنش پرداخت',
    example: 'پرداخت آنلاین فاکتور فروش',
  })
  @IsString()
  @IsOptional()
  @MaxLength(256)
  description?: string;
}

export class PaymentLinkResponseDto {
  paymentLinkId: string;
  invoiceId: string;
  trackId: string;
  paymentUrl: string;
  amount: string;
  status: string;
  createdAt: Date;
}

/**
 * Zibal IPG callback parameters documented at https://help.zibal.ir/IPG/API/#callbackurl
 * - Standard GET redirect sends: `trackId`, `success`, `status`, `orderId`.
 * - Lazy/webhook POST notifications may additionally carry `refNumber`, `cardNumber`,
 *   `hashedCardNumber`, `paidAt`, `amount`, `description`, `result`, `message`.
 * Unknown fields (such as spoofed `tenantId`) remain rejected by global `forbidNonWhitelisted`.
 */
export class PaymentCallbackQueryDto {
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value).trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  trackId: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(32)
  success?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(128)
  orderId?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(32)
  amount?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(128)
  refNumber?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(64)
  cardNumber?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(128)
  hashedCardNumber?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(64)
  paidAt?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(32)
  result?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @MaxLength(256)
  message?: string;
}

export class PaymentCallbackResultDto {
  success: boolean;
  paid: boolean;
  message: string;
}
