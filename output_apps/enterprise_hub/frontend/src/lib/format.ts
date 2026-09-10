/** توابع کمکی قالب‌بندی اعداد/تاریخ برای نمایش خروجی محاسبات */

const RIAL_FORMATTER = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 2,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatRial(value: number): string {
  return `${RIAL_FORMATTER.format(value)} ریال`;
}

export function formatNumber(value: number): string {
  return RIAL_FORMATTER.format(value);
}

export function formatPersianDate(isoDate: string): string {
  try {
    return DATE_FORMATTER.format(new Date(isoDate));
  } catch {
    return isoDate;
  }
}
