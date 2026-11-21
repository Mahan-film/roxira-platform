import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BANK_STATEMENT_ENTITY_KEY,
  reconciliationCacheKey,
} from './analysis/reconciliation';
import { EffectiveTieOutConfigRegistry } from './analysis/effective-tie-out-config.registry';
import { ImportTieOutEngine } from './analysis/import-tie-out.engine';
import { PackageCommitDto } from './dto/package-commit.dto';
import { AccountingOpeningBalancesRegistry } from './registry/accounting-opening-balances.registry';
import { BankStatementRegistry } from './registry/bank-statement.registry';
import { EntityRegistryService } from './registry/entity-registry.service';
import { MappingMemoryService } from './services/mapping-memory.service';
import { PackageAnalysisService } from './services/package-analysis.service';
import { PackageReconciliationService } from './services/package-reconciliation.service';
import { PackageStoreService } from './services/package-store.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';

describe('Fix #1216 Part 2: PackageCommitDto validation, bank-statement key and reconciliation cache', () => {
  let root: string;
  let store: PackageStoreService;
  let analysis: PackageAnalysisService;
  let reconciliation: PackageReconciliationService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-reconcile-dto-'));
    process.env.IMPORT_TMP_DIR = root;

    const stub = {
      importOpeningBalances: async () => 1,
      removeImportedJournalEntries: async () => ({ removed: 0 }),
      importStatementLines: async () => [1],
      findExistingDedupeKeys: async () => [],
      removeImportedLines: async () => ({ removed: 0, refused: [] }),
    };
    const registry = new EntityRegistryService([
      new AccountingOpeningBalancesRegistry(stub as never),
      new BankStatementRegistry(stub as never),
    ]);
    const memory = {
      recall: async () => null,
      remember: async () => undefined,
    } as unknown as MappingMemoryService;
    store = new PackageStoreService();
    analysis = new PackageAnalysisService(store, registry, memory);
    reconciliation = new PackageReconciliationService(
      store,
      analysis,
      registry,
      new ImportTieOutEngine(new EffectiveTieOutConfigRegistry()),
    );
  });

  afterEach(() => {
    delete process.env.IMPORT_TMP_DIR;
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects bad currency, calendar date, control amount and string booleans with HTTP 400 under ValidationPipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const base = {
      tables: [{ name: 'data', entity: 'accounting-opening-balances', mapping: {} }],
    };
    const validate = (payload: unknown) =>
      pipe.transform(payload, { type: 'body', metatype: PackageCommitDto });

    await expect(validate({ ...base, currency: 'FAKE' })).rejects.toThrow(BadRequestException);
    await expect(validate({ ...base, asOfDate: '2026-02-30' })).rejects.toThrow(BadRequestException);
    await expect(validate({ ...base, asOfDate: 'not-a-date' })).rejects.toThrow(BadRequestException);
    await expect(
      validate({ ...base, controlTotals: { accountsPayable: 'not-a-number' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate({ ...base, controlTotals: { bankBalance: '10.1234' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(validate({ ...base, confirmImbalance: 'false' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      validate({
        tables: [{ name: 'data', entity: 'accounting-opening-balances', mapping: {}, skip: 'false' }],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validate({
        ...base,
        currency: 'KWD',
        asOfDate: '2026-11-21',
        confirmImbalance: true,
        controlTotals: { accountsPayable: '12.345' },
      }),
    ).resolves.toMatchObject({ currency: 'KWD', asOfDate: '2026-11-21', confirmImbalance: true });
  });

  it('caches reconciliation report by selections + options and invalidates when options change', async () => {
    const state = await store.createPackage(
      TENANT_ID,
      {
        originalname: 'opening.csv',
        buffer: Buffer.from('کد حساب,شرح,بدهکار,بستانکار\n1030,دریافتنی,5000000,0\n3010,سرمایه,0,5000000\n'),
      },
      10 * 1024 * 1024,
    );
    await analysis.analyze(TENANT_ID, state.packageId);

    const selections = [
      {
        name: 'data',
        entity: 'accounting-opening-balances',
        mapping: { 'کد حساب': 'accountCode', شرح: 'description', بدهکار: 'debit', بستانکار: 'credit' },
      },
    ];
    const openSpy = jest.spyOn(analysis, 'openPackage');

    const r1 = await reconciliation.reconcile(TENANT_ID, state.packageId, selections, {
      controlTotals: { ACCOUNTS_RECEIVABLE: '5000000' },
    });
    const r2 = await reconciliation.reconcile(TENANT_ID, state.packageId, selections, {
      controlTotals: { ACCOUNTS_RECEIVABLE: '5000000' },
    });
    expect(r1.balanced).toBe(true);
    expect(r2.balanced).toBe(true);
    expect(openSpy).toHaveBeenCalledTimes(1);

    const r3 = await reconciliation.reconcile(TENANT_ID, state.packageId, selections, {
      controlTotals: { ACCOUNTS_RECEIVABLE: '4000000' },
    });
    expect(r3.balanced).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('normalizes bank-statement alias keys in reconcilePackage and reconciliationCacheKey', async () => {
    const state = await store.createPackage(
      TENANT_ID,
      {
        originalname: 'bank.csv',
        buffer: Buffer.from('تاریخ,شرح,واریز,برداشت,مانده\n1403/07/01,واریز,7500000,0,7500000\n'),
      },
      10 * 1024 * 1024,
    );
    await analysis.analyze(TENANT_ID, state.packageId);

    const selections = [
      {
        name: 'data',
        entity: 'bank-statements',
        mapping: { تاریخ: 'date', شرح: 'description', واریز: 'deposit', برداشت: 'withdrawal', مانده: 'balance' },
      },
    ];
    expect(reconciliationCacheKey(selections)).toBe(
      reconciliationCacheKey([{ ...selections[0], entity: BANK_STATEMENT_ENTITY_KEY }]),
    );

    const report = await reconciliation.reconcile(TENANT_ID, state.packageId, selections, {
      controlTotals: { BANK_BALANCE: '8000000' },
    });
    expect(report.tables[0].entity).toBe(BANK_STATEMENT_ENTITY_KEY);
    expect(report.tieOut?.items.find((i) => i.category === 'BANK_BALANCE')).toMatchObject({
      matched: false,
      expectedMinor: '8000000',
      actualMinor: '7500000',
    });
  });
});
