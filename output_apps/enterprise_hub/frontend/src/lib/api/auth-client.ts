/**
 * کلاینت احراز هویت پیامکی (Auth & .
 *
 * منطبق بر قرارداد Swagger کنترلر NestJS `auth`:
 *   • POST /api/backend/auth/send-otp   → SendOtpResponse
 *   • POST /api/backend/auth/verify-otp → AuthSession (JWT)
 *   • GET  /api/backend/auth/me         → AuthUser (Bearer)
 *
 * سشن در localStorage نگهداری می‌شود تا وضعیت ورود میان بخش‌های مختلف
 * رابط (هدر، چت‌بات قاضی و فرم فاکتور روکسیرا) مشترک باشد.
 */

import { ApiClientError, apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, AUTH_RESOURCE_PATH } from "@/lib/api/config";

/** دامنه سرویس — تعیین‌کننده قالب پیامک . */
export type AuthServiceDomain = "ROXIRA" | "GHAZI";

/** نقش کاربر در توکن JWT. */
export type UserRole = "USER" | "LAWYER" | "ADMIN";

/** اطلاعات عمومی کاربر (بدون داده حساس). */
export interface AuthUser {
  id: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  role: UserRole;
  serviceDomain: AuthServiceDomain;
  createdAt: string;
}

/** سشن بازگشتی از تأیید کد. */
export interface AuthSession {
  tokenType: string;
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

/** پاسخ ارسال کد یک‌بارمصرف. */
export interface SendOtpResponse {
  success: boolean;
  expiresIn: number;
  serviceDomain: AuthServiceDomain;
  smsDelivered: boolean;
  template: string;
}

export interface SendOtpPayload {
  phone: string;
  serviceDomain?: AuthServiceDomain;
}

export interface VerifyOtpPayload {
  phone: string;
  code: string;
  serviceDomain?: AuthServiceDomain;
}

const AUTH_ENDPOINT = `${API_PROXY_BASE_PATH}/${AUTH_RESOURCE_PATH}`;
const STORAGE_KEY = "roxira.auth.session";

/** استنتاج دامنه سرویس از میزبان جاری مرورگر (ghazi → GHAZI، در غیر این صورت ROXIRA). */
export function inferServiceDomain(): AuthServiceDomain {
  if (typeof window === "undefined") {
    return "ROXIRA";
  }
  const host = window.location.hostname.toLowerCase();
  return host.includes("ghazi") || host.includes("smartjudge") ? "GHAZI" : "ROXIRA";
}

/**
 * ارسال کد یک‌بارمصرف به شماره همراه ایران.
 *
 * @deprecated مسیر قدیمی NestJS (`/api/backend/auth/send-otp`) برای سامانه
 * قاضی هوشمند معتبر نیست و روی دامنهٔ ghazihoushmand.ir به خطای ۵۰۰ منجر
 * می‌شود. از `sendJudgeOtp` در `@/lib/api/judge-auth-client` استفاده کنید
 * که مسیر قطعی `/api/v1/apps/judge/auth/send-otp` را فراخوانی می‌کند.
 */
export async function sendOtp(
  payload: SendOtpPayload,
  signal?: AbortSignal,
): Promise<SendOtpResponse> {
  return apiRequest<SendOtpResponse>(`${AUTH_ENDPOINT}/send-otp`, {
    method: "POST",
    body: {
      phone: payload.phone,
      serviceDomain: payload.serviceDomain ?? inferServiceDomain(),
    },
    signal,
  });
}

/**
 * تأیید کد یک‌بارمصرف و دریافت توکن JWT + سشن کاربری.
 *
 * @deprecated برای سامانه قاضی هوشمند از `verifyJudgeOtp` در
 * `@/lib/api/judge-auth-client` استفاده کنید تا مسیر قطعی
 * `/api/v1/apps/judge/auth/verify-otp` فراخوانی شود.
 */
export async function verifyOtp(
  payload: VerifyOtpPayload,
  signal?: AbortSignal,
): Promise<AuthSession> {
  return apiRequest<AuthSession>(`${AUTH_ENDPOINT}/verify-otp`, {
    method: "POST",
    body: {
      phone: payload.phone,
      code: payload.code,
      serviceDomain: payload.serviceDomain ?? inferServiceDomain(),
    },
    signal,
  });
}

/** دریافت اطلاعات کاربر جاری با توکن Bearer. */
export async function fetchCurrentUser(
  accessToken: string,
  signal?: AbortSignal,
): Promise<AuthUser> {
  const response = await fetch(`${AUTH_ENDPOINT}/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    let body: unknown = response.statusText;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = response.statusText;
    }
    throw new ApiClientError(response.status, {
      message:
        typeof body === "object" && body && "message" in body
          ? (body as { message: string }).message
          : String(body),
      statusCode: response.status,
    });
  }

  return (await response.json()) as AuthUser;
}

/** ساخت سشن قابل ذخیره‌سازی همراه با زمان انقضا. */
export interface StoredAuthSession {
  accessToken: string;
  tokenType: string;
  user: AuthUser;
  expiresAt: number;
}

export function toStoredSession(session: AuthSession): StoredAuthSession {
  return {
    accessToken: session.accessToken,
    tokenType: session.tokenType,
    user: session.user,
    expiresAt: Date.now() + session.expiresIn * 1000,
  };
}

/** ذخیره سشن در localStorage (با کنترل دسترس‌پذیری در SSR). */
export function saveStoredSession(session: StoredAuthSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event("roxira-auth-changed"));
  } catch {
    // در حالت Private Browsing ممکن است ذخیره‌سازی در دسترس نباشد.
  }
}

/** بارگذاری سشن ذخیره‌شده؛ سشن منقضی پاک می‌شود. */
export function loadStoredSession(): StoredAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthSession;
    if (!parsed?.accessToken || !parsed?.user) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** پاک‌کردن سشن (خروج). */
export function clearStoredSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("roxira-auth-changed"));
  } catch {
    // no-op
  }
}
