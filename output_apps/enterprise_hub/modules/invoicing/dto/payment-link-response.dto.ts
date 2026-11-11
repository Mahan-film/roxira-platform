import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

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

export class PaymentCallbackQueryDto {
  trackId: string;
  status?: string;
  success?: string;
  tenantId?: string;
}

export class PaymentCallbackResultDto {
  success: boolean;
  paid: boolean;
  invoiceId?: string;
  refNumber?: string;
  message: string;
}
