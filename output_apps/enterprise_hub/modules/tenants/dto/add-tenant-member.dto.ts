import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, Matches } from 'class-validator';
import { IR_MOBILE_REGEX } from '../../auth/constants/auth.constants';
import { normalizeIranianMobile } from '../../auth/utils/phone.util';
import { TenantRole } from '../enums/tenant-role.enum';

/**
 * DTO افزودن عضو به سازمان (POST /tenants/members).
 * شماره همراه پیش از اعتبارسنجی نرمال‌سازی می‌شود (ارقام فارسی/عربی و پیشوند +98).
 */
export class AddTenantMemberDto {
  @ApiProperty({
    description: 'شماره همراه ایران (۱۱ رقم، با فرمت 09xxxxxxxxx)',
    example: '09121234567',
  })
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone: string;

  @ApiProperty({ enum: TenantRole, example: TenantRole.MEMBER })
  @IsEnum(TenantRole, { message: 'نقش سازمانی باید MEMBER یا OWNER باشد.' })
  tenantRole: TenantRole;
}
