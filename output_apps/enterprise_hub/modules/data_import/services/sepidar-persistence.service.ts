import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { EntityManager, In, IsNull } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  AccountLevel,
  AccountType,
  JournalEntryStatus,
  JournalEntryType,
} from '../../accounting/enums/accounting.enum';
import { MoneyFormatError, minorToDecimal, parseMinor } from '../../accounting/money';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../../accounting/entities/journal-entry-line.entity';
import { ChequeEntity } from '../../cheques/entities/cheque.entity';
import { ChequeStatus } from '../../cheques/enums/cheque.enum';
import { ChequesRepository } from '../../cheques/repositories/cheques.repository';
import { SayadRegistrationStatus } from '../../cheques/sayad/sayad';
import { ImportMappingMemoryEntity } from '../entities/import-mapping-memory.entity';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartyEntity } from '../../parties/entities/party.entity';
import { StockItemEntity } from '../../inventory/entities/stock-item.entity';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_ITEMS,
  SYNTHETIC_SEPIDAR_OPENING_VOUCHER,
  SYNTHETIC_SEPIDAR_PARTIES,
  SepidarRawAccount,
  SepidarRawItem,
  SepidarRawParty,
  SepidarRawVoucherItem,
} from '../__fixtures__/synthetic-sepidar.fixture';
import {
  SYNTHETIC_SEPIDAR_CHEQUES,
  SepidarRawCheque,
} from '../__fixtures__/synthetic-sepidar-p2.fixture';
import {
  MappedChartAccount,
  MappedItemRecord,
  MappedOpeningLine,
  MappedPartyRecord,
  SepidarMappingAdapter,
} from '../migration/bak/sepidar-mapping.adapter';
import {
  MappedRoxiraCheque,
  SepidarChequesFifoAdapter,
} from '../migration/bak/sepidar-cheques-fifo.adapter';

export interface SepidarPersistenceCertificate {
  tenantId: string;
  certifiedAt: string;
  balanced: boolean;
  varianceMinor: string;
  counts: {
    accounts: number;
    parties: number;
    items: number;
    openingLines: number;
    cheques: number;
  };
  totals: {
    openingDebitMinor: string;
    openingCreditMinor: string;
    chequesAmountMinor: string;
  };
  canonicalSha256: string;
  idempotencySummary: {
    accountsInserted: number;
    accountsSkipped: number;
    partiesInserted: number;
    partiesSkipped: number;
    itemsInserted: number;
    itemsSkipped: number;
    openingVoucherCreated: boolean;
    chequesInserted: number;
    chequesSkipped: number;
  };
}

export type SepidarImportAccountInput = SepidarRawAccount & {
  AccountType?: AccountType;
};

export interface SepidarImportInput {
  useSynthetic?: boolean;
  openingDate?: string;
  customerGroup?: CustomerGroup;
  accountTypeMap?: Record<string, AccountType>;
  accounts?: SepidarImportAccountInput[];
  parties?: SepidarRawParty[];
  items?: SepidarRawItem[];
  openingVoucher?: SepidarRawVoucherItem[];
  cheques?: SepidarRawCheque[];
}

const OPENING_ENTRY_NUMBER = 'JV-OPENING-SEPIDAR';
const MAX_SEPIDAR_RIAL = 999_999_999_999_999n;
const SEPIDAR_IDEMPOTENCY_ENTITY = 'sepidar_idempotency';
const SYNTHETIC_FLOAT_ACCOUNT_TYPES: Record<string, AccountType> = {
  'F-001': AccountType.EXPENSE,
  'F-002': AccountType.EXPENSE,
};

/**
 * Converts a whole-IRR Sepidar amount into scale-2 Roxira minor units via `parseMinor`.
 * Rejects fractional/over-scale floats and oversized amounts instead of rounding or
 * letting adapters treat whole IRR as scale-2 minor units.
 */
function parseSepidarRialToMinor(
  value: number | string | bigint,
  fieldName: string,
  lineId: number,
): bigint {
  let rialText: string;
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new BadRequestException(`Negative amount on line ${lineId} ${fieldName}: ${value}`);
    }
    rialText = value.toString();
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(
        `Invalid whole IRR integer on line ${lineId} ${fieldName}: ${value}`,
      );
    }
    rialText = String(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new BadRequestException(
        `Invalid whole IRR integer string on line ${lineId} ${fieldName}: "${value}"`,
      );
    }
    rialText = trimmed;
  } else {
    throw new BadRequestException(`Unsupported amount type on line ${lineId} ${fieldName}`);
  }

  if (BigInt(rialText) > MAX_SEPIDAR_RIAL) {
    throw new BadRequestException(
      `Amount exceeds numeric(18,2) limit on line ${lineId} ${fieldName}: ${rialText}`,
    );
  }

  try {
    return parseMinor(rialText);
  } catch (err) {
    if (err instanceof MoneyFormatError) {
      throw new BadRequestException(
        `Invalid Rial amount on line ${lineId} ${fieldName}: ${err.message}`,
      );
    }
    throw err;
  }
}

/**
 * Service for persisting Sepidar backup data into Roxira enterprise database (T88 / #774).
 *
 * Guarantees:
 * 1. Strict Tenant Isolation: All operations execute inside a single TenantScope transaction.
 * 2. Atomic All-or-Nothing Persistence: Validation (including zero-variance balance) runs before
 *    writes, and all 5 entity groups share one transaction so any error leaves zero partial data.
 * 3. Concurrency & Idempotency: Uses a per-tenant advisory lock, Idempotency-Key + request
 *    fingerprint verification (409 on payload mismatch), and composite cheque keys (sayadNumber or
 *    chequeNumber + bankName).
 * 4. DB-Verified Reconciliation Certificate: Queries persisted database rows to certify counts,
 *    totals, balance variance, and canonical SHA-256 digest.
 */
@Injectable()
export class SepidarPersistenceService {
  private readonly logger = new Logger(SepidarPersistenceService.name);

  constructor(
    private readonly mappingAdapter: SepidarMappingAdapter,
    private readonly chequesAdapter: SepidarChequesFifoAdapter,
    private readonly tenantScope: TenantScope,
    private readonly chequesRepository: ChequesRepository,
  ) {}

  async persistSepidarData(
    tenantId: string,
    input?: SepidarImportInput,
    idempotencyKey?: string,
  ): Promise<SepidarPersistenceCertificate> {
    const isSynthetic = input?.useSynthetic === true;
    if (isSynthetic) {
      const env = process.env.NODE_ENV;
      const explicitlyAllowed =
        env === 'test' ||
        env === 'development' ||
        process.env.ALLOW_SYNTHETIC_SEPIDAR_IMPORT === '1';
      if (env === 'production' || !explicitlyAllowed) {
        throw new BadRequestException(
          'Synthetic fixture import is disabled outside development/test environments.',
        );
      }
    }

    const rawAccounts: SepidarImportAccountInput[] = isSynthetic
      ? SYNTHETIC_SEPIDAR_ACCOUNTS
      : input?.accounts ?? [];
    const rawParties = isSynthetic
      ? SYNTHETIC_SEPIDAR_PARTIES
      : input?.parties ?? [];
    const rawItems = isSynthetic
      ? SYNTHETIC_SEPIDAR_ITEMS
      : input?.items ?? [];
    const rawVoucher = isSynthetic
      ? SYNTHETIC_SEPIDAR_OPENING_VOUCHER
      : input?.openingVoucher ?? [];
    const rawCheques = isSynthetic
      ? SYNTHETIC_SEPIDAR_CHEQUES
      : input?.cheques ?? [];

    if (
      !isSynthetic &&
      rawAccounts.length === 0 &&
      rawParties.length === 0 &&
      rawItems.length === 0 &&
      rawVoucher.length === 0 &&
      rawCheques.length === 0
    ) {
      throw new BadRequestException(
        'حداقل یک گروه داده سپیدار باید ارسال شود.',
      );
    }

    const explicitOpeningDate = input?.openingDate ?? null;
    if (explicitOpeningDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(explicitOpeningDate)) {
        throw new BadRequestException('Invalid openingDate value.');
      }
      const [y, m, d] = explicitOpeningDate.split('-').map((p) => Number(p));
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== m - 1 ||
        dt.getUTCDate() !== d
      ) {
        throw new BadRequestException('Invalid openingDate calendar date.');
      }
    }
    const openingDate = explicitOpeningDate ? new Date(explicitOpeningDate) : new Date();
    if (Number.isNaN(openingDate.getTime())) {
      throw new BadRequestException('Invalid openingDate value.');
    }
    const customerGroup = input?.customerGroup ?? CustomerGroup.CONSUMER;

    // Step 1: In-memory mapping & structure validation (fails fast before any DB write).
    // All Sepidar amounts are whole IRR integers; validate strictly (reject floats/fractions)
    // and convert once through `parseMinor` into Roxira scale-2 minor units.
    let mappedAccounts: MappedChartAccount[];
    const explicitAccountTypesByCode = new Map<string, AccountType>();
    let mappedParties: MappedPartyRecord[];
    let mappedItems: MappedItemRecord[];
    let mappedOpeningLines: MappedOpeningLine[];
    let totalOpeningDebitMinor = 0n;
    let totalOpeningCreditMinor = 0n;
    let validCheques: MappedRoxiraCheque[];

    try {
      const baseTypeMap = isSynthetic
        ? { ...SYNTHETIC_FLOAT_ACCOUNT_TYPES, ...(input?.accountTypeMap ?? {}) }
        : (input?.accountTypeMap ?? {});
      for (const [code, accType] of Object.entries(baseTypeMap)) {
        explicitAccountTypesByCode.set(code.trim(), accType);
      }
      for (const rawAcc of rawAccounts) {
        if (rawAcc.AccountType !== undefined) {
          explicitAccountTypesByCode.set(rawAcc.Code.trim(), rawAcc.AccountType);
        }
      }

      const openingAmountByIndex = new Map<
        number,
        {
          accountCode: string;
          floatingDetailCode: string | null;
          debitMinor: bigint;
          creditMinor: bigint;
        }
      >();
      for (let i = 0; i < rawVoucher.length; i++) {
        const line = rawVoucher[i];
        const debitMinor = parseSepidarRialToMinor(line.Debit, 'Debit', line.VoucherItemID);
        const creditMinor = parseSepidarRialToMinor(line.Credit, 'Credit', line.VoucherItemID);
        openingAmountByIndex.set(i, {
          accountCode: line.AccountCode.trim(),
          floatingDetailCode: line.FloatingDetailCode ? line.FloatingDetailCode.trim() : null,
          debitMinor,
          creditMinor,
        });
      }

      const openRawCheques: Array<{
        chequeNumber: string;
        bankName: string | null;
        amountMinor: bigint;
      }> = [];
      for (const rawChq of rawCheques) {
        const isClosed =
          rawChq.State === 'cleared' || rawChq.State === 'returned' || rawChq.State === 'bounced';
        if (isClosed) continue;
        const amountMinor = parseSepidarRialToMinor(rawChq.Amount, 'Amount', rawChq.ChequeId);
        if (amountMinor <= 0n) {
          throw new BadRequestException(
            `Invalid Sepidar cheque ${rawChq.ChequeNumber}: Amount must be positive`,
          );
        }
        openRawCheques.push({
          chequeNumber: rawChq.ChequeNumber.trim(),
          bankName: rawChq.BankName ? rawChq.BankName.trim() : null,
          amountMinor,
        });
      }

      mappedAccounts = this.mappingAdapter.mapAccounts(rawAccounts);
      // Fail fast before opening DB transaction if any account prefix lacks valid Iranian COA group & no explicit AccountType
      for (const acc of mappedAccounts) {
        this.resolveAccountType(acc.code, explicitAccountTypesByCode.get(acc.code));
      }
      mappedParties = this.mappingAdapter.mapParties(rawParties);
      mappedItems = this.mappingAdapter.mapItems(rawItems);

      const mappedOpeningResult = this.mappingAdapter.mapOpeningBalance(rawVoucher, {
        requireBalanced: rawVoucher.length > 0,
      });
      if (mappedOpeningResult.lines.length !== rawVoucher.length) {
        throw new BadRequestException('Opening voucher mapped line count mismatch.');
      }
      mappedOpeningLines = mappedOpeningResult.lines.map((line, i) => {
        const rawConverted = openingAmountByIndex.get(i);
        if (
          !rawConverted ||
          rawConverted.accountCode !== line.accountCode ||
          rawConverted.floatingDetailCode !== (line.floatingDetailCode ?? null)
        ) {
          throw new BadRequestException(
            `Opening voucher line alignment mismatch at index ${i} (${line.accountCode}).`,
          );
        }
        totalOpeningDebitMinor += rawConverted.debitMinor;
        totalOpeningCreditMinor += rawConverted.creditMinor;
        return {
          ...line,
          debitMinor: rawConverted.debitMinor,
          creditMinor: rawConverted.creditMinor,
        };
      });

      const mappedCheques = this.chequesAdapter.mapCheques(rawCheques);
      if (mappedCheques.errors.length > 0) {
        const firstErr = mappedCheques.errors[0];
        throw new BadRequestException(
          `Invalid Sepidar cheque ${firstErr.chequeNumber}: ${firstErr.reason}`,
        );
      }
      if (mappedCheques.validCheques.length !== openRawCheques.length) {
        throw new BadRequestException('Sepidar open cheques alignment count mismatch.');
      }
      validCheques = mappedCheques.validCheques.map((chq, idx) => {
        const matched = openRawCheques[idx];
        if (
          !matched ||
          matched.chequeNumber !== chq.chequeNumber ||
          matched.bankName !== (chq.bankName ?? null)
        ) {
          throw new BadRequestException(
            `Sepidar cheque alignment mismatch at index ${idx} (${chq.chequeNumber}).`,
          );
        }
        return {
          ...chq,
          amountMinor: matched.amountMinor,
        };
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid Sepidar payload',
      );
    }

    const requestFingerprint = this.computeRequestFingerprint(tenantId, {
      openingDate: explicitOpeningDate,
      customerGroup,
      accounts: mappedAccounts.map((a) => ({
        code: a.code,
        name: a.name,
        level: a.level,
        parentCode: a.parentCode ?? null,
        accountType: this.resolveAccountType(a.code, explicitAccountTypesByCode.get(a.code)),
      })),
      parties: mappedParties.map((p) => ({
        code: p.code,
        name: p.name,
        role: p.role,
        customerGroup,
        nationalId: p.nationalId ?? null,
        economicCode: p.economicCode ?? null,
        phone: p.phone ?? null,
      })),
      items: mappedItems.map((i) => ({
        sku: i.sku,
        name: i.name,
        barcode: i.barcode || i.sku,
        primaryUnit: i.primaryUnit,
        secondaryUnit: i.secondaryUnit ?? null,
        unitRatio: i.unitRatio !== null && i.unitRatio !== undefined ? Number(i.unitRatio) : null,
      })),
      openingLines: mappedOpeningLines.map((l) => ({
        accountCode: l.accountCode,
        floatingDetailCode: l.floatingDetailCode ?? null,
        debitMinor: l.debitMinor.toString(),
        creditMinor: l.creditMinor.toString(),
        description: l.description ?? null,
      })),
      cheques: validCheques.map((c) => ({
        chequeNumber: c.chequeNumber,
        sayadNumber: c.sayadNumber,
        bankName: c.bankName ?? null,
        direction: c.direction,
        amountMinor: c.amountMinor.toString(),
        issueDate: c.issueDate,
        dueDate: c.dueDate,
        partyName: c.partyName,
        partyCode: c.partyCode ?? null,
        receiverNationalId: c.receiverNationalId ?? null,
        spentToName: c.spentToName ?? null,
        spentToCode: c.spentToCode ?? null,
        spentToNationalId: c.spentToNationalId ?? null,
        status: c.status ?? ChequeStatus.REGISTERED,
      })),
      totals: {
        openingDebitMinor: totalOpeningDebitMinor,
        openingCreditMinor: totalOpeningCreditMinor,
        chequesAmountMinor: validCheques.reduce((sum, c) => sum + c.amountMinor, 0n),
      },
    });

    // Step 2: Single atomic TenantScope transaction across all 5 entity groups
    return this.tenantScope.run(tenantId, async (em: EntityManager) => {
      if (typeof em.query === 'function') {
        await em.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `sepidar_persist:${tenantId}`,
        ]);
      }

      if (idempotencyKey) {
        const entryRepo = em.getRepository(JournalEntryEntity);
        const existingByKey = await entryRepo.findOne({
          where: { tenantId, idempotencyKey },
        });
        if (
          existingByKey &&
          existingByKey.idempotencyFingerprint &&
          existingByKey.idempotencyFingerprint !== requestFingerprint
        ) {
          throw new ConflictException(
            `Idempotency-Key "${idempotencyKey}" was already used with a different Sepidar payload.`,
          );
        }

        const idemRepo = em.getRepository(ImportMappingMemoryEntity);
        const idemSignature = crypto
          .createHash('sha256')
          .update(`sepidar_idempotency:${idempotencyKey}`)
          .digest('hex');
        const existingRecord = await idemRepo.findOne({
          where: { tenantId, signature: idemSignature },
        });
        if (existingRecord) {
          const recordedFp = (existingRecord.mapping as { fingerprint?: string } | null)?.fingerprint;
          if (recordedFp && recordedFp !== requestFingerprint) {
            throw new ConflictException(
              `Idempotency-Key "${idempotencyKey}" was already used with a different Sepidar payload.`,
            );
          }
        } else {
          const now = new Date();
          await idemRepo.save(
            idemRepo.create({
              id: crypto.randomUUID(),
              tenantId,
              signature: idemSignature,
              entity: SEPIDAR_IDEMPOTENCY_ENTITY,
              mapping: { idempotencyKey, fingerprint: requestFingerprint } as unknown as Record<
                string,
                string | null
              >,
              uses: 1,
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
      }

      const accountResult = await this.persistAccounts(
        tenantId,
        mappedAccounts,
        explicitAccountTypesByCode,
        em,
      );
      const partyResult = await this.persistParties(tenantId, mappedParties, customerGroup, em);
      const itemResult = await this.persistItems(tenantId, mappedItems, em);
      const voucherResult = await this.persistOpeningVoucher(
        tenantId,
        mappedOpeningLines,
        openingDate,
        explicitOpeningDate,
        idempotencyKey,
        requestFingerprint,
        em,
      );
      const chequeResult = await this.persistCheques(tenantId, validCheques, em);

      // Step 3: Reconcile certificate from actual persisted database rows
      return this.buildDbReconciliationCertificate(
        tenantId,
        mappedAccounts,
        mappedParties,
        mappedItems,
        validCheques,
        {
          accountsInserted: accountResult.inserted,
          accountsSkipped: accountResult.skipped,
          partiesInserted: partyResult.inserted,
          partiesSkipped: partyResult.skipped,
          itemsInserted: itemResult.inserted,
          itemsSkipped: itemResult.skipped,
          openingVoucherCreated: voucherResult.created,
          chequesInserted: chequeResult.inserted,
          chequesSkipped: chequeResult.skipped,
        },
        em,
      );
    });
  }

  /**
   * Uses explicit AccountType if supplied; otherwise maps Iranian COA group prefixes
   * per `iran-chart-template.ts` (1=ASSET, 2=LIABILITY, 3/9=EQUITY, 4/7=REVENUE, 5/6/8=EXPENSE).
   * Rejects unknown prefixes when no explicit AccountType is given.
   */
  private resolveAccountType(code: string, explicitType?: AccountType): AccountType {
    if (explicitType !== undefined) {
      return explicitType;
    }
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
        throw new BadRequestException(
          `Cannot infer accountType for account code "${code}": provide explicit AccountType.`,
        );
    }
  }

  private async persistAccounts(
    tenantId: string,
    accounts: MappedChartAccount[],
    explicitAccountTypesByCode: Map<string, AccountType>,
    em: EntityManager,
  ): Promise<{ inserted: number; skipped: number }> {
    const repo = em.getRepository(ChartOfAccountEntity);
    let inserted = 0;
    let skipped = 0;

    const sorted = [...accounts].sort((a, b) => a.level - b.level);

    for (const acc of sorted) {
      let levelEnum: AccountLevel | null = null;
      switch (acc.level) {
        case 1: levelEnum = AccountLevel.GROUP; break;
        case 2: levelEnum = AccountLevel.KOL; break;
        case 3: levelEnum = AccountLevel.MOEIN; break;
        case 4: levelEnum = AccountLevel.TAFSILI; break;
      }

      const accountType = this.resolveAccountType(
        acc.code,
        explicitAccountTypesByCode.get(acc.code),
      );

      const existing = await repo.findOne({ where: { tenantId, code: acc.code } });
      if (existing) {
        if (
          existing.name !== acc.name ||
          existing.level !== levelEnum ||
          (existing.parentCode ?? null) !== (acc.parentCode ?? null) ||
          existing.accountType !== accountType
        ) {
          throw new ConflictException(
            `Account ${acc.code} already exists in database with conflicting attributes.`,
          );
        }
        skipped++;
        continue;
      }

      const entity = repo.create({
        tenantId,
        code: acc.code,
        name: acc.name,
        accountType,
        currency: 'IRR',
        balance: '0',
        level: levelEnum,
        parentCode: acc.parentCode ?? null,
      });

      await repo.save(entity);
      inserted++;
    }

    return { inserted, skipped };
  }

  private async persistParties(
    tenantId: string,
    parties: MappedPartyRecord[],
    customerGroup: CustomerGroup,
    em: EntityManager,
  ): Promise<{ inserted: number; skipped: number }> {
    const repo = em.getRepository(PartyEntity);
    let inserted = 0;
    let skipped = 0;

    for (const p of parties) {
      let roleEnum = PartyRole.CUSTOMER;
      if (p.role === 'supplier') roleEnum = PartyRole.SUPPLIER;
      else if (p.role === 'both') roleEnum = PartyRole.BOTH;

      const existing = await repo.findOne({ where: { tenantId, code: p.code } });
      if (existing) {
        if (
          existing.name !== p.name ||
          existing.role !== roleEnum ||
          existing.customerGroup !== customerGroup ||
          (existing.nationalId ?? null) !== (p.nationalId ?? null) ||
          (existing.economicCode ?? null) !== (p.economicCode ?? null) ||
          (existing.phone ?? null) !== (p.phone ?? null)
        ) {
          throw new ConflictException(
            `Party ${p.code} already exists in database with conflicting attributes.`,
          );
        }
        skipped++;
        continue;
      }

      const entity = repo.create({
        tenantId,
        code: p.code,
        name: p.name,
        role: roleEnum,
        customerGroup,
        nationalId: p.nationalId ?? null,
        economicCode: p.economicCode ?? null,
        phone: p.phone ?? null,
        active: true,
      });

      await repo.save(entity);
      inserted++;
    }

    return { inserted, skipped };
  }

  private async persistItems(
    tenantId: string,
    items: MappedItemRecord[],
    em: EntityManager,
  ): Promise<{ inserted: number; skipped: number }> {
    const repo = em.getRepository(StockItemEntity);
    let inserted = 0;
    let skipped = 0;

    for (const item of items) {
      if (
        item.unitRatio !== null &&
        item.unitRatio !== undefined &&
        !/^\d+(\.\d{1,4})?$/.test(item.unitRatio)
      ) {
        throw new BadRequestException(`Invalid unitRatio "${item.unitRatio}" for item ${item.sku}`);
      }

      const expectedBarcode = item.barcode || item.sku;
      const expectedUnit = item.primaryUnit ?? 'piece';
      const expectedSecondaryUnit = item.secondaryUnit ?? null;
      const expectedRatio =
        item.unitRatio !== null && item.unitRatio !== undefined ? Number(item.unitRatio) : null;

      const existing = await repo.findOne({ where: { tenantId, sku: item.sku } });
      if (existing) {
        const existingRatio =
          existing.unitRatio !== null && existing.unitRatio !== undefined
            ? Number(existing.unitRatio)
            : null;
        if (
          existing.name !== item.name ||
          (existing.barcode ?? null) !== expectedBarcode ||
          (existing.primaryUnit ?? 'piece') !== expectedUnit ||
          (existing.secondaryUnit ?? null) !== expectedSecondaryUnit ||
          existingRatio !== expectedRatio
        ) {
          throw new ConflictException(
            `Stock item ${item.sku} already exists in database with conflicting attributes.`,
          );
        }
        skipped++;
        continue;
      }

      const entity = repo.create({
        tenantId,
        sku: item.sku,
        name: item.name,
        barcode: expectedBarcode,
        quantity: 0,
        minQuantity: 0,
        primaryUnit: expectedUnit,
        secondaryUnit: expectedSecondaryUnit,
        unitRatio: expectedRatio,
      });

      await repo.save(entity);
      inserted++;
    }

    return { inserted, skipped };
  }

  private async persistOpeningVoucher(
    tenantId: string,
    lines: MappedOpeningLine[],
    openingDate: Date,
    explicitOpeningDate: string | null,
    idempotencyKey: string | undefined,
    requestFingerprint: string,
    em: EntityManager,
  ): Promise<{ created: boolean }> {
    const entryRepo = em.getRepository(JournalEntryEntity);
    const lineRepo = em.getRepository(JournalEntryLineEntity);
    const accountRepo = em.getRepository(ChartOfAccountEntity);

    const existing = await entryRepo.findOne({
      where: { tenantId, entryNumber: OPENING_ENTRY_NUMBER },
    });
    if (existing) {
      if (
        idempotencyKey &&
        existing.idempotencyKey === idempotencyKey &&
        existing.idempotencyFingerprint &&
        existing.idempotencyFingerprint !== requestFingerprint
      ) {
        throw new ConflictException(
          `Idempotency-Key "${idempotencyKey}" reused with a different opening voucher payload.`,
        );
      }

      if (
        explicitOpeningDate !== null &&
        new Date(existing.date).getTime() !== openingDate.getTime()
      ) {
        throw new ConflictException(
          `Opening voucher ${OPENING_ENTRY_NUMBER} already exists in database with a different openingDate.`,
        );
      }

      if (lines.length > 0) {
        const storedLines = await lineRepo.find({
          where: { tenantId, journalEntryId: existing.id },
        });
        const storedDebit = storedLines.reduce((s, l) => s + parseMinor(l.debit), 0n);
        const storedCredit = storedLines.reduce((s, l) => s + parseMinor(l.credit), 0n);
        const incomingDebit = lines.reduce((s, l) => s + l.debitMinor, 0n);
        const incomingCredit = lines.reduce((s, l) => s + l.creditMinor, 0n);
        if (
          storedLines.length !== lines.length ||
          storedDebit !== incomingDebit ||
          storedCredit !== incomingCredit
        ) {
          throw new ConflictException(
            `Opening voucher ${OPENING_ENTRY_NUMBER} already exists in database with different lines or totals.`,
          );
        }

        const storedAccIds = Array.from(new Set(storedLines.map((l) => l.accountId)));
        const storedAccounts =
          storedAccIds.length > 0
            ? await accountRepo.find({ where: { tenantId, id: In(storedAccIds) } })
            : [];
        const idToCode = new Map(storedAccounts.map((a) => [a.id, a.code]));
        const normalizeLineKey = (
          code: string,
          partyCode: string | null | undefined,
          debit: bigint,
          credit: bigint,
        ) => `${code}|${partyCode ?? ''}|${debit.toString()}|${credit.toString()}`;
        const storedSignatures = storedLines
          .map((l) =>
            normalizeLineKey(
              idToCode.get(l.accountId) ?? String(l.accountId),
              l.partyCode,
              parseMinor(l.debit),
              parseMinor(l.credit),
            ),
          )
          .sort();
        const incomingSignatures = lines
          .map((l) =>
            normalizeLineKey(l.accountCode, l.floatingDetailCode, l.debitMinor, l.creditMinor),
          )
          .sort();
        const exactMatch = storedSignatures.every((sig, idx) => sig === incomingSignatures[idx]);
        if (!exactMatch) {
          throw new ConflictException(
            `Opening voucher ${OPENING_ENTRY_NUMBER} already exists in database with different account breakdown.`,
          );
        }
      }

      return { created: false };
    }

    if (lines.length === 0) {
      return { created: false };
    }

    const totalDebit = lines.reduce((s, l) => s + l.debitMinor, 0n);
    const totalCredit = lines.reduce((s, l) => s + l.creditMinor, 0n);
    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Opening balance voucher is unbalanced: Debit (${totalDebit}) != Credit (${totalCredit})`,
      );
    }

    // Verify all referenced accounts exist BEFORE inserting the voucher header
    const accountByCode = new Map<string, ChartOfAccountEntity>();
    for (const l of lines) {
      if (!accountByCode.has(l.accountCode)) {
        const acc = await accountRepo.findOne({ where: { tenantId, code: l.accountCode } });
        if (!acc) {
          throw new BadRequestException(
            `Account ${l.accountCode} not found in chart of accounts for opening balance line`,
          );
        }
        accountByCode.set(l.accountCode, acc);
      }
    }

    const entry = entryRepo.create({
      tenantId,
      entryNumber: OPENING_ENTRY_NUMBER,
      date: openingDate,
      description: 'سند افتتاحیه انتقال از سپیدار سیستم',
      status: JournalEntryStatus.POSTED,
      entryType: JournalEntryType.NORMAL,
      idempotencyKey: idempotencyKey ?? null,
      idempotencyFingerprint: requestFingerprint,
    });
    const savedEntry = await entryRepo.save(entry);

    const deltaByAccount = new Map<number, bigint>();
    for (const l of lines) {
      const acc = accountByCode.get(l.accountCode)!;
      const journalLine = lineRepo.create({
        tenantId,
        journalEntryId: savedEntry.id,
        accountId: acc.id,
        debit: minorToDecimal(l.debitMinor),
        credit: minorToDecimal(l.creditMinor),
        currency: 'IRR',
        partyCode: l.floatingDetailCode ?? null,
        description: l.description ?? 'مانده اول دوره سپیدار',
      });
      await lineRepo.save(journalLine);

      deltaByAccount.set(
        acc.id,
        (deltaByAccount.get(acc.id) ?? 0n) + l.debitMinor - l.creditMinor,
      );
    }

    // Atomic SQL balance deltas in ascending accountId order to prevent deadlocks and lost updates
    const sortedAccountIds = Array.from(deltaByAccount.keys()).sort((a, b) => a - b);
    for (const accountId of sortedAccountIds) {
      const delta = deltaByAccount.get(accountId)!;
      const result: unknown[] = await em.query(
        `UPDATE "fin_chart_of_accounts" SET "balance" = "balance" + $1::numeric
          WHERE "id" = $2 AND "tenant_id" = $3 RETURNING "id"`,
        [minorToDecimal(delta), accountId, tenantId],
      );
      const updated = Array.isArray(result[0]) ? result[0] : result;
      if (updated.length !== 1) {
        throw new BadRequestException(
          `Account ${accountId} not found for tenant while updating opening balance.`,
        );
      }
    }

    return { created: true };
  }

  private async persistCheques(
    tenantId: string,
    cheques: MappedRoxiraCheque[],
    em: EntityManager,
  ): Promise<{ inserted: number; skipped: number }> {
    const repo = em.getRepository(ChequeEntity);
    let inserted = 0;
    let skipped = 0;

    for (const c of cheques) {
      let existing: ChequeEntity | null = null;
      if (c.sayadNumber) {
        existing = await repo.findOne({ where: { tenantId, sayadNumber: c.sayadNumber } });
      } else {
        existing = await repo.findOne({
          where: {
            tenantId,
            chequeNumber: c.chequeNumber,
            bankName: c.bankName ? c.bankName : IsNull(),
          },
        });
      }

      if (existing) {
        const expectedStatus = c.status ?? ChequeStatus.REGISTERED;
        if (
          parseMinor(existing.amount) !== c.amountMinor ||
          existing.direction !== c.direction ||
          existing.issueDate !== c.issueDate ||
          existing.dueDate !== c.dueDate ||
          (existing.bankName ?? null) !== (c.bankName ?? null) ||
          existing.partyName !== c.partyName ||
          (existing.partyCode ?? null) !== (c.partyCode ?? null) ||
          (existing.receiverNationalId ?? null) !== (c.receiverNationalId ?? null) ||
          (existing.spentToName ?? null) !== (c.spentToName ?? null) ||
          (existing.spentToCode ?? null) !== (c.spentToCode ?? null) ||
          (existing.spentToNationalId ?? null) !== (c.spentToNationalId ?? null) ||
          existing.status !== expectedStatus
        ) {
          throw new ConflictException(
            `Cheque ${c.chequeNumber} already exists in database with conflicting attributes or amount.`,
          );
        }
        skipped++;
        continue;
      }

      const entity = repo.create({
        tenantId,
        direction: c.direction,
        sayadNumber: c.sayadNumber || null,
        sayadVerified: false,
        sayadVerifiedBy: null,
        sayadVerifiedAt: null,
        sayadRegistrationStatus: SayadRegistrationStatus.UNKNOWN,
        chequeNumber: c.chequeNumber,
        bankName: c.bankName ?? null,
        amount: minorToDecimal(c.amountMinor),
        issueDate: c.issueDate,
        dueDate: c.dueDate,
        partyName: c.partyName,
        partyCode: c.partyCode ?? null,
        receiverNationalId: c.receiverNationalId ?? null,
        spentToName: c.spentToName ?? null,
        spentToCode: c.spentToCode ?? null,
        spentToNationalId: c.spentToNationalId ?? null,
        status: c.status ?? ChequeStatus.REGISTERED,
        description: c.description ?? 'انتقال چک اول دوره از سپیدار',
      });

      const saved = await repo.save(entity);
      await this.chequesRepository.addEvent(
        tenantId,
        {
          chequeId: saved.id,
          fromStatus: null,
          toStatus: saved.status,
          eventDate: saved.issueDate,
          journalEntryId: null,
          amount: null,
          note: 'انتقال چک اول دوره از سپیدار',
        },
        em,
      );
      inserted++;
    }

    return { inserted, skipped };
  }

  private async buildDbReconciliationCertificate(
    tenantId: string,
    mappedAccounts: MappedChartAccount[],
    mappedParties: MappedPartyRecord[],
    mappedItems: MappedItemRecord[],
    validCheques: MappedRoxiraCheque[],
    idempotencySummary: SepidarPersistenceCertificate['idempotencySummary'],
    em: EntityManager,
  ): Promise<SepidarPersistenceCertificate> {
    const accountRepo = em.getRepository(ChartOfAccountEntity);
    const partyRepo = em.getRepository(PartyEntity);
    const itemRepo = em.getRepository(StockItemEntity);
    const entryRepo = em.getRepository(JournalEntryEntity);
    const lineRepo = em.getRepository(JournalEntryLineEntity);
    const chequeRepo = em.getRepository(ChequeEntity);

    const dbAccounts =
      mappedAccounts.length > 0
        ? await accountRepo.find({
            where: { tenantId, code: In(mappedAccounts.map((a) => a.code)) },
          })
        : [];
    const dbParties =
      mappedParties.length > 0
        ? await partyRepo.find({
            where: { tenantId, code: In(mappedParties.map((p) => p.code)) },
          })
        : [];
    const dbItems =
      mappedItems.length > 0
        ? await itemRepo.find({
            where: { tenantId, sku: In(mappedItems.map((i) => i.sku)) },
          })
        : [];

    const dbEntry = await entryRepo.findOne({
      where: { tenantId, entryNumber: OPENING_ENTRY_NUMBER },
    });
    const dbLines = dbEntry
      ? await lineRepo.find({ where: { tenantId, journalEntryId: dbEntry.id } })
      : [];

    const accountIdToCode = new Map<number, string>();
    if (dbLines.length > 0) {
      const lineAccountIds = Array.from(new Set(dbLines.map((l) => l.accountId)));
      const lineAccounts = await accountRepo.find({
        where: { tenantId, id: In(lineAccountIds) },
      });
      for (const a of lineAccounts) accountIdToCode.set(a.id, a.code);
    }

    const dbCheques: ChequeEntity[] = [];
    const seenChequeIds = new Set<number>();
    for (const c of validCheques) {
      let found: ChequeEntity | null = null;
      if (c.sayadNumber) {
        found = await chequeRepo.findOne({ where: { tenantId, sayadNumber: c.sayadNumber } });
      } else {
        found = await chequeRepo.findOne({
          where: {
            tenantId,
            chequeNumber: c.chequeNumber,
            bankName: c.bankName ? c.bankName : IsNull(),
          },
        });
      }
      if (found && !seenChequeIds.has(found.id)) {
        seenChequeIds.add(found.id);
        dbCheques.push(found);
      }
    }

    const openingDebitMinor = dbLines.reduce((s, l) => s + parseMinor(l.debit), 0n);
    const openingCreditMinor = dbLines.reduce((s, l) => s + parseMinor(l.credit), 0n);
    const varianceMinor = openingDebitMinor - openingCreditMinor;
    const chequesAmountMinor = dbCheques.reduce((s, c) => s + parseMinor(c.amount), 0n);

    const levelToNumber = (lvl: AccountLevel | null): number => {
      switch (lvl) {
        case AccountLevel.GROUP: return 1;
        case AccountLevel.KOL: return 2;
        case AccountLevel.MOEIN: return 3;
        case AccountLevel.TAFSILI: return 4;
        default: return 0;
      }
    };

    const canonicalSha256 = this.computeCanonicalSha256(tenantId, {
      accounts: dbAccounts.map((a) => ({
        code: a.code,
        name: a.name,
        level: levelToNumber(a.level),
        parentCode: a.parentCode ?? null,
      })),
      parties: dbParties.map((p) => ({
        code: p.code,
        name: p.name,
        role: p.role,
        nationalId: p.nationalId ?? null,
      })),
      items: dbItems.map((i) => ({
        sku: i.sku,
        name: i.name,
        barcode: i.barcode ?? null,
        primaryUnit: i.primaryUnit ?? 'piece',
      })),
      openingLines: dbLines.map((l) => ({
        accountCode: accountIdToCode.get(l.accountId) ?? String(l.accountId),
        floatingDetailCode: l.partyCode ?? null,
        debitMinor: parseMinor(l.debit).toString(),
        creditMinor: parseMinor(l.credit).toString(),
      })),
      cheques: dbCheques.map((c) => ({
        chequeNumber: c.chequeNumber,
        sayadNumber: c.sayadNumber ?? '',
        bankName: c.bankName ?? null,
        direction: c.direction,
        amountMinor: parseMinor(c.amount).toString(),
        dueDate: c.dueDate,
      })),
      totals: {
        openingDebitMinor,
        openingCreditMinor,
        chequesAmountMinor,
      },
    });

    return {
      tenantId,
      certifiedAt: new Date().toISOString(),
      balanced: varianceMinor === 0n,
      varianceMinor: varianceMinor.toString(),
      counts: {
        accounts: dbAccounts.length,
        parties: dbParties.length,
        items: dbItems.length,
        openingLines: dbLines.length,
        cheques: dbCheques.length,
      },
      totals: {
        openingDebitMinor: openingDebitMinor.toString(),
        openingCreditMinor: openingCreditMinor.toString(),
        chequesAmountMinor: chequesAmountMinor.toString(),
      },
      canonicalSha256,
      idempotencySummary,
    };
  }

  private computeRequestFingerprint(
    tenantId: string,
    data: {
      openingDate: string | null;
      customerGroup: CustomerGroup;
      accounts: Array<{
        code: string;
        name: string;
        level: number;
        parentCode: string | null;
        accountType: AccountType;
      }>;
      parties: Array<{
        code: string;
        name: string;
        role: string;
        customerGroup: CustomerGroup;
        nationalId: string | null;
        economicCode: string | null;
        phone: string | null;
      }>;
      items: Array<{
        sku: string;
        name: string;
        barcode: string | null;
        primaryUnit: string;
        secondaryUnit: string | null;
        unitRatio: number | null;
      }>;
      openingLines: Array<{
        accountCode: string;
        floatingDetailCode: string | null;
        debitMinor: string;
        creditMinor: string;
        description: string | null;
      }>;
      cheques: Array<{
        chequeNumber: string;
        sayadNumber: string;
        bankName: string | null;
        direction: string;
        amountMinor: string;
        issueDate: string;
        dueDate: string;
        partyName: string;
        partyCode: string | null;
        receiverNationalId: string | null;
        spentToName: string | null;
        spentToCode: string | null;
        spentToNationalId: string | null;
        status: string;
      }>;
      totals: {
        openingDebitMinor: bigint;
        openingCreditMinor: bigint;
        chequesAmountMinor: bigint;
      };
    },
  ): string {
    const canonicalPayload = JSON.stringify({
      tenantId,
      openingDate: data.openingDate,
      customerGroup: data.customerGroup,
      accounts: [...data.accounts].sort((a, b) => a.code.localeCompare(b.code)),
      parties: [...data.parties].sort((a, b) => a.code.localeCompare(b.code)),
      items: [...data.items].sort((a, b) => a.sku.localeCompare(b.sku)),
      openingLines: [...data.openingLines].sort((a, b) =>
        a.accountCode === b.accountCode
          ? (a.floatingDetailCode ?? '').localeCompare(b.floatingDetailCode ?? '')
          : a.accountCode.localeCompare(b.accountCode),
      ),
      cheques: [...data.cheques].sort((a, b) =>
        (a.sayadNumber || `${a.bankName ?? ''}:${a.chequeNumber}`).localeCompare(
          b.sayadNumber || `${b.bankName ?? ''}:${b.chequeNumber}`,
        ),
      ),
      totals: {
        openingDebitMinor: data.totals.openingDebitMinor.toString(),
        openingCreditMinor: data.totals.openingCreditMinor.toString(),
        varianceMinor: (
          data.totals.openingDebitMinor - data.totals.openingCreditMinor
        ).toString(),
        chequesAmountMinor: data.totals.chequesAmountMinor.toString(),
      },
    });

    return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  }

  private computeCanonicalSha256(
    tenantId: string,
    data: {
      accounts: Array<{ code: string; name: string; level: number; parentCode: string | null }>;
      parties: Array<{ code: string; name: string; role: string; nationalId: string | null }>;
      items: Array<{ sku: string; name: string; barcode: string | null; primaryUnit: string }>;
      openingLines: Array<{
        accountCode: string;
        floatingDetailCode: string | null;
        debitMinor: string;
        creditMinor: string;
      }>;
      cheques: Array<{
        chequeNumber: string;
        sayadNumber: string;
        bankName: string | null;
        direction: string;
        amountMinor: string;
        dueDate: string;
      }>;
      totals: {
        openingDebitMinor: bigint;
        openingCreditMinor: bigint;
        chequesAmountMinor: bigint;
      };
    },
  ): string {
    const canonicalPayload = JSON.stringify({
      tenantId,
      accounts: [...data.accounts].sort((a, b) => a.code.localeCompare(b.code)),
      parties: [...data.parties].sort((a, b) => a.code.localeCompare(b.code)),
      items: [...data.items].sort((a, b) => a.sku.localeCompare(b.sku)),
      openingLines: [...data.openingLines].sort((a, b) =>
        a.accountCode === b.accountCode
          ? (a.floatingDetailCode ?? '').localeCompare(b.floatingDetailCode ?? '')
          : a.accountCode.localeCompare(b.accountCode),
      ),
      cheques: [...data.cheques].sort((a, b) =>
        (a.sayadNumber || `${a.bankName ?? ''}:${a.chequeNumber}`).localeCompare(
          b.sayadNumber || `${b.bankName ?? ''}:${b.chequeNumber}`,
        ),
      ),
      totals: {
        openingDebitMinor: data.totals.openingDebitMinor.toString(),
        openingCreditMinor: data.totals.openingCreditMinor.toString(),
        varianceMinor: (
          data.totals.openingDebitMinor - data.totals.openingCreditMinor
        ).toString(),
        chequesAmountMinor: data.totals.chequesAmountMinor.toString(),
      },
    });

    return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  }
}
