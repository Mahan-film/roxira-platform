/**
 * تایپ‌های مربوط به مدیریت توکن‌های API سازمان (Public API Tokens).
 * مطابق با DTOهای backend در `enterprise_hub/modules/public_api/dto/api-token.dto.ts`.
 */

export const API_SCOPES = [
  "invoices:write",
  "invoices:read",
  "items:read",
  "parties:read",
  "parties:write",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS_FA: Record<ApiScope, { label: string; description: string }> = {
  "invoices:write": {
    label: "صدور و ویرایش صورتحساب‌ها",
    description: "ایجاد، ثبت و به‌روزرسانی فاکتورهای فروش و پیش‌فاکتور",
  },
  "invoices:read": {
    label: "مشاهده صورتحساب‌ها",
    description: "دریافت فهرست و جزئیات فاکتورهای فروش و وضعیت مودیان",
  },
  "items:read": {
    label: "مشاهده کالاها و خدمات",
    description: "دریافت اطلاعات کالاها، خدمات، قیمت‌ها و موجودی",
  },
  "parties:read": {
    label: "مشاهده طرف‌های حساب",
    description: "مشاهده اطلاعات مشتریان، تامین‌کنندگان و طرف‌های معامله",
  },
  "parties:write": {
    label: "تعریف و ویرایش طرف‌های حساب",
    description: "ایجاد و به‌روزرسانی مشخصات مشتریان و اشخاص حقیقی/حقوقی",
  },
};

export interface ApiTokenView {
  id: number;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiTokenView extends ApiTokenView {
  /**
   * توکن خام کامل. فقط در پاسخ ایجاد توکن یک‌بار برگردانده می‌شود.
   * هرگز نباید در کنسول لاگ شود یا در استیت ماندگار ذخیره گردد.
   */
  token: string;
}

export interface CreateApiTokenPayload {
  name: string;
  scopes: string[];
  rateLimitPerMinute?: number;
  expiresAt?: string;
}
