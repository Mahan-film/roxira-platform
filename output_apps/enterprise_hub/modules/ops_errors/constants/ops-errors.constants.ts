export const OPS_ERROR_ALERTS_QUEUE = 'ops-error-alerts';
export const OPS_ERROR_SCAN_JOB = 'scan';
export const OPS_ERROR_DIGEST_JOB = 'digest';

export const OPS_ERROR_SCAN_EVERY_MS = 5 * 60 * 1000;
/** 05:00 UTC, about 08:30 Tehran. */
export const OPS_ERROR_DIGEST_CRON = '0 5 * * *';

/**
 * Sentinel tenant UUID for system, unauthenticated, or AI-core errors that have no tenant context.
 * Stored under the same FORCE RLS policy as tenant rows so platform ops errors never leak into
 * any customer tenant scope.
 */
export const PLATFORM_OPS_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export const MAX_SAMPLE_MESSAGE = 300;
export const MAX_SAMPLE_STACK = 2000;
export const MAX_ROUTE = 200;

/** Telegram: at most this many messages per rolling hour (no alert floods). */
export const ALERT_MAX_PER_HOUR = 10;
export const ALERT_WINDOW_MS = 60 * 60 * 1000;
/** A fingerprint alerts as a spike when this hour's count is >= 10x the previous hour's. */
export const SPIKE_FACTOR = 10;
export const SPIKE_MIN_COUNT = 10;
export const DIGEST_TOP_N = 10;
export const RETENTION_DAYS = 30;

export const OPS_ERROR_SOURCES = ['backend', 'ai-core'] as const;
export type OpsErrorSource = (typeof OPS_ERROR_SOURCES)[number];

export const OPS_ERROR_SCOPES = ['tenant', 'platform'] as const;
export type OpsErrorScope = (typeof OPS_ERROR_SCOPES)[number];
