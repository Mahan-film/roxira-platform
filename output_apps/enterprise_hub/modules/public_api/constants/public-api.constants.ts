/** Scopes a tenant admin can grant to an API token. Keep in sync with docs/api/fa. */
export const API_SCOPES = [
  'invoices:write',
  'invoices:read',
  'items:read',
  'parties:read',
  'parties:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Plain tokens look like `rxk_<tenant uuid>_<43 url-safe chars>`. */
export const TOKEN_PREFIX = 'rxk';
export const TOKEN_REGEX = /^rxk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/i;

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
export const MAX_RATE_LIMIT_PER_MINUTE = 6000;
export const MAX_ACTIVE_TOKENS_PER_TENANT = 25;
/** last_used_at is refreshed at most this often, to keep reads from turning into writes. */
export const LAST_USED_REFRESH_MS = 60_000;

export const PUBLIC_API_REDIS = 'PUBLIC_API_REDIS';
export const RATE_WINDOW_SECONDS = 60;
