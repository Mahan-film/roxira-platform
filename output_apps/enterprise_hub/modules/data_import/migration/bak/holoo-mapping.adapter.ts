import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { MoneyFormatError, parseMinor } from '../../../accounting/money';
import {
  HolooRawAccount,
  HolooRawItem,
  HolooRawParty,
  HolooRawVoucherItem,
} from './holoo-raw-types';

export interface MappedChartAccount {
  code: string;
  name: string;
  level: number; // 1: Gorouh, 2: Kol, 3: Moein, 4: Tafsili
  levelName: 'gorouh' | 'kol' | 'moein' | 'tafsili';
  parentCode: string | null;
  isFloatingDetail: boolean;
  fingerprint: string;
}

export interface MappedPartyRecord {
  code: string;
  name: string;
  role: 'customer' | 'supplier' | 'both';
  nationalId: string | null;
  economicCode: string | null;
  phone: string | null;
}

export interface MappedItemRecord {
  sku: string;
  name: string;
  barcode: string | null;
  primaryUnit: string;
  secondaryUnit: string | null;
  unitRatio: string | null;
  category: string | null;
}

export interface MappedOpeningLine {
  sanadId: number;
  accountCode: string;
  floatingDetailCode: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
  description: string;
}

export interface HolooReconciliationCertificate {
  balanced: boolean;
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
  varianceMinor: bigint;
  totalAccounts: number;
  totalParties: number;
  totalItems: number;
  openingLinesCount: number;
  certifiedAt: string;
  checksum: string;
}

/**
 * Pure in-memory adapter translating Holoo (هلو) 3-level chart (group/kol/moein)
 * and floating details into standard Roxira 4-level chart and domain structures (#230 / T89).
 * Mapper only.
 */
@Injectable()
export class HolooMappingAdapter {
  private static readonly LEVEL_NAMES: Record<number, 'gorouh' | 'kol' | 'moein' | 'tafsili'> = {
    1: 'gorouh',
    2: 'kol',
    3: 'moein',
    4: 'tafsili',
  };

  /**
   * Parses a Rial amount into ledger minor units (MONEY_SCALE = 2) via money.ts.
   * Rejects negative, non-finite, oversized, or >2-decimal fractional values without rounding.
   */
  private parseAmountMinor(value: number | string | bigint, fieldName: string, lineId: number): bigint {
    if (typeof value === 'bigint') {
      if (value < 0n) throw new Error(`Negative amount on line ${lineId} ${fieldName}: ${value}`);
      try {
        return parseMinor(value.toString());
      } catch (err) {
        if (err instanceof MoneyFormatError) {
          throw new Error(`Invalid amount on line ${lineId} ${fieldName}: ${err.message}`);
        }
        throw err;
      }
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid non-finite number on line ${lineId} ${fieldName}: ${value}`);
      }
      if (value < 0) {
        throw new Error(`Negative amount on line ${lineId} ${fieldName}: ${value}`);
      }
      if (value > Number.MAX_SAFE_INTEGER / 100) {
        throw new Error(
          `Invalid amount on line ${lineId} ${fieldName}: Amount is too large for a JSON number; send it as a decimal string.`,
        );
      }
      try {
        return parseMinor(value.toString());
      } catch (err) {
        if (err instanceof MoneyFormatError) {
          throw new Error(`Invalid amount on line ${lineId} ${fieldName}: ${err.message}`);
        }
        throw err;
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('-')) {
        throw new Error(`Negative amount on line ${lineId} ${fieldName}: ${value}`);
      }
      try {
        return parseMinor(trimmed);
      } catch (err) {
        if (err instanceof MoneyFormatError) {
          throw new Error(`Invalid amount on line ${lineId} ${fieldName}: ${err.message}`);
        }
        throw err;
      }
    }
    throw new Error(`Unsupported amount type on line ${lineId} ${fieldName}`);
  }

  /**
   * Maps Holoo's 3-level chart (Group, Kol, Moein) + floating detail accounts into
   * standard Roxira 4-tier chart structure.
   * Enforces code uniqueness, integer levels 1..4, strict parent level progression,
   * cycle freedom, and generates deterministic fingerprints.
   */
  mapAccounts(rawAccounts: HolooRawAccount[]): MappedChartAccount[] {
    const accountByCode = new Map<string, HolooRawAccount>();
    const seenCodes = new Set<string>();

    for (const raw of rawAccounts) {
      const code = raw.Code.trim();
      if (!code) {
        throw new Error('Holoo account code cannot be empty');
      }
      if (seenCodes.has(code)) {
        throw new Error(`Duplicate Holoo account code: ${code}`);
      }
      seenCodes.add(code);
      accountByCode.set(code, raw);
    }

    const mapped = rawAccounts.map((raw) => {
      const code = raw.Code.trim();
      const level = raw.Level;
      if (!Number.isInteger(level) || level < 1 || level > 4) {
        throw new Error(
          `Invalid account level ${level} for account ${code}. Must be an integer between 1 and 4.`,
        );
      }

      let parentCode: string | null = null;
      if (raw.ParentCode !== null && raw.ParentCode !== undefined && raw.ParentCode.trim() !== '') {
        const pCode = raw.ParentCode.trim();
        if (pCode === code) {
          throw new Error(`Circular parent reference detected for account ${code}`);
        }
        const parent = accountByCode.get(pCode);
        if (!parent) {
          throw new Error(`Account ${code} references missing parent code "${pCode}"`);
        }
        if (level !== parent.Level + 1) {
          throw new Error(
            `Account ${code} (level ${level}) has parent ${pCode} with incompatible level ${parent.Level} (expected level ${parent.Level + 1})`,
          );
        }
        parentCode = pCode;
      }

      const isFloatingDetail = Boolean(raw.IsFloatingDetail);
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${code}:${level}:${parentCode ?? ''}:${isFloatingDetail ? 1 : 0}`)
        .digest('hex');

      return {
        code,
        name: raw.Name.trim(),
        level,
        levelName: HolooMappingAdapter.LEVEL_NAMES[level],
        parentCode,
        isFloatingDetail,
        fingerprint,
      };
    });

    // Cycle detection across all parent links
    const parentLookup = new Map<string, string | null>(
      mapped.map((a) => [a.code, a.parentCode]),
    );
    for (const acc of mapped) {
      const visited = new Set<string>();
      let curr: string | null = acc.code;
      while (curr !== null) {
        if (visited.has(curr)) {
          throw new Error(`Circular parent reference detected involving account ${curr}`);
        }
        visited.add(curr);
        curr = parentLookup.get(curr) ?? null;
      }
    }

    return mapped;
  }

  /**
   * Maps Holoo parties (ashkhas) to Roxira party entities with customer/supplier roles.
   */
  mapParties(rawParties: HolooRawParty[]): MappedPartyRecord[] {
    const seenCodes = new Set<string>();

    return rawParties.map((raw) => {
      const code = raw.Code.trim();
      if (seenCodes.has(code)) {
        throw new Error(`Duplicate Holoo party code: ${code}`);
      }
      seenCodes.add(code);

      let role: 'customer' | 'supplier' | 'both' = 'customer';
      if (raw.IsCustomer && raw.IsSupplier) {
        role = 'both';
      } else if (raw.IsSupplier) {
        role = 'supplier';
      }

      return {
        code,
        name: raw.Name.trim(),
        role,
        nationalId: raw.NationalCode ? raw.NationalCode.trim() : null,
        economicCode: raw.EconomicCode ? raw.EconomicCode.trim() : null,
        phone: raw.Phone ? raw.Phone.trim() : raw.Mobile ? raw.Mobile.trim() : null,
      };
    });
  }

  /**
   * Maps Holoo inventory items (kala) to Roxira stock items supporting primary & secondary units.
   */
  mapItems(rawItems: HolooRawItem[]): MappedItemRecord[] {
    const seenSkus = new Set<string>();

    return rawItems.map((raw) => {
      const sku = raw.Code.trim();
      if (seenSkus.has(sku)) {
        throw new Error(`Duplicate Holoo item SKU: ${sku}`);
      }
      seenSkus.add(sku);

      if (!raw.Unit || !raw.Unit.trim()) {
        throw new Error(`Item ${sku} is missing mandatory primary unit`);
      }

      const unitRatio =
        raw.UnitRatio !== null && raw.UnitRatio !== undefined
          ? String(raw.UnitRatio).trim()
          : null;

      return {
        sku,
        name: raw.Name.trim(),
        barcode: raw.Barcode ? raw.Barcode.trim() : null,
        primaryUnit: raw.Unit.trim(),
        secondaryUnit: raw.SecondaryUnit ? raw.SecondaryUnit.trim() : null,
        unitRatio,
        category: raw.Category ? raw.Category.trim() : null,
      };
    });
  }

  private static compareCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  private static compareBigInt(a: bigint, b: bigint): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /**
   * Maps Holoo opening balance voucher lines into balanced double-entry lines.
   * Fails closed if `validAccounts` is missing/empty; enforces postable accounts (level >= 3,
   * non-floating, non-parent), valid floating-detail codes, zero variance by default
   * (`requireBalanced = true`), and rejects simultaneous debit+credit.
   */
  mapOpeningBalance(
    rawVoucherItems: HolooRawVoucherItem[],
    options: {
      validAccounts: MappedChartAccount[];
      validFloatingDetailCodes?: Set<string>;
      requireBalanced?: boolean;
    },
  ): {
    lines: MappedOpeningLine[];
    totalDebitMinor: bigint;
    totalCreditMinor: bigint;
    varianceMinor: bigint;
    isBalanced: boolean;
  } {
    if (!options?.validAccounts || options.validAccounts.length === 0) {
      throw new Error(
        'Opening balance mapping requires a non-empty validAccounts chart to enforce postable account validation',
      );
    }

    let totalDebit = 0n;
    let totalCredit = 0n;

    const accountMap = new Map(options.validAccounts.map((a) => [a.code, a]));
    const parentAccountCodes = new Set(
      options.validAccounts
        .filter((a) => !a.isFloatingDetail && a.parentCode !== null)
        .map((a) => a.parentCode as string),
    );
    const allowedFloatingDetailCodes = new Set<string>([
      ...options.validAccounts.filter((a) => a.isFloatingDetail).map((a) => a.code),
      ...(options.validFloatingDetailCodes ?? []),
    ]);

    const lines: MappedOpeningLine[] = rawVoucherItems.map((item, idx) => {
      const lineNo = item.SanadId || idx + 1;
      const accountCode = item.AccountCode.trim();

      const account = accountMap.get(accountCode);
      if (!account) {
        throw new Error(`Opening balance line ${lineNo} references unknown account code: ${accountCode}`);
      }
      if (account.isFloatingDetail || account.level < 3 || parentAccountCodes.has(accountCode)) {
        throw new Error(
          `Opening balance line ${lineNo} references non-postable account code: ${accountCode} (level ${account.level})`,
        );
      }

      const floatingDetailCode = item.FloatingDetailCode ? item.FloatingDetailCode.trim() : null;
      if (floatingDetailCode && !allowedFloatingDetailCodes.has(floatingDetailCode)) {
        throw new Error(
          `Opening balance line ${lineNo} references unknown floating detail code: ${floatingDetailCode}`,
        );
      }

      const debitMinor = this.parseAmountMinor(item.Debit, 'Debit', lineNo);
      const creditMinor = this.parseAmountMinor(item.Credit, 'Credit', lineNo);

      if (debitMinor > 0n && creditMinor > 0n) {
        throw new Error(`Opening balance line ${lineNo} cannot have both Debit and Credit greater than zero`);
      }

      totalDebit += debitMinor;
      totalCredit += creditMinor;

      return {
        sanadId: item.SanadId,
        accountCode,
        floatingDetailCode,
        debitMinor,
        creditMinor,
        description: item.Description ? item.Description.trim() : 'سند افتتاحیه منتقل‌شده از نرم‌افزار هلو',
      };
    });

    const varianceMinor = totalDebit - totalCredit;
    const isBalanced = varianceMinor === 0n;
    const requireBalanced = options.requireBalanced ?? true;

    if (requireBalanced && !isBalanced) {
      throw new Error(`Holoo opening balance is unbalanced: variance = ${varianceMinor} minor units`);
    }

    return {
      lines,
      totalDebitMinor: totalDebit,
      totalCreditMinor: totalCredit,
      varianceMinor,
      isBalanced,
    };
  }

  /**
   * Produces the reconciliation certificate verifying zero-variance balance, postable accounts,
   * floating-detail codes, and a deterministic SHA-256 digest over canonical sorted payloads.
   */
  generateReconciliationCertificate(
    accounts: MappedChartAccount[],
    parties: MappedPartyRecord[],
    items: MappedItemRecord[],
    openingVoucher: HolooRawVoucherItem[],
  ): HolooReconciliationCertificate {
    const validFloatingDetailCodes = new Set<string>([
      ...accounts.filter((a) => a.isFloatingDetail).map((a) => a.code),
      ...parties.map((p) => p.code),
    ]);
    const opening = this.mapOpeningBalance(openingVoucher, {
      validAccounts: accounts,
      validFloatingDetailCodes,
      requireBalanced: true,
    });
    const certifiedAt = new Date().toISOString();

    const canonicalPayload = JSON.stringify({
      accounts: [...accounts]
        .sort((a, b) => HolooMappingAdapter.compareCodeUnits(a.code, b.code))
        .map((a) => ({
          code: a.code,
          isFloatingDetail: a.isFloatingDetail,
          level: a.level,
          name: a.name,
          parentCode: a.parentCode,
        })),
      balanced: opening.isBalanced,
      items: [...items]
        .sort((a, b) => HolooMappingAdapter.compareCodeUnits(a.sku, b.sku))
        .map((i) => ({
          barcode: i.barcode,
          primaryUnit: i.primaryUnit,
          sku: i.sku,
          unitRatio: i.unitRatio,
        })),
      openingLines: [...opening.lines]
        .sort((a, b) =>
          HolooMappingAdapter.compareCodeUnits(a.accountCode, b.accountCode) ||
          HolooMappingAdapter.compareCodeUnits(a.floatingDetailCode ?? '', b.floatingDetailCode ?? '') ||
          HolooMappingAdapter.compareBigInt(a.debitMinor, b.debitMinor) ||
          HolooMappingAdapter.compareBigInt(a.creditMinor, b.creditMinor) ||
          (a.sanadId < b.sanadId ? -1 : a.sanadId > b.sanadId ? 1 : 0) ||
          HolooMappingAdapter.compareCodeUnits(a.description, b.description),
        )
        .map((l) => ({
          accountCode: l.accountCode,
          creditMinor: l.creditMinor.toString(),
          debitMinor: l.debitMinor.toString(),
          description: l.description,
          floatingDetailCode: l.floatingDetailCode,
          sanadId: l.sanadId,
        })),
      parties: [...parties]
        .sort((a, b) => HolooMappingAdapter.compareCodeUnits(a.code, b.code))
        .map((p) => ({
          code: p.code,
          nationalId: p.nationalId,
          role: p.role,
        })),
      totalCreditMinor: opening.totalCreditMinor.toString(),
      totalDebitMinor: opening.totalDebitMinor.toString(),
      varianceMinor: opening.varianceMinor.toString(),
    });

    const checksum = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    return {
      balanced: opening.isBalanced,
      totalDebitMinor: opening.totalDebitMinor,
      totalCreditMinor: opening.totalCreditMinor,
      varianceMinor: opening.varianceMinor,
      totalAccounts: accounts.length,
      totalParties: parties.length,
      totalItems: items.length,
      openingLinesCount: opening.lines.length,
      certifiedAt,
      checksum,
    };
  }
}
