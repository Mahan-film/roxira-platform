/**
 * ثابت‌های دستیار هوشمند روی داده‌های خود سازمان (Business Suite فاز ۲، §4).
 *
 * مدل‌ها فقط از نقش‌های `config/models.yaml` خوانده می‌شوند (AGENTS.md §3):
 * ابتدا نقش رایگان، سپس نقش ارزان پولی به‌عنوان جایگزین (AGENTS.md §4).
 */

/** نقش‌های مدل به ترتیب اولویت: رایگان اول، پولی به‌عنوان جایگزین. */
export const ASSISTANT_MODEL_ROLES = ['free', 'cheap'] as const;

/** نقش‌هایی که ارائه‌دهنده‌شان ممکن است پرامپت را ثبت کند (data_collection آزاد). */
export const ASSISTANT_MAY_LOG_ROLES: ReadonlySet<string> = new Set(['free']);

/** حداکثر تعداد دور فراخوانی مدل در یک پرسش (هر دور ممکن است ابزار صدا بزند). */
export const ASSISTANT_MAX_ROUNDS = 5;

/** حداکثر تعداد فراخوانی ابزار در یک پرسش. */
export const ASSISTANT_MAX_TOOL_CALLS = 8;

/**
 * حداکثر تعداد مدل رایگان که برای یک دور امتحان می‌شود. مدل‌های پولی (`cheap`)
 * همیشه بعد از آن‌ها اضافه می‌شوند تا جایگزین پولی هرگز حذف نشود (AGENTS.md §4).
 */
export const ASSISTANT_MAX_FREE_ATTEMPTS = 3;

/** سقف زمان کل یک پرسش (همه دورها و مدل‌ها) به میلی‌ثانیه. */
export const ASSISTANT_TOTAL_TIMEOUT_MS = 90_000;

/** مهلت هر درخواست به OpenRouter (میلی‌ثانیه). */
export const ASSISTANT_LLM_TIMEOUT_MS = 45_000;

/** حداکثر طول نتیجه JSON هر ابزار که به مدل داده می‌شود. */
export const ASSISTANT_MAX_TOOL_RESULT_CHARS = 6_000;

/** حداکثر تعداد پیام‌های تاریخچه گفت‌وگو که از کلاینت پذیرفته می‌شود. */
export const ASSISTANT_MAX_HISTORY = 10;

/** حداکثر طول هر پیام گفت‌وگو. */
export const ASSISTANT_MAX_MESSAGE_CHARS = 2_000;

/** پیش‌فرض محدودیت نرخ: تعداد پرسش در هر پنجره برای هر سازمان. */
export const ASSISTANT_RATE_LIMIT_DEFAULT = 20;

/** طول پنجره محدودیت نرخ (میلی‌ثانیه). */
export const ASSISTANT_RATE_WINDOW_MS = 60 * 60 * 1000;

/** حداکثر ردیف‌های فهرستی که هر ابزار دستیار برمی‌گرداند. */
export const ASSISTANT_MAX_ROWS = 50;

/** منطقه زمانی مبنای «این ماه/ماه گذشته» (ایران از ۱۴۰۱ ساعت تابستانی ندارد). */
export const ASSISTANT_TZ_OFFSET_MS = 3.5 * 60 * 60 * 1000;
