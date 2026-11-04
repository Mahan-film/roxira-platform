import { Injectable } from '@nestjs/common';
import { fromMinor } from '../../accounting/money';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import { SeasonalReportRepository } from './seasonal-report.repository';
import { toCsv } from './csv.util';
import { invoiceRateLines, invoiceRialAmounts } from './invoice-rial-amounts';
import { formatJalaliYmd, tehranDay } from './jalali-format.util';
import { PurchaseAmounts, purchaseFromCapture, purchaseFromInvoice } from './purchase-amounts';

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
  /** Input VAT credit from purchase invoices and posted captured purchase documents. */
  purchases: {
    available: true;
    documentCount: number;
    invoiceCount: number;
    captureCount: number;
    taxableBase: number | string;
    /** Input VAT (credit) in IRR. */
    inputVat: number | string;
    /** Posted captures whose amounts could not be read; excluded from the totals. */
    unreadableCaptures: number;
  };
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

export interface SeasonalPurchaseRow {
  source: 'invoice' | 'capture';
  documentNumber: string;
  dateJalali: string;
  sellerName: string;
  sellerTaxId: string;
  taxableBase: number | string;
  vat: number | string;
}

export const SEASONAL_NOTES: readonly string[] = [
  'این گزارش پیش‌نویس محاسباتی از صورتحساب‌های صادرشده و تسویه‌شده است و جایگزین اظهارنامه یا صورت معاملات فصلی ثبت‌شده در سامانه سازمان امور مالیاتی نیست.',
  'ستون‌های فایل CSV قالب رسمی بارگذاری سامانه معاملات فصلی نیست؛ حسابدار باید آن را با راهنمای جاری سامانه تطبیق دهد.',
  'خرید از دو منبع می‌آید: صورتحساب‌های خرید (اصلی، صادرشده/پرداخت‌شده) و اسناد خرید ثبت‌شده در دریافت هوشمند سند (ثبت‌شده یا ثبت‌خودکار). اسناد برگشتی، اصلاحی و ابطالی خرید لحاظ نمی‌شوند؛ حسابدار باید آن‌ها را جداگانه تطبیق دهد.',
  'مالیات ورودی قابل کسر، مشروط به تطبیق با صورت‌حساب فروشنده در سامانه مودیان (کارپوشه) است؛ این تطبیق هنوز انجام نمی‌شود.',
  'حد آستانهٔ ۵٪ و قالب رسمی فایل خرید هنوز تأیید نشده است (unverified)؛ در این گزارش هیچ آستانه‌ای اعمال نشده است.',
  'فقط صورتحساب‌های داخلی (IR) با وضعیت صادرشده یا پرداخت‌شده و تاریخ صدور در فصل انتخابی لحاظ شده‌اند؛ پیش‌نویس و ابطال‌شده‌ها حذف می‌شوند.',
  'مبالغ با نرخ تبدیل ثبت‌شده در صورتحساب به ریال برگردانده می‌شوند.',
];

/** Seasonal VAT summary and per-invoice sales list from tenant invoice data. */
@Injectable()
export class SeasonalReportService {
  constructor(private readonly repository: SeasonalReportRepository) {}

  private async loadPurchases(
    tenantId: string,
    range: ReturnType<typeof jalaliQuarterRange>,
  ): Promise<{ rows: PurchaseAmounts[]; invoiceCount: number; unreadable: number }> {
    const invoices = await this.repository.findPurchaseInvoicesBetween(tenantId, range.from, range.to);
    const captures = await this.repository.findPostedCapturePurchasesBetween(
      tenantId,
      tehranDay(range.from),
      tehranDay(range.to),
    );
    const rows = invoices.map((invoice) =>
      purchaseFromInvoice(invoice, tehranDay(invoice.issuedAt ?? range.from)),
    );
    let unreadable = 0;
    for (const doc of captures) {
      const row = purchaseFromCapture(doc);
      if (row) rows.push(row);
      else unreadable += 1;
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.documentNumber.localeCompare(b.documentNumber));
    return { rows, invoiceCount: invoices.length, unreadable };
  }

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

    const purchases = await this.loadPurchases(tenantId, range);
    const purchaseBase = purchases.rows.reduce((sum, r) => sum + r.baseMinor, 0n);
    const inputVat = purchases.rows.reduce((sum, r) => sum + r.vatMinor, 0n);

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
        available: true,
        documentCount: purchases.rows.length,
        invoiceCount: purchases.invoiceCount,
        captureCount: purchases.rows.length - purchases.invoiceCount,
        taxableBase: fromMinor(purchaseBase),
        inputVat: fromMinor(inputVat),
        unreadableCaptures: purchases.unreadable,
      },
      notes: [...SEASONAL_NOTES],
    };
  }

  async transactions(
    tenantId: string,
    year: number,
    quarter: number,
  ): Promise<{
    period: SeasonalVatReport['period'];
    rows: SeasonalTransactionRow[];
    purchaseRows: SeasonalPurchaseRow[];
    notes: string[];
  }> {
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
    const purchaseRows = (await this.loadPurchases(tenantId, range)).rows.map(
      (r): SeasonalPurchaseRow => ({
        source: r.source,
        documentNumber: r.documentNumber,
        dateJalali: formatJalaliYmd(new Date(`${r.date}T00:00:00+03:30`)),
        sellerName: r.sellerName,
        sellerTaxId: r.sellerTaxId,
        taxableBase: fromMinor(r.baseMinor),
        vat: fromMinor(r.vatMinor),
      }),
    );
    return {
      period: {
        year: range.year,
        quarter: range.quarter,
        label: range.label,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      rows,
      purchaseRows,
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

  async purchasesCsv(tenantId: string, year: number, quarter: number): Promise<string> {
    const { purchaseRows } = await this.transactions(tenantId, year, quarter);
    return toCsv(
      [
        'منبع',
        'شماره سند',
        'تاریخ (شمسی)',
        'نام فروشنده',
        'شناسه/کد ملی فروشنده',
        'مبلغ مشمول (ریال)',
        'مالیات ورودی (ریال)',
      ],
      purchaseRows.map((r) => [
        r.source === 'invoice' ? 'صورتحساب خرید' : 'سند ثبت‌شده',
        r.documentNumber,
        r.dateJalali,
        r.sellerName,
        r.sellerTaxId,
        r.taxableBase,
        r.vat,
      ]),
    );
  }

  async vatCsv(tenantId: string, year: number, quarter: number): Promise<string> {
    const report = await this.vatReport(tenantId, year, quarter);
    return toCsv(
      ['نرخ مالیات', 'تعداد سطر', 'مبلغ مشمول (ریال)', 'مالیات (ریال)'],
      [
        ...report.sales.byRate.map((r) => [
          `${Number((r.rate * 100).toFixed(2))}%`,
          r.invoiceLines,
          r.taxableBase,
          r.vat,
        ]),
        ['خرید (مالیات ورودی)', report.purchases.documentCount, report.purchases.taxableBase, report.purchases.inputVat],
      ],
    );
  }
}
