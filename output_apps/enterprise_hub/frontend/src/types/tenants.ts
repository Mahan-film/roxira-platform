/**
 * تایپ‌های مشترک ماژول سازمان و اعضا.
 * این تایپ‌ها دقیقاً منطبق بر DTOهای Swagger بک‌اند NestJS در
 * `modules/tenants/dto` هستند (Contract-First Synchronization — Rule #4).
 */

export enum TenantRole {
  OWNER = "OWNER",
  MEMBER = "MEMBER",
}

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  [TenantRole.OWNER]: "مالک سازمان",
  [TenantRole.MEMBER]: "عضو",
};

/** سازمان جاری کاربر — GET /tenants/me */
export interface TenantMe {
  id: string;
  name: string;
  slug: string;
  tenantRole: TenantRole | null;
}

/** عضو سازمان — GET /tenants/members */
export interface TenantMember {
  id: string;
  /** شماره همراه پوشانده‌شده (نمونه: 0912***7796) */
  phone: string;
  tenantRole: TenantRole | null;
  createdAt: string;
}

/** بدنه افزودن عضو — POST /tenants/members */
export interface AddTenantMemberDto {
  phone: string;
  tenantRole: TenantRole;
}
