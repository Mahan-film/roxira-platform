import { CAPTURE_ACCOUNTS } from '../constants/capture.constants';
import { DraftInvoice, Finding } from './capture.types';
import {
  normaliseTaxId,
  parseAmountMinor,
  parseQuantityMilli,
  taxIdLooksValid,
} from './normalise';

/** Facts the service resolves from the database before the (pure) validation runs. */
export interface ValidationContext {
  /** Document id of an already-captured duplicate, if any. */
  duplicateOfDocumentId?: string | null;
  /** True when the date falls in a locked accounting period. */
  periodLocked: boolean;
  /** Codes that exist in the tenant's chart of accounts. */
  chartCodes: ReadonlySet<string>;
}

const minor = (value: string): bigint | null => parseAmountMinor(value);

/**
 * Arithmetic, completeness, duplicate, period-lock and chart checks. Errors block posting; warnings
 * block only auto-posting. Everything is exact integer arithmetic (no floats, no tolerance).
 */
export function validateDraft(draft: DraftInvoice, ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], code: string, message: string, field?: string): void => {
    findings.push({ severity, code, message, field });
  };

  const subtotal = minor(draft.subtotal);
  const tax = minor(draft.tax);
  const total = minor(draft.total);
  if (subtotal === null || tax === null || total === null) {
    add('error', 'AMOUNT_UNREADABLE', 'مبلغ جمع، مالیات یا کل قابل خواندن نیست.', 'total');
    return findings;
  }
  if (total <= 0n) {
    add('error', 'TOTAL_NOT_POSITIVE', 'مبلغ کل باید بزرگ‌تر از صفر باشد.', 'total');
  }
  if (draft.items.length === 0) {
    add('error', 'NO_ITEMS', 'هیچ ردیف کالا/خدمتی استخراج نشد.', 'items');
  }

  let itemSum = 0n;
  draft.items.forEach((item, index) => {
    const itemTotal = minor(item.total);
    const unit = minor(item.unitPrice);
    const qty = parseQuantityMilli(item.quantity);
    if (itemTotal === null || unit === null || qty === null) {
      add('error', 'ITEM_UNREADABLE', `ردیف ${index + 1} قابل خواندن نیست.`, `items.${index}`);
      return;
    }
    itemSum += itemTotal;
    const expected = (unit * qty + 500n) / 1000n;
    if (expected !== itemTotal) {
      add('warning', 'ITEM_MISMATCH', `ردیف ${index + 1}: تعداد × فی با مبلغ ردیف نمی‌خواند.`, `items.${index}`);
    }
    if (!item.description) {
      add('warning', 'ITEM_NO_DESCRIPTION', `ردیف ${index + 1} شرح ندارد.`, `items.${index}`);
    }
  });

  if (itemSum !== subtotal) {
    add('error', 'SUBTOTAL_MISMATCH', 'جمع ردیف‌ها با جمع کل قبل از مالیات برابر نیست.', 'subtotal');
  }
  if (subtotal + tax !== total) {
    add('error', 'TOTAL_MISMATCH', 'جمع قبل از مالیات + مالیات با مبلغ کل برابر نیست.', 'total');
  }
  if (tax > 0n && subtotal > 0n) {
    const bps = (tax * 10_000n) / subtotal;
    if (bps < 950n || bps > 1_050n) {
      add('warning', 'VAT_RATE_ODD', 'نرخ مالیات بر ارزش افزوده حدود ۱۰٪ نیست.', 'tax');
    }
  }

  if (!draft.date) {
    add('error', 'DATE_MISSING', 'تاریخ فاکتور خوانده نشد.', 'date');
  }
  if (draft.currency !== 'IRR' && !draft.fxRate) {
    add('error', 'FX_RATE_REQUIRED', 'برای ارز غیر ریالی نرخ تبدیل به ریال لازم است.', 'fxRate');
  }
  if (!draft.sellerName) {
    add('error', 'SELLER_MISSING', 'نام فروشنده خوانده نشد.', 'sellerName');
  }
  if (!draft.invoiceNumber) {
    add('warning', 'INVOICE_NUMBER_MISSING', 'شماره فاکتور خوانده نشد.', 'invoiceNumber');
  }
  const taxId = normaliseTaxId(draft.sellerTaxId);
  if (!taxId) {
    add('warning', 'TAX_ID_MISSING', 'شناسه ملی/کد اقتصادی فروشنده خوانده نشد.', 'sellerTaxId');
  } else if (taxIdLooksValid(taxId) === false) {
    add('warning', 'TAX_ID_INVALID', 'شناسه ملی/کد اقتصادی فروشنده معتبر به نظر نمی‌رسد.', 'sellerTaxId');
  }

  if (ctx.duplicateOfDocumentId) {
    add('error', 'DUPLICATE', `این فاکتور قبلاً ثبت شده است (${ctx.duplicateOfDocumentId}).`);
  }
  if (ctx.periodLocked) {
    add('error', 'PERIOD_LOCKED', 'تاریخ فاکتور در دوره مالی قفل‌شده است.', 'date');
  }

  const requiredCodes = [
    CAPTURE_ACCOUNTS.payable,
    CAPTURE_ACCOUNTS.cash,
    CAPTURE_ACCOUNTS.receivable,
    CAPTURE_ACCOUNTS.vat,
  ];
  for (const code of requiredCodes) {
    if (!ctx.chartCodes.has(code)) {
      add('error', 'CHART_ACCOUNT_MISSING', `حساب ${code} در دفتر کل سازمان وجود ندارد.`);
      break;
    }
  }
  draft.items.forEach((item, index) => {
    if (item.accountCode && !ctx.chartCodes.has(item.accountCode)) {
      add('error', 'ACCOUNT_UNKNOWN', `حساب ${item.accountCode} در دفتر کل وجود ندارد.`, `items.${index}`);
    }
  });
  return findings;
}

/** Stable duplicate key: seller id (or name), invoice number, total and date. */
export function dedupeKey(draft: DraftInvoice, normalisedSellerName: string): string | null {
  if (!draft.invoiceNumber || !draft.date) {
    return null;
  }
  const seller = normaliseTaxId(draft.sellerTaxId) || normalisedSellerName;
  return `${seller}|${draft.invoiceNumber.toLowerCase()}|${draft.date}|${draft.total}`;
}

export interface AccountSuggestionInput {
  kind: DraftInvoice['kind'];
  description: string;
  vendorRuleCode?: string | null;
  vendorHits?: Record<string, number>;
  chartCodes: ReadonlySet<string>;
}

const KEYWORDS: Array<[RegExp, string]> = [
  [/(اجاره|رهن)/, '5020'],
  [/(حقوق|دستمزد)/, '5010'],
  [/(کالا|محصول|مواد|قطعه)/, '1030'],
];

/** Suggested chart code: vendor rule > most used for this vendor > keyword > default. Must exist in the chart. */
export function suggestAccount(input: AccountSuggestionInput): string | null {
  const candidates: Array<string | null | undefined> = [input.vendorRuleCode];
  const hits = Object.entries(input.vendorHits ?? {}).sort((a, b) => b[1] - a[1]);
  if (hits[0]) {
    candidates.push(hits[0][0]);
  }
  if (input.kind === 'sales') {
    candidates.push(CAPTURE_ACCOUNTS.salesRevenue);
  } else {
    candidates.push(KEYWORDS.find(([re]) => re.test(input.description))?.[1]);
    candidates.push(CAPTURE_ACCOUNTS.defaultExpense);
  }
  return candidates.find((code): code is string => !!code && input.chartCodes.has(code)) ?? null;
}
