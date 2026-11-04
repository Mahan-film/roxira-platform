import { AccessModule } from '../../access/catalogue';

/** مبلغ دقیق JSON: عدد وقتی دقیق است، وگرنه رشته اعشاری (مانند `fromMinor`). */
export type Money = number | string;

export type MetricUnit = 'IRR' | 'count' | 'percent';

export type MetricSide = 'receivable' | 'payable';

/**
 * درگاه‌های خواندنی که متریک‌ها از آن‌ها محاسبه می‌شوند. هر درگاه یک سرویس
 * گزارش موجود را (فقط‌خواندنی و با شناسهٔ مستأجر) صدا می‌زند؛ ریاضی دفتر کل
 * اینجا تکرار نمی‌شود. همهٔ مبالغ ریال‌اند.
 */
export interface MetricSources {
  /** مانده‌های سرفصل از دفتر کل (اسناد قطعی‌شده) تا تاریخ `asOf` (YYYY-MM-DD). */
  dashboard(
    tenantId: string,
    asOf: string,
  ): Promise<{
    cash: Money;
    bank: Money;
    receivables: Money;
    payables: Money;
    taxDue: Money;
    inventory: Money;
  }>;
  /** صورت سود و زیان از ابتدای سال مالی تا `asOf`. */
  incomeStatement(
    tenantId: string,
    asOf: string,
  ): Promise<{
    revenue: Money;
    grossProfit: Money;
    operatingExpenses: Money;
    netProfit: Money;
  }>;
  balanceSheet(
    tenantId: string,
    asOf: string,
  ): Promise<{
    totalAssets: Money;
    totalLiabilities: Money;
    totalEquity: Money;
  }>;
  /** سن مطالبات/بدهی‌ها: مبلغ باز هر سطل سنی، به ترتیب سطل‌ها. */
  ageing(
    tenantId: string,
    side: MetricSide,
    asOf: string,
  ): Promise<{
    buckets: Array<{ fromDay: number }>;
    amounts: Money[];
  }>;
  /**
   * جمع فروش (صادرشده و پرداخت‌شده) در بازهٔ نیم‌باز `[from, to)`. فقط صورتحساب‌های
   * ریالی؛ ارزهای دیگر هرگز با ریال جمع نمی‌شوند (آداپتور باید فیلتر کند).
   */
  salesTotals(
    tenantId: string,
    range: { from: Date; to: Date },
  ): Promise<{ count: number; payable: Money; vat: Money }>;
  stock(
    tenantId: string,
  ): Promise<{ fifoValue: Money; lowStockCount: number }>;
  /**
   * چک‌های باز با سررسید تا `days` روز آینده + معوق‌ها (جمع‌ها به ریال). تعداد کالاهای زیر
   * نقطهٔ سفارش در `stock` باید شمارش کل مستأجر باشد، نه یک صفحه.
   */
  chequesDue(
    tenantId: string,
    days: number,
    asOf: string,
  ): Promise<{
    receivedTotal: Money;
    issuedTotal: Money;
    overdueCount: number;
  }>;
  /** اجرای حقوق یک ماه شمسی؛ `null` اگر اجرایی نیست. */
  payrollRun(
    tenantId: string,
    jy: number,
    jm: number,
  ): Promise<{
    employeeCount: number;
    totalGross: Money;
    totalEmployerInsurance: Money;
    totalUnemploymentInsurance: Money;
  } | null>;
  /** پیش‌نویس اظهارنامهٔ ارزش افزودهٔ یک فصل شمسی. */
  vatSeason(
    tenantId: string,
    year: number,
    quarter: number,
  ): Promise<{ payable: Money; reconciled: boolean }>;
}

export const METRIC_SOURCES = Symbol('METRIC_SOURCES');

export interface MetricContext {
  tenantId: string;
  now: Date;
  /** امروز به وقت تهران، YYYY-MM-DD میلادی. */
  today: string;
  /** تاریخ شمسی امروز. */
  jalali: { jy: number; jm: number; jd: number };
  sources: MetricSources;
}

/** نتیجهٔ محاسبهٔ یک متریک؛ `null` یعنی شواهد کافی نیست (دستیار باید پرهیز کند). */
export type MetricComputation =
  | { value: Money }
  | { value: null; reasonFa: string };

export interface MetricDefinition {
  id: string;
  labelFa: string;
  unit: MetricUnit;
  /** ماژولی که کاربر باید در آن دسترسی خواندن داشته باشد. */
  module: AccessModule;
  /** تعریف دقیق به فارسی: از کدام داده و با چه قاعده‌ای. */
  definitionFa: string;
  compute(ctx: MetricContext): Promise<MetricComputation>;
}

export interface MetricResult {
  id: string;
  labelFa: string;
  unit: MetricUnit;
  /** `null` = بدون شواهد. */
  value: Money | null;
  reasonFa?: string;
  asOf: string;
  definitionFa: string;
}
