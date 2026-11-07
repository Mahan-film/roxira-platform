/**
 * Types of the organisation access-control API (`/org`, `/auth/organizations`,
 * `/auth/sessions`, `/auth/totp`, `/admin/entitlements`). They mirror the
 * backend catalogue in `modules/access/catalogue.ts`. The frontend only uses
 * them to hide what is not allowed; the server decides every request.
 */

export type AccessModuleKey =
  | "accounting" | "banking" | "cheques" | "invoicing" | "tax" | "crm" | "hr"
  | "inventory" | "damages" | "data_import" | "assistant"
  | "members" | "security" | "audit";

export type AccessActionKey = "read" | "create" | "approve" | "post" | "export" | "admin";

export const ACCESS_ACTIONS: AccessActionKey[] = ["read", "create", "approve", "post", "export", "admin"];

export const SELLABLE_MODULES: AccessModuleKey[] = [
  "accounting", "banking", "cheques", "invoicing", "tax", "crm", "hr", "inventory", "damages", "data_import", "assistant",
];

export const MODULE_LABELS: Record<AccessModuleKey, string> = {
  accounting: "حسابداری",
  banking: "حساب‌های بانکی",
  cheques: "چک",
  invoicing: "صورتحساب",
  tax: "مالیات و مودیان",
  crm: "مشتریان (CRM)",
  hr: "منابع انسانی",
  inventory: "کالا و انبار",
  damages: "خسارت",
  data_import: "ورود داده",
  assistant: "دستیار هوشمند",
  members: "اعضا و نقش‌ها",
  security: "امنیت سازمان",
  audit: "گزارش رخدادها",
};

export const ACTION_LABELS: Record<AccessActionKey, string> = {
  read: "مشاهده",
  create: "ثبت و ویرایش",
  approve: "تأیید",
  post: "قطعی‌سازی",
  export: "خروجی",
  admin: "مدیریت",
};

export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  owner: "مالک",
  admin: "مدیر",
  accountant: "حسابدار",
  sales: "فروش",
  cheque_reviewer: "بازبین چک",
  hr: "منابع انسانی",
  read_only: "فقط مشاهده",
  legacy_member: "عضو (قدیمی)",
  custom: "نقش سفارشی",
};

export interface MyAccess {
  organization: null | {
    tenantId: string;
    roleKey: string;
    permissions: string[];
    entitledModules: string[];
    branchId: string | null;
    branchScoped: boolean;
    require2fa: boolean;
    mfa: boolean;
  };
}

export interface OrganizationSummary {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  roleKey: string;
  status: string;
}

export interface Member {
  id: string;
  userId: string;
  roleKey: string;
  customRoleId: string | null;
  branchId: string | null;
  departmentId: string | null;
  branchScoped: boolean;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  displayName: string | null;
  loginEmail: string | null;
  username: string | null;
  phone: string | null;
  managed: boolean;
}

export interface Invitation {
  id: string;
  email: string | null;
  phone: string | null;
  roleKey: string;
  customRoleId: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInvitation {
  invitation: Invitation;
  link: string;
  emailed: boolean;
}

export interface CustomRole {
  id: string;
  name: string;
  permissions: string[];
}

export interface RolesResponse {
  system: Array<{ key: string; deprecated: boolean; permissions: string[] }>;
  custom: CustomRole[];
  catalogue: { modules: AccessModuleKey[]; actions: AccessActionKey[] };
}

export interface Branch { id: string; name: string; code: string | null; parentId: string | null }
export interface Department { id: string; name: string; branchId: string | null }

export interface EntitlementView { module: AccessModuleKey; enabled: boolean }
export interface TenantListItem { id: string; name: string; slug: string; isActive: boolean }

export interface AuditEntry {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface SessionView {
  id: string;
  current: boolean;
  device: string;
  ip: string | null;
  startedAt: string | null;
  lastUsedAt: string;
  mfa: boolean;
  tenantId: string | null;
}

export interface InvitationPreview {
  organizationName: string;
  roleKey: string;
  expiresAt: string;
}

/** Tenant policy settings (#585), mirroring `modules/tenants/policy/policy.registry.ts`. */
export type PolicyGroup = "A" | "B" | "C";
export type PolicyValue = string | number | boolean;

export interface PolicySetting {
  key: string;
  group: PolicyGroup;
  type: "enum" | "int" | "bool";
  allowed: string[] | { min: number; max: number } | boolean[];
  default: PolicyValue;
  labelFa: string;
  descriptionFa: string;
  value: PolicyValue;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  editable: boolean;
}
