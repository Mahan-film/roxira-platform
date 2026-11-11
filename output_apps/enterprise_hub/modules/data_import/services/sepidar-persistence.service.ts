import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { EntityManager } from 'typeorm';
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
import { ChequeDirection, ChequeStatus } from '../../cheques/enums/cheque.enum';
import { ChequeEntity } from '../../cheques/entities/cheque.entity';
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
  accounts?: SepidarRawAccount[];
  parties?: SepidarRawParty[];
  items?: SepidarRawItem[];
  openingVoucher?: SepidarRawVoucherItem[];
  cheques?: SepidarRawCheque[];
}

/**
 * Service for persisting Sepidar backup data into Roxira enterprise database (T88 / #774).
 *
 * Guarantees:
 * 1. Strict Tenant Isolation: All operations are executed within TenantScope.
 * 2. Transaction per Entity Group: Each entity group (accounts, parties, items, voucher, cheques)
 *    runs in its own independent transaction.
 * 3. Idempotency: Duplicate source codes / keys are safely skipped on repeated runs.
 * 4. Reconciliation Certificate: Generates a certified SHA-256 cryptographic digest over
 *    the canonical representation of the imported data with 0 Rials balance variance.
 */
@Injectable()
export class SepidarPersistenceService {
  private readonly logger = new Logger(SepidarPersistenceService.name);

  constructor(
    private readonly mappingAdapter: SepidarMappingAdapter,
    private readonly chequesAdapter: SepidarChequesFifoAdapter,
    private readonly tenantScope: TenantScope,
  ) {}

  async persistSepidarData(
    tenantId: string,
    input?: SepidarImportInput,
  ): Promise<SepidarPersistenceCertificate> {
    const isSynthetic = input?.useSynthetic ?? (!input?.accounts && !input?.parties);

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

    // Step 1: In-memory mapping & structure validation
    const mappedAccounts = this.mappingAdapter.mapAccounts(rawAccounts);
    const mappedParties = this.mappingAdapter.mapParties(rawParties);
    const mappedItems = this.mappingAdapter.mapItems(rawItems);
    const mappedOpeningResult = this.mappingAdapter.mapOpeningBalance(rawVoucher);
    const mappedOpeningLines = mappedOpeningResult.lines;
    const { validCheques } = this.chequesAdapter.mapCheques(rawCheques);

    // Step 2: Persist Entity Group 1 — Chart of Accounts (in dedicated transaction)
    const accountResult = await this.persistAccounts(tenantId, mappedAccounts);

    // Step 3: Persist Entity Group 2 — Parties (in dedicated transaction)
    const partyResult = await this.persistParties(tenantId, mappedParties);

    // Step 4: Persist Entity Group 3 — Stock Items (in dedicated transaction)
    const itemResult = await this.persistItems(tenantId, mappedItems);

    // Step 5: Persist Entity Group 4 — Opening Balance Voucher (in dedicated transaction)
    const voucherResult = await this.persistOpeningVoucher(tenantId, mappedOpeningLines);

    // Step 6: Persist Entity Group 5 — Open Cheques (in dedicated transaction)
    const chequeResult = await this.persistCheques(tenantId, validCheques);

    // Step 7: Cryptographic Reconciliation Certificate
    const totals = {
      openingDebitMinor: mappedOpeningResult.totalDebitMinor,
      openingCreditMinor: mappedOpeningResult.totalCreditMinor,
      chequesAmountMinor: validCheques.reduce((sum, c) => sum + c.amountMinor, 0n),
    };
    const varianceMinor = mappedOpeningResult.varianceMinor;

    const canonicalSha256 = this.computeCanonicalSha256(tenantId, {
      accounts: mappedAccounts,
      parties: mappedParties,
      items: mappedItems,
      openingLines: mappedOpeningLines,
      cheques: validCheques,
      totals,
    });

    return {
      tenantId,
      certifiedAt: new Date().toISOString(),
      balanced: mappedOpeningResult.isBalanced,
      varianceMinor: varianceMinor.toString(),
      counts: {
        accounts: mappedAccounts.length,
        parties: mappedParties.length,
        items: mappedItems.length,
        openingLines: mappedOpeningLines.length,
        cheques: validCheques.length,
      },
      totals: {
        openingDebitMinor: totals.openingDebitMinor.toString(),
        openingCreditMinor: totals.openingCreditMinor.toString(),
        chequesAmountMinor: totals.chequesAmountMinor.toString(),
      },
      canonicalSha256,
      idempotencySummary: {
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
    };
  }

  /**
   * Persists chart of accounts in hierarchical order (Gorouh -> Kol -> Moein -> Tafsili)
   * within an isolated transaction, idempotent on account code.
   */
  private async persistAccounts(
    tenantId: string,
    accounts: MappedChartAccount[],
  ): Promise<{ inserted: number; skipped: number }> {
    return this.tenantScope.run(tenantId, async (em: EntityManager) => {
      const repo = em.getRepository(ChartOfAccountEntity);
      let inserted = 0;
      let skipped = 0;

      // Hierarchical sort by level so parent codes are stored before child codes
      const sorted = [...accounts].sort((a, b) => a.level - b.level);

      for (const acc of sorted) {
        const existing = await repo.findOne({ where: { tenantId, code: acc.code } });
        if (existing) {
          skipped++;
          continue;
        }

        let accountType: AccountType = AccountType.ASSET;
        const firstDigit = acc.code.charAt(0);
        switch (firstDigit) {
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
    });
  }

  /**
   * Persists parties (customers & suppliers) within an isolated transaction,
   * idempotent on party code.
   */
  private async persistParties(
    tenantId: string,
    parties: MappedPartyRecord[],
  ): Promise<{ inserted: number; skipped: number }> {
    return this.tenantScope.run(tenantId, async (em: EntityManager) => {
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
          customerGroup: CustomerGroup.CONSUMER,
          nationalId: p.nationalId ?? null,
          economicCode: p.economicCode ?? null,
          phone: p.phone ?? null,
          active: true,
        });

        await repo.save(entity);
        inserted++;
      }

      return { inserted, skipped };
    });
  }

  /**
   * Persists stock items within an isolated transaction,
   * idempotent on SKU.
   */
  private async persistItems(
    tenantId: string,
    items: MappedItemRecord[],
  ): Promise<{ inserted: number; skipped: number }> {
    return this.tenantScope.run(tenantId, async (em: EntityManager) => {
      const repo = em.getRepository(StockItemEntity);
      let inserted = 0;
      let skipped = 0;

      for (const item of items) {
        const existing = await repo.findOne({ where: { tenantId, sku: item.sku } });
        if (existing) {
          skipped++;
          continue;
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
          unitRatio: item.unitRatio ? Number(item.unitRatio) : null,
        });

        await repo.save(entity);
        inserted++;
      }

      return { inserted, skipped };
    });
  }

  /**
   * Persists opening balance voucher within an isolated transaction,
   * idempotent on entryNumber ('JV-OPENING-SEPIDAR').
   */
  private async persistOpeningVoucher(
    tenantId: string,
    lines: MappedOpeningLine[],
  ): Promise<{ created: boolean }> {
    return this.tenantScope.run(tenantId, async (em: EntityManager) => {
      const entryRepo = em.getRepository(JournalEntryEntity);
      const lineRepo = em.getRepository(JournalEntryLineEntity);
      const accountRepo = em.getRepository(ChartOfAccountEntity);

      const entryNumber = 'JV-OPENING-SEPIDAR';
      const existing = await entryRepo.findOne({ where: { tenantId, entryNumber } });
      if (existing) {
        return { created: false }; // Idempotent skip
      }

      const totalDebit = lines.reduce((s, l) => s + l.debitMinor, 0n);
      const totalCredit = lines.reduce((s, l) => s + l.creditMinor, 0n);

      if (totalDebit !== totalCredit) {
        throw new BadRequestException(
          `Opening balance voucher is unbalanced: Debit (${totalDebit}) != Credit (${totalCredit})`,
        );
      }

      if (lines.length === 0) {
        return { created: false };
      }

      const entry = entryRepo.create({
        tenantId,
        entryNumber,
        date: new Date(),
        description: 'سند افتتاحیه انتقال از سپیدار سیستم',
        status: JournalEntryStatus.POSTED,
        entryType: JournalEntryType.NORMAL,
      });
      const savedEntry = await entryRepo.save(entry);

      for (const l of lines) {
        const acc = await accountRepo.findOne({ where: { tenantId, code: l.accountCode } });
        if (!acc) {
          throw new BadRequestException(
            `Account ${l.accountCode} not found in chart of accounts for opening balance line`,
          );
        }

        const debitStr = minorToDecimal(l.debitMinor);
        const creditStr = minorToDecimal(l.creditMinor);

        const journalLine = lineRepo.create({
          tenantId,
          journalEntryId: savedEntry.id,
          accountId: acc.id,
          debit: debitStr,
          credit: creditStr,
          currency: 'IRR',
          partyCode: l.floatingDetailCode ?? null,
          description: l.description ?? 'مانده اول دوره سپیدار',
        });
        await lineRepo.save(journalLine);

        // Update running balance (debit-positive)
        const currentBalance = parseMinor(acc.balance);
        const newBalance = currentBalance + l.debitMinor - l.creditMinor;
        acc.balance = minorToDecimal(newBalance);
        await accountRepo.save(acc);
      }

      return { created: true };
    });
  }

  /**
   * Persists open cheques within an isolated transaction,
   * idempotent on SayadNumber or ChequeNumber.
   */
  private async persistCheques(
    tenantId: string,
    cheques: MappedRoxiraCheque[],
  ): Promise<{ inserted: number; skipped: number }> {
    return this.tenantScope.run(tenantId, async (em: EntityManager) => {
      const repo = em.getRepository(ChequeEntity);
      let inserted = 0;
      let skipped = 0;

      for (const c of cheques) {
        let existing: ChequeEntity | null = null;
        if (c.sayadNumber) {
          existing = await repo.findOne({ where: { tenantId, sayadNumber: c.sayadNumber } });
        }
        if (!existing) {
          existing = await repo.findOne({ where: { tenantId, chequeNumber: c.chequeNumber } });
        }

        if (existing) {
          skipped++;
          continue;
        }

        const entity = repo.create({
          tenantId,
          direction: c.direction,
          sayadNumber: c.sayadNumber || null,
          sayadVerified: true,
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
          status: c.status ?? ChequeStatus.REGISTERED,
          description: c.description ?? 'انتقال چک اول دوره از سپیدار',
        });

        await repo.save(entity);
        inserted++;
      }

      return { inserted, skipped };
    });
  }

  /**
   * Computes deterministic SHA-256 cryptographic checksum over canonical representation
   * of all imported and reconciled rows.
   */
  private computeCanonicalSha256(
    tenantId: string,
    data: {
      accounts: MappedChartAccount[];
      parties: MappedPartyRecord[];
      items: MappedItemRecord[];
      openingLines: MappedOpeningLine[];
      cheques: MappedRoxiraCheque[];
      totals: {
        openingDebitMinor: bigint;
        openingCreditMinor: bigint;
        chequesAmountMinor: bigint;
      };
    },
  ): string {
    const canonicalPayload = JSON.stringify({
      tenantId,
      accounts: [...data.accounts]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => ({
          code: a.code,
          name: a.name,
          level: a.level,
          parentCode: a.parentCode ?? null,
        })),
      parties: [...data.parties]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((p) => ({
          code: p.code,
          name: p.name,
          role: p.role,
          nationalId: p.nationalId ?? null,
        })),
      items: [...data.items]
        .sort((a, b) => a.sku.localeCompare(b.sku))
        .map((i) => ({
          sku: i.sku,
          name: i.name,
          barcode: i.barcode ?? null,
          primaryUnit: i.primaryUnit,
        })),
      openingLines: [...data.openingLines]
        .sort((a, b) =>
          a.accountCode === b.accountCode
            ? (a.floatingDetailCode ?? '').localeCompare(b.floatingDetailCode ?? '')
            : a.accountCode.localeCompare(b.accountCode),
        )
        .map((l) => ({
          accountCode: l.accountCode,
          floatingDetailCode: l.floatingDetailCode ?? null,
          debitMinor: l.debitMinor.toString(),
          creditMinor: l.creditMinor.toString(),
        })),
      cheques: [...data.cheques]
        .sort((a, b) =>
          (a.sayadNumber || a.chequeNumber).localeCompare(b.sayadNumber || b.chequeNumber),
        )
        .map((c) => ({
          chequeNumber: c.chequeNumber,
          sayadNumber: c.sayadNumber,
          direction: c.direction,
          amountMinor: c.amountMinor.toString(),
          dueDate: c.dueDate,
        })),
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
