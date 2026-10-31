/**
 * Pure session-lifetime rules (no browser APIs), unit-tested with `node --test`.
 *
 * NestJS sessions are a 15-minute access token plus a 30-day rotating refresh
 * token. The access token is renewed shortly before it expires; the user is
 * only asked to sign in again when the refresh token is gone, expired or
 * rejected by the server. Smart Judge (Python) sessions have no refresh token
 * and simply end when their access token expires.
 */

/** Renew this long before the access token expires. */
export const REFRESH_LEAD_MS = 60_000;

export interface SessionTimes {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  refreshToken?: string;
  /** Epoch ms when the refresh token expires. */
  refreshExpiresAt?: number;
}

export function canRefresh(session: SessionTimes, now = Date.now()): boolean {
  return Boolean(
    session.refreshToken &&
      (session.refreshExpiresAt === undefined || session.refreshExpiresAt > now),
  );
}

/** True when the access token is expired or about to be. */
export function accessNeedsRefresh(session: SessionTimes, now = Date.now()): boolean {
  return session.expiresAt - REFRESH_LEAD_MS <= now;
}

/** A stored session is worth keeping if its access token still works or it can be refreshed. */
export function isSessionAlive(session: SessionTimes, now = Date.now()): boolean {
  return session.expiresAt > now || canRefresh(session, now);
}

/** Milliseconds until the next proactive refresh (never negative, at least 5 s apart). */
export function msUntilRefresh(session: SessionTimes, now = Date.now()): number {
  return Math.max(5_000, session.expiresAt - REFRESH_LEAD_MS - now);
}
