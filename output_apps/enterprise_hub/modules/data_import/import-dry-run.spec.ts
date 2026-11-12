import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountLevel } from '../accounting/enums/accounting.enum';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { ImportDryRunController } from './controllers/import-dry-run.controller';
import { SepidarMappingAdapter } from './migration/bak/sepidar-mapping.adapter';
import { ImportDryRunService } from './services/import-dry-run.service';
import {
  SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS,
  SYNTHETIC_HOLOO_DRY_RUN_PARTIES,
} from './__fixtures__/synthetic-holoo-dry-run.fixture';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_PARTIES,
} from './__fixtures__/synthetic-sepidar.fixture';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

interface MockDbState {
  accounts: Array<Record<string, unknown>>;
  parties: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown>>;
  lines: Array<Record<string, unknown>>;
  cheques: Array<Record<string, unknown>>;
  chequeEvents: Array<Record<string, unknown>>;
}

function createMockTenantScope(initial?: Partial<MockDbState>): {
  scope: TenantScope;
  state: MockDbState;
  wasRolledBack: () => boolean;
} {
  const committed: MockDbState = {
    accounts: [...(initial?.accounts ?? [])],
    parties: [...(initial?.parties ?? [])],
    items: [...(initial?.items ?? [])],
    entries: [...(initial?.entries ?? [])],
    lines: [...(initial?.lines ?? [])],
    cheques: [...(initial?.cheques ?? [])],
    chequeEvents: [...(initial?.chequeEvents ?? [])],
  };
  let rolledBack = false;

  const scope = {
    run: async <T>(_tenantId: string, fn: (em: EntityManager) => Promise<T>): Promise<T> => {
      const txState: MockDbState = {
        accounts: committed.accounts.map((r) => ({ ...r })),
        parties: committed.parties.map((r) => ({ ...r })),
        items: committed.items.map((r) => ({ ...r })),
        entries: committed.entries.map((r) => ({ ...r })),
        lines: committed.lines.map((r) => ({ ...r })),
        cheques: committed.cheques.map((r) => ({ ...r })),
        chequeEvents: committed.chequeEvents.map((r) => ({ ...r })),
      };
      let nextId = 1000;

      const storeFor = (entity: unknown): Array<Record<string, unknown>> => {
        const name = (entity as { name?: string })?.name;
        switch (name) {
          case 'ChartOfAccountEntity':
            return txState.accounts;
          case 'PartyEntity':
            return txState.parties;
          case 'StockItemEntity':
            return txState.items;
          case 'JournalEntryEntity':
            return txState.entries;
          case 'JournalEntryLineEntity':
            return txState.lines;
          case 'ChequeEntity':
            return txState.cheques;
          case 'ChequeEventEntity':
            return txState.chequeEvents;
          default:
            return [];
        }
      };

      const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
        Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object' && '_type' in (v as Record<string, unknown>)) {
            if ((v as { _type: string })._type === 'isNull') {
              return row[k] === null || row[k] === undefined;
            }
          }
          return row[k] === v;
        });

      const em = {
        query: jest.fn().mockResolvedValue([]),
        getRepository: (entity: unknown) => {
          const rows = storeFor(entity);
          return {
            find: async (opts?: { where?: Record<string, unknown> }) =>
              opts?.where ? rows.filter((r) => matchesWhere(r, opts.where!)) : [...rows],
            findOne: async (opts?: { where?: Record<string, unknown> }) =>
              opts?.where ? (rows.find((r) => matchesWhere(r, opts.where!)) ?? null) : null,
            count: async (opts?: { where?: Record<string, unknown> }) =>
              opts?.where ? rows.filter((r) => matchesWhere(r, opts.where!)).length : rows.length,
            create: (obj: Record<string, unknown>) => ({ ...obj }),
            save: async (obj: Record<string, unknown>) => {
              const saved = { id: ++nextId, ...obj };
              rows.push(saved);
              return saved;
            },
          };
        },
      } as unknown as EntityManager;

      try {
        const result = await fn(em);
        Object.assign(committed, txState);
        return result;
      } catch (err) {
        rolledBack = true;
        throw err;
      }
    },
  } as unknown as TenantScope;

  return { scope, state: committed, wasRolledBack: () => rolledBack };
}

describe('ImportDryRunService & ImportDryRunController (T100)', () => {
  it('runs Sepidar synthetic dry-run inside a transaction, rolls back, and returns complete report', async () => {
    const { scope, state, wasRolledBack } = createMockTenantScope();
    const service = new ImportDryRunService(new SepidarMappingAdapter(), scope);

    const report = await service.dryRunSepidar(TENANT_ID, { useSynthetic: true });

    expect(wasRolledBack()).toBe(true);
    expect(report.source).toBe('sepidar');
    expect(report.dryRun).toBe(true);
    expect(report.rolledBack).toBe(true);
    expect(report.readyToCommit).toBe(true);
    expect(report.counts.accounts).toEqual({
      incoming: SYNTHETIC_SEPIDAR_ACCOUNTS.length,
      wouldInsert: SYNTHETIC_SEPIDAR_ACCOUNTS.length,
      existingSkipped: 0,
      invalidCount: 0,
    });
    expect(report.counts.parties.wouldInsert).toBe(SYNTHETIC_SEPIDAR_PARTIES.length);
    expect(report.counts.parties.duplicates).toBe(0);
    expect(report.counts.items.wouldInsert).toBe(2);
    expect(report.counts.openingLines.incoming).toBe(5);
    expect(report.counts.openingLines.unmapped).toBe(0);
    expect(report.openingTrialBalance.balanced).toBe(true);
    expect(report.openingTrialBalance.totalDebitRial).toBe('250000000.00');
    expect(report.openingTrialBalance.totalCreditRial).toBe('250000000.00');
    expect(report.openingTrialBalance.varianceRial).toBe('0.00');
    expect(report.openingTrialBalance.persistedInTx).toBe(true);
    expect(report.openCheques.totalCount).toBe(5);
    expect(report.openCheques.totalAmountRial).toBe('955000000.00');
    expect(report.openCheques.receivedCount).toBe(3);
    expect(report.openCheques.issuedCount).toBe(2);
    expect(report.openCheques.endorsedCount).toBe(1);
    expect(report.counts.cheques.closedSkipped).toBe(2);
    expect(report.txVerification.dbAccountsAfterInsert).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);
    expect(state.accounts).toHaveLength(0);
    expect(state.cheques).toHaveLength(0);
  });

  it('runs Holoo synthetic dry-run inside a transaction, rolls back, and returns complete report', async () => {
    const { scope, state, wasRolledBack } = createMockTenantScope();
    const service = new ImportDryRunService(new SepidarMappingAdapter(), scope);

    const report = await service.dryRunHoloo(TENANT_ID, { useSynthetic: true });

    expect(wasRolledBack()).toBe(true);
    expect(report.source).toBe('holoo');
    expect(report.dryRun).toBe(true);
    expect(report.rolledBack).toBe(true);
    expect(report.readyToCommit).toBe(true);
    expect(report.counts.accounts.wouldInsert).toBe(SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS.length);
    expect(report.counts.parties.wouldInsert).toBe(SYNTHETIC_HOLOO_DRY_RUN_PARTIES.length);
    expect(report.counts.items.wouldInsert).toBe(2);
    expect(report.openingTrialBalance.balanced).toBe(true);
    expect(report.openingTrialBalance.totalDebitRial).toBe('150000000.00');
    expect(report.openingTrialBalance.totalCreditRial).toBe('150000000.00');
    expect(report.openCheques.totalCount).toBe(2);
    expect(report.openCheques.totalAmountRial).toBe('130000000.00');
    expect(report.counts.cheques.closedSkipped).toBe(1);
    expect(state.accounts).toHaveLength(0);
  });

  it('fails closed when useSynthetic is omitted/false with empty payload, in production, or on invalid calendar date', async () => {
    const { scope } = createMockTenantScope();
    const service = new ImportDryRunService(new SepidarMappingAdapter(), scope);

    await expect(service.dryRunSepidar(TENANT_ID, {})).rejects.toThrow(BadRequestException);
    await expect(service.dryRunHoloo(TENANT_ID, {})).rejects.toThrow(BadRequestException);
    await expect(
      service.dryRunHoloo(TENANT_ID, { useSynthetic: true, openingDate: '2026-02-31' }),
    ).rejects.toThrow(BadRequestException);

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        service.dryRunSepidar(TENANT_ID, { useSynthetic: true }),
      ).rejects.toThrow('disabled in production');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('detects unmapped accounts, non-postable accounts, unbalanced trial balance, and duplicate parties', async () => {
    const { scope } = createMockTenantScope({
      parties: [
        {
          id: 1,
          tenantId: TENANT_ID,
          code: 'DB-P1',
          name: 'مشتری قبلی',
          nationalId: '9988776655',
        },
      ],
      accounts: [
        {
          id: 1,
          tenantId: TENANT_ID,
          code: '1010',
          name: 'صندوق قبلی',
          level: AccountLevel.MOEIN,
          parentCode: '10',
        },
      ],
    });
    const service = new ImportDryRunService(new SepidarMappingAdapter(), scope);

    const report = await service.dryRunHoloo(TENANT_ID, {
      accounts: [
        { AccountId: 1, Code: '1', Name: 'گروه', Level: 1, ParentCode: null },
        { AccountId: 2, Code: '10', Name: 'کل', Level: 2, ParentCode: '1' },
        { AccountId: 3, Code: '1020', Name: 'معین دارای تفصیلی', Level: 3, ParentCode: '10' },
        { AccountId: 4, Code: '102001', Name: 'تفصیلی بانک', Level: 4, ParentCode: '1020' },
        { AccountId: 5, Code: 'F-900', Name: 'شناور', Level: 4, ParentCode: null, IsFloatingDetail: true },
      ],
      parties: [
        { PartyId: 1, Code: 'P-NEW', Name: 'جدید ۱', IsCustomer: true, IsSupplier: false, NationalCode: '1111111111' },
        { PartyId: 2, Code: 'P-NEW', Name: 'تکراری کد', IsCustomer: true, IsSupplier: false, NationalCode: '2222222222' },
        { PartyId: 3, Code: 'P-DUP-NID', Name: 'تکراری کد ملی', IsCustomer: true, IsSupplier: false, NationalCode: '1111111111' },
        { PartyId: 4, Code: 'DB-P1', Name: 'تکراری با دیتابیس', IsCustomer: true, IsSupplier: false, NationalCode: '9988776655' },
        { PartyId: 5, Code: 'P-DB-NID', Name: 'کد جدید ولی کد ملی دیتابیس', IsCustomer: true, IsSupplier: false, NationalCode: '9988776655' },
      ],
      openingVoucher: [
        { SanadId: 1, AccountCode: '1010', Debit: 50000, Credit: 0 },
        { SanadId: 2, AccountCode: '9999', Debit: 10000, Credit: 0 },
        { SanadId: 3, AccountCode: '1', Debit: 2000, Credit: 0 },
        { SanadId: 4, AccountCode: '1020', Debit: 0, Credit: 3000 },
        { SanadId: 5, AccountCode: 'F-900', Debit: 0, Credit: 1000 },
      ],
      cheques: [
        {
          ChequeId: 1,
          ChequeNumber: 'BAD-1',
          SayadNumber: '1111111111111111',
          Direction: 'received',
          State: 'in_hand',
          Amount: 100000,
          IssueDate: '2026-10-01',
          DueDate: '2026-11-01',
          PartyCode: 'P-NEW',
          PartyName: 'جدید ۱',
          BankName: 'ملت',
        },
      ],
    });

    expect(report.readyToCommit).toBe(false);
    expect(report.openingTrialBalance.balanced).toBe(false);
    expect(report.openingTrialBalance.persistedInTx).toBe(false);
    expect(report.openingTrialBalance.totalDebitRial).toBe('62000.00');
    expect(report.openingTrialBalance.totalCreditRial).toBe('4000.00');
    expect(report.openingTrialBalance.varianceRial).toBe('58000.00');

    expect(report.unmappedAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '9999', reason: 'missing_in_chart' }),
        expect.objectContaining({ accountCode: '1', reason: 'non_postable_level' }),
        expect.objectContaining({ accountCode: '1020', reason: 'has_child_accounts' }),
        expect.objectContaining({ accountCode: 'F-900', reason: 'floating_detail_only' }),
      ]),
    );

    expect(report.duplicateParties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'P-NEW', reason: 'duplicate_code_in_batch' }),
        expect.objectContaining({ code: 'P-DUP-NID', reason: 'duplicate_national_id_in_batch', conflictingCode: 'P-NEW' }),
        expect.objectContaining({ code: 'DB-P1', reason: 'existing_code_in_db', conflictingCode: 'DB-P1' }),
        expect.objectContaining({ code: 'P-DB-NID', reason: 'existing_national_id_in_db', conflictingCode: 'DB-P1' }),
      ]),
    );
    expect(report.counts.parties.wouldInsert).toBe(1);
    expect(report.counts.parties.duplicates).toBe(4);
    expect(report.openCheques.invalidErrors).toHaveLength(1);
  });

  it('extracts tenantId strictly from verified JWT in ImportDryRunController', async () => {
    const mockService = {
      dryRunSepidar: jest.fn().mockResolvedValue({ source: 'sepidar', dryRun: true, rolledBack: true }),
      dryRunHoloo: jest.fn().mockResolvedValue({ source: 'holoo', dryRun: true, rolledBack: true }),
    } as unknown as ImportDryRunService;

    const controller = new ImportDryRunController(mockService);
    const req = { user: { sub: 'u1', tenantId: TENANT_ID } } as unknown as AuthenticatedRequest;

    await controller.dryRunSepidar(req, { useSynthetic: true });
    await controller.dryRunHoloo(req, { useSynthetic: true });

    expect(mockService.dryRunSepidar).toHaveBeenCalledWith(TENANT_ID, { useSynthetic: true });
    expect(mockService.dryRunHoloo).toHaveBeenCalledWith(TENANT_ID, { useSynthetic: true });
  });
});
