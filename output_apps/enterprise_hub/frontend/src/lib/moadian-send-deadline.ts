/**
 * محاسبه و هشدار مهلت ارسال صورتحساب‌ها به سامانه مؤدیان (بر پایه آستانه روز تقویمی واردشده توسط کاربر).
 *
 * بدون آستانه تنظیم‌شده توسط کاربر، برچسب «منقضی شده» یا پیش‌فرض قانونی اعمال نمی‌شود؛
 * مهلت‌ها و روزهای کاری/تعطیل رسمی تابع آخرین بخشنامه‌های سازمان امور مالیاتی است.
 */

export const MOADIAN_MAX_DEADLINE_DAYS = 365;
const TEHRAN_TIME_ZONE = 'Asia/Tehran';
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type MoadianDeadlineUrgency =
  | 'UNCONFIGURED'
  | 'NORMAL'
  | 'WARNING'
  | 'CRITICAL'
  | 'EXPIRED';

export interface MoadianInvoiceDeadlineView {
  elapsedDays: number;
  remainingDays: number | null;
  deadlineDays: number | null;
  urgency: MoadianDeadlineUrgency;
  isExpired: boolean;
  isUrgent: boolean;
  statusLabel: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  description: string;
}

export interface UnsentInvoiceInput {
  id: string;
  invoiceNumber?: string;
  issueDate: string;
  total?: number | string;
  buyerName?: string | null;
  status?: string;
  direction?: string;
}

function toTehranDayUtcMs(date: Date): number | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
}

function normalizeDeadlineDays(deadlineDays?: number | null): number | null {
  if (deadlineDays === null || deadlineDays === undefined) return null;
  if (!Number.isFinite(deadlineDays)) return null;
  const floored = Math.floor(deadlineDays);
  if (floored <= 0) return null;
  return Math.min(MOADIAN_MAX_DEADLINE_DAYS, floored);
}

/**
 * محاسبه وضعیت مهلت ارسال یک صورتحساب در تقویم ایران (`Asia/Tehran`).
 */
export function calculateMoadianDeadline(
  issueDateStr: string,
  deadlineDays?: number | null,
  referenceDate: Date = new Date(),
): MoadianInvoiceDeadlineView {
  const safeDeadlineDays = normalizeDeadlineDays(deadlineDays);
  const issueMidnight = toTehranDayUtcMs(new Date(issueDateStr));
  const nowMidnight = toTehranDayUtcMs(new Date(referenceDate));

  const elapsedDays =
    issueMidnight !== null && nowMidnight !== null
      ? Math.max(0, Math.round((nowMidnight - issueMidnight) / MS_PER_DAY))
      : 0;

  if (safeDeadlineDays === null) {
    return {
      elapsedDays,
      remainingDays: null,
      deadlineDays: null,
      urgency: 'UNCONFIGURED',
      isExpired: false,
      isUrgent: false,
      statusLabel: 'آستانه تنظیم نشده',
      badgeVariant: 'outline',
      description: `از تاریخ صدور ${elapsedDays} روز سپری شده است. برای پایش هشدارها آستانه را وارد کنید.`,
    };
  }

  const remainingDays = safeDeadlineDays - elapsedDays;

  let urgency: MoadianDeadlineUrgency;
  let statusLabel: string;
  let badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  let description: string;

  if (remainingDays < 0) {
    urgency = 'EXPIRED';
    statusLabel = 'منقضی شده';
    badgeVariant = 'destructive';
    description = `آستانه ${safeDeadlineDays} روز تقویمی ارسال ${Math.abs(remainingDays)} روز پیش به پایان رسیده است.`;
  } else if (remainingDays === 0) {
    urgency = 'CRITICAL';
    statusLabel = 'روز آخر مهلت';
    badgeVariant = 'destructive';
    description = 'امروز آخرین روز مهلت تنظیم‌شده برای ارسال به سامانه مؤدیان است.';
  } else if (remainingDays <= 2) {
    urgency = 'WARNING';
    statusLabel = `${remainingDays} روز باقی‌مانده`;
    badgeVariant = 'outline';
    description = `تنها ${remainingDays} روز تا پایان مهلت تنظیم‌شده برای ارسال به سامانه مؤدیان باقی است.`;
  } else {
    urgency = 'NORMAL';
    statusLabel = `${remainingDays} روز باقی‌مانده`;
    badgeVariant = 'secondary';
    description = `مهلت ارسال (${safeDeadlineDays} روز تقویمی) برقرار است.`;
  }

  return {
    elapsedDays,
    remainingDays,
    deadlineDays: safeDeadlineDays,
    urgency,
    isExpired: urgency === 'EXPIRED',
    isUrgent: urgency === 'EXPIRED' || urgency === 'CRITICAL' || urgency === 'WARNING',
    statusLabel,
    badgeVariant,
    description,
  };
}

/**
 * فیلتر و مرتب‌سازی صورتحساب‌های ارسال‌نشده با اولویت فوریت مهلت (منقضی و بحرانی در ابتدا).
 */
export function sortUnsentInvoicesByUrgency<T extends UnsentInvoiceInput>(
  invoices: T[],
  deadlineDays?: number | null,
  referenceDate: Date = new Date(),
): Array<{ invoice: T; deadline: MoadianInvoiceDeadlineView }> {
  const ranked = invoices.map((inv) => ({
    invoice: inv,
    deadline: calculateMoadianDeadline(inv.issueDate, deadlineDays, referenceDate),
  }));

  const urgencyOrder: Record<MoadianDeadlineUrgency, number> = {
    EXPIRED: 0,
    CRITICAL: 1,
    WARNING: 2,
    NORMAL: 3,
    UNCONFIGURED: 4,
  };

  return ranked.sort((a, b) => {
    const diffUrgency = urgencyOrder[a.deadline.urgency] - urgencyOrder[b.deadline.urgency];
    if (diffUrgency !== 0) return diffUrgency;
    if (a.deadline.remainingDays !== null && b.deadline.remainingDays !== null) {
      return a.deadline.remainingDays - b.deadline.remainingDays;
    }
    return b.deadline.elapsedDays - a.deadline.elapsedDays;
  });
}
