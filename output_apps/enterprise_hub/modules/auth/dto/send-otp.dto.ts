import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { IR_MOBILE_REGEX } from '../constants/auth.constants';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { normalizeIranianMobile } from '../utils/phone.util';

/**
 * DTO درخواست ارسال کد یک‌بارمصرف پیامکی.
 * شماره همراه صرفاً با فرمت رسمی ایران (09xxxxxxxxx) پذیرفته می‌شود
 * (Rule #2 - AGENTS.md: Strict DTO Validation).
 */
export class SendOtpDto {
  @ApiProperty({
    description: 'شماره همراه ایران (۱۱ رقم، با فرمت 09xxxxxxxxx)',
    example: '09121234567',
  })
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone: string;

  @ApiPropertyOptional({
    description:
      'دامنه سرویس برای انتخاب قالب کاوه‌نگار (GHAZI → ghazi-verify | ROXIRA → roxira-verify)',
    enum: AuthServiceDomain,
    example: AuthServiceDomain.ROXIRA,
  })
  @IsOptional()
  @IsEnum(AuthServiceDomain)
  serviceDomain?: AuthServiceDomain;
}
