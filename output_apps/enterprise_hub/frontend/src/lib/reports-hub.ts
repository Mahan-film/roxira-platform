export interface ReportCard {
  key: string;
  title: string;
  description: string;
}

export interface ReportGroup {
  id: string;
  title: string;
  reports: ReportCard[];
}

export const REPORT_GROUPS: ReportGroup[] = [
  {
    id: "statements",
    title: "صورت‌های مالی",
    reports: [
      { key: "balance-sheet", title: "ترازنامه", description: "وضعیت دارایی‌ها، بدهی‌ها و حقوق مالکانه در یک تاریخ" },
      { key: "income-statement", title: "سود و زیان", description: "درآمد، هزینه و سود یا زیان یک دوره" },
      { key: "cash-flow", title: "جریان نقد", description: "ورود و خروج نقد در یک دوره" },
      { key: "equity-changes", title: "تغییرات حقوق مالکانه", description: "تغییر سرمایه، اندوخته و سود انباشته در یک دوره" },
    ],
  },
  {
    id: "books",
    title: "دفاتر و تراز",
    reports: [
      { key: "trial-balance", title: "تراز آزمایشی", description: "مانده بدهکار و بستانکار حساب‌ها" },
      { key: "subsidiary", title: "تراز تفصیلی", description: "مانده معین‌ها به تفکیک تفصیلی" },
      { key: "ledger", title: "دفتر کل و معین", description: "گردش یک حساب یا یک معین" },
      { key: "journal-book", title: "دفتر روزنامه", description: "همه اسناد به ترتیب تاریخ و شماره" },
      { key: "general-ledger-book", title: "دفتر کل (چاپی)", description: "دفتر کل آماده چاپ" },
      { key: "chart-of-accounts", title: "سرفصل حساب‌ها", description: "فهرست کامل سرفصل‌ها برای خروجی" },
    ],
  },
  {
    id: "receivables",
    title: "مطالبات و بدهی‌ها",
    reports: [
      { key: "ageing", title: "گزارش سنی", description: "سن مطالبات و بدهی‌ها بر اساس روز گذشت" },
      { key: "party-statement", title: "صورت‌حساب طرف حساب", description: "گردش حساب یک مشتری یا تأمین‌کننده" },
    ],
  },
];

export const ALL_REPORT_KEYS: string[] = REPORT_GROUPS.flatMap((g) => g.reports.map((r) => r.key));

export function reportHref(key: string): string {
  return `/app/accounting/reports?tab=${key}`;
}

export function parseReportTab(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALL_REPORT_KEYS.includes(value) ? value : null;
}
