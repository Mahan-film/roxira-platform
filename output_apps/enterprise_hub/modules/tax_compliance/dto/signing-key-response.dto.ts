import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO خروجی اطلاعات عمومی کلید امضای مالیاتی.
 * کلید خصوصی به دلایل امنیتی هرگز در پاسخ بازگردانده نمی‌شود.
 */
export class SigningKeyResponseDto {
  @ApiProperty({ description: 'شناسه یکتای کلید امضا' })
  keyId: string;

  @ApiProperty({ description: 'اثر انگشت SHA-256 کلید عمومی' })
  keyFingerprint: string;

  @ApiProperty({ description: 'الگوریتم امضا' })
  algorithm: string;

  @ApiProperty({ description: 'طول کلید RSA (بیت)' })
  modulusLength: number;

  @ApiProperty({ description: 'کلید عمومی در قالب PEM (SPKI)' })
  publicKeyPem: string;

  @ApiPropertyOptional({ description: 'درخواست امضای گواهی (CSR) در قالب PEM' })
  certificateRequestPem: string | null;

  @ApiProperty({ description: 'آیا کلید فعال سازمان است' })
  isActive: boolean;

  @ApiProperty({ description: 'زمان تولید کلید' })
  createdAt: Date;
}
