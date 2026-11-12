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
import { minorToDecimal, parseMinor } from '../../accounting/money';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../../accounting/entities/journal-entry-line.entity';
import { ChequeEntity } from '../../cheques/entities/cheque.entity';
import { ChequeStatus } from '../../cheques/enums/cheque.enum';
import { ChequesRepository } from '../../cheques/repositories/cheques.repository';
import { SayadRegistrationStatus } from '../../cheques/sayad/sayad';
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

export interface SepidarImportInput {
  useSynthetic?: boolean;
  openingDate?: string;
  customerGroup?: CustomerGroup;
  accounts?: SepidarRawAccount[];
  parties?: SepidarRawParty[];
  items?: SepidarRawItem[];
  openingVoucher?: SepidarRawVoucherItem[];
  cheques?: SepidarRawCheque[];
}

const OPENING_ENTRY_NUMBER = 'JV-OPENING-SEPIDAR';

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
    if (isSynthetic && process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Synthetic fixture import is disabled in production.');
    }

    const rawAccounts = isSynthetic
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

    const openingDate = input?.openingDate ? new Date(input.openingDate) : new Date();
    if (Number.isNaN(openingDate.getTime())) {
      throw new BadRequestException('Invalid openingDate value.');
    }
    const customerGroup = input?.customerGroup ?? CustomerGroup.CONSUMER;

    // Step 1: In-memory mapping & structure validation (fails fast before any DB write)
    let mappedAccounts: MappedChartAccount[];
    let mappedParties: MappedPartyRecord[];
    let mappedItems: MappedItemRecord[];
    let mappedOpeningResult: ReturnType<SepidarMappingAdapter['mapOpeningBalance']>;
    let validCheques: MappedRoxiraCheque[];

    try {
      mappedAccounts = this.mappingAdapter.mapAccounts(rawAccounts);
      mappedParties = this.mappingAdapter.mapParties(rawParties);
      mappedItems = this.mappingAdapter.mapItems(rawItems);
      mappedOpeningResult = this.mappingAdapter.mapOpeningBalance(rawVoucher, {
        requireBalanced: rawVoucher.length > 0,
      });
      const mappedCheques = this.chequesAdapter.mapCheques(rawCheques);
      if (mappedCheques.errors.length > 0) {
        const firstErr = mappedCheques.errors[0];
        throw new BadRequestException(
          `Invalid Sepidar cheque ${firstErr.chequeNumber}: ${firstErr.reason}`,
        );
      }
      validCheques = mappedCheques.validCheques;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid Sepidar payload',
      );
    }

    const mappedOpeningLines = mappedOpeningResult.lines;
    const requestFingerprint = this.computeCanonicalSha256(tenantId, {
      accounts: mappedAccounts.map((a) => ({
        code: a.code,
        name: a.name,
        level: a.level,
        parentCode: a.parentCode ?? null,
      })),
      parties: mappedParties.map((p) => ({
        code: p.code,
        name: p.name,
        role: p.role,
        nationalId: p.nationalId ?? null,
      })),
      items: mappedItems.map((i) => ({
        sku: i.sku,
        name: i.name,
        barcode: i.barcode || i.sku,
        primaryUnit: i.primaryUnit,
      })),
      openingLines: mappedOpeningLines.map((l) => ({
        accountCode: l.accountCode,
        floatingDetailCode: l.floatingDetailCode ?? null,
        debitMinor: l.debitMinor.toString(),
        creditMinor: l.creditMinor.toString(),
      })),
      cheques: validCheques.map((c) => ({
        chequeNumber: c.chequeNumber,
        sayadNumber: c.sayadNumber,
        bankName: c.bankName ?? null,
        direction: c.direction,
        amountMinor: c.amountMinor.toString(),
        dueDate: c.dueDate,
      })),
      totals: {
        openingDebitMinor: mappedOpeningResult.totalDebitMinor,
        openingCreditMinor: mappedOpeningResult.totalCreditMinor,
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
      }

      const accountResult = await this.persistAccounts(tenantId, mappedAccounts, em);
      const partyResult = await this.persistParties(tenantId, mappedParties, customerGroup, em);
      const itemResult = await this.persistItems(tenantId, mappedItems, em);
      const voucherResult = await this.persistOpeningVoucher(
        tenantId,
        mappedOpeningLines,
        openingDate,
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

  private async persistAccounts(
    tenantId: string,
    accounts: MappedChartAccount[],
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

      let accountType: AccountType = AccountType.ASSET;
      switch (acc.code.charAt(0)) {
        case '1': accountType = AccountType.ASSET; break;
        case '2': accountType = AccountType.LIABILITY; break;
        case '3': accountType = AccountType.EQUITY; break;
        case '4': accountType = AccountType.REVENUE; break;
        case '5':
        case '6': accountType = AccountType.EXPENSE; break;
        case '7': accountType = AccountType.REVENUE; break;
        case '8': accountType = AccountType.EXPENSE; break;
        case '9': accountType = AccountType.EQUITY; break;
        default: accountType = AccountType.ASSET;
      }

      let levelEnum: AccountLevel | null = null;
      switch (acc.level) {
        case 1: levelEnum = AccountLevel.GROUP; break;
        case 2: levelEnum = AccountLevel.KOL; break;
        case 3: levelEnum = AccountLevel.MOEIN; break;
        case 4: levelEnum = AccountLevel.TAFSILI; break;
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
      const existing = await repo.findOne({ where: { tenantId, code: p.code } });
      if (existing) {
        skipped++;
        continue;
      }

      let roleEnum = PartyRole.CUSTOMER;
      if (p.role === 'supplier') roleEnum = PartyRole.SUPPLIER;
      else if (p.role === 'both') roleEnum = PartyRole.BOTH;

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
      const existing = await repo.findOne({ where: { tenantId, sku: item.sku } });
      if (existing) {
        skipped++;
        continue;
      }

      if (item.unitRatio !== null && item.unitRatio !== undefined && !/^\d+(\.\d{1,4})?$/.test(item.unitRatio)) {
        throw new BadRequestException(`Invalid unitRatio "${item.unitRatio}" for item ${item.sku}`);
      }

      const entity = repo.create({
        tenantId,
        sku: item.sku,
        name: item.name,
        barcode: item.barcode || item.sku,
        quantity: 0,
        minQuantity: 0,
        primaryUnit: item.primaryUnit ?? 'piece',
        secondaryUnit: item.secondaryUnit ?? null,
        unitRatio: (item.unitRatio ?? null) as unknown as number | null,
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
    for (const c of validCheques) {
      let found: ChequeEntity | null = null;
      if (c.sayadNumber) {
        found = await chequeRepo.findOne({ where: { tenantId, sayadNumber: c.sayadNumber } });
      }
      if (!found) {
        found = await chequeRepo.findOne({
          where: {
            tenantId,
            chequeNumber: c.chequeNumber,
            bankName: c.bankName ? c.bankName : IsNull(),
          },
        });
      }
      if (found) dbCheques.push(found);
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
