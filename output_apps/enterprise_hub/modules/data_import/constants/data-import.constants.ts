/**
 * ثابت‌های ماژول ورود داده با کمک هوش مصنوعی (AI-assisted data import).
 *
 * هدف: مشتری فایل خروجی نرم‌افزار قبلی (CRM/حسابداری/ERP) را بارگذاری می‌کند
 * و ستون‌های آن به‌صورت خودکار به فیلدهای سرنخ CRM نگاشت و درج می‌شوند.
 *
 * قواعد سخت (Rule #4 - AGENTS.md):
 * - داده مشتری هرگز به مدل رایگان/`may_log` فرستاده نمی‌شود؛ تنها تماس مجاز
 *   OpenRouter با کلید سروری `OPENROUTER_API_KEY`، مدل نقش `cheap` (نگاشت) یا
 *   `vision` (استخراج جدول از تصویر) از `config/models.yaml` و بدنه درخواست با
 *   `provider.data_collection: "deny"`.
 * - شناسه مستأجر فقط از `requireTenantId(request)` خوانده می‌شود.
 */

/** مسیر پایه کنترلر ورود داده در لایه NestJS. */
export const DATA_IMPORT_RESOURCE = 'enterprise-hub/data-import';

/** حداکثر حجم فایل بارگذاری‌شده: ۵ مگابایت. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** حداکثر تعداد ردیف قابل پردازش در هر فایل. */
export const MAX_IMPORT_ROWS = 5000;

/** تعداد ردیف نمونه‌ای که برای نگاشت به LLM فرستاده می‌شود. */
export const MAX_SAMPLE_ROWS = 5;

/** حداکثر طول هر سلول هنگام ارسال نمونه به LLM (بقیه بریده می‌شود). */
export const MAX_CELL_CHARS = 40;

/** مدت نگه‌داری فایل تجزیه‌شده در حافظه سرور: ۳۰ دقیقه. */
export const UPLOAD_TTL_MS = 30 * 60 * 1000;

/** اندازه هر بسته درج گروهی سرنخ‌ها. */
export const IMPORT_BATCH_SIZE = 200;

/** حداکثر تعداد خطاهایی که در پاسخ commit برگردانده می‌شود. */
export const MAX_REPORTED_ERRORS = 50;

/** نقطه پایانی چت‌تکمیل OpenRouter (تنها درگاه LLM مجاز). */
export const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions';

/** نقش مدل ارزان در `config/models.yaml` برای نگاشت ستون‌ها. */
export const CHEAP_MODEL_ROLE = 'cheap';

/**
 * نقش مدل بینایی در `config/models.yaml` برای استخراج جدول از تصویر
 * (فاکتور/دفتر اسکن‌شده یا عکس). همان الگوی نقش `cheap` خوانده می‌شود؛ هیچ
 * شناسه‌ای hardcode نمی‌شود.
 */
export const VISION_MODEL_ROLE = 'vision';

/** حداکثر تعداد صفحه/تصویری که به مدل بینایی فرستاده می‌شود. */
export const MAX_VISION_PAGES = 5;

/** MIME typeهای تصویری مجاز برای استخراج جدول با مدل بینایی. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** پسوندهای مجاز فایل بارگذاری‌شده. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  '.csv',
  '.xlsx',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const;

/**
 * فیلدهای قابل‌نگاشت سرنخ CRM (منطبق بر `CreateLeadDto`).
 * مقدار نگاشت پیشنهادی همواره یکی از این شناسه‌ها یا رشته خالی است.
 */
export const CRM_LEAD_FIELDS = [
  'fullName',
  'email',
  'phone',
  'company',
  'pipelineStage',
  'estimatedValue',
  'owner',
  'notes',
] as const;

/** شناسه نوع فیلد سرنخ CRM. */
export type CrmLeadField = (typeof CRM_LEAD_FIELDS)[number];
