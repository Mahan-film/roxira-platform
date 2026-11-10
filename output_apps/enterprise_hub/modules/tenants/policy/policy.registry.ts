/**
 * Tenant policy registry (#585). Pure data: no I/O, no database, no Nest.
 *
 * Management chooses the business and access rules; the code holds a safe default for each one.
 * Groups say how much protection a rule carries:
 *   - A: fixed. Shown read-only; the code always enforces it and it is never stored or writable.
 *   - B: protects the ledger or a control. Lowering it needs a longer written reason.
 *   - C: a management decision, freely set with a short reason.
 *
 * Every default equals today's behaviour, so an organisation that sets nothing keeps the same
 * outcome. Nothing here is a legal statement and no statutory figure lives in code.
 */

export type PolicyGroup = 'A' | 'B' | 'C';
export type PolicyType = 'enum' | 'int' | 'bool';
export type PolicyValue = string | number | boolean;
export type PolicyAllowed = readonly string[] | { readonly min: number; readonly max: number } | readonly boolean[];

export interface PolicyDefinition {
  readonly key: string;
  readonly group: PolicyGroup;
  readonly type: PolicyType;
  /** Enum values, `{ min, max }` for int, or `[true]` for a fixed flag. */
  readonly allowed: PolicyAllowed;
  readonly default: PolicyValue;
  readonly labelFa: string;
  readonly descriptionFa: string;
  /** Keys stored in `erp_purchase_settings` (column mapped by the service) instead of this module's table. */
  readonly store?: 'purchase_settings';
}

export type PolicyValidation = { ok: true } | { ok: false; error: string };

export const POLICY_REGISTRY: readonly PolicyDefinition[] = [
  // ---------------------------------------------------------------- group A (fixed)
  {
    key: 'ledger.posted_voucher_immutable',
    group: 'A',
    type: 'bool',
    allowed: [true],
    default: true,
    labelFa: 'سند قطعی‌شده قابل ویرایش یا حذف نیست؛ اصلاح فقط با سند معکوس',
    descriptionFa: 'هر سند قطعی‌شده برای همیشه در دفتر می‌ماند؛ برای اصلاح باید سند معکوس ثبت شود. این قاعده ثابت است.',
  },
  {
    key: 'ledger.audit_chain_append_only',
    group: 'A',
    type: 'bool',
    allowed: [true],
    default: true,
    labelFa: 'گزارش رخدادها زنجیرهٔ درهم‌تنیده و فقط‌افزودنی است',
    descriptionFa: 'هر رخداد به رخداد پیشینش زنجیر می‌شود و ویرایش یا حذف رخدادهای گذشته ممکن نیست. این قاعده ثابت است.',
  },
  {
    key: 'ledger.locked_period_refuses_writes',
    group: 'A',
    type: 'bool',
    allowed: [true],
    default: true,
    labelFa: 'ثبت در دورهٔ قفل‌شده یا سال مالی بسته پذیرفته نمی‌شود',
    descriptionFa: 'پس از قفل‌شدن یک دوره یا بسته‌شدن سال مالی، هیچ سندی در آن بازه ثبت نمی‌شود. این قاعده ثابت است.',
  },

  // ------------------------------------------------------- group B (ledger / control)
  {
    key: 'purchase.invoice_review.reviewer_rule',
    group: 'B',
    type: 'enum',
    allowed: ['always_differs', 'differs_unless_sole_approver', 'creator_may_accept'],
    default: 'always_differs',
    labelFa: 'قاعدهٔ تأییدکنندهٔ صورتحساب معلق',
    descriptionFa: 'تعیین می‌کند چه کسی می‌تواند اختلاف صورتحساب خرید را بپذیرد؛ قاعدهٔ سخت‌گیرانه‌تر امن‌تر است.',
  },
  {
    key: 'fixed_asset.disposal_before_depreciation',
    group: 'B',
    type: 'enum',
    allowed: ['refuse', 'allow'],
    default: 'refuse',
    labelFa: 'فروش دارایی پیش از آخرین سند استهلاک',
    descriptionFa: 'اگر «رد کردن» باشد، فروش دارایی با تاریخی پیش از آخرین سند استهلاک ثبت‌شده رد می‌شود.',
  },

  // ------------------------------------------------------ group C (management)
  {
    key: 'purchase.three_way.qty_excess_tolerance_bp',
    group: 'C',
    type: 'int',
    allowed: { min: 0, max: 1000 },
    default: 0,
    labelFa: 'تلورانس مقدار اضافهٔ صورتحساب نسبت به رسید (صدم درصد)',
    descriptionFa: 'مقدار مجاز صورتحساب بیشتر از مقدار رسید، بر حسب صدم درصد از مقدار رسید.',
  },
  {
    key: 'purchase.three_way.price_tolerance_bp',
    group: 'C',
    type: 'int',
    allowed: { min: 0, max: 10000 },
    default: 0,
    labelFa: 'تلورانس درصدی تفاوت قیمت صورتحساب (صدم درصد)',
    descriptionFa: 'تفاوت مجاز قیمت واحد صورتحساب با سفارش، بر حسب صدم درصد از ارزش سفارش.',
    store: 'purchase_settings',
  },
  {
    key: 'purchase.three_way.price_tolerance_abs',
    group: 'C',
    type: 'int',
    allowed: { min: 0, max: 1_000_000_000_000 },
    default: 0,
    labelFa: 'تلورانس مطلق تفاوت قیمت صورتحساب (صدم ریال)',
    descriptionFa: 'تفاوت مجاز مطلق قیمت صورتحساب با سفارش، بر حسب صدم ریال.',
    store: 'purchase_settings',
  },
  {
    key: 'accounting.recurring_voucher.creation_mode',
    group: 'C',
    type: 'enum',
    allowed: ['draft_unless_auto_reverse', 'always_post'],
    default: 'draft_unless_auto_reverse',
    labelFa: 'حالت ساخت سند دوره‌ای',
    descriptionFa: 'اگر «همیشه قطعی» باشد سند دوره‌ای همان‌لحظه قطعی می‌شود؛ وگرنه تا برگشت خودکار پیش‌نویس می‌ماند.',
  },
];

const BY_KEY = new Map(POLICY_REGISTRY.map((definition) => [definition.key, definition]));

/** The definition of a key, or undefined for an unknown key. */
export function getPolicyDefinition(key: string): PolicyDefinition | undefined {
  return BY_KEY.get(key);
}

/** The safe default of a key (undefined for an unknown key). */
export function policyDefault(key: string): PolicyValue | undefined {
  return BY_KEY.get(key)?.default;
}

/**
 * Validates a candidate value against its definition, returning a Persian error on failure.
 * Types are strict: an int must be a whole JS number in range (never a numeric string), an enum
 * must be one of the allowed strings, and a fixed flag must be `true`.
 */
export function validatePolicyValue(key: string, value: unknown): PolicyValidation {
  const definition = BY_KEY.get(key);
  if (!definition) return { ok: false, error: `قاعدهٔ «${key}» شناخته‌شده نیست.` };

  if (definition.type === 'bool') {
    if (typeof value !== 'boolean' || !(definition.allowed as readonly boolean[]).includes(value)) {
      return { ok: false, error: 'مقدار این قاعده باید «درست» (فعال) باشد.' };
    }
    return { ok: true };
  }

  if (definition.type === 'enum') {
    if (typeof value !== 'string' || !(definition.allowed as readonly string[]).includes(value)) {
      return { ok: false, error: 'مقدار انتخابی برای این قاعده مجاز نیست.' };
    }
    return { ok: true };
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, error: 'مقدار این قاعده باید یک عدد صحیح باشد.' };
  }
  const range = definition.allowed as { readonly min: number; readonly max: number };
  if (value < range.min || value > range.max) {
    return { ok: false, error: `مقدار این قاعده باید بین ${range.min} و ${range.max} باشد.` };
  }
  return { ok: true };
}

/**
 * Checks whether a given policy value represents a weakened internal control or deviation from safe default (#584-6).
 */
export function isPolicyWeakened(key: string, value: unknown): boolean {
  const definition = BY_KEY.get(key);
  if (!definition) return false;
  if (value === definition.default) return false;

  switch (key) {
    case 'purchase.invoice_review.reviewer_rule':
      return value === 'creator_may_accept' || value === 'differs_unless_sole_approver';
    case 'fixed_asset.disposal_before_depreciation':
      return value === 'allow';
    case 'purchase.three_way.qty_excess_tolerance_bp':
    case 'purchase.three_way.price_tolerance_bp':
    case 'purchase.three_way.price_tolerance_abs':
      return typeof value === 'number' && value > 0;
    case 'accounting.recurring_voucher.creation_mode':
      return value === 'always_post';
    default:
      return definition.group === 'B';
  }
}

/**
 * Returns a Persian warning message when a control is weakened or turned off (#584-6).
 */
export function getWeakeningWarning(key: string, value: unknown): string | null {
  if (!isPolicyWeakened(key, value)) return null;

  switch (key) {
    case 'purchase.invoice_review.reviewer_rule':
      return value === 'creator_may_accept'
        ? 'هشدار کنترل داخلی: ایجادکنندهٔ صورتحساب خرید می‌تواند اختلافات را شخصاً تأیید کند (تفکیک وظایف غیرفعال شد).'
        : 'هشدار کنترل داخلی: در صورت تک‌تأییدکننده بودن، تفکیک وظایف بررسی صورتحساب خرید نادیده گرفته می‌شود.';
    case 'fixed_asset.disposal_before_depreciation':
      return 'هشدار کنترل داخلی: ثبت فروش دارایی قبل از آخرین سند استهلاک مجاز شد؛ ممکن است ارزش دفتری نادقیق ثبت شود.';
    case 'purchase.three_way.qty_excess_tolerance_bp':
      return `هشدار کنترل داخلی: تلورانس اضافه‌دریافت (${value} صدم درصد) فعال شد؛ مقادیر بیش از رسید بدون مغایرت پذیرفته می‌شوند.`;
    case 'purchase.three_way.price_tolerance_bp':
      return `هشدار کنترل داخلی: تلورانس درصدی قیمت (${value} صدم درصد) فعال شد؛ تفاوت قیمت با سفارش خودکار پذیرفته می‌شود.`;
    case 'purchase.three_way.price_tolerance_abs':
      return `هشدار کنترل داخلی: تلورانس مبلغی قیمت (${value} صدم ریال) فعال شد؛ تفاوت قیمت با سفارش خودکار پذیرفته می‌شود.`;
    case 'accounting.recurring_voucher.creation_mode':
      return 'هشدار کنترل داخلی: اسناد دوره‌ای به‌صورت خودکار قطعی می‌شوند و بررسی دستی پیش از ثبت در دفاتر غیرفعال شد.';
    default:
      return 'هشدار کنترل داخلی: تنظیمات این قاعده از حالت امن پیش‌فرض خارج شده است.';
  }
}
