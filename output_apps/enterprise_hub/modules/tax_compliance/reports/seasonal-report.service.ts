import { Injectable } from '@nestjs/common';
import { fromMinor } from '../../accounting/money';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import { SeasonalReportRepository } from './seasonal-report.repository';
import { toCsv } from './csv.util';
import { invoiceRateLines, invoiceRialAmounts } from './invoice-rial-amounts';
import { formatJalaliYmd } from './jalali-format.util';

export interface SeasonalVatRateRow {
  /** VAT rate as a fraction (0.1 = 10%). */
  rate: number;
  invoiceLines: number;
  /** Taxable base in IRR (gross minus discount). */
  taxableBase: number | string;
  vat: number | string;
}

export interface SeasonalVatReport {
  period: { year: number; quarter: number; label: string; from: string; to: string };
  currency: 'IRR';
  sales: {
    invoiceCount: number;
    taxableBase: number | string;
    vat: number | string;
    byRate: SeasonalVatRateRow[];
  };
  /** Purchases are not captured by the suite yet, so they are never reported as zero. */
  purchases: { available: false; note: string };
  notes: string[];
}

export interface SeasonalTransactionRow {
  taxInvoiceNumber: string;
  issuedAtJalali: string;
  buyerName: string;
  buyerNationalId: string;
  buyerEconomicCode: string;
  taxableBase: number | string;
  vat: number | string;
  total: number | string;
  status: string;
}

export const SEASONAL_NOTES: readonly string[] = [
  'این گزارش پیش‌نویس محاسباتی از صورتحساب‌های صادرشده و تسویه‌شده است و جایگزین اظهارنامه یا صورت معاملات فصلی ثبت‌شده در سامانه سازمان امور مالیاتی نیست.',
  'ستون‌های فایل CSV قالب رسمی بارگذاری سامانه معاملات فصلی نیست؛ حسابدار باید آن را با راهنمای جاری سامانه تطبیق دهد.',
  'خرید و مالیات ورودی (قابل استرداد) هنوز در سامانه ثبت نمی‌شود؛ حسابدار باید آن را جداگانه وارد کند.',
  'فقط صورتحساب‌های داخلی (IR) با وضعیت صادرشده یا پرداخت‌شده و تاریخ صدور در فصل انتخابی لحاظ شده‌اند؛ پیش‌نویس و ابطال‌شده‌ها حذف می‌شوند.',
  'مبالغ با نرخ تبدیل ثبت‌شده در صورتحساب به ریال برگردانده می‌شوند.',
];

/** Seasonal VAT summary and per-invoice sales list from tenant invoice data. */
@Injectable()
export class SeasonalReportService {
  constructor(private readonly repository: SeasonalReportRepository) {}

  async vatReport(tenantId: string, year: number, quarter: number): Promise<SeasonalVatReport> {
    const range = jalaliQuarterRange(year, quarter);
    const invoices = await this.repository.findIssuedBetween(tenantId, range.from, range.to);

    const byRate = new Map<number, { rate: number; invoiceLines: number; base: bigint; vat: bigint }>();
    let taxableBase = 0n;
    let vat = 0n;
    for (const invoice of invoices) {
      const amounts = invoiceRialAmounts(invoice);
      taxableBase += amounts.salesMinor;
      vat += amounts.vatMinor;
      for (const line of invoiceRateLines(invoice, amounts)) {
        const row = byRate.get(line.rate) ?? { rate: line.rate, invoiceLines: 0, base: 0n, vat: 0n };
        row.invoiceLines += 1;
        row.base += line.baseMinor;
        row.vat += line.vatMinor;
        byRate.set(line.rate, row);
      }
    }

    return {
      period: {
        year: range.year,
        quarter: range.quarter,
        label: range.label,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      currency: 'IRR',
      sales: {
        invoiceCount: invoices.length,
        taxableBase: fromMinor(taxableBase),
        vat: fromMinor(vat),
        byRate: [...byRate.values()]
          .sort((a, b) => a.rate - b.rate)
          .map((r) => ({
            rate: r.rate,
            invoiceLines: r.invoiceLines,
            taxableBase: fromMinor(r.base),
            vat: fromMinor(r.vat),
          })),
      },
      purchases: {
        available: false,
        note: 'خرید ثبت نشده است؛ مالیات ورودی را حسابدار وارد کند.',
      },
      notes: [...SEASONAL_NOTES],
    };
  }

  async transactions(
    tenantId: string,
    year: number,
    quarter: number,
  ): Promise<{ period: SeasonalVatReport['period']; rows: SeasonalTransactionRow[]; notes: string[] }> {
    const range = jalaliQuarterRange(year, quarter);
    const invoices = await this.repository.findIssuedBetween(tenantId, range.from, range.to);
    const rows = invoices.map((invoice): SeasonalTransactionRow => {
      const amounts = invoiceRialAmounts(invoice);
      return {
        taxInvoiceNumber: invoice.taxInvoiceNumber,
        issuedAtJalali: invoice.issuedAt ? formatJalaliYmd(invoice.issuedAt) : '',
        buyerName: invoice.buyerInfo?.name ?? '',
        buyerNationalId: invoice.buyerInfo?.nationalId ?? '',
        buyerEconomicCode: invoice.buyerInfo?.economicCode ?? '',
        taxableBase: fromMinor(amounts.salesMinor),
        vat: fromMinor(amounts.vatMinor),
        total: fromMinor(amounts.receivableMinor),
        status: invoice.status,
      };
    });
    return {
      period: {
        year: range.year,
        quarter: range.quarter,
        label: range.label,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      rows,
      notes: [...SEASONAL_NOTES],
    };
  }

  async transactionsCsv(tenantId: string, year: number, quarter: number): Promise<string> {
    const { rows } = await this.transactions(tenantId, year, quarter);
    return toCsv(
      [
        'شماره صورتحساب',
        'تاریخ صدور (شمسی)',
        'نام خریدار',
        'شناسه/کد ملی خریدار',
        'کد اقتصادی خریدار',
        'مبلغ مشمول مالیات (ریال)',
        'مالیات بر ارزش افزوده (ریال)',
        'جمع کل (ریال)',
        'وضعیت',
      ],
      rows.map((r) => [
        r.taxInvoiceNumber,
        r.issuedAtJalali,
        r.buyerName,
        r.buyerNationalId,
        r.buyerEconomicCode,
        r.taxableBase,
        r.vat,
        r.total,
        r.status,
      ]),
    );
  }

  async vatCsv(tenantId: string, year: number, quarter: number): Promise<string> {
    const report = await this.vatReport(tenantId, year, quarter);
    return toCsv(
      ['نرخ مالیات', 'تعداد سطر', 'مبلغ مشمول (ریال)', 'مالیات (ریال)'],
      report.sales.byRate.map((r) => [`${Number((r.rate * 100).toFixed(2))}%`, r.invoiceLines, r.taxableBase, r.vat]),
    );
  }
}
