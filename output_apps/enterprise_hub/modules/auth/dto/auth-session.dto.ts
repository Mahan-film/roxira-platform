import { ApiProperty } from '@nestjs/swagger';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { UserRole } from '../enums/user-role.enum';
import { UserEntity } from '../entities/user.entity';

/**
 * نمایش عمومی اطلاعات کاربر (بدون هیچ داده حساس) — بخشی از سشن کاربری.
 */
export class AuthUserDto {
  @ApiProperty({ example: '0b0f6a24-6d5f-4f5b-9f8e-2e5a3c1d7b90' })
  id: string;

  @ApiProperty({ example: '09121234567' })
  phone: string;

  @ApiProperty({ example: 'کاربر روکسیرا', nullable: true })
  displayName: string | null;

  @ApiProperty({ example: 'user@roxira.ir', nullable: true })
  email: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;

  @ApiProperty({ enum: AuthServiceDomain, example: AuthServiceDomain.ROXIRA })
  serviceDomain: AuthServiceDomain;

  @ApiProperty({ example: '2026-09-10T12:00:00.000Z' })
  createdAt: Date;

  static fromEntity(entity: UserEntity): AuthUserDto {
    return {
      id: entity.id,
      phone: entity.phone,
      displayName: entity.displayName,
      email: entity.email,
      role: entity.role,
      serviceDomain: entity.serviceDomain,
      createdAt: entity.createdAt,
    };
  }
}

/**
 * پاسخ نهایی تأیید کد یک‌بارمصرف: توکن JWT امضاشده + سشن کاربری.
 */
export class AuthSessionDto {
  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({
    description: 'توکن دسترسی امضاشده JWT',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ description: 'مدت اعتبار توکن بر حسب ثانیه', example: 604800 })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

/**
 * پاسخ ارسال کد یک‌بارمصرف.
 */
export class SendOtpResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 120, description: 'مدت اعتبار کد بر حسب ثانیه' })
  expiresIn: number;

  @ApiProperty({ enum: AuthServiceDomain })
  serviceDomain: AuthServiceDomain;

  @ApiProperty({
    description: 'آیا ارسال پیامک از سوی کاوه‌نگار با موفقیت انجام شد',
    example: true,
  })
  smsDelivered: boolean;

  @ApiProperty({ example: 'roxira-verify' })
  template: string;
}
