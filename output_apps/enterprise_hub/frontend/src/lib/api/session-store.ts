/**
 * Browser session storage and token renewal, shared by `auth-client` and
 * `http-client` (which cannot import `auth-client` without a cycle).
 *
 * Refresh uses plain `fetch` and the Web Locks API, so two tabs never rotate
 * the same refresh token at once (a replay would revoke the whole session).
 */
import { API_PROXY_BASE_PATH, AUTH_RESOURCE_PATH } from "@/lib/api/config";
import {
  accessNeedsRefresh,
  canRefresh,
  isSessionAlive,
} from "@/lib/api/session-logic";

export const SESSION_STORAGE_KEY = "roxira.auth.session";
const AUTH_ENDPOINT = `${API_PROXY_BASE_PATH}/${AUTH_RESOURCE_PATH}`;

/** Fields shared by every stored session. `user` is typed by auth-client. */
export interface StoredSessionBase<TUser = unknown> {
  accessToken: string;
  tokenType: string;
  user: TUser;
  expiresAt: number;
  /** Only NestJS sessions have a refresh token. */
  refreshToken?: string;
  refreshExpiresAt?: number;
}

/** True when `token` is a 3-part JWT whose `exp` (if present) is still in the future. Unverified decode. */
export function isUsableJwt(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return false;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    if (json && typeof json.exp === "number" && json.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function isWellFormedJwt(token: unknown): boolean {
  return typeof token === "string" && token.split(".").length === 3 && token.split(".").every(Boolean);
}

export function readRawSession<T extends StoredSessionBase>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Load the stored session; drop it only when neither the access nor the refresh token can still work. */
export function loadSession<T extends StoredSessionBase>(): T | null {
  if (typeof window === "undefined") return null;
  const parsed = readRawSession<T>();
  if (!parsed) return null;
  const valid =
    parsed.accessToken &&
    parsed.user &&
    isWellFormedJwt(parsed.accessToken) &&
    isSessionAlive({ ...parsed, expiresAt: parsed.expiresAt || Infinity });
  if (!valid) {
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // storage unavailable
    }
    return null;
  }
  return parsed;
}

export function writeSession(session: StoredSessionBase): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event("roxira-auth-changed"));
  } catch {
    // Private browsing may block storage.
  }
}

export function removeSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.dispatchEvent(new Event("roxira-auth-changed"));
  } catch {
    // no-op
  }
}

interface RefreshResponse {
  tokenType: string;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  user: unknown;
}

/** Why a refresh did not produce a session. `rejected` = server said the refresh token is dead. */
export type RefreshOutcome =
  | { status: "ok"; session: StoredSessionBase }
  | { status: "rejected" }
  | { status: "unavailable" };

async function callRefresh(current: StoredSessionBase): Promise<RefreshOutcome> {
  try {
    const response = await fetch(`${AUTH_ENDPOINT}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 400) return { status: "rejected" };
    if (!response.ok) return { status: "unavailable" };
    const body = (await response.json()) as RefreshResponse;
    const now = Date.now();
    return {
      status: "ok",
      session: {
        accessToken: body.accessToken,
        tokenType: body.tokenType,
        user: body.user,
        expiresAt: now + body.expiresIn * 1000,
        refreshToken: body.refreshToken,
        refreshExpiresAt: now + body.refreshExpiresIn * 1000,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

let inFlight: Promise<RefreshOutcome> | null = null;

/**
 * Renew the stored session when it is (nearly) expired. Safe to call often:
 * calls share one request, and a lock serialises tabs. `force` renews even if
 * the access token still looks fresh (used after a 401).
 */
export function refreshStoredSession(force = false): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;
  const run = async (): Promise<RefreshOutcome> => {
    const current = readRawSession<StoredSessionBase>();
    if (!current || !canRefresh(current)) return { status: "rejected" };
    if (!force && !accessNeedsRefresh(current)) return { status: "ok", session: current };
    const outcome = await callRefresh(current);
    if (outcome.status === "ok") writeSession(outcome.session);
    if (outcome.status === "rejected") removeSession();
    return outcome;
  };
  const locked = async (): Promise<RefreshOutcome> => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return run();
    return locks.request("roxira-auth-refresh", run);
  };
  inFlight = locked().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Access token for an API call. Renews first when it is expired or about to
 * expire; returns null when there is no usable session.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const current = readRawSession<StoredSessionBase>();
  if (!current?.accessToken) return null;
  if (!accessNeedsRefresh(current)) return current.accessToken;
  if (!canRefresh(current)) {
    return current.expiresAt > Date.now() ? current.accessToken : null;
  }
  const outcome = await refreshStoredSession();
  if (outcome.status === "ok") return outcome.session.accessToken;
  // Server unreachable: an access token that has not actually expired still works.
  return current.expiresAt > Date.now() ? current.accessToken : null;
}
