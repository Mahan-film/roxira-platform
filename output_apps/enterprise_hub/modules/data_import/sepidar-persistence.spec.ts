import 'reflect-metadata';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { EntityManager, FindOperator } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountType } from '../accounting/enums/accounting.enum';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../accounting/entities/journal-entry-line.entity';
import { minorToDecimal, parseMinor } from '../accounting/money';
import { ChequeEventEntity } from '../cheques/entities/cheque-event.entity';
import { ChequeEntity } from '../cheques/entities/cheque.entity';
import { ChequesRepository } from '../cheques/repositories/cheques.repository';
import { MAX_SEPIDAR_ARRAY_ITEMS, PersistSepidarDto } from './dto/sepidar-persist.dto';
import { ImportMappingMemoryEntity } from './entities/import-mapping-memory.entity';
import { PartyEntity } from '../parties/entities/party.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_ITEMS,
  SYNTHETIC_SEPIDAR_OPENING_VOUCHER,
  SYNTHETIC_SEPIDAR_PARTIES,
} from './__fixtures__/synthetic-sepidar.fixture';
import { SYNTHETIC_SEPIDAR_CHEQUES } from './__fixtures__/synthetic-sepidar-p2.fixture';
import { SepidarChequesFifoAdapter } from './migration/bak/sepidar-cheques-fifo.adapter';
import { SepidarMappingAdapter } from './migration/bak/sepidar-mapping.adapter';
import { SepidarPersistenceService } from './services/sepidar-persistence.service';

const SYNTHETIC_FLOAT_TYPE_MAP: Record<string, AccountType> = {
  'F-001': AccountType.EXPENSE,
  'F-002': AccountType.EXPENSE,
};

function matchOperator(val: unknown, cond: unknown): boolean {
  if (cond && typeof cond === 'object' && '@instanceof' in (cond as Record<string, unknown>)) {
    const op = cond as FindOperator<unknown>;
    if (op.type === 'isNull') return val === null || val === undefined;
    if (op.type === 'in') return Array.isArray(op.value) && op.value.includes(val);
  }
  return val === cond;
}

describe('Sepidar Data Persistence & Reconciliation Certificate (T88 / #774)', () => {
  const tenantId = '11111111-2222-3333-4444-555555555555';

  let service: SepidarPersistenceService;
  let mappingAdapter: SepidarMappingAdapter;
  let chequesAdapter: SepidarChequesFifoAdapter;

  let accountsStore: ChartOfAccountEntity[];
  let partiesStore: PartyEntity[];
  let itemsStore: StockItemEntity[];
  let entriesStore: JournalEntryEntity[];
  let linesStore: JournalEntryLineEntity[];
  let chequesStore: ChequeEntity[];
  let chequeEventsStore: ChequeEventEntity[];
  let idempotencyStore: ImportMappingMemoryEntity[];

  let mockTenantScope: Partial<TenantScope>;

  function buildEm(
    accounts: ChartOfAccountEntity[],
    parties: PartyEntity[],
    items: StockItemEntity[],
    entries: JournalEntryEntity[],
    lines: JournalEntryLineEntity[],
    cheques: ChequeEntity[],
    events: ChequeEventEntity[],
    idem: ImportMappingMemoryEntity[],
  ): EntityManager {
    const matchAll = <T extends Record<string, any>>(arr: T[], where: Record<string, any>): T[] =>
      arr.filter((row) =>
        Object.entries(where).every(([k, v]) => matchOperator(row[k], v)),
      );

    return {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return [];
        }
        if (sql.includes('UPDATE "fin_chart_of_accounts" SET "balance" = "balance" +')) {
          const [deltaStr, accountId, tid] = params as [string, number, string];
          const target = accounts.find((a) => a.id === accountId && a.tenantId === tid);
          if (!target) return [[], 0];
          const next = parseMinor(target.balance) + parseMinor(deltaStr);
          target.balance = minorToDecimal(next);
          return [[{ id: target.id }], 1];
        }
        return [];
      }),
      getRepository: jest.fn((entityClass) => {
        if (entityClass === ChartOfAccountEntity) {
          return {
            findOne: jest.fn(async ({ where }) => matchAll(accounts, where)[0] ?? null),
            find: jest.fn(async ({ where }) => matchAll(accounts, where)),
            create: jest.fn((dto) => ({ id: accounts.length + 1, ...dto })),
            save: jest.fn(async (entity) => {
              const idx = accounts.findIndex((a) => a.id === entity.id);
              if (idx >= 0) accounts[idx] = entity;
              else accounts.push(entity);
              return entity;
            }),
          };
        }
        if (entityClass === PartyEntity) {
          return {
            findOne: jest.fn(async ({ where }) => matchAll(parties, where)[0] ?? null),
            find: jest.fn(async ({ where }) => matchAll(parties, where)),
            create: jest.fn((dto) => ({ id: parties.length + 1, ...dto })),
            save: jest.fn(async (entity) => {
              parties.push(entity);
              return entity;
            }),
          };
        }
        if (entityClass === StockItemEntity) {
          return {
            findOne: jest.fn(async ({ where }) => matchAll(items, where)[0] ?? null),
            find: jest.fn(async ({ where }) => matchAll(items, where)),
            create: jest.fn((dto) => ({ id: items.length + 1, ...dto })),
            save: jest.fn(async (entity) => {
              items.push(entity);
              return entity;
            }),
          };
        }
        if (entityClass === JournalEntryEntity) {
          return {
            findOne: jest.fn(async ({ where }) => matchAll(entries, where)[0] ?? null),
            create: jest.fn((dto) => ({ id: entries.length + 1, ...dto })),
            save: jest.fn(async (entity) => {
              entries.push(entity);
              return entity;
            }),
          };
        }
        if (entityClass === JournalEntryLineEntity) {
          return {
            find: jest.fn(async ({ where }) => matchAll(lines, where)),
            create: jest.fn((dto) => ({ id: lines.length + 1, ...dto })),
            save: jest.fn(async (line) => {
              lines.push(line);
              return line;
            }),
          };
        }
        if (entityClass === ChequeEntity) {
          return {
            findOne: jest.fn(async ({ where }) => matchAll(cheques, where)[0] ?? null),
            create: jest.fn((dto) => ({ id: cheques.length + 1, ...dto })),
            save: jest.fn(async (entity) => {
              cheques.push(entity);
              return entity;
            }),
          };
        }
        if (entityClass === ChequeEventEntity) {
          return {
            create: jest.fn((dto) => ({ id: events.length + 1, ...dto })),
            save: jest.fn(async (ev) => {
              events.push(ev);
              return ev;
            }),
          };
        }
        if (entityClass === ImportMappingMemoryEntity) {
          return {
            findOne: jest.fn(async ({ where }) => matchAll(idem, where)[0] ?? null),
            create: jest.fn((dto) => ({ ...dto })),
            save: jest.fn(async (entity) => {
              idem.push(entity);
              return entity;
            }),
          };
        }
        throw new Error(`Unexpected entity class: ${entityClass.name}`);
      }),
    } as unknown as EntityManager;
  }

  beforeEach(() => {
    accountsStore = [];
    partiesStore = [];
    itemsStore = [];
    entriesStore = [];
    linesStore = [];
    chequesStore = [];
    chequeEventsStore = [];
    idempotencyStore = [];

    mockTenantScope = {
      run: jest.fn(async (_t: string, fn: (em: EntityManager) => any) => {
        // Transactional snapshot so any thrown error rolls back uncommitted writes
        const snapAcc = accountsStore.map((x) => ({ ...x }));
        const snapPar = partiesStore.map((x) => ({ ...x }));
        const snapItm = itemsStore.map((x) => ({ ...x }));
        const snapEnt = entriesStore.map((x) => ({ ...x }));
        const snapLin = linesStore.map((x) => ({ ...x }));
        const snapChq = chequesStore.map((x) => ({ ...x }));
        const snapEv = chequeEventsStore.map((x) => ({ ...x }));
        const snapIdem = idempotencyStore.map((x) => ({ ...x }));
        const txEm = buildEm(snapAcc, snapPar, snapItm, snapEnt, snapLin, snapChq, snapEv, snapIdem);
        const result = await fn(txEm);
        accountsStore = snapAcc;
        partiesStore = snapPar;
        itemsStore = snapItm;
        entriesStore = snapEnt;
        linesStore = snapLin;
        chequesStore = snapChq;
        chequeEventsStore = snapEv;
        idempotencyStore = snapIdem;
        return result;
      }),
    };

    mappingAdapter = new SepidarMappingAdapter();
    chequesAdapter = new SepidarChequesFifoAdapter();
    const chequesRepo = new ChequesRepository(mockTenantScope as TenantScope);
    service = new SepidarPersistenceService(
      mappingAdapter,
      chequesAdapter,
      mockTenantScope as TenantScope,
      chequesRepo,
    );
  });

  describe('End-to-End Sepidar Data Persistence', () => {
    it('persists all 5 entity groups from explicit synthetic fixtures and certifies against DB', async () => {
      const cert = await service.persistSepidarData(tenantId, {
        useSynthetic: true,
      });

      expect(cert.tenantId).toBe(tenantId);
      expect(cert.balanced).toBe(true);
      expect(cert.varianceMinor).toBe('0');
      expect(cert.canonicalSha256).toHaveLength(64);

      expect(cert.counts.accounts).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);
      expect(cert.idempotencySummary.accountsInserted).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);
      expect(accountsStore).toHaveLength(SYNTHETIC_SEPIDAR_ACCOUNTS.length);

      expect(cert.counts.parties).toBe(SYNTHETIC_SEPIDAR_PARTIES.length);
      expect(partiesStore.find((p) => p.code === 'PRT-1001')?.role).toBe('customer');
      expect(partiesStore.find((p) => p.code === 'PRT-1002')?.role).toBe('supplier');
      expect(partiesStore.find((p) => p.code === 'PRT-1003')?.role).toBe('both');

      expect(cert.counts.items).toBe(SYNTHETIC_SEPIDAR_ITEMS.length);
      expect(itemsStore.find((i) => i.sku === 'SKU-SEP-001')?.name).toBe('ماژول شبکه صنعتی');

      expect(cert.counts.openingLines).toBe(SYNTHETIC_SEPIDAR_OPENING_VOUCHER.length);
      expect(cert.idempotencySummary.openingVoucherCreated).toBe(true);
      expect(cert.totals.openingDebitMinor).toBe('25000000000');
      expect(cert.totals.openingCreditMinor).toBe('25000000000');
      expect(entriesStore.some((e) => e.entryNumber === 'JV-OPENING-SEPIDAR')).toBe(true);
      expect(linesStore).toHaveLength(5);

      // Account balances stored in exact IRR decimal (150M / 50M IRR, not 1/100th)
      expect(accountsStore.find((a) => a.code === '1010')?.balance).toBe('50000000.00');
      expect(accountsStore.find((a) => a.code === '3010')?.balance).toBe('-180000000.00');

      // Cheques persisted with sayadVerified=false (never falsified) + ChequeEventEntity audit row
      expect(cert.counts.cheques).toBe(5);
      expect(cert.totals.chequesAmountMinor).toBe('95500000000');
      expect(chequesStore.every((c) => c.sayadVerified === false && c.sayadVerifiedBy === null && c.sayadVerifiedAt === null)).toBe(true);
      expect(chequeEventsStore).toHaveLength(5);
    });

    it('defaults useSynthetic to false: rejects empty {} and persists only supplied cheques without synthetic fixtures', async () => {
      await expect(service.persistSepidarData(tenantId, {})).rejects.toThrow(BadRequestException);
      expect(accountsStore).toHaveLength(0);

      const onlyCheque = SYNTHETIC_SEPIDAR_CHEQUES[0];
      const cert = await service.persistSepidarData(tenantId, {
        cheques: [onlyCheque],
      });

      expect(cert.counts.accounts).toBe(0);
      expect(cert.counts.parties).toBe(0);
      expect(cert.counts.openingLines).toBe(0);
      expect(cert.counts.cheques).toBe(1);
      expect(chequesStore).toHaveLength(1);
      expect(accountsStore).toHaveLength(0);
    });

    it('does not collide cheques sharing the same chequeNumber across different banks', async () => {
      const chqA = {
        ...SYNTHETIC_SEPIDAR_CHEQUES[0],
        ChequeId: 2001,
        ChequeNumber: 'SHARED-100',
        SayadNumber: '1111222233334444',
        BankName: 'بانک ملت',
      };
      const chqB = {
        ...SYNTHETIC_SEPIDAR_CHEQUES[0],
        ChequeId: 2002,
        ChequeNumber: 'SHARED-100',
        SayadNumber: '5555666677778888',
        BankName: 'بانک سامان',
      };

      const cert = await service.persistSepidarData(tenantId, {
        cheques: [chqA, chqB],
      });

      expect(cert.counts.cheques).toBe(2);
      expect(cert.idempotencySummary.chequesInserted).toBe(2);
      expect(chequesStore).toHaveLength(2);
    });

    it('enforces strict idempotency on identical replay and throws 409 on Idempotency-Key or voucher mismatch', async () => {
      const firstCert = await service.persistSepidarData(
        tenantId,
        { useSynthetic: true },
        'idem-key-1',
      );
      expect(firstCert.idempotencySummary.openingVoucherCreated).toBe(true);

      const secondCert = await service.persistSepidarData(
        tenantId,
        { useSynthetic: true },
        'idem-key-1',
      );
      expect(secondCert.idempotencySummary.accountsInserted).toBe(0);
      expect(secondCert.idempotencySummary.accountsSkipped).toBe(18);
      expect(secondCert.idempotencySummary.openingVoucherCreated).toBe(false);
      expect(secondCert.idempotencySummary.chequesSkipped).toBe(5);
      expect(secondCert.canonicalSha256).toBe(firstCert.canonicalSha256);

      // Reusing same Idempotency-Key with a different payload must return 409 Conflict
      await expect(
        service.persistSepidarData(
          tenantId,
          { accounts: [{ AccountID: 99, Code: '99', Title: 'تست', Level: 1, ParentAccountID: null }] },
          'idem-key-1',
        ),
      ).rejects.toThrow(ConflictException);

      // Re-running with different openingVoucher totals must return 409 Conflict
      await expect(
        service.persistSepidarData(tenantId, {
          accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
          accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
          openingVoucher: [
            { VoucherItemID: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
            { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects unbalanced opening voucher before writing ANY entity (zero partial writes)', async () => {
      const unbalancedVoucher = [
        {
          VoucherItemID: 1,
          AccountCode: '1010',
          Debit: 100_000,
          Credit: 0,
          Description: 'عدم تراز',
        },
      ];

      await expect(
        service.persistSepidarData(tenantId, {
          useSynthetic: false,
          accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
          accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
          parties: SYNTHETIC_SEPIDAR_PARTIES,
          items: SYNTHETIC_SEPIDAR_ITEMS,
          openingVoucher: unbalancedVoucher,
          cheques: [],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(accountsStore).toHaveLength(0);
      expect(partiesStore).toHaveLength(0);
      expect(itemsStore).toHaveLength(0);
      expect(entriesStore).toHaveLength(0);
    });

    it('rolls back entire transaction when an opening voucher references a missing account', async () => {
      await expect(
        service.persistSepidarData(tenantId, {
          accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
          accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
          openingVoucher: [
            { VoucherItemID: 1, AccountCode: '999999', Debit: 1000, Credit: 0 },
            { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(accountsStore).toHaveLength(0);
      expect(entriesStore).toHaveLength(0);
    });

    it('executes all 5 entity groups atomically inside one TenantScope transaction', async () => {
      await service.persistSepidarData(tenantId, { useSynthetic: true });
      expect(mockTenantScope.run).toHaveBeenCalledTimes(1);
    });

    it('treats distinct Sayad numbers on same bank and chequeNumber as distinct cheques and deduplicates certificate counts', async () => {
      const chq1 = {
        ...SYNTHETIC_SEPIDAR_CHEQUES[0],
        ChequeId: 3001,
        ChequeNumber: 'SERIAL-99',
        SayadNumber: '1234567890123456',
        BankName: 'بانک ملت',
        Amount: 10_000_000,
      };
      const chq2DifferentSayadSameBank = {
        ...SYNTHETIC_SEPIDAR_CHEQUES[0],
        ChequeId: 3002,
        ChequeNumber: 'SERIAL-99',
        SayadNumber: '6543210987654321',
        BankName: 'بانک ملت',
        Amount: 20_000_000,
      };
      const duplicateOfChq1 = { ...chq1 };

      const cert = await service.persistSepidarData(
        tenantId,
        { cheques: [chq1, duplicateOfChq1, chq2DifferentSayadSameBank] },
        'cheques-only-key',
      );

      expect(chequesStore).toHaveLength(2);
      expect(cert.counts.cheques).toBe(2);
      expect(cert.totals.chequesAmountMinor).toBe('3000000000');

      // Reusing same Idempotency-Key on a cheques-only import with a different body must throw 409
      await expect(
        service.persistSepidarData(
          tenantId,
          { cheques: [chq2DifferentSayadSameBank] },
          'cheques-only-key',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects fractional IRR inputs, production useSynthetic, and re-runs with conflicting attributes', async () => {
      await expect(
        service.persistSepidarData(tenantId, {
          accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
          accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
          openingVoucher: [
            { VoucherItemID: 1, AccountCode: '1010', Debit: 1000.5, Credit: 0 },
            { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000.5 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(
          service.persistSepidarData(tenantId, { useSynthetic: true }),
        ).rejects.toThrow(BadRequestException);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }

      // First run succeeds, re-running same account code with changed name fails with 409 Conflict
      await service.persistSepidarData(tenantId, {
        accounts: [{ AccountID: 1, Code: '1010', Title: 'صندوق اصلی', Level: 1, ParentAccountID: null }],
      });
      await expect(
        service.persistSepidarData(tenantId, {
          accounts: [{ AccountID: 1, Code: '1010', Title: 'نام تغییریافته', Level: 1, ParentAccountID: null }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects openingDate drift (with & without Idempotency-Key) and attribute drift on party/item/cheque skips', async () => {
      await service.persistSepidarData(
        tenantId,
        {
          accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
          accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
          parties: [
            {
              PartyID: 1,
              Code: 'P-DRIFT-1',
              Title: 'مشتری تست',
              IsCustomer: true,
              IsVendor: false,
              Phone: '02111112222',
              EconomicCode: '411111111111',
            },
          ],
          items: [
            {
              ItemID: 1,
              Code: 'SKU-DRIFT-1',
              Title: 'کالای تست',
              Barcode: 'BAR-1',
              UnitTitle: 'عدد',
              SecondaryUnitTitle: 'کارتن',
              UnitConversionRate: '12',
            },
          ],
          openingDate: '2026-03-21',
          openingVoucher: [
            { VoucherItemID: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
            { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
          cheques: [
            {
              ...SYNTHETIC_SEPIDAR_CHEQUES[0],
              ChequeId: 901,
              ChequeNumber: 'CHQ-DRIFT-1',
              SayadNumber: '1111222233334444',
              PartyName: 'فروشگاه نخست',
              PartyCode: 'P-DRIFT-1',
            },
          ],
        },
        'drift-key-1',
      );

      // 1. openingDate change with same Idempotency-Key -> 409
      await expect(
        service.persistSepidarData(
          tenantId,
          {
            accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
            accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
            openingDate: '2026-04-01',
            openingVoucher: [
              { VoucherItemID: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
              { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
            ],
          },
          'drift-key-1',
        ),
      ).rejects.toThrow(ConflictException);

      // 2. openingDate change WITHOUT Idempotency-Key -> 409
      await expect(
        service.persistSepidarData(tenantId, {
          accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
          accountTypeMap: SYNTHETIC_FLOAT_TYPE_MAP,
          openingDate: '2026-04-01',
          openingVoucher: [
            { VoucherItemID: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
            { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
        }),
      ).rejects.toThrow(ConflictException);

      // 3. Party phone drift on skip (without Idempotency-Key) -> 409
      await expect(
        service.persistSepidarData(tenantId, {
          parties: [
            {
              PartyID: 1,
              Code: 'P-DRIFT-1',
              Title: 'مشتری تست',
              IsCustomer: true,
              IsVendor: false,
              Phone: '02199998888',
              EconomicCode: '411111111111',
            },
          ],
        }),
      ).rejects.toThrow(ConflictException);

      // 4. Item unitRatio drift on skip (without Idempotency-Key) -> 409
      await expect(
        service.persistSepidarData(tenantId, {
          items: [
            {
              ItemID: 1,
              Code: 'SKU-DRIFT-1',
              Title: 'کالای تست',
              Barcode: 'BAR-1',
              UnitTitle: 'عدد',
              SecondaryUnitTitle: 'کارتن',
              UnitConversionRate: '24',
            },
          ],
        }),
      ).rejects.toThrow(ConflictException);

      // 5. Cheque partyName drift on skip (without Idempotency-Key) -> 409
      await expect(
        service.persistSepidarData(tenantId, {
          cheques: [
            {
              ...SYNTHETIC_SEPIDAR_CHEQUES[0],
              ChequeId: 901,
              ChequeNumber: 'CHQ-DRIFT-1',
              SayadNumber: '1111222233334444',
              PartyName: 'نام متفاوت',
              PartyCode: 'P-DRIFT-1',
            },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('supports explicit AccountType override, rejects unknown prefix without AccountType, and validates DTO bounds/dates/booleans', async () => {
      await expect(
        service.persistSepidarData(tenantId, {
          accounts: [
            { AccountID: 1, Code: 'X100', Title: 'Unknown Prefix', Level: 1, ParentAccountID: null },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      await service.persistSepidarData(tenantId, {
        accounts: [
          {
            AccountID: 1,
            Code: 'X100',
            Title: 'Explicit Liability',
            Level: 1,
            ParentAccountID: null,
            AccountType: AccountType.LIABILITY,
          },
        ],
      });
      expect(accountsStore[0].accountType).toBe(AccountType.LIABILITY);

      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      });

      await expect(
        pipe.transform(
          { useSynthetic: 'false' },
          { type: 'body', metatype: PersistSepidarDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { openingDate: '2026-13-45', useSynthetic: false },
          { type: 'body', metatype: PersistSepidarDto },
        ),
      ).rejects.toThrow(BadRequestException);

      const oversized = Array.from({ length: MAX_SEPIDAR_ARRAY_ITEMS + 1 }, (_, i) => ({
        AccountID: i + 1,
        Code: String(1100 + i),
        Title: `Acc ${i}`,
        Level: 3,
        ParentAccountID: null,
      }));
      await expect(
        pipe.transform(
          { accounts: oversized },
          { type: 'body', metatype: PersistSepidarDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
