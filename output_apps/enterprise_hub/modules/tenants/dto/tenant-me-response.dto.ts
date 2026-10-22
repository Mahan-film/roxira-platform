import { ApiProperty } from '@nestjs/swagger';
import { TenantEntity } from '../entities/tenant.entity';
import { TenantRole } from '../enums/tenant-role.enum';

/**
 * پاسخ سازمان جاری کاربر (GET /tenants/me).
 * شناسه و اسلاگ سازمان از رکورد `tenants` و نقش از claim تأییدشده JWT می‌آید.
 */
export class TenantMeResponseDto {
  @ApiProperty({ example: '0b0f6a24-6d5f-4f5b-9f8e-2e5a3c1d7b90' })
  id: string;

  @ApiProperty({ example: 'شرکت توسعه فناوری پارس' })
  name: string;

  @ApiProperty({ example: 'pars-a1b2c3' })
  slug: string;

  @ApiProperty({
    enum: TenantRole,
    nullable: true,
    example: TenantRole.OWNER,
  })
  tenantRole: TenantRole | null;

  @ApiProperty({ description: 'نرخ پیش‌فرض VAT سازمان (نسبت)', example: 0.1 })
  defaultVatRate: number;

  static fromEntity(
    tenant: TenantEntity,
    tenantRole: TenantRole | null,
  ): TenantMeResponseDto {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      tenantRole,
      defaultVatRate: Number(tenant.defaultVatRate ?? 0.1),
    };
  }
}
