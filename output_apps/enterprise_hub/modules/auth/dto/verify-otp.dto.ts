import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { IR_MOBILE_REGEX, OTP_CODE_LENGTH } from '../constants/auth.constants';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { normalizeIranianMobile } from '../utils/phone.util';

/**
 * DTO درخواست تأیید کد یک‌بارمصرف و صدور توکن JWT.
 */
export class VerifyOtpDto {
  @ApiProperty({
    description: 'شماره همراه ایران (۱۱ رقم، با فرمت 09xxxxxxxxx)',
    example: '09121234567',
  })
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone: string;

  @ApiProperty({
    description: 'کد یک‌بارمصرف ۵ رقمی ارسال‌شده از طریق پیامک',
    example: '48321',
  })
  @Transform(({ value }) => String(value ?? '').trim())
  @Matches(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`), {
    message: `کد تأیید باید ${OTP_CODE_LENGTH} رقم باشد.`,
  })
  code: string;

  @ApiPropertyOptional({
    description: 'دامنه سرویس (در صورت نبود، از Host استنتاج می‌شود)',
    enum: AuthServiceDomain,
  })
  @IsOptional()
  @IsEnum(AuthServiceDomain)
  serviceDomain?: AuthServiceDomain;
}
