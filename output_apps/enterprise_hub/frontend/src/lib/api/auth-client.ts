/**
 * Client for the NestJS `auth` controller (Roxira portal: roxira.ir and roxira.net).
 *
 *   • POST /api/backend/auth/send-otp        → SendOtpResponse (Iran SMS)
 *   • POST /api/backend/auth/verify-otp      → AuthSession
 *   • POST /api/backend/auth/signup          → AuthSession (username/email + password)
 *   • POST /api/backend/auth/login           → AuthSession
 *   • POST /api/backend/auth/password/forgot | reset | set
 *   • POST /api/backend/auth/refresh | logout
 *   • GET  /api/backend/auth/me              → AuthUser (Bearer)
 *
 * Smart Judge (ghazihoushmand.ir) signs in through `judge-auth-client` against
 * the Python engine instead; its sessions share the storage below but have no
 * refresh token.
 *
 * The session lives in localStorage so the header, chat and enterprise modules
 * share one login. Token renewal lives in `session-store`.
 */

import { ApiClientError, apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, AUTH_RESOURCE_PATH } from "@/lib/api/config";
import type { PlanLevel } from "@/lib/plan-catalog";
import {
  type StoredSessionBase,
  loadSession,
  removeSession,
  writeSession,
} from "@/lib/api/session-store";

export { isUsableJwt } from "@/lib/api/session-store";

/** Service domain; decides the SMS template and which portal the account belongs to. */
export type AuthServiceDomain = "ROXIRA" | "GHAZI";

/** نقش کاربر در توکن JWT. */
export type UserRole = "USER" | "LAWYER" | "ADMIN";

/** اطلاعات عمومی کاربر (بدون داده حساس). */
export interface AuthUser {
  id: string;
  /** Null for accounts created with email/username (roxira.net). */
  phone: string | null;
  username?: string | null;
  /** True when the account can also sign in with a password. */
  hasPassword?: boolean;
  displayName: string | null;
  email: string | null;
  role: UserRole;
  /** Subscription tier from the verify-otp response (FREE / VIP ...). */
  subscriptionTier?: string;
  planLevel?: PlanLevel;
  serviceDomain: AuthServiceDomain;
  createdAt: string;
}

/** سشن بازگشتی از تأیید کد. */
export interface AuthSession {
  tokenType: string;
  accessToken: string;
  /** Access-token lifetime in seconds (15 minutes on NestJS). */
  expiresIn: number;
  /** Rotating refresh token; absent for Smart Judge (Python) sessions. */
  refreshToken?: string;
  refreshExpiresIn?: number;
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
  /** نام سازمان برای ثبت‌اولیه (فقط اگر کاربر عضو هیچ سازمانی نباشد). */
  organizationName?: string;
  /** Join this organisation by invitation (no organisation name needed). */
  inviteToken?: string;
}

const AUTH_ENDPOINT = `${API_PROXY_BASE_PATH}/${AUTH_RESOURCE_PATH}`;

/** استنتاج دامنه سرویس از میزبان جاری مرورگر (ghazi → GHAZI، در غیر این صورت ROXIRA). */
export function inferServiceDomain(): AuthServiceDomain {
  if (typeof window === "undefined") {
    return "ROXIRA";
  }
  const host = window.location.hostname.toLowerCase();
  return host.includes("ghazi") || host.includes("smartjudge") ? "GHAZI" : "ROXIRA";
}

/**
 * Send a one-time code to an Iranian mobile number (Roxira portal, NestJS).
 * Throws `ApiClientError` with `code === "SMS_DELIVERY_FAILED"` (HTTP 503) when
 * the SMS gateway did not accept the message.
 *
 * Smart Judge (ghazihoushmand.ir) must use `sendJudgeOtp` from
 * `@/lib/api/judge-auth-client`; this route is not served for that product.
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
 * Verify the one-time code and receive a session (Roxira portal, NestJS).
 * Smart Judge uses `verifyJudgeOtp` from `@/lib/api/judge-auth-client`.
 */
export async function verifyOtp(
  payload: VerifyOtpPayload,
  signal?: AbortSignal,
): Promise<LoginResult> {
  return apiRequest<LoginResult>(`${AUTH_ENDPOINT}/verify-otp`, {
    method: "POST",
    body: {
      phone: payload.phone,
      code: payload.code,
      serviceDomain: payload.serviceDomain ?? inferServiceDomain(),
      organizationName: payload.organizationName,
      inviteToken: payload.inviteToken,
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

/** A session as kept in localStorage, with absolute expiry times. */
export interface StoredAuthSession extends StoredSessionBase<AuthUser> {
  user: AuthUser;
}

export function toStoredSession(session: AuthSession): StoredAuthSession {
  const now = Date.now();
  return {
    accessToken: session.accessToken,
    tokenType: session.tokenType,
    user: session.user,
    expiresAt: now + session.expiresIn * 1000,
    ...(session.refreshToken
      ? {
          refreshToken: session.refreshToken,
          refreshExpiresAt: now + (session.refreshExpiresIn ?? 0) * 1000,
        }
      : {}),
  };
}

/** Save the session (SSR-safe; storage failures are ignored). */
export function saveStoredSession(session: StoredAuthSession): void {
  writeSession(session);
}

/** Load the stored session. It is kept while the access token works or can be refreshed. */
export function loadStoredSession(): StoredAuthSession | null {
  return loadSession<StoredAuthSession>();
}

/** Remove the stored session (sign out on this device). */
export function clearStoredSession(): void {
  removeSession();
}

// ---------------------------------------------------------------- password auth

export type UiLocale = "fa" | "en";

export interface SignupPayload {
  username?: string;
  email?: string;
  password: string;
  displayName?: string;
  organizationName?: string;
  /** Join this organisation by invitation instead of creating one. */
  inviteToken?: string;
}

/** Returned instead of tokens when the account has an authenticator app (TOTP). */
export interface MfaChallenge {
  mfaRequired: true;
  challenge: string;
  expiresIn: number;
}

export type LoginResult = AuthSession | MfaChallenge;

export function isMfaChallenge(result: LoginResult): result is MfaChallenge {
  return (result as MfaChallenge).mfaRequired === true;
}

/** Create an account with username/email + password. An organisation is optional. */
export async function passwordSignup(payload: SignupPayload, signal?: AbortSignal): Promise<LoginResult> {
  return apiRequest<LoginResult>(`${AUTH_ENDPOINT}/signup`, { method: "POST", body: payload, signal });
}

/** Sign in with username or email and password. May ask for a TOTP code. */
export async function passwordLogin(
  identifier: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginResult> {
  return apiRequest<LoginResult>(`${AUTH_ENDPOINT}/login`, {
    method: "POST",
    body: { identifier, password },
    signal,
  });
}

/** Second step for accounts with an authenticator app: challenge + 6-digit (or recovery) code. */
export async function completeMfaLogin(
  challenge: string,
  code: string,
  signal?: AbortSignal,
): Promise<AuthSession> {
  return apiRequest<AuthSession>(`${AUTH_ENDPOINT}/login/mfa`, {
    method: "POST",
    body: { challenge, code },
    signal,
  });
}

/** Ask for a reset email. The server always answers the same way. */
export async function requestPasswordResetEmail(
  identifier: string,
  locale: UiLocale,
  signal?: AbortSignal,
): Promise<void> {
  await apiRequest<{ message: string }>(`${AUTH_ENDPOINT}/password/forgot`, {
    method: "POST",
    body: { identifier, locale },
    signal,
  });
}

/** Choose a new password with the token from the reset email. */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiRequest<{ message: string }>(`${AUTH_ENDPOINT}/password/reset`, {
    method: "POST",
    body: { token, newPassword },
    signal,
  });
}

export interface SetPasswordPayload {
  newPassword: string;
  currentPassword?: string;
  username?: string;
  email?: string;
}

/** Add or change the password of the signed-in user. Returns a fresh session. */
export async function setAccountPassword(
  payload: SetPasswordPayload,
  signal?: AbortSignal,
): Promise<AuthSession> {
  return apiRequest<AuthSession>(`${AUTH_ENDPOINT}/password/set`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** Revoke the refresh token on the server. Best effort: local sign-out never waits for it. */
export async function serverLogout(refreshToken: string): Promise<void> {
  try {
    await fetch(`${AUTH_ENDPOINT}/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
      keepalive: true,
    });
  } catch {
    // offline: the refresh token expires on its own and is rotated on next use
  }
}

/** UI language of the portal the visitor is on: roxira.net and /en pages are English. */
export function inferUiLocale(): UiLocale {
  if (typeof window === "undefined") return "fa";
  const host = window.location.hostname.toLowerCase();
  if (host.includes("roxira.net")) return "en";
  return window.location.pathname === "/en" || window.location.pathname.startsWith("/en/") ? "en" : "fa";
}
