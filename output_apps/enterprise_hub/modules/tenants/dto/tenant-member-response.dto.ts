import { ApiProperty } from '@nestjs/swagger';
import { UserEntity } from '../../auth/entities/user.entity';
import { TenantRole } from '../enums/tenant-role.enum';

/**
 * پوشاندن ارقام میانی شماره همراه برای نمایش عمومی فهرست اعضا.
 * نمونه: `09129367796` → `0912***7796`
 */
export function maskTenantMemberPhone(phone: string): string {
  const value = String(phone ?? '');
  if (value.length < 8) {
    return value;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/**
 * پاسخ عضو سازمان. شماره همراه همیشه پوشانده می‌شود تا داده حساس افشا نشود.
 */
export class TenantMemberResponseDto {
  @ApiProperty({ example: '0b0f6a24-6d5f-4f5b-9f8e-2e5a3c1d7b90' })
  id: string;

  @ApiProperty({ example: '0912***7796' })
  phone: string;

  @ApiProperty({
    enum: TenantRole,
    nullable: true,
    example: TenantRole.MEMBER,
  })
  tenantRole: TenantRole | null;

  @ApiProperty({ example: '2026-09-10T12:00:00.000Z' })
  createdAt: Date;

  static fromEntity(user: UserEntity): TenantMemberResponseDto {
    return {
      id: user.id,
      phone: maskTenantMemberPhone(user.phone),
      tenantRole: user.tenantRole,
      createdAt: user.createdAt,
    };
  }
}
