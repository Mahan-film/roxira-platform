/**
 * محاسبه و هشدار مهلت قانونی ارسال صورتحساب‌ها به سامانه مؤدیان (T95 / ماده ۱ قانون پایانه‌های فروشگاهی).
 *
 * طبق مقررات سازمان امور مالیاتی، مؤدیان موظفند حداکثر ظرف مهلت قانونی مشخص‌شده
 * (پیش‌فرض ۷ روز کاری/تقویمی) صورتحساب‌های الکترونیکی خود را به سامانه ارسال نمایند.
 */

export const MOADIAN_DEFAULT_DEADLINE_DAYS = 7;

export type MoadianDeadlineUrgency = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXPIRED';

export interface MoadianInvoiceDeadlineView {
  elapsedDays: number;
  remainingDays: number;
  deadlineDays: number;
  urgency: MoadianDeadlineUrgency;
  isExpired: boolean;
  isUrgent: boolean;
  statusLabel: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  description: string;
}

export interface UnsentInvoiceInput {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  total?: number | string | bigint;
  buyerName?: string | null;
  status?: string;
  direction?: string;
}

/**
 * محاسبه وضعیت مهلت ارسال یک صورتحساب.
 */
export function calculateMoadianDeadline(
  issueDateStr: string,
  deadlineDays: number = MOADIAN_DEFAULT_DEADLINE_DAYS,
  referenceDate: Date = new Date(),
): MoadianInvoiceDeadlineView {
  const safeDeadlineDays = Number.isFinite(deadlineDays) && deadlineDays > 0 ? deadlineDays : MOADIAN_DEFAULT_DEADLINE_DAYS;
  const issue = new Date(issueDateStr);
  const now = new Date(referenceDate);

  // صفر کردن ساعت برای محاسبه دقیق بر حسب روز
  const issueMidnight = new Date(issue.getFullYear(), issue.getMonth(), issue.getDate()).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const diffMs = nowMidnight - issueMidnight;
  const elapsedDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const remainingDays = safeDeadlineDays - elapsedDays;

  let urgency: MoadianDeadlineUrgency;
  let statusLabel: string;
  let badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  let description: string;

  if (remainingDays < 0) {
    urgency = 'EXPIRED';
    statusLabel = 'منقضی شده';
    badgeVariant = 'destructive';
    description = `مهلت قانونی ارسال ${Math.abs(remainingDays)} روز پیش به پایان رسیده است (مشمول جریمه ماده ۲۲).`;
  } else if (remainingDays === 0) {
    urgency = 'CRITICAL';
    statusLabel = 'روز آخر مهلت';
    badgeVariant = 'destructive';
    description = 'امروز آخرین روز مهلت قانونی ارسال به سامانه مؤدیان است.';
  } else if (remainingDays <= 2) {
    urgency = 'WARNING';
    statusLabel = `${remainingDays} روز باقی‌مانده`;
    badgeVariant = 'outline';
    description = `تنها ${remainingDays} روز تا پایان مهلت ارسال به سامانه مؤدیان باقی است.`;
  } else {
    urgency = 'NORMAL';
    statusLabel = `${remainingDays} روز باقی‌مانده`;
    badgeVariant = 'secondary';
    description = `مهلت قانونی (${safeDeadlineDays} روزه) برقرار است.`;
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
  deadlineDays: number = MOADIAN_DEFAULT_DEADLINE_DAYS,
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
  };

  return ranked.sort((a, b) => {
    const diffUrgency = urgencyOrder[a.deadline.urgency] - urgencyOrder[b.deadline.urgency];
    if (diffUrgency !== 0) return diffUrgency;
    return a.deadline.remainingDays - b.deadline.remainingDays;
  });
}
