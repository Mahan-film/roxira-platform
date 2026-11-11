import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  SepidarRawAccount,
  SepidarRawItem,
  SepidarRawParty,
  SepidarRawVoucherItem,
} from './sepidar-raw-types';

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
  accountCode: string;
  floatingDetailCode: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
  description: string;
}

export interface SepidarReconciliationCertificate {
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
 * Pure in-memory adapter translating Sepidar MSSQL .bak export structures
 * into Roxira domain models. (No direct DB writes/importing in this phase).
 */
@Injectable()
export class SepidarMappingAdapter {
  private static readonly LEVEL_NAMES: Record<number, 'gorouh' | 'kol' | 'moein' | 'tafsili'> = {
    1: 'gorouh',
    2: 'kol',
    3: 'moein',
    4: 'tafsili',
  };

  private parseAmountMinor(value: number | string | bigint, fieldName: string, lineId: number): bigint {
    if (typeof value === 'bigint') {
      if (value < 0n) throw new Error(`Negative amount on line ${lineId} ${fieldName}: ${value}`);
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Number.isNaN(value)) {
        throw new Error(`Invalid non-finite number on line ${lineId} ${fieldName}: ${value}`);
      }
      if (value < 0) {
        throw new Error(`Negative amount on line ${lineId} ${fieldName}: ${value}`);
      }
      return BigInt(Math.round(value));
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new Error(`Invalid integer string on line ${lineId} ${fieldName}: "${value}"`);
      }
      return BigInt(trimmed);
    }
    throw new Error(`Unsupported amount type on line ${lineId} ${fieldName}`);
  }

  /**
   * Maps Sepidar 4-tier chart of accounts + floating details to standard Roxira chart structure.
   * Enforces uniqueness, validates hierarchical parents, and generates deterministic fingerprints.
   */
  mapAccounts(rawAccounts: SepidarRawAccount[]): MappedChartAccount[] {
    const accountMap = new Map<number, SepidarRawAccount>();
    const seenCodes = new Set<string>();

    rawAccounts.forEach((a) => accountMap.set(a.AccountID, a));

    return rawAccounts.map((raw) => {
      const code = raw.Code.trim();
      if (seenCodes.has(code)) {
        throw new Error(`Duplicate Sepidar account code: ${code}`);
      }
      seenCodes.add(code);

      const level = raw.Level;
      if (!level || level < 1 || level > 4) {
        throw new Error(`Invalid account level ${level} for account ${code}. Must be between 1 and 4.`);
      }

      let parentCode: string | null = null;
      if (raw.ParentAccountID !== null && raw.ParentAccountID !== undefined && raw.ParentAccountID > 0) {
        const parent = accountMap.get(raw.ParentAccountID);
        if (!parent) {
          throw new Error(`Account ${code} references missing parent ID ${raw.ParentAccountID}`);
        }
        parentCode = parent.Code.trim();
      }

      const isFloatingDetail = Boolean(raw.IsFloatingDetail);
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${code}:${level}:${parentCode ?? ''}:${isFloatingDetail ? 1 : 0}`)
        .digest('hex');

      return {
        code,
        name: raw.Title.trim(),
        level,
        levelName: SepidarMappingAdapter.LEVEL_NAMES[level] || 'tafsili',
        parentCode,
        isFloatingDetail,
        fingerprint,
      };
    });
  }

  /**
   * Maps Sepidar parties to Roxira party entities with accurate role assignment.
   */
  mapParties(rawParties: SepidarRawParty[]): MappedPartyRecord[] {
    const seenCodes = new Set<string>();

    return rawParties.map((raw) => {
      const code = raw.Code.trim();
      if (seenCodes.has(code)) {
        throw new Error(`Duplicate Sepidar party code: ${code}`);
      }
      seenCodes.add(code);

      let role: 'customer' | 'supplier' | 'both' = 'customer';
      if (raw.IsCustomer && raw.IsVendor) {
        role = 'both';
      } else if (raw.IsVendor) {
        role = 'supplier';
      }

      return {
        code,
        name: raw.Title.trim(),
        role,
        nationalId: raw.NationalCode ? raw.NationalCode.trim() : null,
        economicCode: raw.EconomicCode ? raw.EconomicCode.trim() : null,
        phone: raw.Phone ? raw.Phone.trim() : null,
      };
    });
  }

  /**
   * Maps Sepidar inventory items to Roxira stock items supporting dual units and ratios.
   */
  mapItems(rawItems: SepidarRawItem[]): MappedItemRecord[] {
    const seenSkus = new Set<string>();

    return rawItems.map((raw) => {
      const sku = raw.Code.trim();
      if (seenSkus.has(sku)) {
        throw new Error(`Duplicate Sepidar item SKU: ${sku}`);
      }
      seenSkus.add(sku);

      if (!raw.UnitTitle || !raw.UnitTitle.trim()) {
        throw new Error(`Item ${sku} is missing mandatory primary unit`);
      }

      const unitRatio =
        raw.UnitConversionRate !== null && raw.UnitConversionRate !== undefined
          ? String(raw.UnitConversionRate).trim()
          : null;

      return {
        sku,
        name: raw.Title.trim(),
        barcode: raw.Barcode ? raw.Barcode.trim() : null,
        primaryUnit: raw.UnitTitle.trim(),
        secondaryUnit: raw.SecondaryUnitTitle ? raw.SecondaryUnitTitle.trim() : null,
        unitRatio,
        category: raw.CategoryTitle ? raw.CategoryTitle.trim() : null,
      };
    });
  }

  /**
   * Maps Sepidar opening balance voucher items into balanced ledger lines.
   * Enforces integrity: no negative amounts, no simultaneous debit+credit, validates against chart codes.
   */
  mapOpeningBalance(
    rawVoucherItems: SepidarRawVoucherItem[],
    options?: { validAccountCodes?: Set<string>; requireBalanced?: boolean },
  ): {
    lines: MappedOpeningLine[];
    totalDebitMinor: bigint;
    totalCreditMinor: bigint;
    varianceMinor: bigint;
    isBalanced: boolean;
  } {
    let totalDebit = 0n;
    let totalCredit = 0n;

    const lines: MappedOpeningLine[] = rawVoucherItems.map((item, idx) => {
      const lineNo = item.VoucherItemID || idx + 1;
      const accountCode = item.AccountCode.trim();

      if (options?.validAccountCodes && !options.validAccountCodes.has(accountCode)) {
        throw new Error(`Opening balance line ${lineNo} references unknown account code: ${accountCode}`);
      }

      const debitMinor = this.parseAmountMinor(item.Debit, 'Debit', lineNo);
      const creditMinor = this.parseAmountMinor(item.Credit, 'Credit', lineNo);

      if (debitMinor > 0n && creditMinor > 0n) {
        throw new Error(`Opening balance line ${lineNo} cannot have both Debit and Credit greater than zero`);
      }

      totalDebit += debitMinor;
      totalCredit += creditMinor;

      return {
        accountCode,
        floatingDetailCode: item.FloatingDetailCode ? item.FloatingDetailCode.trim() : null,
        debitMinor,
        creditMinor,
        description: item.Description ? item.Description.trim() : 'سند افتتاحیه منتقل‌شده از سپیدار',
      };
    });

    const varianceMinor = totalDebit - totalCredit;
    const isBalanced = varianceMinor === 0n;

    if (options?.requireBalanced && !isBalanced) {
      throw new Error(`Sepidar opening balance is unbalanced: variance = ${varianceMinor} Rials`);
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
   * Produces the official reconciliation certificate verifying balancing invariants with a SHA-256 signature.
   */
  generateReconciliationCertificate(
    accounts: MappedChartAccount[],
    parties: MappedPartyRecord[],
    items: MappedItemRecord[],
    openingVoucher: SepidarRawVoucherItem[],
  ): SepidarReconciliationCertificate {
    const validCodes = new Set(accounts.map((a) => a.code));
    const opening = this.mapOpeningBalance(openingVoucher, { validAccountCodes: validCodes });
    const certifiedAt = new Date().toISOString();

    const certPayload = JSON.stringify({
      balanced: opening.isBalanced,
      totalDebitMinor: opening.totalDebitMinor.toString(),
      totalCreditMinor: opening.totalCreditMinor.toString(),
      varianceMinor: opening.varianceMinor.toString(),
      totalAccounts: accounts.length,
      totalParties: parties.length,
      totalItems: items.length,
      openingLinesCount: opening.lines.length,
      certifiedAt,
    });

    const checksum = crypto.createHash('sha256').update(certPayload).digest('hex');

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
