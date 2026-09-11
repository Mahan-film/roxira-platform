/**
 * شمارشی‌ها و برچسب‌های معنایی ماژول «تطبیق سامانه مودیان».
 */

/**
 * وضعیت ارسال بسته مالیاتی به سامانه مودیان.
 *
 * SIGNED:
 *   بسته صورتحساب با کلید خصوصی سازمان امضا شده اما هنوز ارسال/پذیرش
 *   رسمی از سوی سامانه مودیان دریافت نشده است.
 * SENT:
 *   بسته امضاشده به سامانه مودیان ارسال شده و در انتظار پذیرش قطعی است.
 * ACCEPTED:
 *   سامانه مودیان بسته را پذیرفته و شماره مرجع رسمی صادر کرده است.
 * REJECTED:
 *   سامانه مودیان بسته را به دلیل خطای اعتبارسنجی/مالیاتی رد کرده است.
 */
export enum TaxSubmissionStatus {
  SIGNED = 'SIGNED',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/** برچسب فارسی وضعیت ارسال مالیاتی برای گزارش‌ها و UI. */
export const TAX_SUBMISSION_STATUS_LABELS: Record<TaxSubmissionStatus, string> = {
  [TaxSubmissionStatus.SIGNED]: 'امضاشده (در انتظار ارسال)',
  [TaxSubmissionStatus.SENT]: 'ارسال‌شده (در انتظار پذیرش)',
  [TaxSubmissionStatus.ACCEPTED]: 'پذیرفته‌شده توسط مودیان',
  [TaxSubmissionStatus.REJECTED]: 'ردشده توسط مودیان',
};

/** وضعیت‌هایی که نشان‌دهنده تکمیل موفق چرخه مالیاتی هستند. */
export const TERMINAL_ACCEPTED_STATUS: ReadonlySet<TaxSubmissionStatus> = new Set([
  TaxSubmissionStatus.ACCEPTED,
]);
