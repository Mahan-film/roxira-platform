import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
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
   * Maps Holoo's 3-level chart (Group, Kol, Moein) + floating detail accounts into
   * standard Roxira 4-tier chart structure.
   * Enforces code uniqueness, validates hierarchical parents, and generates deterministic fingerprints.
   */
  mapAccounts(rawAccounts: HolooRawAccount[]): MappedChartAccount[] {
    const accountByCode = new Map<string, HolooRawAccount>();
    const seenCodes = new Set<string>();

    for (const raw of rawAccounts) {
      const code = raw.Code.trim();
      if (seenCodes.has(code)) {
        throw new Error(`Duplicate Holoo account code: ${code}`);
      }
      seenCodes.add(code);
      accountByCode.set(code, raw);
    }

    return rawAccounts.map((raw) => {
      const code = raw.Code.trim();

      const level = raw.Level;
      if (!level || level < 1 || level > 4) {
        throw new Error(`Invalid account level ${level} for account ${code}. Must be between 1 and 4.`);
      }

      let parentCode: string | null = null;
      if (raw.ParentCode !== null && raw.ParentCode !== undefined && raw.ParentCode.trim() !== '') {
        const pCode = raw.ParentCode.trim();
        const parent = accountByCode.get(pCode);
        if (!parent) {
          throw new Error(`Account ${code} references missing parent code "${pCode}"`);
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
        levelName: HolooMappingAdapter.LEVEL_NAMES[level] || 'tafsili',
        parentCode,
        isFloatingDetail,
        fingerprint,
      };
    });
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

  /**
   * Maps Holoo opening balance voucher lines into balanced double-entry lines.
   * Enforces integrity: no negative amounts, no simultaneous debit+credit, validates against chart codes.
   */
  mapOpeningBalance(
    rawVoucherItems: HolooRawVoucherItem[],
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
      const lineNo = item.SanadId || idx + 1;
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
        description: item.Description ? item.Description.trim() : 'سند افتتاحیه منتقل‌شده از نرم‌افزار هلو',
      };
    });

    const varianceMinor = totalDebit - totalCredit;
    const isBalanced = varianceMinor === 0n;

    if (options?.requireBalanced && !isBalanced) {
      throw new Error(`Holoo opening balance is unbalanced: variance = ${varianceMinor} Rials`);
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
    openingVoucher: HolooRawVoucherItem[],
  ): HolooReconciliationCertificate {
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
