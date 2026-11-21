import { ConflictException, Injectable } from '@nestjs/common';
import {
  formatCurrencyMinor,
  parseCurrencyMinor,
} from '../../accounting/money';
import { NormalisedRecord } from '../registry/import-registry.types';
import {
  EffectiveTieOutConfig,
  EffectiveTieOutConfigRegistry,
  TieOutCategory,
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
}

export interface EvaluateTieOutsOptions {
  recordsByEntity: Map<string, NormalisedRecord[]>;
  asOfDate?: string;
  currency?: string;
  customConfig?: Partial<EffectiveTieOutConfig>;
  controlTotals?: Partial<Record<TieOutCategory, number | string | bigint>>;
}

/**
 * تبدیل مقادیر ورودی (عدد، رشته، bigint) به واحدهای minor بر مبنای توان ارزی ISO 4217.
 */
export function parseMoneyValue(
  value: number | string | bigint,
  currencyCode: string = 'IRR',
): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  const clean =
    typeof value === 'number'
      ? value.toString()
      : String(value)
          .replace(/[٬,\s]/g, '')
          .trim();
  if (clean === '' || clean === '0' || clean === '-0') {
    return 0n;
  }
  return parseCurrencyMinor(clean, currencyCode);
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
    } = options;

    const config = this.configRegistry.resolveConfig(asOfDate, customConfig);
    const currency = (requestedCurrency ?? config.currency).toUpperCase();

    const openingRecords =
      recordsByEntity.get('accounting-opening-balances') ?? [];
    const journalRecords =
      recordsByEntity.get('accounting-journal-lines') ?? [];
    const invoiceRecords = recordsByEntity.get('sales-invoices') ?? [];
    const inventoryRecords = recordsByEntity.get('inventory-items') ?? [];
    const bankRecords = recordsByEntity.get('bank-statement') ?? [];

    const items: TieOutItemReport[] = [];

    // ۱. بررسی تراز آزمایشی (TB)
    const tbItem = this.checkTrialBalance(
      openingRecords,
      journalRecords,
      currency,
      controlTotals?.TRIAL_BALANCE,
    );
    if (tbItem) {
      items.push(tbItem);
    }

    // ۲. بررسی کنترل حساب‌های دریافتنی (AR)
    const arItem = this.checkAccountsReceivable(
      openingRecords,
      invoiceRecords,
      config,
      currency,
      controlTotals?.ACCOUNTS_RECEIVABLE,
    );
    if (arItem) {
      items.push(arItem);
    }

    // ۳. بررسی کنترل حساب‌های پرداختنی (AP)
    const apItem = this.checkAccountsPayable(
      openingRecords,
      config,
      currency,
      controlTotals?.ACCOUNTS_PAYABLE,
    );
    if (apItem) {
      items.push(apItem);
    }

    // ۴. بررسی کنترل موجودی کالا (Inventory Stock Value)
    const invItem = this.checkInventoryStock(
      openingRecords,
      inventoryRecords,
      config,
      currency,
      controlTotals?.INVENTORY_STOCK,
    );
    if (invItem) {
      items.push(invItem);
    }

    // ۵. بررسی کنترل حساب بانکی (Bank Balance)
    const bankItem = this.checkBankBalance(
      openingRecords,
      bankRecords,
      config,
      currency,
      controlTotals?.BANK_BALANCE,
    );
    if (bankItem) {
      items.push(bankItem);
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
      const debitRaw =
        record.values.debit ?? record.values.debitRial ?? 0;
      const creditRaw =
        record.values.credit ?? record.values.creditRial ?? 0;

      if (debitRaw !== null && debitRaw !== undefined && debitRaw !== '') {
        totalDebitUnits += parseMoneyValue(debitRaw as number | string, currency);
      }
      if (creditRaw !== null && creditRaw !== undefined && creditRaw !== '') {
        totalCreditUnits += parseMoneyValue(creditRaw as number | string, currency);
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

  private checkAccountsReceivable(
    openingRecords: NormalisedRecord[],
    invoiceRecords: NormalisedRecord[],
    config: EffectiveTieOutConfig,
    currency: string,
    controlTotal?: number | string | bigint,
  ): TieOutItemReport | null {
    let tbArBalanceUnits = 0n;
    let foundTbAr = false;

    for (const record of openingRecords) {
      const code = String(
        record.values.accountCode ?? record.values.code ?? '',
      ).trim();
      const desc = String(
        record.values.description ??
          record.values.accountName ??
          record.values.name ??
          '',
      ).toLowerCase();

      const isMatch =
        config.accountsReceivable.accountCodes.includes(code) ||
        config.accountsReceivable.namePatterns.some((p) =>
          desc.includes(p.toLowerCase()),
        );

      if (isMatch) {
        foundTbAr = true;
        const d =
          record.values.debit !== undefined && record.values.debit !== null
            ? parseMoneyValue(record.values.debit as number | string, currency)
            : 0n;
        const c =
          record.values.credit !== undefined && record.values.credit !== null
            ? parseMoneyValue(record.values.credit as number | string, currency)
            : 0n;
        tbArBalanceUnits += d - c; // حساب دارایی ماهیت بدهکار دارد
      }
    }

    let subledgerArUnits = 0n;
    const hasSubledger = invoiceRecords.length > 0;

    for (const inv of invoiceRecords) {
      const totalVal =
        inv.values.totalAmount ??
        inv.values.totalPrice ??
        inv.values.total ??
        inv.values.amount;

      if (totalVal !== undefined && totalVal !== null && totalVal !== '') {
        subledgerArUnits += parseMoneyValue(totalVal as number | string, currency);
      } else {
        const unitPriceVal = inv.values.unitPrice ?? inv.values.price;
        const qtyVal = inv.values.quantity ?? inv.values.qty;
        if (unitPriceVal !== undefined && unitPriceVal !== null) {
          const unitUnits = parseMoneyValue(unitPriceVal as number | string, currency);
          const parsedQty =
            typeof qtyVal === 'number'
              ? qtyVal
              : typeof qtyVal === 'string'
                ? Number(qtyVal)
                : 1;
          const qtyUnits = BigInt(
            Math.trunc(Number.isFinite(parsedQty) ? parsedQty : 1),
          );
          subledgerArUnits += unitUnits * (qtyUnits === 0n ? 1n : qtyUnits);
        }
      }
    }

    if (!foundTbAr && !hasSubledger && controlTotal === undefined) {
      return null;
    }

    let expectedUnits = 0n;
    let actualUnits = 0n;

    if (hasSubledger && foundTbAr) {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : tbArBalanceUnits;
      actualUnits = subledgerArUnits;
    } else if (hasSubledger) {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : 0n;
      actualUnits = subledgerArUnits;
    } else {
      // فقط تراز افتتاحیه و کنترل توتال خارجی داریم
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : 0n;
      actualUnits = tbArBalanceUnits;
    }

    const diffUnits = actualUnits - expectedUnits;
    const matched = diffUnits === 0n;

    const expectedMoney = formatTieOutMoney(expectedUnits, currency);
    const actualMoney = formatTieOutMoney(actualUnits, currency);
    const diffMoney = formatTieOutMoney(
      diffUnits < 0n ? -diffUnits : diffUnits,
      currency,
    );

    let blockerFa: string | undefined;
    if (!matched) {
      blockerFa = `مغایرت حساب‌های دریافتنی (AR): مانده معین افتتاحیه (${actualMoney}) با کنترل تعیین‌شده (${expectedMoney}) مغایرت دارد؛ اختلاف: ${diffMoney}.`;
    }

    return {
      category: 'ACCOUNTS_RECEIVABLE',
      name: 'کنترل حساب‌های دریافتنی (معین مشتریان در برابر صورتحساب‌های باز)',
      expectedMinor: expectedUnits.toString(),
      expectedMoney,
      actualMinor: actualUnits.toString(),
      actualMoney,
      differenceMinor: diffUnits.toString(),
      differenceMoney: diffMoney,
      currency,
      matched,
      blockerFa,
    };
  }

  private checkAccountsPayable(
    openingRecords: NormalisedRecord[],
    config: EffectiveTieOutConfig,
    currency: string,
    controlTotal?: number | string | bigint,
  ): TieOutItemReport | null {
    let tbApBalanceUnits = 0n;
    let foundTbAp = false;

    for (const record of openingRecords) {
      const code = String(
        record.values.accountCode ?? record.values.code ?? '',
      ).trim();
      const desc = String(
        record.values.description ??
          record.values.accountName ??
          record.values.name ??
          '',
      ).toLowerCase();

      const isMatch =
        config.accountsPayable.accountCodes.includes(code) ||
        config.accountsPayable.namePatterns.some((p) =>
          desc.includes(p.toLowerCase()),
        );

      if (isMatch) {
        foundTbAp = true;
        const d =
          record.values.debit !== undefined && record.values.debit !== null
            ? parseMoneyValue(record.values.debit as number | string, currency)
            : 0n;
        const c =
          record.values.credit !== undefined && record.values.credit !== null
            ? parseMoneyValue(record.values.credit as number | string, currency)
            : 0n;
        tbApBalanceUnits += c - d; // حساب بدهی ماهیت بستانکار دارد
      }
    }

    if (!foundTbAp && controlTotal === undefined) {
      return null;
    }

    const expectedUnits =
      controlTotal !== undefined
        ? parseMoneyValue(controlTotal, currency)
        : tbApBalanceUnits;
    const actualUnits = tbApBalanceUnits;
    const diffUnits = actualUnits - expectedUnits;
    const matched = diffUnits === 0n;

    const expectedMoney = formatTieOutMoney(expectedUnits, currency);
    const actualMoney = formatTieOutMoney(actualUnits, currency);
    const diffMoney = formatTieOutMoney(
      diffUnits < 0n ? -diffUnits : diffUnits,
      currency,
    );

    let blockerFa: string | undefined;
    if (!matched) {
      blockerFa = `مغایرت حساب‌های پرداختنی (AP): مانده معین پرداختنی در افتتاحیه (${actualMoney}) با کنترل تعیین‌شده (${expectedMoney}) مغایرت دارد؛ اختلاف: ${diffMoney}.`;
    }

    return {
      category: 'ACCOUNTS_PAYABLE',
      name: 'کنترل حساب‌های پرداختنی (معین بستانکاران تجاری)',
      expectedMinor: expectedUnits.toString(),
      expectedMoney,
      actualMinor: actualUnits.toString(),
      actualMoney,
      differenceMinor: diffUnits.toString(),
      differenceMoney: diffMoney,
      currency,
      matched,
      blockerFa,
    };
  }

  private checkInventoryStock(
    openingRecords: NormalisedRecord[],
    inventoryRecords: NormalisedRecord[],
    config: EffectiveTieOutConfig,
    currency: string,
    controlTotal?: number | string | bigint,
  ): TieOutItemReport | null {
    let tbInvBalanceUnits = 0n;
    let foundTbInv = false;

    for (const record of openingRecords) {
      const code = String(
        record.values.accountCode ?? record.values.code ?? '',
      ).trim();
      const desc = String(
        record.values.description ??
          record.values.accountName ??
          record.values.name ??
          '',
      ).toLowerCase();

      const isMatch =
        config.inventory.accountCodes.includes(code) ||
        config.inventory.namePatterns.some((p) =>
          desc.includes(p.toLowerCase()),
        );

      if (isMatch) {
        foundTbInv = true;
        const d =
          record.values.debit !== undefined && record.values.debit !== null
            ? parseMoneyValue(record.values.debit as number | string, currency)
            : 0n;
        const c =
          record.values.credit !== undefined && record.values.credit !== null
            ? parseMoneyValue(record.values.credit as number | string, currency)
            : 0n;
        tbInvBalanceUnits += d - c;
      }
    }

    let subledgerInvUnits = 0n;
    const hasSubledger = inventoryRecords.length > 0;

    for (const item of inventoryRecords) {
      const totalCostVal = item.values.totalCost ?? item.values.totalValue;
      if (totalCostVal !== undefined && totalCostVal !== null && totalCostVal !== '') {
        subledgerInvUnits += parseMoneyValue(totalCostVal as number | string, currency);
      } else {
        const costVal = item.values.unitCost ?? item.values.cost ?? item.values.fee;
        const qtyVal = item.values.quantity ?? item.values.qty ?? 0;
        if (costVal !== undefined && costVal !== null) {
          const costUnits = parseMoneyValue(costVal as number | string, currency);
          const parsedQty =
            typeof qtyVal === 'number'
              ? qtyVal
              : typeof qtyVal === 'string'
                ? Number(qtyVal)
                : 0;
          const qtyUnits = BigInt(
            Math.trunc(Number.isFinite(parsedQty) ? parsedQty : 0),
          );
          subledgerInvUnits += costUnits * qtyUnits;
        }
      }
    }

    if (!foundTbInv && !hasSubledger && controlTotal === undefined) {
      return null;
    }

    let expectedUnits = 0n;
    let actualUnits = 0n;

    if (hasSubledger && foundTbInv) {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : tbInvBalanceUnits;
      actualUnits = subledgerInvUnits;
    } else if (hasSubledger) {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : 0n;
      actualUnits = subledgerInvUnits;
    } else {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : 0n;
      actualUnits = tbInvBalanceUnits;
    }

    const diffUnits = actualUnits - expectedUnits;
    const matched = diffUnits === 0n;

    const expectedMoney = formatTieOutMoney(expectedUnits, currency);
    const actualMoney = formatTieOutMoney(actualUnits, currency);
    const diffMoney = formatTieOutMoney(
      diffUnits < 0n ? -diffUnits : diffUnits,
      currency,
    );

    let blockerFa: string | undefined;
    if (!matched) {
      blockerFa = `مغایرت موجودی انبار: مانده سرفصل موجودی کالا در افتتاحیه (${actualMoney}) با ارزش کنترل (${expectedMoney}) مغایرت دارد؛ اختلاف: ${diffMoney}.`;
    }

    return {
      category: 'INVENTORY_STOCK',
      name: 'کنترل موجودی انبار (سرفصل موجودی کالا در برابر لایه‌های انبار)',
      expectedMinor: expectedUnits.toString(),
      expectedMoney,
      actualMinor: actualUnits.toString(),
      actualMoney,
      differenceMinor: diffUnits.toString(),
      differenceMoney: diffMoney,
      currency,
      matched,
      blockerFa,
    };
  }

  private checkBankBalance(
    openingRecords: NormalisedRecord[],
    bankRecords: NormalisedRecord[],
    config: EffectiveTieOutConfig,
    currency: string,
    controlTotal?: number | string | bigint,
  ): TieOutItemReport | null {
    let tbBankBalanceUnits = 0n;
    let foundTbBank = false;

    for (const record of openingRecords) {
      const code = String(
        record.values.accountCode ?? record.values.code ?? '',
      ).trim();
      const desc = String(
        record.values.description ??
          record.values.accountName ??
          record.values.name ??
          '',
      ).toLowerCase();

      const isMatch =
        config.bank.accountCodes.includes(code) ||
        config.bank.namePatterns.some((p) => desc.includes(p.toLowerCase()));

      if (isMatch) {
        foundTbBank = true;
        const d =
          record.values.debit !== undefined && record.values.debit !== null
            ? parseMoneyValue(record.values.debit as number | string, currency)
            : 0n;
        const c =
          record.values.credit !== undefined && record.values.credit !== null
            ? parseMoneyValue(record.values.credit as number | string, currency)
            : 0n;
        tbBankBalanceUnits += d - c;
      }
    }

    let subledgerBankUnits = 0n;
    const hasSubledger = bankRecords.length > 0;

    if (hasSubledger) {
      // پیدا کردن مانده نهایی صورتحساب بانک (از آخرین سطر با ستون مانده یا جمع گردش)
      const rowsWithBalance = bankRecords.filter(
        (r) =>
          r.values.balance !== undefined &&
          r.values.balance !== null &&
          r.values.balance !== '',
      );
      if (rowsWithBalance.length > 0) {
        const lastRow = rowsWithBalance[rowsWithBalance.length - 1];
        subledgerBankUnits = parseMoneyValue(
          lastRow.values.balance as number | string,
          currency,
        );
      } else {
        let sumDeposits = 0n;
        let sumWithdrawals = 0n;
        for (const r of bankRecords) {
          const dep = r.values.deposit ?? 0;
          const wth = r.values.withdrawal ?? 0;
          if (dep) {
            sumDeposits += parseMoneyValue(dep as number | string, currency);
          }
          if (wth) {
            sumWithdrawals += parseMoneyValue(wth as number | string, currency);
          }
        }
        subledgerBankUnits = sumDeposits - sumWithdrawals;
      }
    }

    if (!foundTbBank && !hasSubledger && controlTotal === undefined) {
      return null;
    }

    let expectedUnits = 0n;
    let actualUnits = 0n;

    if (hasSubledger && foundTbBank) {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : tbBankBalanceUnits;
      actualUnits = subledgerBankUnits;
    } else if (hasSubledger) {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : 0n;
      actualUnits = subledgerBankUnits;
    } else {
      expectedUnits =
        controlTotal !== undefined
          ? parseMoneyValue(controlTotal, currency)
          : 0n;
      actualUnits = tbBankBalanceUnits;
    }

    const diffUnits = actualUnits - expectedUnits;
    const matched = diffUnits === 0n;

    const expectedMoney = formatTieOutMoney(expectedUnits, currency);
    const actualMoney = formatTieOutMoney(actualUnits, currency);
    const diffMoney = formatTieOutMoney(
      diffUnits < 0n ? -diffUnits : diffUnits,
      currency,
    );

    let blockerFa: string | undefined;
    if (!matched) {
      blockerFa = `مغایرت حساب بانکی: مانده حساب بانکی در افتتاحیه (${actualMoney}) با مانده صورتحساب بانک (${expectedMoney}) مغایرت دارد؛ اختلاف: ${diffMoney}.`;
    }

    return {
      category: 'BANK_BALANCE',
      name: 'کنترل حساب بانکی (مانده معین بانک در برابر صورتحساب بانکی)',
      expectedMinor: expectedUnits.toString(),
      expectedMoney,
      actualMinor: actualUnits.toString(),
      actualMoney,
      differenceMinor: diffUnits.toString(),
      differenceMoney: diffMoney,
      currency,
      matched,
      blockerFa,
    };
  }
}
