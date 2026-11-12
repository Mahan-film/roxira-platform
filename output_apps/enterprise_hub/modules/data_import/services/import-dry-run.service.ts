import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, In, IsNull } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../../accounting/entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import {
  AccountLevel,
  AccountType,
  JournalEntryStatus,
  JournalEntryType,
} from '../../accounting/enums/accounting.enum';
import { MoneyFormatError, minorToDecimal, parseMinor } from '../../accounting/money';
import { ChequeEventEntity } from '../../cheques/entities/cheque-event.entity';
import { ChequeEntity } from '../../cheques/entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from '../../cheques/enums/cheque.enum';
import {
  SayadRegistrationStatus,
  isValidSayadNumber,
  toLatinDigits,
} from '../../cheques/sayad/sayad';
import { StockItemEntity } from '../../inventory/entities/stock-item.entity';
import { PartyEntity } from '../../parties/entities/party.entity';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';
import { PartyRole } from '../../parties/enums/party-role.enum';
import {
  SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS,
  SYNTHETIC_HOLOO_DRY_RUN_CHEQUES,
  SYNTHETIC_HOLOO_DRY_RUN_ITEMS,
  SYNTHETIC_HOLOO_DRY_RUN_OPENING_VOUCHER,
  SYNTHETIC_HOLOO_DRY_RUN_PARTIES,
  type HolooDryRunRawAccount,
  type HolooDryRunRawCheque,
  type HolooDryRunRawItem,
  type HolooDryRunRawParty,
  type HolooDryRunRawVoucherItem,
} from '../__fixtures__/synthetic-holoo-dry-run.fixture';
import {
  SYNTHETIC_SEPIDAR_CHEQUES,
  type SepidarRawCheque,
} from '../__fixtures__/synthetic-sepidar-p2.fixture';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_ITEMS,
  SYNTHETIC_SEPIDAR_OPENING_VOUCHER,
  SYNTHETIC_SEPIDAR_PARTIES,
  type SepidarRawAccount,
  type SepidarRawItem,
  type SepidarRawParty,
  type SepidarRawVoucherItem,
} from '../__fixtures__/synthetic-sepidar.fixture';
import { SepidarMappingAdapter } from '../migration/bak/sepidar-mapping.adapter';

export type ImportDryRunSource = 'sepidar' | 'holoo';

export type SepidarDryRunAccountInput = Omit<SepidarRawAccount, 'ParentAccountID'> & {
  ParentAccountID?: number | null;
};

export type DryRunChequeInput = Omit<
  SepidarRawCheque,
  | 'Amount'
  | 'SpentToPartyCode'
  | 'SpentToPartyName'
  | 'SpentToNationalId'
  | 'ReceiverNationalId'
  | 'Description'
> & {
  Amount: number | string;
  SpentToPartyCode?: string | null;
  SpentToPartyName?: string | null;
  SpentToNationalId?: string | null;
  ReceiverNationalId?: string | null;
  Description?: string | null;
};

export interface SepidarDryRunInput {
  useSynthetic?: boolean;
  openingDate?: string;
  customerGroup?: CustomerGroup;
  accounts?: SepidarDryRunAccountInput[];
  parties?: SepidarRawParty[];
  items?: SepidarRawItem[];
  openingVoucher?: Array<Omit<SepidarRawVoucherItem, 'Debit' | 'Credit'> & {
    Debit: number | string | bigint;
    Credit: number | string | bigint;
  }>;
  cheques?: DryRunChequeInput[];
}

export interface HolooDryRunInput {
  useSynthetic?: boolean;
  openingDate?: string;
  customerGroup?: CustomerGroup;
  accounts?: HolooDryRunRawAccount[];
  parties?: HolooDryRunRawParty[];
  items?: HolooDryRunRawItem[];
  openingVoucher?: Array<Omit<HolooDryRunRawVoucherItem, 'Debit' | 'Credit'> & {
    Debit: number | string | bigint;
    Credit: number | string | bigint;
  }>;
  cheques?: HolooDryRunRawCheque[];
}

export interface ImportDryRunEntityCount {
  incoming: number;
  wouldInsert: number;
  existingSkipped: number;
  invalidCount: number;
}

export interface ImportDryRunUnmappedAccount {
  accountCode: string;
  reason: 'missing_in_chart' | 'non_postable_level' | 'floating_detail_only' | 'has_child_accounts';
  lineCount: number;
  debitMinor: string;
  creditMinor: string;
  debitRial: string;
  creditRial: string;
  sampleLineIds: number[];
}

export interface ImportDryRunDuplicateParty {
  code: string;
  name: string;
  nationalId: string | null;
  reason:
    | 'duplicate_code_in_batch'
    | 'duplicate_national_id_in_batch'
    | 'existing_code_in_db'
    | 'existing_national_id_in_db';
  conflictingCode: string | null;
}

export interface ImportDryRunTrialBalanceLine {
  accountCode: string;
  accountName: string | null;
  mapped: boolean;
  debitMinor: string;
  creditMinor: string;
  debitRial: string;
  creditRial: string;
  netMinor: string;
}

export interface ImportDryRunReport {
  source: ImportDryRunSource;
  dryRun: true;
  rolledBack: true;
  tenantId: string;
  generatedAt: string;
  readyToCommit: boolean;
  blockersFa: string[];
  warningsFa: string[];
  counts: {
    accounts: ImportDryRunEntityCount;
    parties: ImportDryRunEntityCount & { duplicates: number };
    items: ImportDryRunEntityCount;
    openingLines: ImportDryRunEntityCount & { unmapped: number };
    cheques: ImportDryRunEntityCount & { openValid: number; closedSkipped: number };
  };
  openingTrialBalance: {
    balanced: boolean;
    totalDebitMinor: string;
    totalCreditMinor: string;
    varianceMinor: string;
    totalDebitRial: string;
    totalCreditRial: string;
    varianceRial: string;
    lineCount: number;
    persistedInTx: boolean;
    accounts: ImportDryRunTrialBalanceLine[];
  };
  unmappedAccounts: ImportDryRunUnmappedAccount[];
  duplicateParties: ImportDryRunDuplicateParty[];
  openCheques: {
    totalCount: number;
    totalAmountMinor: string;
    totalAmountRial: string;
    receivedCount: number;
    receivedAmountMinor: string;
    receivedAmountRial: string;
    issuedCount: number;
    issuedAmountMinor: string;
    issuedAmountRial: string;
    endorsedCount: number;
    endorsedAmountMinor: string;
    endorsedAmountRial: string;
    wouldInsertCount: number;
    existingSkippedCount: number;
    invalidErrors: Array<{ chequeNumber: string; reason: string }>;
  };
  txVerification: {
    dbAccountsAfterInsert: number;
    dbPartiesAfterInsert: number;
    dbItemsAfterInsert: number;
    dbOpeningLinesAfterInsert: number;
    dbChequesAfterInsert: number;
  };
}

interface NormalizedAccount {
  code: string;
  name: string;
  level: number;
  parentCode: string | null;
  isFloatingDetail: boolean;
}

interface NormalizedParty {
  code: string;
  name: string;
  role: 'customer' | 'supplier' | 'both';
  nationalId: string | null;
  economicCode: string | null;
  phone: string | null;
}

interface NormalizedItem {
  sku: string;
  name: string;
  barcode: string | null;
  primaryUnit: string;
  secondaryUnit: string | null;
  unitRatio: string | null;
}

interface NormalizedOpeningLine {
  lineId: number;
  accountCode: string;
  floatingDetailCode: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
  description: string;
}

interface NormalizedCheque {
  chequeNumber: string;
  sayadNumber: string;
  direction: ChequeDirection;
  status: ChequeStatus;
  amountMinor: bigint;
  issueDate: string;
  dueDate: string;
  partyName: string;
  partyCode: string;
  bankName: string | null;
  receiverNationalId: string | null;
  isEndorsed: boolean;
  spentToName: string | null;
  spentToCode: string | null;
  spentToNationalId: string | null;
  description: string | null;
}

interface NormalizedImportBatch {
  source: ImportDryRunSource;
  openingDate: Date;
  customerGroup: CustomerGroup;
  accounts: NormalizedAccount[];
  parties: NormalizedParty[];
  items: NormalizedItem[];
  openingLines: NormalizedOpeningLine[];
  openCheques: NormalizedCheque[];
  closedChequesCount: number;
  chequeErrors: Array<{ chequeNumber: string; reason: string }>;
  incomingChequesCount: number;
}

class DryRunRollbackSignal {
  constructor(public readonly report: ImportDryRunReport) {}
}

/**
 * Executes Sepidar and Holoo import dry-runs inside a real TenantScope PostgreSQL
 * transaction, persists entities in-transaction to verify constraints and DB state,
 * collects the full pre-commit dry-run report, and unconditionally rolls back.
 */
@Injectable()
export class ImportDryRunService {
  constructor(
    private readonly sepidarMappingAdapter: SepidarMappingAdapter,
    private readonly tenantScope: TenantScope,
  ) {}

  async dryRunSepidar(
    tenantId: string,
    input?: SepidarDryRunInput,
  ): Promise<ImportDryRunReport> {
    const isSynthetic = input?.useSynthetic === true;
    this.assertSyntheticAllowed(isSynthetic);

    const rawAccounts = isSynthetic ? SYNTHETIC_SEPIDAR_ACCOUNTS : (input?.accounts ?? []);
    const rawParties = isSynthetic ? SYNTHETIC_SEPIDAR_PARTIES : (input?.parties ?? []);
    const rawItems = isSynthetic ? SYNTHETIC_SEPIDAR_ITEMS : (input?.items ?? []);
    const rawVoucher = isSynthetic ? SYNTHETIC_SEPIDAR_OPENING_VOUCHER : (input?.openingVoucher ?? []);
    const rawCheques = isSynthetic ? SYNTHETIC_SEPIDAR_CHEQUES : (input?.cheques ?? []);

    this.assertNonEmptyPayload(
      isSynthetic,
      rawAccounts.length,
      rawParties.length,
      rawItems.length,
      rawVoucher.length,
      rawCheques.length,
    );

    const openingDate = this.parseCalendarDate(input?.openingDate);
    const customerGroup = input?.customerGroup ?? CustomerGroup.CONSUMER;

    const accounts = this.mapSepidarAccounts(rawAccounts);
    const parties: NormalizedParty[] = rawParties.map((raw) => ({
      code: raw.Code.trim(),
      name: raw.Title.trim(),
      role: raw.IsCustomer && raw.IsVendor ? 'both' : raw.IsVendor ? 'supplier' : 'customer',
      nationalId: raw.NationalCode ? raw.NationalCode.trim() : null,
      economicCode: raw.EconomicCode ? raw.EconomicCode.trim() : null,
      phone: raw.Phone ? raw.Phone.trim() : null,
    }));
    const items = this.mapSepidarItems(rawItems);
    const openingLines = rawVoucher.map((v, idx) =>
      this.normalizeVoucherLine(
        v.VoucherItemID || idx + 1,
        v.AccountCode,
        v.FloatingDetailCode,
        v.Debit,
        v.Credit,
        v.Description ?? 'سند افتتاحیه آزمایشی سپیدار',
      ),
    );
    const chequeResult = this.normalizeCheques(rawCheques);

    return this.executeDryRunTransaction(tenantId, {
      source: 'sepidar',
      openingDate,
      customerGroup,
      accounts,
      parties,
      items,
      openingLines,
      openCheques: chequeResult.validOpen,
      closedChequesCount: chequeResult.closedCount,
      chequeErrors: chequeResult.errors,
      incomingChequesCount: rawCheques.length,
    });
  }

  async dryRunHoloo(
    tenantId: string,
    input?: HolooDryRunInput,
  ): Promise<ImportDryRunReport> {
    const isSynthetic = input?.useSynthetic === true;
    this.assertSyntheticAllowed(isSynthetic);

    const rawAccounts = isSynthetic ? SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS : (input?.accounts ?? []);
    const rawParties = isSynthetic ? SYNTHETIC_HOLOO_DRY_RUN_PARTIES : (input?.parties ?? []);
    const rawItems = isSynthetic ? SYNTHETIC_HOLOO_DRY_RUN_ITEMS : (input?.items ?? []);
    const rawVoucher = isSynthetic ? SYNTHETIC_HOLOO_DRY_RUN_OPENING_VOUCHER : (input?.openingVoucher ?? []);
    const rawCheques = isSynthetic ? SYNTHETIC_HOLOO_DRY_RUN_CHEQUES : (input?.cheques ?? []);

    this.assertNonEmptyPayload(
      isSynthetic,
      rawAccounts.length,
      rawParties.length,
      rawItems.length,
      rawVoucher.length,
      rawCheques.length,
    );

    const openingDate = this.parseCalendarDate(input?.openingDate);
    const customerGroup = input?.customerGroup ?? CustomerGroup.CONSUMER;

    const accounts = this.mapHolooAccounts(rawAccounts);
    const parties: NormalizedParty[] = rawParties.map((raw) => ({
      code: raw.Code.trim(),
      name: raw.Name.trim(),
      role: raw.IsCustomer && raw.IsSupplier ? 'both' : raw.IsSupplier ? 'supplier' : 'customer',
      nationalId: raw.NationalCode ? raw.NationalCode.trim() : null,
      economicCode: raw.EconomicCode ? raw.EconomicCode.trim() : null,
      phone: raw.Phone ? raw.Phone.trim() : raw.Mobile ? raw.Mobile.trim() : null,
    }));
    const items = this.mapHolooItems(rawItems);
    const openingLines = rawVoucher.map((v, idx) =>
      this.normalizeVoucherLine(
        v.SanadId || idx + 1,
        v.AccountCode,
        v.FloatingDetailCode,
        v.Debit,
        v.Credit,
        v.Description ?? 'سند افتتاحیه آزمایشی هلو',
      ),
    );
    const chequeResult = this.normalizeCheques(rawCheques);

    return this.executeDryRunTransaction(tenantId, {
      source: 'holoo',
      openingDate,
      customerGroup,
      accounts,
      parties,
      items,
      openingLines,
      openCheques: chequeResult.validOpen,
      closedChequesCount: chequeResult.closedCount,
      chequeErrors: chequeResult.errors,
      incomingChequesCount: rawCheques.length,
    });
  }

  private assertSyntheticAllowed(isSynthetic: boolean): void {
    if (isSynthetic && process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Synthetic fixture dry-run is disabled in production.');
    }
  }

  private assertNonEmptyPayload(
    isSynthetic: boolean,
    accountsLen: number,
    partiesLen: number,
    itemsLen: number,
    voucherLen: number,
    chequesLen: number,
  ): void {
    if (
      !isSynthetic &&
      accountsLen === 0 &&
      partiesLen === 0 &&
      itemsLen === 0 &&
      voucherLen === 0 &&
      chequesLen === 0
    ) {
      throw new BadRequestException('حداقل یک گروه داده برای اجرای آزمایشی باید ارسال شود.');
    }
  }

  private parseCalendarDate(value?: string): Date {
    if (!value) return new Date();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
      throw new BadRequestException('Invalid openingDate format; expected YYYY-MM-DD.');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
      dt.getUTCFullYear() !== year ||
      dt.getUTCMonth() + 1 !== month ||
      dt.getUTCDate() !== day
    ) {
      throw new BadRequestException(`Invalid calendar openingDate: ${value}`);
    }
    return dt;
  }

  private parseRialToMinor(value: number | string | bigint, fieldName: string, lineId: number): bigint {
    if (typeof value === 'bigint') {
      if (value < 0n) {
        throw new BadRequestException(`Negative amount on line ${lineId} ${fieldName}`);
      }
      try {
        return parseMinor(value.toString());
      } catch (err) {
        if (err instanceof MoneyFormatError) {
          throw new BadRequestException(`Invalid amount on line ${lineId} ${fieldName}: ${err.message}`);
        }
        throw err;
      }
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(`Invalid non-finite number on line ${lineId} ${fieldName}`);
      }
      if (value < 0) {
        throw new BadRequestException(`Negative amount on line ${lineId} ${fieldName}`);
      }
      if (value > Number.MAX_SAFE_INTEGER / 100) {
        throw new BadRequestException(
          `Amount on line ${lineId} ${fieldName} exceeds safe JS number range; send as decimal string.`,
        );
      }
      try {
        return parseMinor(value.toString());
      } catch (err) {
        if (err instanceof MoneyFormatError) {
          throw new BadRequestException(`Invalid amount on line ${lineId} ${fieldName}: ${err.message}`);
        }
        throw err;
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('-')) {
        throw new BadRequestException(`Negative amount on line ${lineId} ${fieldName}`);
      }
      try {
        return parseMinor(trimmed);
      } catch (err) {
        if (err instanceof MoneyFormatError) {
          throw new BadRequestException(`Invalid amount on line ${lineId} ${fieldName}: ${err.message}`);
        }
        throw err;
      }
    }
    throw new BadRequestException(`Unsupported amount type on line ${lineId} ${fieldName}`);
  }

  private mapSepidarAccounts(rawAccounts: SepidarDryRunAccountInput[]): NormalizedAccount[] {
    try {
      const normalizedRaw: SepidarRawAccount[] = rawAccounts.map((a) => ({
        ...a,
        ParentAccountID: a.ParentAccountID ?? null,
      }));
      return this.sepidarMappingAdapter.mapAccounts(normalizedRaw).map((a) => ({
        code: a.code,
        name: a.name,
        level: a.level,
        parentCode: a.parentCode,
        isFloatingDetail: a.isFloatingDetail,
      }));
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid Sepidar accounts');
    }
  }

  private mapSepidarItems(rawItems: SepidarRawItem[]): NormalizedItem[] {
    try {
      return this.sepidarMappingAdapter.mapItems(rawItems).map((i) => ({
        sku: i.sku,
        name: i.name,
        barcode: i.barcode,
        primaryUnit: i.primaryUnit,
        secondaryUnit: i.secondaryUnit,
        unitRatio: i.unitRatio,
      }));
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid Sepidar items');
    }
  }

  private mapHolooAccounts(rawAccounts: HolooDryRunRawAccount[]): NormalizedAccount[] {
    const byCode = new Map<string, HolooDryRunRawAccount>();
    for (const raw of rawAccounts) {
      const code = raw.Code.trim();
      if (!code) throw new BadRequestException('Holoo account code cannot be empty');
      if (byCode.has(code)) throw new BadRequestException(`Duplicate Holoo account code: ${code}`);
      byCode.set(code, raw);
    }

    const mapped = rawAccounts.map((raw) => {
      const code = raw.Code.trim();
      if (!Number.isInteger(raw.Level) || raw.Level < 1 || raw.Level > 4) {
        throw new BadRequestException(`Invalid Holoo account level ${raw.Level} for ${code}`);
      }
      let parentCode: string | null = null;
      if (raw.ParentCode && raw.ParentCode.trim() !== '') {
        const pCode = raw.ParentCode.trim();
        if (pCode === code) {
          throw new BadRequestException(`Circular parent reference detected for Holoo account ${code}`);
        }
        const parent = byCode.get(pCode);
        if (!parent) {
          throw new BadRequestException(`Account ${code} references missing parent code "${pCode}"`);
        }
        if (raw.Level !== parent.Level + 1) {
          throw new BadRequestException(
            `Account ${code} (level ${raw.Level}) has incompatible parent ${pCode} (level ${parent.Level})`,
          );
        }
        parentCode = pCode;
      }
      return {
        code,
        name: raw.Name.trim(),
        level: raw.Level,
        parentCode,
        isFloatingDetail: Boolean(raw.IsFloatingDetail),
      };
    });

    const parentLookup = new Map(mapped.map((a) => [a.code, a.parentCode]));
    for (const acc of mapped) {
      const visited = new Set<string>();
      let curr: string | null = acc.code;
      while (curr !== null) {
        if (visited.has(curr)) {
          throw new BadRequestException(`Circular parent reference involving account ${curr}`);
        }
        visited.add(curr);
        curr = parentLookup.get(curr) ?? null;
      }
    }

    return mapped;
  }

  private mapHolooItems(rawItems: HolooDryRunRawItem[]): NormalizedItem[] {
    const seen = new Set<string>();
    return rawItems.map((raw) => {
      const sku = raw.Code.trim();
      if (!sku) throw new BadRequestException('Holoo item SKU cannot be empty');
      if (seen.has(sku)) throw new BadRequestException(`Duplicate Holoo item SKU: ${sku}`);
      seen.add(sku);
      if (!raw.Unit || !raw.Unit.trim()) {
        throw new BadRequestException(`Item ${sku} is missing mandatory primary unit`);
      }
      return {
        sku,
        name: raw.Name.trim(),
        barcode: raw.Barcode ? raw.Barcode.trim() : null,
        primaryUnit: raw.Unit.trim(),
        secondaryUnit: raw.SecondaryUnit ? raw.SecondaryUnit.trim() : null,
        unitRatio:
          raw.UnitRatio !== null && raw.UnitRatio !== undefined
            ? String(raw.UnitRatio).trim()
            : null,
      };
    });
  }

  private normalizeVoucherLine(
    lineId: number,
    accountCode: string,
    floatingDetailCode: string | null | undefined,
    debit: number | string | bigint,
    credit: number | string | bigint,
    description: string,
  ): NormalizedOpeningLine {
    const trimmedAccount = accountCode.trim();
    if (!trimmedAccount) {
      throw new BadRequestException(`Opening balance line ${lineId} is missing AccountCode`);
    }
    const debitMinor = this.parseRialToMinor(debit, 'Debit', lineId);
    const creditMinor = this.parseRialToMinor(credit, 'Credit', lineId);
    if (debitMinor > 0n && creditMinor > 0n) {
      throw new BadRequestException(
        `Opening balance line ${lineId} cannot have both Debit and Credit greater than zero`,
      );
    }
    return {
      lineId,
      accountCode: trimmedAccount,
      floatingDetailCode: floatingDetailCode ? floatingDetailCode.trim() : null,
      debitMinor,
      creditMinor,
      description: description.trim(),
    };
  }

  private normalizeCheques(
    rawCheques: Array<{
      ChequeId: number;
      ChequeNumber: string;
      SayadNumber: string;
      Direction: 'received' | 'issued';
      State: 'in_hand' | 'deposited' | 'spent' | 'delivered' | 'cleared' | 'bounced' | 'returned';
      Amount: number | string;
      IssueDate: string;
      DueDate: string;
      PartyCode: string;
      PartyName: string;
      BankName: string;
      SpentToPartyCode?: string | null;
      SpentToPartyName?: string | null;
      SpentToNationalId?: string | null;
      ReceiverNationalId?: string | null;
      Description?: string | null;
    }>,
  ): {
    validOpen: NormalizedCheque[];
    closedCount: number;
    errors: Array<{ chequeNumber: string; reason: string }>;
  } {
    const validOpen: NormalizedCheque[] = [];
    const errors: Array<{ chequeNumber: string; reason: string }> = [];
    let closedCount = 0;

    for (const raw of rawCheques) {
      if (raw.State === 'cleared' || raw.State === 'returned' || raw.State === 'bounced') {
        closedCount++;
        continue;
      }

      const sayadNumber = toLatinDigits(raw.SayadNumber || '').trim();
      if (!isValidSayadNumber(sayadNumber)) {
        errors.push({
          chequeNumber: raw.ChequeNumber,
          reason: `Invalid 16-digit Sayad number: '${raw.SayadNumber}'`,
        });
        continue;
      }

      let amountMinor: bigint;
      try {
        amountMinor = this.parseRialToMinor(raw.Amount, 'Amount', raw.ChequeId);
      } catch (err) {
        errors.push({
          chequeNumber: raw.ChequeNumber,
          reason: err instanceof Error ? err.message : 'Invalid cheque amount',
        });
        continue;
      }
      if (amountMinor <= 0n) {
        errors.push({
          chequeNumber: raw.ChequeNumber,
          reason: 'Cheque amount must be greater than zero',
        });
        continue;
      }

      if (raw.DueDate < raw.IssueDate) {
        errors.push({
          chequeNumber: raw.ChequeNumber,
          reason: `DueDate (${raw.DueDate}) precedes IssueDate (${raw.IssueDate})`,
        });
        continue;
      }

      const direction =
        raw.Direction === 'received' ? ChequeDirection.RECEIVED : ChequeDirection.ISSUED;
      let status: ChequeStatus;
      let isEndorsed = false;
      if (direction === ChequeDirection.RECEIVED) {
        if (raw.State === 'spent') {
          status = ChequeStatus.SPENT;
          isEndorsed = true;
        } else if (raw.State === 'deposited') {
          status = ChequeStatus.DEPOSITED;
        } else {
          status = ChequeStatus.REGISTERED;
        }
      } else {
        status = raw.State === 'delivered' ? ChequeStatus.DELIVERED : ChequeStatus.REGISTERED;
      }

      validOpen.push({
        chequeNumber: raw.ChequeNumber.trim(),
        sayadNumber,
        direction,
        status,
        amountMinor,
        issueDate: raw.IssueDate,
        dueDate: raw.DueDate,
        partyName: raw.PartyName.trim(),
        partyCode: raw.PartyCode.trim(),
        bankName: raw.BankName ? raw.BankName.trim() : null,
        receiverNationalId: raw.ReceiverNationalId ? raw.ReceiverNationalId.trim() : null,
        isEndorsed,
        spentToName: isEndorsed ? (raw.SpentToPartyName?.trim() ?? null) : null,
        spentToCode: isEndorsed ? (raw.SpentToPartyCode?.trim() ?? null) : null,
        spentToNationalId: isEndorsed ? (raw.SpentToNationalId?.trim() ?? null) : null,
        description: raw.Description ? raw.Description.trim() : null,
      });
    }

    return { validOpen, closedCount, errors };
  }

  private async executeDryRunTransaction(
    tenantId: string,
    batch: NormalizedImportBatch,
  ): Promise<ImportDryRunReport> {
    try {
      await this.tenantScope.run(tenantId, async (em: EntityManager) => {
        if (typeof em.query === 'function') {
          await em.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
            `import_dry_run:${tenantId}`,
          ]);
        }

        const accResult = await this.persistAccountsInTx(tenantId, batch.accounts, em);
        const partyResult = await this.persistPartiesAndDetectDuplicatesInTx(
          tenantId,
          batch.parties,
          batch.customerGroup,
          em,
        );
        const itemResult = await this.persistItemsInTx(tenantId, batch.items, em);
        const voucherAnalysis = await this.analyzeAndPersistOpeningVoucherInTx(
          tenantId,
          batch,
          em,
        );
        const chequeResult = await this.persistOpenChequesInTx(
          tenantId,
          batch.openCheques,
          batch.source,
          em,
        );

        const accountRepo = em.getRepository(ChartOfAccountEntity);
        const partyRepo = em.getRepository(PartyEntity);
        const itemRepo = em.getRepository(StockItemEntity);
        const lineRepo = em.getRepository(JournalEntryLineEntity);
        const chequeRepo = em.getRepository(ChequeEntity);

        const [
          dbAccountsAfterInsert,
          dbPartiesAfterInsert,
          dbItemsAfterInsert,
          dbOpeningLinesAfterInsert,
          dbChequesAfterInsert,
        ] = await Promise.all([
          accountRepo.count({ where: { tenantId } }),
          partyRepo.count({ where: { tenantId } }),
          itemRepo.count({ where: { tenantId } }),
          voucherAnalysis.entryId !== null
            ? lineRepo.count({ where: { tenantId, journalEntryId: voucherAnalysis.entryId } })
            : Promise.resolve(0),
          chequeRepo.count({ where: { tenantId } }),
        ]);

        const blockersFa: string[] = [];
        const warningsFa: string[] = [];

        if (voucherAnalysis.unmappedAccounts.length > 0) {
          blockersFa.push(
            `${voucherAnalysis.unmappedAccounts.length} حساب در سند افتتاحیه نگاشت نشده یا غیرقابل‌پست است.`,
          );
        }
        if (batch.openingLines.length > 0 && !voucherAnalysis.balanced) {
          blockersFa.push(
            `سند افتتاحیه تراز نیست (اختلاف: ${minorToDecimal(voucherAnalysis.varianceMinor)} ریال).`,
          );
        }
        if (batch.chequeErrors.length > 0) {
          blockersFa.push(
            `${batch.chequeErrors.length} چک دارای خطای ساختاری یا شناسه صیاد نامعتبر است.`,
          );
        }
        if (partyResult.duplicates.length > 0) {
          warningsFa.push(
            `${partyResult.duplicates.length} طرف‌حساب تکراری در فایل یا پایگاه‌داده شناسایی و رد شد.`,
          );
        }

        const report: ImportDryRunReport = {
          source: batch.source,
          dryRun: true,
          rolledBack: true,
          tenantId,
          generatedAt: new Date().toISOString(),
          readyToCommit: blockersFa.length === 0,
          blockersFa,
          warningsFa,
          counts: {
            accounts: {
              incoming: batch.accounts.length,
              wouldInsert: accResult.inserted,
              existingSkipped: accResult.skipped,
              invalidCount: 0,
            },
            parties: {
              incoming: batch.parties.length,
              wouldInsert: partyResult.inserted,
              existingSkipped: partyResult.existingSkipped,
              invalidCount: 0,
              duplicates: partyResult.duplicates.length,
            },
            items: {
              incoming: batch.items.length,
              wouldInsert: itemResult.inserted,
              existingSkipped: itemResult.skipped,
              invalidCount: 0,
            },
            openingLines: {
              incoming: batch.openingLines.length,
              wouldInsert: voucherAnalysis.persistedInTx ? batch.openingLines.length : 0,
              existingSkipped: 0,
              invalidCount: voucherAnalysis.unmappedLineCount,
              unmapped: voucherAnalysis.unmappedAccounts.length,
            },
            cheques: {
              incoming: batch.incomingChequesCount,
              wouldInsert: chequeResult.inserted,
              existingSkipped: chequeResult.skipped,
              invalidCount: batch.chequeErrors.length,
              openValid: batch.openCheques.length,
              closedSkipped: batch.closedChequesCount,
            },
          },
          openingTrialBalance: {
            balanced: voucherAnalysis.balanced,
            totalDebitMinor: voucherAnalysis.totalDebitMinor.toString(),
            totalCreditMinor: voucherAnalysis.totalCreditMinor.toString(),
            varianceMinor: voucherAnalysis.varianceMinor.toString(),
            totalDebitRial: minorToDecimal(voucherAnalysis.totalDebitMinor),
            totalCreditRial: minorToDecimal(voucherAnalysis.totalCreditMinor),
            varianceRial: minorToDecimal(voucherAnalysis.varianceMinor),
            lineCount: batch.openingLines.length,
            persistedInTx: voucherAnalysis.persistedInTx,
            accounts: voucherAnalysis.trialBalanceLines,
          },
          unmappedAccounts: voucherAnalysis.unmappedAccounts,
          duplicateParties: partyResult.duplicates,
          openCheques: {
            ...chequeResult.totals,
            wouldInsertCount: chequeResult.inserted,
            existingSkippedCount: chequeResult.skipped,
            invalidErrors: batch.chequeErrors,
          },
          txVerification: {
            dbAccountsAfterInsert,
            dbPartiesAfterInsert,
            dbItemsAfterInsert,
            dbOpeningLinesAfterInsert,
            dbChequesAfterInsert,
          },
        };

        throw new DryRunRollbackSignal(report);
      });
      throw new Error('Dry-run transaction did not roll back as expected');
    } catch (err) {
      if (err instanceof DryRunRollbackSignal) {
        return err.report;
      }
      throw err;
    }
  }

  private async persistAccountsInTx(
    tenantId: string,
    accounts: NormalizedAccount[],
    em: EntityManager,
  ): Promise<{ inserted: number; skipped: number }> {
    const repo = em.getRepository(ChartOfAccountEntity);
    let inserted = 0;
    let skipped = 0;

    const sorted = [...accounts].sort((a, b) => a.level - b.level);
    for (const acc of sorted) {
      const existing = await repo.findOne({ where: { tenantId, code: acc.code } });
      if (existing) {
        skipped++;
        continue;
      }

      const entity = repo.create({
        tenantId,
        code: acc.code,
        name: acc.name,
        accountType: this.inferAccountType(acc.code),
        currency: 'IRR',
        balance: '0',
        level: this.toAccountLevel(acc.level),
        parentCode: acc.parentCode,
      });
      await repo.save(entity);
      inserted++;
    }

    return { inserted, skipped };
  }

  private inferAccountType(code: string): AccountType {
    switch (code.charAt(0)) {
      case '1':
        return AccountType.ASSET;
      case '2':
        return AccountType.LIABILITY;
      case '3':
      case '9':
        return AccountType.EQUITY;
      case '4':
      case '7':
        return AccountType.REVENUE;
      case '5':
      case '6':
      case '8':
        return AccountType.EXPENSE;
      default:
        return AccountType.ASSET;
    }
  }

  private toAccountLevel(level: number): AccountLevel | null {
    switch (level) {
      case 1:
        return AccountLevel.GROUP;
      case 2:
        return AccountLevel.KOL;
      case 3:
        return AccountLevel.MOEIN;
      case 4:
        return AccountLevel.TAFSILI;
      default:
        return null;
    }
  }

  private async persistPartiesAndDetectDuplicatesInTx(
    tenantId: string,
    parties: NormalizedParty[],
    customerGroup: CustomerGroup,
    em: EntityManager,
  ): Promise<{
    inserted: number;
    existingSkipped: number;
    duplicates: ImportDryRunDuplicateParty[];
  }> {
    const repo = em.getRepository(PartyEntity);
    const existingAll = await repo.find({ where: { tenantId } });
    const dbByCode = new Map(existingAll.map((p) => [p.code, p]));
    const dbByNationalId = new Map<string, PartyEntity>();
    for (const p of existingAll) {
      if (p.nationalId) dbByNationalId.set(p.nationalId, p);
    }

    const batchSeenCodes = new Set<string>();
    const batchSeenNationalIds = new Map<string, string>();
    const duplicates: ImportDryRunDuplicateParty[] = [];
    let inserted = 0;
    let existingSkipped = 0;

    for (const p of parties) {
      if (batchSeenCodes.has(p.code)) {
        duplicates.push({
          code: p.code,
          name: p.name,
          nationalId: p.nationalId,
          reason: 'duplicate_code_in_batch',
          conflictingCode: p.code,
        });
        continue;
      }

      if (p.nationalId && batchSeenNationalIds.has(p.nationalId)) {
        duplicates.push({
          code: p.code,
          name: p.name,
          nationalId: p.nationalId,
          reason: 'duplicate_national_id_in_batch',
          conflictingCode: batchSeenNationalIds.get(p.nationalId) ?? null,
        });
        continue;
      }

      const existingCode = dbByCode.get(p.code);
      if (existingCode) {
        existingSkipped++;
        duplicates.push({
          code: p.code,
          name: p.name,
          nationalId: p.nationalId,
          reason: 'existing_code_in_db',
          conflictingCode: existingCode.code,
        });
        batchSeenCodes.add(p.code);
        continue;
      }

      if (p.nationalId && dbByNationalId.has(p.nationalId)) {
        const conflict = dbByNationalId.get(p.nationalId)!;
        existingSkipped++;
        duplicates.push({
          code: p.code,
          name: p.name,
          nationalId: p.nationalId,
          reason: 'existing_national_id_in_db',
          conflictingCode: conflict.code,
        });
        batchSeenCodes.add(p.code);
        continue;
      }

      batchSeenCodes.add(p.code);
      if (p.nationalId) batchSeenNationalIds.set(p.nationalId, p.code);

      let roleEnum = PartyRole.CUSTOMER;
      if (p.role === 'supplier') roleEnum = PartyRole.SUPPLIER;
      else if (p.role === 'both') roleEnum = PartyRole.BOTH;

      const entity = repo.create({
        tenantId,
        code: p.code,
        name: p.name,
        role: roleEnum,
        customerGroup,
        nationalId: p.nationalId,
        economicCode: p.economicCode,
        phone: p.phone,
        active: true,
      });
      await repo.save(entity);
      inserted++;
    }

    return { inserted, existingSkipped, duplicates };
  }

  private async persistItemsInTx(
    tenantId: string,
    items: NormalizedItem[],
    em: EntityManager,
  ): Promise<{ inserted: number; skipped: number }> {
    const repo = em.getRepository(StockItemEntity);
    let inserted = 0;
    let skipped = 0;

    for (const item of items) {
      const existing = await repo.findOne({ where: { tenantId, sku: item.sku } });
      if (existing) {
        skipped++;
        continue;
      }

      if (
        item.unitRatio !== null &&
        item.unitRatio !== undefined &&
        !/^\d+(\.\d{1,4})?$/.test(item.unitRatio)
      ) {
        throw new BadRequestException(`Invalid unitRatio "${item.unitRatio}" for item ${item.sku}`);
      }

      const entity = repo.create({
        tenantId,
        sku: item.sku,
        name: item.name,
        barcode: item.barcode || item.sku,
        quantity: 0,
        minQuantity: 0,
        primaryUnit: item.primaryUnit,
        secondaryUnit: item.secondaryUnit,
        unitRatio: (item.unitRatio ?? null) as unknown as number | null,
      });
      await repo.save(entity);
      inserted++;
    }

    return { inserted, skipped };
  }

  private async analyzeAndPersistOpeningVoucherInTx(
    tenantId: string,
    batch: NormalizedImportBatch,
    em: EntityManager,
  ): Promise<{
    totalDebitMinor: bigint;
    totalCreditMinor: bigint;
    varianceMinor: bigint;
    balanced: boolean;
    persistedInTx: boolean;
    entryId: number | null;
    unmappedLineCount: number;
    unmappedAccounts: ImportDryRunUnmappedAccount[];
    trialBalanceLines: ImportDryRunTrialBalanceLine[];
  }> {
    const accountRepo = em.getRepository(ChartOfAccountEntity);
    const dbAccounts = await accountRepo.find({ where: { tenantId } });
    const dbByCode = new Map(dbAccounts.map((a) => [a.code, a]));
    const incomingByCode = new Map(batch.accounts.map((a) => [a.code, a]));
    const floatingCodes = new Set(
      batch.accounts.filter((a) => a.isFloatingDetail).map((a) => a.code),
    );
    const parentCodesWithChildren = new Set<string>();
    for (const acc of dbAccounts) {
      if (acc.parentCode && !floatingCodes.has(acc.code)) {
        parentCodesWithChildren.add(acc.parentCode);
      }
    }

    let totalDebitMinor = 0n;
    let totalCreditMinor = 0n;
    let unmappedLineCount = 0;

    const tbAgg = new Map<
      string,
      {
        accountName: string | null;
        mapped: boolean;
        debitMinor: bigint;
        creditMinor: bigint;
      }
    >();
    const unmappedAgg = new Map<
      string,
      {
        reason: ImportDryRunUnmappedAccount['reason'];
        lineCount: number;
        debitMinor: bigint;
        creditMinor: bigint;
        sampleLineIds: number[];
      }
    >();

    for (const line of batch.openingLines) {
      totalDebitMinor += line.debitMinor;
      totalCreditMinor += line.creditMinor;

      const dbAcc = dbByCode.get(line.accountCode);
      const incAcc = incomingByCode.get(line.accountCode);

      let unmappedReason: ImportDryRunUnmappedAccount['reason'] | null = null;
      if (!dbAcc) {
        unmappedReason = 'missing_in_chart';
      } else if (incAcc?.isFloatingDetail) {
        unmappedReason = 'floating_detail_only';
      } else if (
        dbAcc.level === AccountLevel.GROUP ||
        dbAcc.level === AccountLevel.KOL
      ) {
        unmappedReason = 'non_postable_level';
      } else if (parentCodesWithChildren.has(line.accountCode)) {
        unmappedReason = 'has_child_accounts';
      }

      const mapped = unmappedReason === null;
      if (!mapped && unmappedReason) {
        unmappedLineCount++;
        const existingUnmapped = unmappedAgg.get(line.accountCode);
        if (existingUnmapped) {
          existingUnmapped.lineCount++;
          existingUnmapped.debitMinor += line.debitMinor;
          existingUnmapped.creditMinor += line.creditMinor;
          if (existingUnmapped.sampleLineIds.length < 5) {
            existingUnmapped.sampleLineIds.push(line.lineId);
          }
        } else {
          unmappedAgg.set(line.accountCode, {
            reason: unmappedReason,
            lineCount: 1,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            sampleLineIds: [line.lineId],
          });
        }
      }

      const existingTb = tbAgg.get(line.accountCode);
      if (existingTb) {
        existingTb.debitMinor += line.debitMinor;
        existingTb.creditMinor += line.creditMinor;
      } else {
        tbAgg.set(line.accountCode, {
          accountName: dbAcc?.name ?? incAcc?.name ?? null,
          mapped,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
        });
      }
    }

    const varianceMinor = totalDebitMinor - totalCreditMinor;
    const balanced = varianceMinor === 0n;

    const unmappedAccounts: ImportDryRunUnmappedAccount[] = Array.from(unmappedAgg.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([accountCode, v]) => ({
        accountCode,
        reason: v.reason,
        lineCount: v.lineCount,
        debitMinor: v.debitMinor.toString(),
        creditMinor: v.creditMinor.toString(),
        debitRial: minorToDecimal(v.debitMinor),
        creditRial: minorToDecimal(v.creditMinor),
        sampleLineIds: v.sampleLineIds,
      }));

    const trialBalanceLines: ImportDryRunTrialBalanceLine[] = Array.from(tbAgg.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([accountCode, v]) => ({
        accountCode,
        accountName: v.accountName,
        mapped: v.mapped,
        debitMinor: v.debitMinor.toString(),
        creditMinor: v.creditMinor.toString(),
        debitRial: minorToDecimal(v.debitMinor),
        creditRial: minorToDecimal(v.creditMinor),
        netMinor: (v.debitMinor - v.creditMinor).toString(),
      }));

    let persistedInTx = false;
    let entryId: number | null = null;

    if (batch.openingLines.length > 0 && unmappedAccounts.length === 0 && balanced) {
      const entryRepo = em.getRepository(JournalEntryEntity);
      const lineRepo = em.getRepository(JournalEntryLineEntity);
      const entryNumber = `JV-DRYRUN-${batch.source.toUpperCase()}`;

      const existingEntry = await entryRepo.findOne({
        where: { tenantId, entryNumber },
      });
      if (!existingEntry) {
        const entry = entryRepo.create({
          tenantId,
          entryNumber,
          date: batch.openingDate,
          description: `اجرای آزمایشی سند افتتاحیه ${batch.source === 'sepidar' ? 'سپیدار' : 'هلو'}`,
          status: JournalEntryStatus.POSTED,
          entryType: JournalEntryType.NORMAL,
        });
        const savedEntry = await entryRepo.save(entry);
        entryId = savedEntry.id;

        const deltaByAccount = new Map<number, bigint>();
        for (const l of batch.openingLines) {
          const acc = dbByCode.get(l.accountCode)!;
          const journalLine = lineRepo.create({
            tenantId,
            journalEntryId: savedEntry.id,
            accountId: acc.id,
            debit: minorToDecimal(l.debitMinor),
            credit: minorToDecimal(l.creditMinor),
            currency: 'IRR',
            partyCode: l.floatingDetailCode,
            description: l.description,
          });
          await lineRepo.save(journalLine);
          deltaByAccount.set(
            acc.id,
            (deltaByAccount.get(acc.id) ?? 0n) + l.debitMinor - l.creditMinor,
          );
        }

        const sortedAccountIds = Array.from(deltaByAccount.keys()).sort((a, b) => a - b);
        for (const accountId of sortedAccountIds) {
          const delta = deltaByAccount.get(accountId)!;
          await em.query(
            `UPDATE "fin_chart_of_accounts" SET "balance" = "balance" + $1::numeric WHERE "id" = $2 AND "tenant_id" = $3`,
            [minorToDecimal(delta), accountId, tenantId],
          );
        }
        persistedInTx = true;
      }
    }

    return {
      totalDebitMinor,
      totalCreditMinor,
      varianceMinor,
      balanced,
      persistedInTx,
      entryId,
      unmappedLineCount,
      unmappedAccounts,
      trialBalanceLines,
    };
  }

  private async persistOpenChequesInTx(
    tenantId: string,
    cheques: NormalizedCheque[],
    source: ImportDryRunSource,
    em: EntityManager,
  ): Promise<{
    inserted: number;
    skipped: number;
    totals: Omit<
      ImportDryRunReport['openCheques'],
      'wouldInsertCount' | 'existingSkippedCount' | 'invalidErrors'
    >;
  }> {
    const repo = em.getRepository(ChequeEntity);
    const eventRepo = em.getRepository(ChequeEventEntity);
    let inserted = 0;
    let skipped = 0;

    let totalAmountMinor = 0n;
    let receivedCount = 0;
    let receivedAmountMinor = 0n;
    let issuedCount = 0;
    let issuedAmountMinor = 0n;
    let endorsedCount = 0;
    let endorsedAmountMinor = 0n;

    for (const c of cheques) {
      totalAmountMinor += c.amountMinor;
      if (c.direction === ChequeDirection.RECEIVED) {
        receivedCount++;
        receivedAmountMinor += c.amountMinor;
        if (c.isEndorsed) {
          endorsedCount++;
          endorsedAmountMinor += c.amountMinor;
        }
      } else {
        issuedCount++;
        issuedAmountMinor += c.amountMinor;
      }

      let existing: ChequeEntity | null = null;
      if (c.sayadNumber) {
        existing = await repo.findOne({ where: { tenantId, sayadNumber: c.sayadNumber } });
      }
      if (!existing) {
        existing = await repo.findOne({
          where: {
            tenantId,
            chequeNumber: c.chequeNumber,
            bankName: c.bankName ? c.bankName : IsNull(),
          },
        });
      }
      if (existing) {
        skipped++;
        continue;
      }

      const entity = repo.create({
        tenantId,
        direction: c.direction,
        sayadNumber: c.sayadNumber,
        sayadVerified: false,
        sayadVerifiedBy: null,
        sayadVerifiedAt: null,
        sayadRegistrationStatus: SayadRegistrationStatus.UNKNOWN,
        chequeNumber: c.chequeNumber,
        bankName: c.bankName,
        amount: minorToDecimal(c.amountMinor),
        issueDate: c.issueDate,
        dueDate: c.dueDate,
        partyName: c.partyName,
        partyCode: c.partyCode,
        receiverNationalId: c.receiverNationalId,
        spentToName: c.spentToName,
        spentToCode: c.spentToCode,
        spentToNationalId: c.spentToNationalId,
        status: c.status,
        description: c.description ?? `چک باز آزمایشی ${source === 'sepidar' ? 'سپیدار' : 'هلو'}`,
      });
      const saved = await repo.save(entity);
      const event = eventRepo.create({
        tenantId,
        chequeId: saved.id,
        fromStatus: null,
        toStatus: saved.status,
        eventDate: saved.issueDate,
        journalEntryId: null,
        amount: null,
        note: `اجرای آزمایشی چک باز ${source === 'sepidar' ? 'سپیدار' : 'هلو'}`,
      });
      await eventRepo.save(event);
      inserted++;
    }

    return {
      inserted,
      skipped,
      totals: {
        totalCount: cheques.length,
        totalAmountMinor: totalAmountMinor.toString(),
        totalAmountRial: minorToDecimal(totalAmountMinor),
        receivedCount,
        receivedAmountMinor: receivedAmountMinor.toString(),
        receivedAmountRial: minorToDecimal(receivedAmountMinor),
        issuedCount,
        issuedAmountMinor: issuedAmountMinor.toString(),
        issuedAmountRial: minorToDecimal(issuedAmountMinor),
        endorsedCount,
        endorsedAmountMinor: endorsedAmountMinor.toString(),
        endorsedAmountRial: minorToDecimal(endorsedAmountMinor),
      },
    };
  }
}
