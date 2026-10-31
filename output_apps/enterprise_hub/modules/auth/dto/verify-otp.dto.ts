import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { IR_MOBILE_REGEX } from '../constants/auth.constants';
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
    description: 'کد یک‌بارمصرف ۶ رقمی ارسال‌شده از طریق پیامک',
    example: '483217',
  })
  @Transform(({ value }) => String(value ?? '').trim())
  // 5 or 6 digits for one release so cached clients keep working; codes issued are 6.
  @Matches(/^\d{5,6}$/, {
    message: 'کد تأیید باید ۵ یا ۶ رقم باشد.',
  })
  code: string;

  @ApiPropertyOptional({
    description: 'دامنه سرویس (در صورت نبود، از Host استنتاج می‌شود)',
    enum: AuthServiceDomain,
  })
  @IsOptional()
  @IsEnum(AuthServiceDomain)
  serviceDomain?: AuthServiceDomain;

  @ApiPropertyOptional({
    description:
      'نام سازمان برای ثبت‌اولیه. فقط زمانی اعمال می‌شود که کاربر هنوز به هیچ سازمانی متصل نباشد.',
    example: 'شرکت توسعه فناوری پارس',
    minLength: 2,
    maxLength: 150,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @Length(2, 150)
  organizationName?: string;

  @ApiPropertyOptional({
    description: 'Invitation token: joins that organisation instead of creating one. No organisation name needed.',
  })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  inviteToken?: string;
}
