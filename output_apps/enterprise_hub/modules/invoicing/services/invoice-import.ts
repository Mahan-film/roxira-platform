import { fromMinor, parseScaled, scaledToDecimal } from '../../accounting/money';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceDirection } from '../enums/invoice-kind.enum';

export const INVOICE_IMPORT_VAT_RATE_SCALE = 4;
export const INVOICE_IMPORT_QUANTITY_SCALE = 3;

const RATE_FACTOR = 10n ** BigInt(INVOICE_IMPORT_VAT_RATE_SCALE);
const QUANTITY_FACTOR = 10n ** BigInt(INVOICE_IMPORT_QUANTITY_SCALE);
const MAX_MONEY_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export interface InvoiceImportRow {
  rowNumber: number;
  number: string;
  type?: string;
  date?: string;
  partyCode?: string;
  itemCode?: string;
  quantity?: unknown;
  unitPrice?: unknown;
  amount?: unknown;
  vat?: unknown;
  totalRial?: unknown;
  currency?: string;
  fxRate?: unknown;
  status?: string;
}

export interface ImportedPartyRef {
  id: number;
  code: string;
  name: string;
  nationalId?: string | null;
  economicCode?: string | null;
}

export interface InvoiceImportLookups {
  partyByCode: Map<string, ImportedPartyRef>;
  existingSkus: Set<string>;
}

export interface InvoiceImportLine {
  rowNumber: number;
  sku: string;
  quantity: number;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  vatRate: number;
}

export interface InvoiceImportPlan {
  invoiceNumber: string;
  direction: InvoiceDirection | null;
  date: Date | null;
  currency: Currency | null;
  fxRate: number | null;
  party: ImportedPartyRef | null;
  walkIn: boolean;
  lines: InvoiceImportLine[];
  rowNumbers: number[];
  duplicateRows: Array<{ rowNumber: number; ofRowNumber: number }>;
  rowErrors: Map<number, string>;
  valid: boolean;
}

export interface InvoiceImportRowResult {
  rowNumber: number;
  invoiceNumber: string;
  invoiceId: string | null;
  error: string | null;
  duplicate: boolean;
  existingDuplicate: boolean;
}

const emptyLookups: InvoiceImportLookups = {
  partyByCode: new Map(),
  existingSkus: new Set(),
};

export function mapImportedDirection(raw: string | undefined): InvoiceDirection | null {
  const value = (raw ?? '').trim().replace(/\u200c/g, '');
  if (!value) {
    return null;
  }
  const key = value.toUpperCase();
  if (value === 'فروش' || key === 'SALE') {
    return InvoiceDirection.SALE;
  }
  if (value === 'خرید' || key === 'PURCHASE') {
    return InvoiceDirection.PURCHASE;
  }
  return null;
}

function rowIdentityKey(row: InvoiceImportRow): string {
  return JSON.stringify([
    row.type ?? '',
    row.date ?? '',
    row.partyCode ?? '',
    row.itemCode ?? '',
    row.quantity ?? '',
    row.unitPrice ?? '',
    row.amount ?? '',
    row.vat ?? '',
    row.totalRial ?? '',
    row.currency ?? '',
    row.fxRate ?? '',
    row.status ?? '',
  ]);
}

function toMoneyMinor(value: unknown, label: string, errors: string[]): bigint | null {
  if (value === undefined || value === null || value === '') {
    errors.push(`${label} در سطر یافت نشد.`);
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) {
    errors.push(`${label} باید عدد باشد («${String(value)}»).`);
    return null;
  }
  if (numeric < 0) {
    errors.push(`${label} نمی‌تواند منفی باشد («${String(value)}»).`);
    return null;
  }
  // Exact decimal parsing: 19.99 * 100 is not an integer in binary floating point.
  let minor: bigint;
  try {
    minor = parseScaled(typeof value === 'number' ? value : String(value), 2);
  } catch {
    errors.push(`${label} «${String(value)}» بیش از دو رقم اعشار دارد و گرد نمی‌شود.`);
    return null;
  }
  if (minor > MAX_MONEY_MINOR) {
    errors.push(`${label} «${String(value)}» خارج از بازه مجاز است.`);
    return null;
  }
  return minor;
}

function toQuantityMicro(value: unknown, errors: string[]): bigint | null {
  if (value === undefined || value === null || value === '') {
    errors.push('تعداد در سطر یافت نشد.');
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) {
    errors.push(`تعداد باید عدد باشد («${String(value)}»).`);
    return null;
  }
  let micro: bigint;
  try {
    micro = parseScaled(typeof value === 'number' ? value : String(value), INVOICE_IMPORT_QUANTITY_SCALE);
  } catch {
    errors.push(
      numeric < 0
        ? `تعداد باید بیشتر از صفر باشد («${String(value)}»).`
        : `تعداد «${String(value)}» بیش از ${INVOICE_IMPORT_QUANTITY_SCALE} رقم اعشار دارد و گرد نمی‌شود.`,
    );
    return null;
  }
  if (micro <= 0n) {
    errors.push(`تعداد باید بیشتر از صفر باشد («${String(value)}»).`);
    return null;
  }
  return micro;
}

function toFxRate(value: unknown, errors: string[]): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    errors.push(`نرخ تسعیر باید عددی مثبت باشد («${String(value)}»).`);
    return null;
  }
  return numeric;
}

function parseIsoDate(value: string | undefined): Date | null {
  const text = (value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatRials(minor: bigint): string {
  return String(fromMinor(minor));
}

function formatQuantity(micro: bigint): string {
  return String(Number(micro) / Number(QUANTITY_FACTOR));
}

export function groupInvoiceRows(
  rows: InvoiceImportRow[],
  lookups: InvoiceImportLookups = emptyLookups,
): InvoiceImportPlan[] {
  const plans = new Map<string, InvoiceImportPlan>();
  const identities = new Map<string, Map<number, string>>();

  for (const row of rows) {
    const invoiceNumber = String(row.number ?? '').trim();
    if (!invoiceNumber) {
      continue;
    }
    let plan = plans.get(invoiceNumber);
    if (!plan) {
      plan = {
        invoiceNumber,
        direction: null,
        date: null,
        currency: null,
        fxRate: null,
        party: null,
        walkIn: false,
        lines: [],
        rowNumbers: [],
        duplicateRows: [],
        rowErrors: new Map(),
        valid: true,
      };
      plans.set(invoiceNumber, plan);
      identities.set(invoiceNumber, new Map());
    }
    const seen = identities.get(invoiceNumber)!;
    const identity = rowIdentityKey(row);
    const earlier = Array.from(seen.entries()).find(
      ([, previousIdentity]) => previousIdentity === identity,
    );
    if (earlier) {
      plan.duplicateRows.push({ rowNumber: row.rowNumber, ofRowNumber: earlier[0] });
      plan.rowNumbers.push(row.rowNumber);
      continue;
    }
    seen.set(row.rowNumber, identity);
    plan.rowNumbers.push(row.rowNumber);
    validateRow(plan, row, lookups);
  }

  for (const plan of plans.values()) {
    finalisePlan(plan);
  }
  return Array.from(plans.values());
}

function addRowError(plan: InvoiceImportPlan, rowNumber: number, message: string): void {
  const existing = plan.rowErrors.get(rowNumber);
  plan.rowErrors.set(rowNumber, existing ? `${existing}؛ ${message}` : message);
}

function validateRow(
  plan: InvoiceImportPlan,
  row: InvoiceImportRow,
  lookups: InvoiceImportLookups,
): void {
  const errors: string[] = [];
  const rowNumber = row.rowNumber;
  const invoiceNumber = plan.invoiceNumber;

  const direction = mapImportedDirection(row.type);
  if (!direction) {
    errors.push(
      `نوع صورتحساب «${String(row.type ?? '').trim() || 'خالی'}» شناخته نمی‌شود؛ «فروش» یا «خرید» وارد کنید.`,
    );
  } else if (plan.direction === null) {
    plan.direction = direction;
  } else if (plan.direction !== direction) {
    errors.push(
      `نوع این سطر (${direction === InvoiceDirection.SALE ? 'فروش' : 'خرید'}) با نوع صورتحساب «${invoiceNumber}» (${plan.direction === InvoiceDirection.SALE ? 'فروش' : 'خرید'}) یکی نیست.`,
    );
  }

  const date = parseIsoDate(row.date);
  if (!date) {
    errors.push(
      `تاریخ «${String(row.date ?? '').trim() || 'خالی'}» معتبر نیست؛ قالب میلادی YYYY-MM-DD لازم است.`,
    );
  } else if (!plan.date) {
    plan.date = date;
  }

  const partyCode = String(row.partyCode ?? '').trim();
  if (!partyCode) {
    if (direction === InvoiceDirection.PURCHASE) {
      errors.push(
        'برای صورتحساب خرید، کد طرف حساب (تأمین‌کننده) الزامی است؛ خرید بدون طرف حساب ثبت نمی‌شود.',
      );
    } else {
      plan.walkIn = true;
    }
  } else {
    const party = lookups.partyByCode.get(partyCode);
    if (!party) {
      errors.push(`طرف حساب با کد «${partyCode}» در سازمان شما یافت نشد.`);
    } else if (!plan.party) {
      plan.party = party;
    } else if (plan.party.code !== party.code) {
      errors.push(
        `کد طرف حساب این سطر («${partyCode}») با سطرهای دیگر همین صورتحساب («${plan.party.code}») یکی نیست.`,
      );
    }
  }

  const sku = String(row.itemCode ?? '').trim();
  if (!sku) {
    errors.push('کد کالا در سطر صورتحساب الزامی است.');
  } else if (!lookups.existingSkus.has(sku)) {
    errors.push(`کالای انبار با کد «${sku}» در سازمان شما یافت نشد.`);
  }

  const quantityMicro = toQuantityMicro(row.quantity, errors);
  const unitPriceMinor = toMoneyMinor(row.unitPrice, 'بهای واحد', errors);
  const amountMinor = toMoneyMinor(row.amount, 'مبلغ', errors);
  const vatMinor = toMoneyMinor(row.vat, 'مالیات ارزش افزوده', errors);
  const totalMinor = toMoneyMinor(row.totalRial, 'جمع نهایی', errors);

  const currencyRaw = String(row.currency ?? '').trim().toUpperCase();
  let currency: Currency | null = currencyRaw ? (currencyRaw as Currency) : Currency.IRR;
  if (currencyRaw && !Object.values(Currency).includes(currency as Currency)) {
    errors.push(`ارز «${row.currency}» پشتیبانی نمی‌شود.`);
    currency = null;
  } else if (plan.currency === null) {
    plan.currency = currency;
  } else if (currency !== plan.currency) {
    errors.push(
      `ارز این سطر (${currency}) با ارز صورتحساب «${invoiceNumber}» (${plan.currency}) یکی نیست.`,
    );
  }

  const fxRate = toFxRate(row.fxRate, errors);
  if (fxRate !== null) {
    if (plan.fxRate === null) {
      plan.fxRate = fxRate;
    } else if (plan.fxRate !== fxRate) {
      errors.push(
        `نرخ تسعیر این سطر (${fxRate}) با نرخ صورتحساب «${invoiceNumber}» (${plan.fxRate}) یکی نیست.`,
      );
    }
  }

  if (
    quantityMicro !== null &&
    unitPriceMinor !== null &&
    amountMinor !== null &&
    vatMinor !== null &&
    totalMinor !== null
  ) {
    errors.push(
      ...checkFigures(invoiceNumber, {
        quantityMicro,
        unitPriceMinor,
        amountMinor,
        vatMinor,
        totalMinor,
      }),
    );
  }

  if (
    errors.length === 0 &&
    quantityMicro !== null &&
    unitPriceMinor !== null &&
    amountMinor !== null &&
    vatMinor !== null &&
    totalMinor !== null &&
    sku
  ) {
    plan.lines.push({
      rowNumber,
      sku,
      quantity: Number(quantityMicro) / Number(QUANTITY_FACTOR),
      unitPriceMinor,
      amountMinor,
      vatMinor,
      totalMinor,
      vatRate: vatRateOf(amountMinor, vatMinor),
    });
  }

  for (const message of errors) {
    addRowError(plan, rowNumber, message);
  }
}

function vatRateOf(amountMinor: bigint, vatMinor: bigint): number {
  if (amountMinor === 0n) {
    return 0;
  }
  return Number(
    scaledToDecimal((vatMinor * RATE_FACTOR) / amountMinor, INVOICE_IMPORT_VAT_RATE_SCALE),
  );
}

function checkFigures(
  invoiceNumber: string,
  figures: {
    quantityMicro: bigint;
    unitPriceMinor: bigint;
    amountMinor: bigint;
    vatMinor: bigint;
    totalMinor: bigint;
  },
): string[] {
  const errors: string[] = [];
  const product = figures.quantityMicro * figures.unitPriceMinor;
  if (product % 1000n !== 0n) {
    errors.push(
      `مبلغ سطر با حاصل‌ضرب تعداد در بهای واحد برابر نیست و محاسبهٔ دقیق بدون گردکردن ممکن نیست (تعداد ${formatQuantity(figures.quantityMicro)} × بهای واحد ${formatRials(figures.unitPriceMinor)} ریال، صورتحساب ${invoiceNumber}).`,
    );
    return errors;
  }
  const computedAmount = product / 1000n;
  if (computedAmount !== figures.amountMinor) {
    errors.push(
      `مبلغ سطر با تعداد × بهای واحد سازگار نیست: ${formatQuantity(figures.quantityMicro)} × ${formatRials(figures.unitPriceMinor)} = ${formatRials(computedAmount)} ریال، اما مبلغ «${formatRials(figures.amountMinor)}» ثبت شده است (صورتحساب ${invoiceNumber}).`,
    );
  }
  const expectedTotal = figures.amountMinor + figures.vatMinor;
  if (expectedTotal !== figures.totalMinor) {
    errors.push(
      `جمع نهایی سطر با مبلغ + مالیات سازگار نیست: ${formatRials(figures.amountMinor)} + ${formatRials(figures.vatMinor)} = ${formatRials(expectedTotal)} ریال، اما جمع «${formatRials(figures.totalMinor)}» ثبت شده است (صورتحساب ${invoiceNumber}).`,
    );
  }
  if (figures.amountMinor === 0n) {
    if (figures.vatMinor !== 0n) {
      errors.push(
        `مالیات «${formatRials(figures.vatMinor)}» ریال برای سطر بدون مبلغ پایه ثبت شده است (صورتحساب ${invoiceNumber}).`,
      );
    }
  } else if ((figures.vatMinor * RATE_FACTOR) % figures.amountMinor !== 0n) {
    errors.push(
      `مالیات «${formatRials(figures.vatMinor)}» ریال برای مبلغ «${formatRials(figures.amountMinor)}» ریال با نرخ دقیق سازگار نیست و گردکردن پنهان مجاز نیست (صورتحساب ${invoiceNumber}).`,
    );
  } else if (figures.vatMinor > figures.amountMinor) {
    errors.push(
      `مالیات «${formatRials(figures.vatMinor)}» ریال بیش از مبلغ پایه «${formatRials(figures.amountMinor)}» ریال است (صورتحساب ${invoiceNumber}).`,
    );
  }
  return errors;
}

function finalisePlan(plan: InvoiceImportPlan): void {
  if (plan.rowErrors.size === 0) {
    plan.valid = true;
    return;
  }
  plan.valid = false;
  const summary = Array.from(plan.rowErrors.entries())
    .map(([rowNumber, message]) => `سطر ${rowNumber}: ${message}`)
    .join('؛ ');
  for (const rowNumber of plan.rowNumbers) {
    if (!plan.rowErrors.has(rowNumber)) {
      plan.rowErrors.set(
        rowNumber,
        `این سطر به‌سبب خطای سایر سطرهای صورتحساب «${plan.invoiceNumber}» ثبت نشد: ${summary}`,
      );
    }
  }
}
