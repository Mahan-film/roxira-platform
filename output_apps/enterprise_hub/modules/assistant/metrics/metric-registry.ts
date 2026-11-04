import { AccessModule } from '../../access/catalogue';
import { fromMinor, toMinor } from '../../accounting/money';
import { resolvePeriod } from '../services/jalali-period';
import {
  MetricComputation,
  MetricContext,
  MetricDefinition,
  MetricSide,
  Money,
} from './metric.types';

/** مطالبات/بدهی‌های قدیمی‌تر از این تعداد روز «معوق» حساب می‌شوند. */
export const OVERDUE_AFTER_DAYS = 30;
/** پنجرهٔ «چک‌های نزدیک سررسید». */
export const CHEQUE_DUE_WINDOW_DAYS = 7;

const done = (minor: bigint): MetricComputation => ({ value: fromMinor(minor) });
const count = (n: number): MetricComputation => ({ value: n });
const noEvidence = (reasonFa: string): MetricComputation => ({
  value: null,
  reasonFa,
});

/** نسبت درصدی با دو رقم اعشار، بدون محاسبهٔ اعشاری روی مبالغ. */
function percent(part: bigint, whole: bigint): number {
  return Number((part * 10_000n) / whole) / 100;
}

const ledger = (
  id: string,
  labelFa: string,
  definitionFa: string,
  pick: (ctx: MetricContext) => Promise<Money>,
  module: AccessModule = AccessModule.ACCOUNTING,
): MetricDefinition => ({
  id,
  labelFa,
  unit: 'IRR',
  module,
  definitionFa,
  compute: async (ctx) => done(toMinor(await pick(ctx))),
});

async function overdue(ctx: MetricContext, side: MetricSide): Promise<bigint> {
  const report = await ctx.sources.ageing(ctx.tenantId, side, ctx.today);
  return report.buckets.reduce(
    (sum, bucket, index) =>
      bucket.fromDay > OVERDUE_AFTER_DAYS
        ? sum + toMinor(report.amounts[index] ?? 0)
        : sum,
    0n,
  );
}

async function sales(ctx: MetricContext, period: 'this_month' | 'last_month') {
  const range = resolvePeriod({ period }, ctx.now);
  return ctx.sources.salesTotals(ctx.tenantId, {
    from: range.from as Date,
    to: range.to as Date,
  });
}

const season = (ctx: MetricContext) => ({
  year: ctx.jalali.jy,
  quarter: Math.ceil(ctx.jalali.jm / 3),
});

/**
 * ثبت‌نام متریک‌های تأییدشدهٔ دستیار. هر عدد در پاسخ دستیار باید از اینجا یا از
 * نتیجهٔ یک ابزار همان نوبت بیاید (اعتبارسنج عددی). هر متریک فقط از سرویس‌های
 * گزارش موجود می‌خواند؛ دستیار هرگز SQL آزاد نمی‌سازد و هیچ‌چیز در دفتر ثبت نمی‌کند.
 */
export const METRIC_REGISTRY: readonly MetricDefinition[] = [
  ledger('cash_balance', 'موجودی صندوق', 'مانده بدهکار حساب‌های نقد و تنخواه در دفتر کل (اسناد قطعی) تا امروز.', async (c) => (await c.sources.dashboard(c.tenantId, c.today)).cash),
  ledger('bank_balance', 'موجودی بانک', 'مانده بدهکار حساب‌های بانکی در دفتر کل (اسناد قطعی) تا امروز.', async (c) => (await c.sources.dashboard(c.tenantId, c.today)).bank),
  {
    id: 'liquid_funds',
    labelFa: 'نقدینگی (صندوق + بانک)',
    unit: 'IRR',
    module: AccessModule.ACCOUNTING,
    definitionFa: 'جمع موجودی صندوق و بانک از دفتر کل تا امروز.',
    compute: async (c) => {
      const d = await c.sources.dashboard(c.tenantId, c.today);
      return done(toMinor(d.cash) + toMinor(d.bank));
    },
  },
  ledger('receivables', 'مطالبات از مشتریان', 'مانده بدهکار حساب‌های دریافتنی در دفتر کل تا امروز.', async (c) => (await c.sources.dashboard(c.tenantId, c.today)).receivables),
  ledger('payables', 'بدهی به تأمین‌کنندگان', 'مانده بستانکار حساب‌های پرداختنی در دفتر کل تا امروز.', async (c) => (await c.sources.dashboard(c.tenantId, c.today)).payables),
  {
    id: 'overdue_receivables',
    labelFa: 'مطالبات معوق',
    unit: 'IRR',
    module: AccessModule.ACCOUNTING,
    definitionFa: `جمع اقلام باز مطالبات که بیش از ${OVERDUE_AFTER_DAYS} روز از تاریخ سندشان گذشته (گزارش سن مطالبات).`,
    compute: async (c) => done(await overdue(c, 'receivable')),
  },
  {
    id: 'overdue_payables',
    labelFa: 'بدهی‌های معوق',
    unit: 'IRR',
    module: AccessModule.ACCOUNTING,
    definitionFa: `جمع اقلام باز بدهی که بیش از ${OVERDUE_AFTER_DAYS} روز از تاریخ سندشان گذشته (گزارش سن بدهی‌ها).`,
    compute: async (c) => done(await overdue(c, 'payable')),
  },
  {
    id: 'sales_this_month',
    labelFa: 'فروش این ماه (شمسی)',
    unit: 'IRR',
    module: AccessModule.INVOICING,
    definitionFa: 'جمع مبلغ قابل‌پرداخت صورتحساب‌های صادرشده و پرداخت‌شده (ریالی) در ماه شمسی جاری؛ پیش‌نویس و باطل‌شده نیستند.',
    compute: async (c) => done(toMinor((await sales(c, 'this_month')).payable)),
  },
  {
    id: 'sales_last_month',
    labelFa: 'فروش ماه گذشته (شمسی)',
    unit: 'IRR',
    module: AccessModule.INVOICING,
    definitionFa: 'مانند فروش این ماه، برای ماه شمسی قبل.',
    compute: async (c) => done(toMinor((await sales(c, 'last_month')).payable)),
  },
  {
    id: 'sales_change_pct',
    labelFa: 'تغییر فروش این ماه نسبت به ماه گذشته',
    unit: 'percent',
    module: AccessModule.INVOICING,
    definitionFa: '(فروش این ماه − فروش ماه گذشته) ÷ فروش ماه گذشته × ۱۰۰؛ اگر ماه گذشته فروشی نداشته باشد تعریف‌نشده است.',
    compute: async (c) => {
      const now = toMinor((await sales(c, 'this_month')).payable);
      const before = toMinor((await sales(c, 'last_month')).payable);
      if (before <= 0n) {
        return noEvidence('ماه گذشته فروشی ثبت نشده و درصد تغییر تعریف نمی‌شود.');
      }
      return { value: percent(now - before, before) };
    },
  },
  {
    id: 'invoice_count_this_month',
    labelFa: 'تعداد صورتحساب‌های این ماه',
    unit: 'count',
    module: AccessModule.INVOICING,
    definitionFa: 'تعداد صورتحساب‌های صادرشده و پرداخت‌شدهٔ ریالی در ماه شمسی جاری.',
    compute: async (c) => count((await sales(c, 'this_month')).count),
  },
  {
    id: 'vat_collected_this_month',
    labelFa: 'مالیات ارزش افزوده فروش این ماه',
    unit: 'IRR',
    module: AccessModule.INVOICING,
    definitionFa: 'جمع مالیات صورتحساب‌های صادرشده و پرداخت‌شدهٔ ریالی در ماه شمسی جاری.',
    compute: async (c) => done(toMinor((await sales(c, 'this_month')).vat)),
  },
  ledger('revenue_ytd', 'درآمد از ابتدای سال مالی', 'جمع درآمدهای عملیاتی (پس از برگشت از فروش) در صورت سود و زیان دفتر کل از ابتدای سال مالی.', async (c) => (await c.sources.incomeStatement(c.tenantId, c.today)).revenue),
  ledger('gross_profit_ytd', 'سود ناخالص از ابتدای سال مالی', 'درآمد عملیاتی منهای بهای تمام‌شده در صورت سود و زیان دفتر کل.', async (c) => (await c.sources.incomeStatement(c.tenantId, c.today)).grossProfit),
  {
    id: 'gross_margin_pct',
    labelFa: 'حاشیه سود ناخالص',
    unit: 'percent',
    module: AccessModule.ACCOUNTING,
    definitionFa: 'سود ناخالص ÷ درآمد عملیاتی × ۱۰۰ از ابتدای سال مالی؛ بدون درآمد تعریف‌نشده است.',
    compute: async (c) => {
      const s = await c.sources.incomeStatement(c.tenantId, c.today);
      const revenue = toMinor(s.revenue);
      if (revenue <= 0n) {
        return noEvidence('درآمدی در سال مالی جاری ثبت نشده و حاشیه سود تعریف نمی‌شود.');
      }
      return { value: percent(toMinor(s.grossProfit), revenue) };
    },
  },
  ledger('operating_expenses_ytd', 'هزینه‌های عملیاتی از ابتدای سال مالی', 'جمع هزینه‌های عملیاتی در صورت سود و زیان دفتر کل.', async (c) => (await c.sources.incomeStatement(c.tenantId, c.today)).operatingExpenses),
  ledger('net_profit_ytd', 'سود خالص از ابتدای سال مالی', 'سود خالص صورت سود و زیان دفتر کل از ابتدای سال مالی.', async (c) => (await c.sources.incomeStatement(c.tenantId, c.today)).netProfit),
  ledger('total_assets', 'جمع دارایی‌ها', 'جمع دارایی‌های ترازنامهٔ دفتر کل تا امروز.', async (c) => (await c.sources.balanceSheet(c.tenantId, c.today)).totalAssets),
  ledger('total_liabilities', 'جمع بدهی‌ها', 'جمع بدهی‌های ترازنامهٔ دفتر کل تا امروز.', async (c) => (await c.sources.balanceSheet(c.tenantId, c.today)).totalLiabilities),
  ledger('total_equity', 'جمع حقوق صاحبان سرمایه', 'جمع حقوق صاحبان سرمایه در ترازنامهٔ دفتر کل تا امروز.', async (c) => (await c.sources.balanceSheet(c.tenantId, c.today)).totalEquity),
  {
    id: 'vat_payable_season',
    labelFa: 'مالیات ارزش افزوده قابل پرداخت این فصل',
    unit: 'IRR',
    module: AccessModule.TAX,
    definitionFa: 'مبلغ قابل پرداخت در پیش‌نویس اظهارنامهٔ ارزش افزودهٔ فصل شمسی جاری (مالیات فروش منهای مالیات ورودی و منهای اعتبار منتقل‌شده از فصل‌های قبل در همان سال)؛ فقط وقتی با دفتر کل مطابقت دارد گزارش می‌شود.',
    compute: async (c) => {
      const { year, quarter } = season(c);
      const vat = await c.sources.vatSeason(c.tenantId, year, quarter);
      if (!vat.reconciled) {
        return noEvidence('پیش‌نویس ارزش افزودهٔ این فصل با دفتر کل مطابقت ندارد؛ عدد قطعی نیست.');
      }
      return { value: vat.payable };
    },
  },
  ledger('stock_value', 'ارزش موجودی انبار', 'جمع ارزش FIFO کالاهای انبار (سرویس انبار).', async (c) => (await c.sources.stock(c.tenantId)).fifoValue, AccessModule.INVENTORY),
  {
    id: 'below_reorder_count',
    labelFa: 'تعداد کالاهای زیر نقطه سفارش',
    unit: 'count',
    module: AccessModule.INVENTORY,
    definitionFa: 'تعداد کالاهایی که موجودی‌شان از حداقل تعریف‌شده کمتر یا مساوی است.',
    compute: async (c) => count((await c.sources.stock(c.tenantId)).lowStockCount),
  },
  {
    id: 'payroll_cost_this_month',
    labelFa: 'هزینه حقوق این ماه',
    unit: 'IRR',
    module: AccessModule.HR,
    definitionFa: 'جمع ناخالص حقوق، بیمهٔ سهم کارفرما و بیمهٔ بیکاری (همان ترکیب سند حسابداری حقوق) در اجرای حقوق ثبت‌شده (قطعی) ماه شمسی جاری؛ بدون اجرای ثبت‌شده تعریف‌نشده است.',
    compute: async (c) => {
      const run = await c.sources.payrollRun(c.tenantId, c.jalali.jy, c.jalali.jm);
      if (!run) {
        return noEvidence('برای این ماه اجرای حقوق ثبت‌شده (قطعی) وجود ندارد.');
      }
      return done(
        toMinor(run.totalGross) +
          toMinor(run.totalEmployerInsurance) +
          toMinor(run.totalUnemploymentInsurance),
      );
    },
  },
  {
    id: 'cheques_due_7d_received',
    labelFa: `چک‌های دریافتی سررسید تا ${CHEQUE_DUE_WINDOW_DAYS} روز آینده`,
    unit: 'IRR',
    module: AccessModule.CHEQUES,
    definitionFa: `جمع چک‌های دریافتی باز با سررسید تا ${CHEQUE_DUE_WINDOW_DAYS} روز آینده، با احتساب معوق‌ها.`,
    compute: async (c) => done(toMinor((await c.sources.chequesDue(c.tenantId, CHEQUE_DUE_WINDOW_DAYS, c.today)).receivedTotal)),
  },
  {
    id: 'cheques_due_7d_issued',
    labelFa: `چک‌های پرداختی سررسید تا ${CHEQUE_DUE_WINDOW_DAYS} روز آینده`,
    unit: 'IRR',
    module: AccessModule.CHEQUES,
    definitionFa: `جمع چک‌های صادرشدهٔ باز با سررسید تا ${CHEQUE_DUE_WINDOW_DAYS} روز آینده، با احتساب معوق‌ها.`,
    compute: async (c) => done(toMinor((await c.sources.chequesDue(c.tenantId, CHEQUE_DUE_WINDOW_DAYS, c.today)).issuedTotal)),
  },
  {
    id: 'cheques_overdue_count',
    labelFa: 'تعداد چک‌های معوق',
    unit: 'count',
    module: AccessModule.CHEQUES,
    definitionFa: 'تعداد چک‌های بازی که سررسیدشان گذشته است.',
    compute: async (c) => count((await c.sources.chequesDue(c.tenantId, CHEQUE_DUE_WINDOW_DAYS, c.today)).overdueCount),
  },
];

export const METRIC_IDS: readonly string[] = METRIC_REGISTRY.map((m) => m.id);
