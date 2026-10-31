/**
 * Constants of the invoice-capture pipeline (assistant chat: photo / PDF / voice -> draft voucher).
 * Model ids are NOT here: they come from the `invoice_extraction` role of `config/models.yaml`.
 */

/** Role in `config/models.yaml` holding the paid vision fallback (tried after the `free` ladder). */
export const CAPTURE_MODEL_ROLE = 'invoice_extraction';
/** The free ladder tried first (AGENTS.md §4: free first, paid fallback). */
export const CAPTURE_FREE_ROLE = 'free';
/** Role used to transcribe voice notes. */
export const CAPTURE_STT_ROLE = 'stt';

/** Largest accepted upload (image, PDF or audio). */
export const CAPTURE_MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Longest free text (description / transcript) sent to the model. */
export const CAPTURE_MAX_TEXT_CHARS = 8_000;
/** At most this many PDF text characters are sent to the model. */
export const CAPTURE_MAX_PDF_TEXT_CHARS = 12_000;
/** Per-request timeout towards the model provider. */
export const CAPTURE_LLM_TIMEOUT_MS = 30_000;
/** Free models tried before the paid fallback (paid fallback is never dropped, AGENTS.md §4). */
export const CAPTURE_MAX_FREE_ATTEMPTS = 5;

/** Defaults of `capture_settings` (auto mode is OFF until a tenant admin turns it on). */
export const CAPTURE_DEFAULT_MIN_CONFIDENCE = 0.95;
export const CAPTURE_DEFAULT_DAILY_COST_CAP_USD = 1;
export const CAPTURE_DEFAULT_DAILY_DOC_CAP = 100;
export const CAPTURE_MIN_CONFIDENCE_FLOOR = 0.8;

/** Bounds of every string taken from model output. */
export const CAPTURE_MAX_ITEMS = 100;
export const CAPTURE_MAX_FIELD_CHARS = 200;

/** Window of the daily review queue. */
export const CAPTURE_QUEUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Chart-of-accounts codes of the default ledger (accounting.constants DEFAULT_CHART_OF_ACCOUNTS). */
export const CAPTURE_ACCOUNTS = {
  cash: '1010',
  receivable: '1020',
  payable: '2010',
  vat: '2020',
  salesRevenue: '4010',
  defaultExpense: '5030',
} as const;

export const CAPTURE_ENTRY_PREFIX = 'CAP';
