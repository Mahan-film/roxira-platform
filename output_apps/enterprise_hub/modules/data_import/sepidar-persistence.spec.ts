import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../accounting/entities/journal-entry-line.entity';
import { ChequeEntity } from '../cheques/entities/cheque.entity';
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

describe('Sepidar Data Persistence & Reconciliation Certificate (T88 / #774)', () => {
  const tenantId = '11111111-2222-3333-4444-555555555555';

  let service: SepidarPersistenceService;
  let mappingAdapter: SepidarMappingAdapter;
  let chequesAdapter: SepidarChequesFifoAdapter;

  // In-memory mock repositories per entity
  let accountsStore: Map<string, ChartOfAccountEntity>;
  let partiesStore: Map<string, PartyEntity>;
  let itemsStore: Map<string, StockItemEntity>;
  let entriesStore: Map<string, JournalEntryEntity>;
  let linesStore: JournalEntryLineEntity[];
  let chequesStore: Map<string, ChequeEntity>;

  let mockTenantScope: Partial<TenantScope>;

  beforeEach(() => {
    accountsStore = new Map();
    partiesStore = new Map();
    itemsStore = new Map();
    entriesStore = new Map();
    linesStore = [];
    chequesStore = new Map();

    const mockEntityManager = {
      getRepository: jest.fn((entityClass) => {
        if (entityClass === ChartOfAccountEntity) {
          return {
            findOne: jest.fn(async ({ where }) => {
              if (where.code) return accountsStore.get(where.code) ?? null;
              return null;
            }),
            create: jest.fn((dto) => ({ id: accountsStore.size + 1, ...dto })),
            save: jest.fn(async (entity) => {
              accountsStore.set(entity.code, entity);
              return entity;
            }),
          };
        }
        if (entityClass === PartyEntity) {
          return {
            findOne: jest.fn(async ({ where }) => {
              if (where.code) return partiesStore.get(where.code) ?? null;
              return null;
            }),
            create: jest.fn((dto) => ({ id: partiesStore.size + 1, ...dto })),
            save: jest.fn(async (entity) => {
              partiesStore.set(entity.code, entity);
              return entity;
            }),
          };
        }
        if (entityClass === StockItemEntity) {
          return {
            findOne: jest.fn(async ({ where }) => {
              if (where.sku) return itemsStore.get(where.sku) ?? null;
              return null;
            }),
            create: jest.fn((dto) => ({ id: itemsStore.size + 1, ...dto })),
            save: jest.fn(async (entity) => {
              itemsStore.set(entity.sku, entity);
              return entity;
            }),
          };
        }
        if (entityClass === JournalEntryEntity) {
          return {
            findOne: jest.fn(async ({ where }) => {
              if (where.entryNumber) return entriesStore.get(where.entryNumber) ?? null;
              return null;
            }),
            create: jest.fn((dto) => ({ id: entriesStore.size + 1, ...dto })),
            save: jest.fn(async (entity) => {
              entriesStore.set(entity.entryNumber, entity);
              return entity;
            }),
          };
        }
        if (entityClass === JournalEntryLineEntity) {
          return {
            create: jest.fn((dto) => ({ id: linesStore.length + 1, ...dto })),
            save: jest.fn(async (line) => {
              linesStore.push(line);
              return line;
            }),
          };
        }
        if (entityClass === ChequeEntity) {
          return {
            findOne: jest.fn(async ({ where }) => {
              if (where.sayadNumber) return chequesStore.get(where.sayadNumber) ?? null;
              if (where.chequeNumber) return chequesStore.get(where.chequeNumber) ?? null;
              return null;
            }),
            create: jest.fn((dto) => ({ id: chequesStore.size + 1, ...dto })),
            save: jest.fn(async (entity) => {
              const key = entity.sayadNumber || entity.chequeNumber;
              chequesStore.set(key, entity);
              return entity;
            }),
          };
        }
        throw new Error(`Unexpected entity class: ${entityClass.name}`);
      }),
    };

    mockTenantScope = {
      run: jest.fn(async (_t: string, fn: (em: EntityManager) => any) => {
        return fn(mockEntityManager as unknown as EntityManager);
      }),
    };

    mappingAdapter = new SepidarMappingAdapter();
    chequesAdapter = new SepidarChequesFifoAdapter();
    service = new SepidarPersistenceService(
      mappingAdapter,
      chequesAdapter,
      mockTenantScope as TenantScope,
    );
  });

  describe('End-to-End Sepidar Data Persistence', () => {
    it('persists all 5 entity groups from synthetic fixtures and issues certified reconciliation digest', async () => {
      const cert = await service.persistSepidarData(tenantId, {
        useSynthetic: true,
      });

      expect(cert.tenantId).toBe(tenantId);
      expect(cert.balanced).toBe(true);
      expect(cert.varianceMinor).toBe('0');
      expect(cert.canonicalSha256).toHaveLength(64);

      // Verify Entity Group 1: Chart of Accounts
      expect(cert.counts.accounts).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);
      expect(cert.idempotencySummary.accountsInserted).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);
      expect(cert.idempotencySummary.accountsSkipped).toBe(0);
      expect(accountsStore.size).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);

      // Verify hierarchical accounts exist
      expect(accountsStore.get('1')).toBeDefined(); // Gorouh
      expect(accountsStore.get('10')).toBeDefined(); // Kol
      expect(accountsStore.get('1010')).toBeDefined(); // Moein
      expect(accountsStore.get('102001')).toBeDefined(); // Tafsili

      // Verify Entity Group 2: Parties
      expect(cert.counts.parties).toBe(SYNTHETIC_SEPIDAR_PARTIES.length);
      expect(cert.idempotencySummary.partiesInserted).toBe(SYNTHETIC_SEPIDAR_PARTIES.length);
      expect(partiesStore.size).toBe(SYNTHETIC_SEPIDAR_PARTIES.length);
      expect(partiesStore.get('PRT-1001')?.role).toBe('customer');
      expect(partiesStore.get('PRT-1002')?.role).toBe('supplier');
      expect(partiesStore.get('PRT-1003')?.role).toBe('both');

      // Verify Entity Group 3: Items
      expect(cert.counts.items).toBe(SYNTHETIC_SEPIDAR_ITEMS.length);
      expect(cert.idempotencySummary.itemsInserted).toBe(SYNTHETIC_SEPIDAR_ITEMS.length);
      expect(itemsStore.size).toBe(SYNTHETIC_SEPIDAR_ITEMS.length);
      expect(itemsStore.get('SKU-SEP-001')?.name).toBe('ماژول شبکه صنعتی');

      // Verify Entity Group 4: Opening Balance Voucher
      expect(cert.counts.openingLines).toBe(SYNTHETIC_SEPIDAR_OPENING_VOUCHER.length);
      expect(cert.idempotencySummary.openingVoucherCreated).toBe(true);
      // 250,000,000 Rials Debit & Credit = 250,000,000 Minor units in the fixture
      expect(cert.totals.openingDebitMinor).toBe('250000000');
      expect(cert.totals.openingCreditMinor).toBe('250000000');
      expect(entriesStore.has('JV-OPENING-SEPIDAR')).toBe(true);
      expect(linesStore).toHaveLength(5);

      // Verify Entity Group 5: Open Cheques
      // Synthetic fixture has 5 open cheques (3 received, 2 issued)
      expect(cert.counts.cheques).toBe(5);
      expect(cert.idempotencySummary.chequesInserted).toBe(5);
      expect(chequesStore.size).toBe(5);
      // 150M + 280M + 95M (rec) + 320M + 110M (iss) = 955,000,000
      expect(cert.totals.chequesAmountMinor).toBe('955000000');
    });

    it('enforces strict idempotency on repeated execution, skipping all duplicates with identical digest', async () => {
      // First run: inserts everything
      const firstCert = await service.persistSepidarData(tenantId, {
        useSynthetic: true,
      });

      expect(firstCert.idempotencySummary.accountsInserted).toBe(18);
      expect(firstCert.idempotencySummary.openingVoucherCreated).toBe(true);

      // Second run: completely idempotent replay
      const secondCert = await service.persistSepidarData(tenantId, {
        useSynthetic: true,
      });

      expect(secondCert.idempotencySummary.accountsInserted).toBe(0);
      expect(secondCert.idempotencySummary.accountsSkipped).toBe(18);

      expect(secondCert.idempotencySummary.partiesInserted).toBe(0);
      expect(secondCert.idempotencySummary.partiesSkipped).toBe(3);

      expect(secondCert.idempotencySummary.itemsInserted).toBe(0);
      expect(secondCert.idempotencySummary.itemsSkipped).toBe(2);

      expect(secondCert.idempotencySummary.openingVoucherCreated).toBe(false);

      expect(secondCert.idempotencySummary.chequesInserted).toBe(0);
      expect(secondCert.idempotencySummary.chequesSkipped).toBe(5);

      // Cryptographic digest must be completely deterministic and identical!
      expect(secondCert.canonicalSha256).toBe(firstCert.canonicalSha256);
    });

    it('rejects unbalanced opening balance vouchers with zero variance assertion', async () => {
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
          parties: [],
          items: [],
          openingVoucher: unbalancedVoucher,
          cheques: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('executes each entity group inside its own transaction (5 distinct transaction boundaries)', async () => {
      await service.persistSepidarData(tenantId, { useSynthetic: true });

      // TenantScope.run must have been invoked exactly 5 times (once per entity group)
      expect(mockTenantScope.run).toHaveBeenCalledTimes(5);
    });
  });
});
