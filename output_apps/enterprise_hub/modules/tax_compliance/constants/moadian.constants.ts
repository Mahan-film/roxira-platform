/**
 * ثابت‌ها و نام متغیرهای محیطی اتصال زنده به سامانه مودیان.
 *
 * اتصال به‌صورت پیش‌فرض خاموش است (`MOADIAN_ENABLED=false`) و نشانی پایه
 * پیش‌فرض، محیط آزمایشی (sandbox) است؛ تولید فقط با تنظیم صریح
 * `MOADIAN_BASE_URL=https://tp.tax.gov.ir/requestsmanager/api/v2`.
 */

export const MOADIAN_ENV = {
  ENABLED: 'MOADIAN_ENABLED',
  BASE_URL: 'MOADIAN_BASE_URL',
  KEY_ENCRYPTION_KEY: 'MOADIAN_KEY_ENCRYPTION_KEY',
  POLL_DELAY_MS: 'MOADIAN_POLL_DELAY_MS',
  MAX_POLLS: 'MOADIAN_MAX_POLLS',
  HTTP_TIMEOUT_MS: 'MOADIAN_HTTP_TIMEOUT_MS',
} as const;

export const MOADIAN_SANDBOX_BASE_URL = 'https://sandboxrc.tax.gov.ir/requestsmanager/api/v2';
export const MOADIAN_PRODUCTION_BASE_URL = 'https://tp.tax.gov.ir/requestsmanager/api/v2';

export const MOADIAN_QUEUE = 'moadian';
export const MOADIAN_SEND_JOB = 'moadian.send';
export const MOADIAN_POLL_JOB = 'moadian.poll';
export const MOADIAN_SYNC_STATUS_JOB = 'moadian.sync-status';
/** کار صف برای مسیر جدید outbox/adapter (TaxTransmissionService). */
export const MOADIAN_TX_JOB = 'moadian.tx';

export const MOADIAN_DEFAULT_POLL_DELAY_MS = 60_000;
export const MOADIAN_DEFAULT_MAX_POLLS = 30;
export const MOADIAN_DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const MOADIAN_DEFAULT_HTTP_TIMEOUT_MS = 20_000;
/** عمر nonce درخواستی (ثانیه) برای توکن احراز هویت. */
export const MOADIAN_NONCE_TTL_SECONDS = 20;
/** مدت نگه‌داری کلید عمومی سازمان امور مالیاتی در حافظه. */
export const MOADIAN_SERVER_KEY_CACHE_MS = 60 * 60 * 1000;

/** تلاش مجدد BullMQ برای خطای انتقال (شبکه/5xx). */
export const MOADIAN_JOB_ATTEMPTS = 5;
export const MOADIAN_JOB_BACKOFF_MS = 30_000;

/** توکن تزریق `fetch` (برای آزمون واحد بدون شبکه). */
export const MOADIAN_FETCH = Symbol('MOADIAN_FETCH');
