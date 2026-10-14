import { CrmLeadField } from '../constants/data-import.constants';

/**
 * نگاشت قطعی (fallback) سربرگ ستون‌ها به فیلدهای سرنخ CRM.
 *
 * وقتی فراخوانی LLM ناموفق باشد یا خروجی نگاشت خالی/نامعتبر بدهد، این نگاشت
 * مترادف‌های فارسی/انگلیسی جایگزین می‌شود تا «ورود داده» هرگز به‌خاطر خطای
 * مدل متوقف نشود. طراحی عمداً ساده و قطعی است (بدون شبکه، بدون تصادفی‌بودن).
 */
export const LEAD_FIELD_SYNONYMS: Record<CrmLeadField, string[]> = {
  fullName: [
    'fullName',
    'name',
    'full name',
    'contact name',
    'customer name',
    'display name',
    'نام',
    'نام کامل',
    'نام و نام خانوادگی',
    'نام مخاطب',
    'نام مشتری',
    'اسم',
    'عنوان',
  ],
  email: [
    'email',
    'e-mail',
    'email address',
    'mail',
    'رایانامه',
    'ایمیل',
    'پست الکترونیک',
    'پست الکترونیکی',
  ],
  phone: [
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'telephone',
    'tel',
    'cell',
    'contact number',
    'تلفن',
    'شماره تلفن',
    'شماره تماس',
    'موبایل',
    'شماره همراه',
    'همراه',
    'تلفن همراه',
  ],
  company: [
    'company',
    'company name',
    'organization',
    'organisation',
    'org',
    'account',
    'شرکت',
    'نام شرکت',
    'سازمان',
    'موسسه',
    'مؤسسه',
    'مجموعه',
  ],
  pipelineStage: [
    'pipelineStage',
    'pipeline stage',
    'stage',
    'status',
    'deal stage',
    'مرحله',
    'مرحله فروش',
    'وضعیت',
  ],
  estimatedValue: [
    'estimatedValue',
    'estimated value',
    'value',
    'amount',
    'deal value',
    'opportunity value',
    'price',
    'ارزش',
    'ارزش معامله',
    'مبلغ',
    'مبلغ برآوردی',
    'قیمت',
  ],
  owner: [
    'owner',
    'sales rep',
    'sales representative',
    'salesperson',
    'responsible',
    'assigned to',
    'کارشناس',
    'کارشناس فروش',
    'مسئول',
    'مالک',
  ],
  notes: [
    'notes',
    'note',
    'description',
    'comment',
    'comments',
    'remarks',
    'توضیحات',
    'توضیح',
    'یادداشت',
    'شرح',
    'ملاحظات',
  ],
};

/**
 * نرمال‌سازی سربرگ برای تطبیق مترادف‌ها: حروف کوچک، حذف نیم‌فاصله/علامت‌های
 * جداسازی و یکسان‌سازی فاصله‌ها.
 */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200e\u200f]/g, '')
    .replace(/[_\-./\\()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ساخت نگاشت پیشنهادی قطعی از سربرگ‌ها.
 *
 * هر سربرگ در صورت تطبیق با یک مترادف به فیلد متناظر نگاشت می‌شود؛ هر فیلد
 * فقط یک بار (اولین ستون منطبق) انتخاب می‌شود و ستون‌های ناشناخته حذف می‌گردند.
 */
export function buildFallbackMapping(
  headers: string[],
): Record<string, string> {
  const synonymToField = new Map<string, CrmLeadField>();
  for (const field of Object.keys(LEAD_FIELD_SYNONYMS) as CrmLeadField[]) {
    for (const synonym of LEAD_FIELD_SYNONYMS[field]) {
      synonymToField.set(normalizeHeader(synonym), field);
    }
  }

  const mapping: Record<string, string> = {};
  const usedFields = new Set<CrmLeadField>();
  for (const header of headers) {
    if (!header) {
      continue;
    }
    const field = synonymToField.get(normalizeHeader(header));
    if (field && !usedFields.has(field)) {
      mapping[header] = field;
      usedFields.add(field);
    }
  }
  return mapping;
}
