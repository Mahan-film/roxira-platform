import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  formatCurrencyMinor,
  MoneyFormatError,
  parseCurrencyMinor,
} from '../../accounting/money';
import {
  isSupportedCurrency,
  UnsupportedCurrencyError,
} from '../../country_packs/currency-exponents';
import { NormalisedRecord } from '../registry/import-registry.types';
import {
  EffectiveTieOutConfig,
  EffectiveTieOutConfigRegistry,
  TieOutCategory,
  TieOutControlAccountRule,
} from './effective-tie-out-config.registry';

export interface TieOutItemReport {
  category: TieOutCategory;
  name: string;
  expectedMinor: string;
  expectedMoney: string;
  actualMinor: string;
  actualMoney: string;
  differenceMinor: string;
  differenceMoney: string;
  currency: string;
  matched: boolean;
  blockerFa?: string;
  warningFa?: string;
}

export interface TieOutSummary {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  discrepanciesCount: number;
  items: TieOutItemReport[];
  discrepancies: TieOutItemReport[];
  blockersFa: string[];
  warningsFa?: string[];
}

export interface EvaluateTieOutsOptions {
  recordsByEntity: Map<string, NormalisedRecord[]>;
  asOfDate?: string;
  currency?: string;
  customConfig?: Partial<EffectiveTieOutConfig>;
  controlTotals?: Partial<Record<TieOutCategory, number | string | bigint>>;
  /** Fail closed when a control account or subledger is present without its counterpart or controlTotal. */
  requireSubledgerOrControl?: boolean;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PURCHASE_INVOICE_TYPE_RE = /^(purchase|vendor|bill|ap|خرید|فاکتور\s*خرید)$/i;
const DECIMAL_QTY_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function toAsciiNumericText(raw: string): string {
  let out = raw.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  out = out.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  return out
    .replace(/٫/g, '.')
    .replace(/[\u200c\u200e\u200f٬,\s]/g, '')
    .trim();
}

function normaliseFaPatternText(raw: string): string {
  return raw
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesBoundedPattern(normalisedText: string, pattern: string): boolean {
  const normPattern = normaliseFaPatternText(pattern);
  if (!normPattern) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(normPattern)}(?![\\p{L}\\p{N}_])`, 'u');
  return re.test(normalisedText);
}

export interface MoneyCellContext {
  column?: string;
  rowNumber?: number;
}

function formatCellPrefix(context?: MoneyCellContext): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.column) parts.push(`ستون «${context.column}»`);
  if (context.rowNumber !== undefined) parts.push(`ردیف ${context.rowNumber}`);
  return parts.length > 0 ? `${parts.join(' در ')}: ` : '';
}

/**
 * تبدیل مقادیر ورودی (عدد، رشته، bigint) به واحدهای minor بر مبنای توان ارزی ISO 4217.
 */
export function parseMoneyValue(
  value: number | string | bigint,
  currencyCode: string = 'IRR',
  context?: MoneyCellContext,
): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  const prefix = formatCellPrefix(context);
  const normCurrency = currencyCode.trim().toUpperCase();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BadRequestException(`${prefix}مبلغ نامعتبر است: ${value}`);
    }
    if (value === 0) return 0n;
    try {
      return parseCurrencyMinor(value, normCurrency);
    } catch (error) {
      if (error instanceof MoneyFormatError || error instanceof UnsupportedCurrencyError) {
        throw new BadRequestException(`${prefix}${error.message}`);
      }
      throw error;
    }
  }
  const raw = toAsciiNumericText(String(value));
  if (raw === '' || raw === '0' || raw === '-0') {
    return 0n;
  }
  const isToman = normCurrency === 'IRR' && /تومان|toman|irt/i.test(raw) && !/ریال|rial|irr/i.test(raw);
  const negative = /^\(.*\)$/.test(raw) || /^[-−]/.test(raw) || /[-−]$/.test(raw);
  const stripped = raw
    .replace(/(تومان|ریال|irr|irt|rial|toman)/gi, '')
    .replace(/^[(\-−]+|[)\-−]+$/g, '');
  if (stripped === '') {
    throw new BadRequestException(`${prefix}مبلغ نامعتبر است: «${String(value)}»`);
  }
  if (stripped === '0') {
    return 0n;
  }
  const signed = negative ? `-${stripped}` : stripped;
  try {
    const parsed = parseCurrencyMinor(signed, normCurrency);
    return isToman ? parsed * 10n : parsed;
  } catch (error) {
    if (error instanceof MoneyFormatError || error instanceof UnsupportedCurrencyError) {
      throw new BadRequestException(`${prefix}${error.message}`);
    }
    throw error;
  }
}

/**
 * ضرب دقیق مبلغ در واحد minor در تعداد اعشاری بدون ممیز شناور و بدون برش اعشار (گرد نیمه‌به‌بالا دور از صفر).
 * مقدار صریح صفر همیشه 0n برمی‌گرداند و هرگز به 1 تبدیل نمی‌شود.
 */
export function multiplyMinorByDecimalQuantity(
  unitMinor: bigint,
  qtyRaw: unknown,
  defaultWhenMissing: string,
): bigint {
  if (qtyRaw === undefined || qtyRaw === null || qtyRaw === '') {
    return multiplyMinorByDecimalQuantity(unitMinor, defaultWhenMissing, defaultWhenMissing);
  }
  if (typeof qtyRaw === 'bigint') {
    return unitMinor * qtyRaw;
  }
  let qtyText: string;
  if (typeof qtyRaw === 'number') {
    if (!Number.isFinite(qtyRaw)) {
      throw new BadRequestException(`تعداد نامعتبر است: ${qtyRaw}`);
    }
    const rawStr = qtyRaw.toString();
    qtyText = rawStr.includes('e') || rawStr.includes('E')
      ? qtyRaw.toFixed(10).replace(/\.?0+$/, '')
      : rawStr;
  } else {
    qtyText = toAsciiNumericText(String(qtyRaw));
  }
  const match = DECIMAL_QTY_RE.exec(qtyText);
  if (!match) {
    throw new BadRequestException(`تعداد نامعتبر است: "${String(qtyRaw)}"`);
  }
  const [, sign, intPart, fracPart = ''] = match;
  const scaledQty = BigInt(`${intPart}${fracPart}`);
  if (scaledQty === 0n) {
    return 0n;
  }
  const signedQty = sign === '-' ? -scaledQty : scaledQty;
  const numerator = unitMinor * signedQty;
  if (fracPart.length === 0) {
    return numerator;
  }
  const denom = 10n ** BigInt(fracPart.length);
  const neg = numerator < 0n;
  const abs = neg ? -numerator : numerator;
  const rounded = (abs + denom / 2n) / denom;
  return neg ? -rounded : rounded;
}

/**
 * قالب‌بندی مبلغ به ریال یا ارز مربوطه به صورت دقیق و بدون خطای اعشاری ممیز شناور.
 */
export function formatTieOutMoney(
  minorUnits: bigint,
  currencyCode: string = 'IRR',
): string {
  const normCurrency = currencyCode.toUpperCase();
  if (normCurrency === 'IRR') {
    const isNegative = minorUnits < 0n;
    const absVal = isNegative ? -minorUnits : minorUnits;
    const formatted = absVal
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${isNegative ? '-' : ''}${formatted} ریال`;
  }
  const dec = formatCurrencyMinor(minorUnits, normCurrency);
  return `${dec} ${normCurrency}`;
}

@Injectable()
export class ImportTieOutEngine {
  constructor(
    private readonly configRegistry: EffectiveTieOutConfigRegistry = new EffectiveTieOutConfigRegistry(),
  ) {}

  /**
   * ارزیابی مغایرت‌گیری کنترل‌های سرفصل افتتاحیه:
   * ۱. تراز آزمایشی (بدهکار = بستانکار)
   * ۲. حساب‌های دریافتنی (AR Control = جمع فاکتورهای باز)
   * ۳. حساب‌های پرداختنی (AP Control = جمع فاکتورهای پرداختنی باز)
   * ۴. موجودی انبار (Stock Control = جمع ارزش لایه‌های انبار: تعداد × بهای واحد)
   * ۵. موجودی بانک (Bank Control = مانده صورتحساب بانک)
   */
  evaluateTieOuts(options: EvaluateTieOutsOptions): TieOutSummary {
    const {
      recordsByEntity,
      asOfDate,
      currency: requestedCurrency,
      customConfig,
      controlTotals,
      requireSubledgerOrControl = false,
    } = options;

    const config = this.configRegistry.resolveConfig(asOfDate, customConfig);
    const currency = (requestedCurrency ?? config.currency).trim().toUpperCase();
    if (!isSupportedCurrency(currency)) {
      throw new BadRequestException(
        `کد ارز پشتیبانی نمی‌شود: "${currency}".`,
      );
    }

    const openingRecords =
      recordsByEntity.get('accounting-opening-balances') ?? [];
    const journalRecords =
      recordsByEntity.get('accounting-journal-lines') ?? [];
    const rawSalesInvoices = recordsByEntity.get('sales-invoices') ?? [];
    const arInvoiceRecords: NormalisedRecord[] = [];
    const apInvoiceRecords: NormalisedRecord[] = [
      ...(recordsByEntity.get('purchase-invoices') ?? []),
      ...(recordsByEntity.get('vendor-bills') ?? []),
      ...(recordsByEntity.get('ap-invoices') ?? []),
      ...(recordsByEntity.get('accounts-payable') ?? []),
    ];
    for (const inv of rawSalesInvoices) {
      const invType = String(inv.values.type ?? '').trim();
      if (invType && PURCHASE_INVOICE_TYPE_RE.test(invType)) {
        apInvoiceRecords.push(inv);
      } else {
        arInvoiceRecords.push(inv);
      }
    }
    const inventoryRecords = recordsByEntity.get('inventory-items') ?? [];
    const bankRecords = [
      ...(recordsByEntity.get('bank-statement') ?? []),
      ...(recordsByEntity.get('bank-statements') ?? []),
    ];

    const warningsFa: string[] = [];
    const tbByCategory = this.classifyOpeningAccounts(
      openingRecords,
      config,
      currency,
      warningsFa,
    );

    const items: TieOutItemReport[] = [];

    const tbItem = this.checkTrialBalance(openingRecords, journalRecords, currency, controlTotals?.TRIAL_BALANCE);
    if (tbItem) items.push(tbItem);

    const controlSpecs: Array<{
      category: Exclude<TieOutCategory, 'TRIAL_BALANCE'>;
      name: string;
      hasSubledger: boolean;
      subledgerUnits: bigint;
      mismatchBlocker: (actual: string, expected: string, diff: string) => string;
      missingWarning: string;
    }> = [
      {
        category: 'ACCOUNTS_RECEIVABLE',
        name: 'کنترل حساب‌های دریافتنی (معین مشتریان در برابر صورتحساب‌های باز)',
        hasSubledger: arInvoiceRecords.length > 0,
        subledgerUnits: this.sumInvoiceSubledger(arInvoiceRecords, currency),
        mismatchBlocker: (a, e, d) => `مغایرت حساب‌های دریافتنی (AR): مانده معین افتتاحیه (${a}) با کنترل تعیین‌شده (${e}) مغایرت دارد؛ اختلاف: ${d}.`,
        missingWarning: 'سرفصل یا زیرمعین حساب‌های دریافتنی (AR) بدون طرف مقابل یا مبلغ کنترل است؛ مغایرت‌گیری AR انجام نشد.',
      },
      {
        category: 'ACCOUNTS_PAYABLE',
        name: 'کنترل حساب‌های پرداختنی (معین بستانکاران تجاری)',
        hasSubledger: apInvoiceRecords.length > 0,
        subledgerUnits: this.sumInvoiceSubledger(apInvoiceRecords, currency),
        mismatchBlocker: (a, e, d) => `مغایرت حساب‌های پرداختنی (AP): مانده معین پرداختنی در افتتاحیه (${a}) با کنترل تعیین‌شده (${e}) مغایرت دارد؛ اختلاف: ${d}.`,
        missingWarning: 'سرفصل یا زیرمعین حساب‌های پرداختنی (AP) بدون طرف مقابل یا مبلغ کنترل است؛ مغایرت‌گیری AP انجام نشد.',
      },
      {
        category: 'INVENTORY_STOCK',
        name: 'کنترل موجودی انبار (سرفصل موجودی کالا در برابر لایه‌های انبار)',
        hasSubledger: inventoryRecords.length > 0,
        subledgerUnits: this.sumInventorySubledger(inventoryRecords, currency),
        mismatchBlocker: (a, e, d) => `مغایرت موجودی انبار: مانده سرفصل موجودی کالا در افتتاحیه (${a}) با ارزش کنترل (${e}) مغایرت دارد؛ اختلاف: ${d}.`,
        missingWarning: 'سرفصل یا زیرمعین موجودی انبار بدون طرف مقابل یا مبلغ کنترل است؛ مغایرت‌گیری انبار انجام نشد.',
      },
      {
        category: 'BANK_BALANCE',
        name: 'کنترل حساب بانکی (مانده معین بانک در برابر صورتحساب بانکی)',
        hasSubledger: bankRecords.length > 0,
        subledgerUnits: this.sumBankSubledger(bankRecords, currency),
        mismatchBlocker: (a, e, d) => `مغایرت حساب بانکی: مانده حساب بانکی در افتتاحیه (${a}) با مانده صورتحساب بانک (${e}) مغایرت دارد؛ اختلاف: ${d}.`,
        missingWarning: 'سرفصل یا صورتحساب بانکی بدون طرف مقابل یا مبلغ کنترل است؛ مغایرت‌گیری بانک انجام نشد.',
      },
    ];
    for (const spec of controlSpecs) {
      const item = this.evaluateControlTieOut({
        ...spec,
        tb: tbByCategory[spec.category],
        currency,
        controlTotal: controlTotals?.[spec.category],
        requireSubledgerOrControl,
        warningsFa,
      });
      if (item) items.push(item);
    }

    const discrepancies = items.filter((item) => !item.matched);
    const passed = discrepancies.length === 0;
    const blockersFa = discrepancies
      .map((d) => d.blockerFa)
      .filter((b): b is string => Boolean(b));

    return {
      passed,
      totalChecks: items.length,
      passedChecks: items.length - discrepancies.length,
      discrepanciesCount: discrepancies.length,
      items,
      discrepancies,
      blockersFa,
      ...(warningsFa.length > 0 ? { warningsFa } : {}),
    };
  }

  /**
   * مسدودسازی ثبت در صورت وجود هرگونه عدم تطابق در کنترل‌ها.
   */
  assertTieOut(summary: TieOutSummary): void {
    if (!summary.passed) {
      throw new ConflictException({
        code: 'TIE_OUT_DISCREPANCY',
        message:
          'ثبت مسدود شد: عدم تطابق در مبالغ کنترل افتتاحیه. جزئیات مغایرت به تفکیک مبالغ در گزارش آمده است.',
        tieOut: summary,
      });
    }
  }

  private checkTrialBalance(
    openingRecords: NormalisedRecord[],
    journalRecords: NormalisedRecord[],
    currency: string,
    targetDiffControl?: number | string | bigint,
  ): TieOutItemReport | null {
    const records =
      openingRecords.length > 0 ? openingRecords : journalRecords;
    if (records.length === 0 && targetDiffControl === undefined) {
      return null;
    }

    let totalDebitUnits = 0n;
    let totalCreditUnits = 0n;

    for (const record of records) {
      const debitCol = record.values.debit !== undefined ? 'debit' : 'debitRial';
      const creditCol = record.values.credit !== undefined ? 'credit' : 'creditRial';
      const debitRaw =
        record.values.debit ?? record.values.debitRial ?? 0;
      const creditRaw =
        record.values.credit ?? record.values.creditRial ?? 0;

      if (debitRaw !== null && debitRaw !== undefined && debitRaw !== '') {
        totalDebitUnits += parseMoneyValue(debitRaw as number | string, currency, {
          column: debitCol,
          rowNumber: record.rowNumber,
        });
      }
      if (creditRaw !== null && creditRaw !== undefined && creditRaw !== '') {
        totalCreditUnits += parseMoneyValue(creditRaw as number | string, currency, {
          column: creditCol,
          rowNumber: record.rowNumber,
        });
      }
    }

    // در حالت تراز، بدهکار باید دقیقاً برابر با بستانکار باشد
    const diffUnits = totalDebitUnits - totalCreditUnits;
    const targetDiff =
      targetDiffControl !== undefined
        ? parseMoneyValue(targetDiffControl, currency)
        : 0n;
    const matched = diffUnits === targetDiff;

    const expectedMoney = formatTieOutMoney(totalCreditUnits, currency);
    const actualMoney = formatTieOutMoney(totalDebitUnits, currency);
    const diffMoney = formatTieOutMoney(
      diffUnits < 0n ? -diffUnits : diffUnits,
      currency,
    );

    let blockerFa: string | undefined;
    if (!matched) {
      blockerFa = `تراز آزمایشی افتتاحیه متوازن نیست: جمع بدهکار (${actualMoney}) ≠ جمع بستانکار (${expectedMoney})؛ اختلاف در مقادیر کنترل: ${diffMoney}.`;
    }

    return {
      category: 'TRIAL_BALANCE',
      name: 'تراز آزمایشی افتتاحیه (جمع بدهکار و بستانکار)',
      expectedMinor: totalCreditUnits.toString(),
      expectedMoney,
      actualMinor: totalDebitUnits.toString(),
      actualMoney,
      differenceMinor: diffUnits.toString(),
      differenceMoney: diffMoney,
      currency,
      matched,
      blockerFa,
    };
  }

  private classifyOpeningAccounts(
    openingRecords: NormalisedRecord[],
    config: EffectiveTieOutConfig,
    currency: string,
    warningsFa: string[],
  ): Record<
    Exclude<TieOutCategory, 'TRIAL_BALANCE'>,
    { found: boolean; balance: bigint }
  > {
    const result: Record<
      Exclude<TieOutCategory, 'TRIAL_BALANCE'>,
      { found: boolean; balance: bigint }
    > = {
      ACCOUNTS_RECEIVABLE: { found: false, balance: 0n },
      ACCOUNTS_PAYABLE: { found: false, balance: 0n },
      INVENTORY_STOCK: { found: false, balance: 0n },
      BANK_BALANCE: { found: false, balance: 0n },
    };

    const categories: Array<{
      category: Exclude<TieOutCategory, 'TRIAL_BALANCE'>;
      rule: TieOutControlAccountRule;
      creditNormal: boolean;
    }> = [
      { category: 'ACCOUNTS_RECEIVABLE', rule: config.accountsReceivable, creditNormal: false },
      { category: 'ACCOUNTS_PAYABLE', rule: config.accountsPayable, creditNormal: true },
      { category: 'INVENTORY_STOCK', rule: config.inventory, creditNormal: false },
      { category: 'BANK_BALANCE', rule: config.bank, creditNormal: false },
    ];

    for (const record of openingRecords) {
      const code = String(record.values.accountCode ?? record.values.code ?? '').trim();
      const rawDesc = String(
        record.values.description ?? record.values.accountName ?? record.values.name ?? '',
      );
      const normDesc = normaliseFaPatternText(rawDesc);

      // Priority 1: exact account code match. When account code is present, match ONLY by exact code;
      // never fall through to name pattern or substring match.
      let matched: typeof categories = [];
      if (code !== '') {
        matched = categories.filter((c) => c.rule.accountCodes.includes(code));
      } else if (normDesc !== '') {
        // Priority 2: bounded whole-word pattern match on normalized description only when account code is absent.
        matched = categories.filter((c) =>
          c.rule.namePatterns.some((p) => matchesBoundedPattern(normDesc, p)),
        );
      }

      if (matched.length === 0) {
        continue;
      }
      if (matched.length > 1) {
        const names = matched.map((m) => m.category).join(' / ');
        warningsFa.push(
          `حساب «${code || rawDesc}» با بیش از یک دسته کنترل (${names}) تطابق داشت و برای جلوگیری از شمارش مضاعف کنار گذاشته شد؛ کد حساب دقیق تعریف کنید.`,
        );
        continue;
      }

      const target = matched[0];
      const debitRaw = record.values.debit;
      const creditRaw = record.values.credit;
      const d =
        debitRaw !== undefined && debitRaw !== null && debitRaw !== ''
          ? parseMoneyValue(debitRaw as number | string, currency, {
              column: 'debit',
              rowNumber: record.rowNumber,
            })
          : 0n;
      const c =
        creditRaw !== undefined && creditRaw !== null && creditRaw !== ''
          ? parseMoneyValue(creditRaw as number | string, currency, {
              column: 'credit',
              rowNumber: record.rowNumber,
            })
          : 0n;
      result[target.category].found = true;
      result[target.category].balance += target.creditNormal ? c - d : d - c;
    }

    return result;
  }

  private sumInvoiceSubledger(records: NormalisedRecord[], currency: string): bigint {
    let total = 0n;
    for (const inv of records) {
      const totalCol =
        inv.values.totalRial !== undefined
          ? 'totalRial'
          : inv.values.totalAmount !== undefined
            ? 'totalAmount'
            : inv.values.totalPrice !== undefined
              ? 'totalPrice'
              : inv.values.total !== undefined
                ? 'total'
                : 'amount';
      const totalVal =
        inv.values.totalRial ??
        inv.values.totalAmount ??
        inv.values.totalPrice ??
        inv.values.total ??
        inv.values.amount;
      if (totalVal !== undefined && totalVal !== null && totalVal !== '') {
        total += parseMoneyValue(totalVal as number | string, currency, {
          column: totalCol,
          rowNumber: inv.rowNumber,
        });
        continue;
      }
      const unitPriceCol = inv.values.unitPrice !== undefined ? 'unitPrice' : 'price';
      const unitPriceVal = inv.values.unitPrice ?? inv.values.price;
      if (unitPriceVal !== undefined && unitPriceVal !== null && unitPriceVal !== '') {
        const unitMinor = parseMoneyValue(unitPriceVal as number | string, currency, {
          column: unitPriceCol,
          rowNumber: inv.rowNumber,
        });
        total += multiplyMinorByDecimalQuantity(
          unitMinor,
          inv.values.quantity ?? inv.values.qty,
          '1',
        );
      }
    }
    return total;
  }

  private sumInventorySubledger(records: NormalisedRecord[], currency: string): bigint {
    let total = 0n;
    for (const item of records) {
      const totalCostCol = item.values.totalCost !== undefined ? 'totalCost' : 'totalValue';
      const totalCostVal = item.values.totalCost ?? item.values.totalValue;
      if (totalCostVal !== undefined && totalCostVal !== null && totalCostVal !== '') {
        total += parseMoneyValue(totalCostVal as number | string, currency, {
          column: totalCostCol,
          rowNumber: item.rowNumber,
        });
        continue;
      }
      const costCol =
        item.values.unitCost !== undefined
          ? 'unitCost'
          : item.values.cost !== undefined
            ? 'cost'
            : 'fee';
      const costVal = item.values.unitCost ?? item.values.cost ?? item.values.fee;
      if (costVal !== undefined && costVal !== null && costVal !== '') {
        const costMinor = parseMoneyValue(costVal as number | string, currency, {
          column: costCol,
          rowNumber: item.rowNumber,
        });
        total += multiplyMinorByDecimalQuantity(
          costMinor,
          item.values.quantity ?? item.values.qty,
          '0',
        );
      }
    }
    return total;
  }

  private sumBankSubledger(bankRecords: NormalisedRecord[], currency: string): bigint {
    if (bankRecords.length === 0) return 0n;
    const rowsWithBalance = bankRecords.filter(
      (r) => r.values.balance !== undefined && r.values.balance !== null && r.values.balance !== '',
    );
    if (rowsWithBalance.length > 0) {
      // Pick chronologically latest dated row (last row on tie) to support both ascending & descending statements.
      let closingRow = rowsWithBalance[rowsWithBalance.length - 1];
      let latestDate = '';
      for (const row of rowsWithBalance) {
        const d = typeof row.values.date === 'string' ? row.values.date : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= latestDate) {
          latestDate = d;
          closingRow = row;
        }
      }
      return parseMoneyValue(closingRow.values.balance as number | string, currency, {
        column: 'balance',
        rowNumber: closingRow.rowNumber,
      });
    }

    let net = 0n;
    for (const r of bankRecords) {
      const hasDep = r.values.deposit !== undefined && r.values.deposit !== null && r.values.deposit !== '';
      const hasWth = r.values.withdrawal !== undefined && r.values.withdrawal !== null && r.values.withdrawal !== '';
      if (hasDep || hasWth) {
        if (hasDep) {
          net += parseMoneyValue(r.values.deposit as number | string, currency, {
            column: 'deposit',
            rowNumber: r.rowNumber,
          });
        }
        if (hasWth) {
          net -= parseMoneyValue(r.values.withdrawal as number | string, currency, {
            column: 'withdrawal',
            rowNumber: r.rowNumber,
          });
        }
      } else if (r.values.amount !== undefined && r.values.amount !== null && r.values.amount !== '') {
        net += parseMoneyValue(r.values.amount as number | string, currency, {
          column: 'amount',
          rowNumber: r.rowNumber,
        });
      }
    }
    return net;
  }

  private evaluateControlTieOut(params: {
    category: Exclude<TieOutCategory, 'TRIAL_BALANCE'>;
    name: string;
    tb: { found: boolean; balance: bigint };
    hasSubledger: boolean;
    subledgerUnits: bigint;
    currency: string;
    controlTotal?: number | string | bigint;
    requireSubledgerOrControl: boolean;
    warningsFa: string[];
    mismatchBlocker: (actual: string, expected: string, diff: string) => string;
    missingWarning: string;
  }): TieOutItemReport | null {
    const { category, name, tb, hasSubledger, subledgerUnits, currency, controlTotal, requireSubledgerOrControl, warningsFa, mismatchBlocker, missingWarning } = params;
    const hasControl = controlTotal !== undefined;
    if (!tb.found && !hasSubledger && !hasControl) return null;

    if (!hasControl && !(tb.found && hasSubledger)) {
      warningsFa.push(missingWarning);
      // AP check without controlTotal or counterpart subledger must fail when AP opening balance exists (never silently pass).
      if (!requireSubledgerOrControl && !(category === 'ACCOUNTS_PAYABLE' && tb.found)) return null;
      const presentUnits = hasSubledger ? subledgerUnits : tb.balance;
      const actualMoney = formatTieOutMoney(presentUnits, currency);
      return {
        category,
        name,
        expectedMinor: 'انجام نشد',
        expectedMoney: 'انجام نشد',
        actualMinor: presentUnits.toString(),
        actualMoney,
        differenceMinor: 'انجام نشد',
        differenceMoney: 'انجام نشد',
        currency,
        matched: false,
        blockerFa:
          category === 'ACCOUNTS_PAYABLE'
            ? `کنترل حساب‌های پرداختنی (AP): مانده معین پرداختنی در افتتاحیه (${actualMoney}) بدون صورتحساب‌های خرید باز یا مبلغ کنترل تاییدشده قابل تایید نیست؛ وارد کردن صورتحساب‌های باز یا مبلغ کنترل الزامی است.`
            : missingWarning,
      };
    }

    const expectedUnits = hasControl ? parseMoneyValue(controlTotal, currency) : tb.balance;
    const actualUnits = !hasControl
      ? subledgerUnits
      : tb.found && hasSubledger
        ? subledgerUnits !== expectedUnits
          ? subledgerUnits
          : tb.balance
        : hasSubledger
          ? subledgerUnits
          : tb.found
            ? tb.balance
            : 0n;

    const diffUnits = actualUnits - expectedUnits;
    const matched = diffUnits === 0n;
    const expectedMoney = formatTieOutMoney(expectedUnits, currency);
    const actualMoney = formatTieOutMoney(actualUnits, currency);
    const diffMoney = formatTieOutMoney(diffUnits < 0n ? -diffUnits : diffUnits, currency);

    return {
      category,
      name,
      expectedMinor: expectedUnits.toString(),
      expectedMoney,
      actualMinor: actualUnits.toString(),
      actualMoney,
      differenceMinor: diffUnits.toString(),
      differenceMoney: diffMoney,
      currency,
      matched,
      blockerFa: matched ? undefined : mismatchBlocker(actualMoney, expectedMoney, diffMoney),
    };
  }
}
