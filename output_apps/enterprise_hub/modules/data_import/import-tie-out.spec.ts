import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { strToU8, zipSync } from 'fflate';
import {
  EffectiveTieOutConfigRegistry,
} from './analysis/effective-tie-out-config.registry';
import {
  formatTieOutMoney,
  ImportTieOutEngine,
  multiplyMinorByDecimalQuantity,
  parseMoneyValue,
} from './analysis/import-tie-out.engine';
import { AccountingJournalLinesRegistry } from './registry/accounting-journal-lines.registry';
import { AccountingOpeningBalancesRegistry } from './registry/accounting-opening-balances.registry';
import { BankStatementRegistry } from './registry/bank-statement.registry';
import { EntityRegistryService } from './registry/entity-registry.service';
import { InventoryItemsRegistry } from './registry/inventory-items.registry';
import { SalesInvoicesRegistry } from './registry/sales-invoices.registry';
import { ChunkedUploadService } from './services/chunked-upload.service';
import { MappingMemoryService } from './services/mapping-memory.service';
import { PackageAnalysisService } from './services/package-analysis.service';
import { PackageCommitService } from './services/package-commit.service';
import { PackageImportService } from './services/package-import.service';
import { PackageProgressService } from './services/package-progress.service';
import { PackageReconciliationService } from './services/package-reconciliation.service';
import { PackageStoreService } from './services/package-store.service';
import { PackageCommitDto } from './dto/package-commit.dto';

interface TestHarness {
  service: PackageImportService;
  reconciliation: PackageReconciliationService;
  tieOutEngine: ImportTieOutEngine;
  configRegistry: EffectiveTieOutConfigRegistry;
  root: string;
}

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const csvBuffer = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.join(',')).join('\n') + '\n');

function buildTestHarness(): TestHarness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-tie-out-'));
  process.env.IMPORT_TMP_DIR = root;

  const accounting = {
    createJournalEntry: async () => ({ id: 1 }),
    importOpeningBalances: async () => 1,
    removeImportedJournalEntries: async () => ({ removed: 0 }),
    findExistingAccountCodes: async () => [],
  };
  const inventory = {
    importStockItemWithOpeningStock: async () => 1,
    findExistingSkus: async () => [],
    removeImportedItems: async () => ({ removed: 0, refused: [] }),
  };
  const invoicing = {
    importInvoice: async () => 1,
    removeImportedInvoices: async () => ({ removed: 0, refused: [] }),
  };
  const banking = {
    importStatementLines: async () => [1],
    findExistingDedupeKeys: async () => [],
    removeImportedLines: async () => ({ removed: 0, refused: [] }),
  };

  const registry = new EntityRegistryService([
    new AccountingOpeningBalancesRegistry(accounting as never),
    new AccountingJournalLinesRegistry(accounting as never),
    new InventoryItemsRegistry(inventory as never),
    new SalesInvoicesRegistry(invoicing as never),
    new BankStatementRegistry(banking as never),
  ] as never);

  const memory = {
    recall: async () => null,
    remember: async () => undefined,
  } as unknown as MappingMemoryService;

  const configRegistry = new EffectiveTieOutConfigRegistry();
  const tieOutEngine = new ImportTieOutEngine(configRegistry);

  const store = new PackageStoreService();
  const analysis = new PackageAnalysisService(store, registry, memory);
  const progress = new PackageProgressService();
  const batchRepo = {
    createBatch: async () => undefined,
    setInserted: async () => undefined,
    removeBatch: async () => undefined,
    addItems: async () => undefined,
  };
  const commit = new PackageCommitService(
    store,
    analysis,
    registry,
    progress,
    batchRepo as never,
    memory,
  );
  const reconciliation = new PackageReconciliationService(
    store,
    analysis,
    registry,
    tieOutEngine,
  );
  const quota = {
    assertWithinQuota: async () => undefined,
    recordImport: async () => undefined,
  };
  const chunked = new ChunkedUploadService();
  const service = new PackageImportService(
    store,
    analysis,
    commit,
    quota as never,
    progress,
    undefined,
    reconciliation,
    chunked,
  );

  return {
    service,
    reconciliation,
    tieOutEngine,
    configRegistry,
    root,
  };
}

describe('T325 R32: Import Tie-Out Engine (TB, AR/AP, Stock Value, Bank)', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = buildTestHarness();
  });

  afterEach(() => {
    delete process.env.IMPORT_TMP_DIR;
    if (fs.existsSync(harness.root)) {
      fs.rmSync(harness.root, { recursive: true, force: true });
    }
  });

  describe('Money term exact formatting and BigInt arithmetic', () => {
    it('formats exact rial amounts with commas and currency label', () => {
      expect(formatTieOutMoney(0n, 'IRR')).toBe('0 ریال');
      expect(formatTieOutMoney(1000000n, 'IRR')).toBe('1,000,000 ریال');
      expect(formatTieOutMoney(-500000n, 'IRR')).toBe('-500,000 ریال');
      expect(formatTieOutMoney(1234567890123456n, 'IRR')).toBe(
        '1,234,567,890,123,456 ریال',
      );
    });

    it('formats foreign currencies using ISO 4217 decimals', () => {
      expect(formatTieOutMoney(125000n, 'USD')).toBe('1250.00 USD');
      expect(formatTieOutMoney(50000n, 'EUR')).toBe('500.00 EUR');
      expect(formatTieOutMoney(123456n, 'OMR')).toBe('123.456 OMR');
    });
  });

  describe('Trial Balance (TB) tie-out', () => {
    it('fails an import whose TB control totals differ and lists difference in money terms', async () => {
      // Opening balances: Debit 1,000,000 vs Credit 900,000 (diff: 100,000 Rials)
      const created = await harness.service.createPackage(TENANT_ID, {
        originalname: 'opening_imbalanced.csv',
        buffer: csvBuffer([
          ['کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
          ['1010', 'صندوق', '1000000', '0'],
          ['3010', 'سرمایه', '0', '900000'],
        ]),
      });

      const commitDto: PackageCommitDto = {
        tables: [
          {
            name: 'data',
            entity: 'accounting-opening-balances',
            mapping: {
              'کد حساب': 'accountCode',
              شرح: 'description',
              بدهکار: 'debit',
              بستانکار: 'credit',
            },
          },
        ],
      };

      const report = await harness.service.reconcile(
        TENANT_ID,
        created.packageId,
        commitDto,
      );

      expect(report.balanced).toBe(false);
      expect(report.tieOut).toBeDefined();
      expect(report.tieOut?.passed).toBe(false);
      expect(report.tieOut?.discrepanciesCount).toBeGreaterThanOrEqual(1);

      const tbCheck = report.tieOut?.items.find(
        (i) => i.category === 'TRIAL_BALANCE',
      );
      expect(tbCheck).toBeDefined();
      expect(tbCheck?.matched).toBe(false);
      expect(tbCheck?.actualMoney).toBe('1,000,000 ریال');
      expect(tbCheck?.expectedMoney).toBe('900,000 ریال');
      expect(tbCheck?.differenceMoney).toBe('100,000 ریال');
      expect(tbCheck?.blockerFa).toContain('100,000 ریال');

      // Attempting commit must fail with 409 ConflictException containing the report
      await expect(
        harness.service.commitPackage(TENANT_ID, created.packageId, commitDto),
      ).rejects.toThrow(ConflictException);
    });

    it('passes when TB control totals agree (debit = credit)', async () => {
      const created = await harness.service.createPackage(TENANT_ID, {
        originalname: 'opening_balanced.csv',
        buffer: csvBuffer([
          ['کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
          ['1010', 'صندوق', '1000000', '0'],
          ['3010', 'سرمایه', '0', '1000000'],
        ]),
      });

      const commitDto: PackageCommitDto = {
        tables: [
          {
            name: 'data',
            entity: 'accounting-opening-balances',
            mapping: {
              'کد حساب': 'accountCode',
              شرح: 'description',
              بدهکار: 'debit',
              بستانکار: 'credit',
            },
          },
        ],
      };

      const report = await harness.service.reconcile(
        TENANT_ID,
        created.packageId,
        commitDto,
      );

      expect(report.balanced).toBe(true);
      expect(report.tieOut?.passed).toBe(true);
      const tbCheck = report.tieOut?.items.find(
        (i) => i.category === 'TRIAL_BALANCE',
      );
      expect(tbCheck?.matched).toBe(true);
      expect(tbCheck?.differenceMoney).toBe('0 ریال');

      const result = await harness.service.commitPackage(
        TENANT_ID,
        created.packageId,
        commitDto,
      );
      expect(result.batchId).toBeDefined();
    });
  });

  describe('Accounts Receivable (AR) Control tie-out', () => {
    it('fails an import whose AR sub-ledger differs from TB AR control account', async () => {
      // TB AR account (1030) has 5,000,000 Rials
      // Open sales invoices total 4,200,000 Rials (diff: 800,000 Rials)
      const tbCreated = await harness.service.createPackage(TENANT_ID, {
        originalname: 'tb.csv',
        buffer: csvBuffer([
          ['کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
          ['1030', 'حساب‌های دریافتنی تجاری', '5000000', '0'],
          ['3010', 'سرمایه', '0', '5000000'],
        ]),
      });

      const commitDto: PackageCommitDto = {
        tables: [
          {
            name: 'data',
            entity: 'accounting-opening-balances',
            mapping: {
              'کد حساب': 'accountCode',
              شرح: 'description',
              بدهکار: 'debit',
              بستانکار: 'credit',
            },
          },
        ],
        controlTotals: {
          accountsReceivable: '4200000', // External sub-ledger control total differs
        },
      };

      const report = await harness.service.reconcile(
        TENANT_ID,
        tbCreated.packageId,
        commitDto,
      );

      expect(report.balanced).toBe(false);
      const arCheck = report.tieOut?.items.find(
        (i) => i.category === 'ACCOUNTS_RECEIVABLE',
      );
      expect(arCheck).toBeDefined();
      expect(arCheck?.matched).toBe(false);
      expect(arCheck?.expectedMoney).toBe('4,200,000 ریال');
      expect(arCheck?.actualMoney).toBe('5,000,000 ریال');
      expect(arCheck?.differenceMoney).toBe('800,000 ریال');
      expect(report.blockersFa.some((b) => b.includes('800,000 ریال'))).toBe(
        true,
      );

      await expect(
        harness.service.commitPackage(TENANT_ID, tbCreated.packageId, commitDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Inventory Stock Value tie-out', () => {
    it('fails an import whose inventory layers value differs from TB stock control', async () => {
      // TB Inventory account (1050) has 3,000,000 Rials
      // Control total says 2,500,000 Rials (diff: 500,000 Rials)
      const tbCreated = await harness.service.createPackage(TENANT_ID, {
        originalname: 'stock_tb.csv',
        buffer: csvBuffer([
          ['کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
          ['1050', 'موجودی کالا', '3000000', '0'],
          ['3010', 'سرمایه', '0', '3000000'],
        ]),
      });

      const commitDto: PackageCommitDto = {
        tables: [
          {
            name: 'data',
            entity: 'accounting-opening-balances',
            mapping: {
              'کد حساب': 'accountCode',
              شرح: 'description',
              بدهکار: 'debit',
              بستانکار: 'credit',
            },
          },
        ],
        controlTotals: {
          inventoryStock: '2500000',
        },
      };

      const report = await harness.service.reconcile(
        TENANT_ID,
        tbCreated.packageId,
        commitDto,
      );

      expect(report.balanced).toBe(false);
      const invCheck = report.tieOut?.items.find(
        (i) => i.category === 'INVENTORY_STOCK',
      );
      expect(invCheck).toBeDefined();
      expect(invCheck?.matched).toBe(false);
      expect(invCheck?.expectedMoney).toBe('2,500,000 ریال');
      expect(invCheck?.actualMoney).toBe('3,000,000 ریال');
      expect(invCheck?.differenceMoney).toBe('500,000 ریال');
      expect(invCheck?.blockerFa).toContain('500,000 ریال');

      await expect(
        harness.service.commitPackage(TENANT_ID, tbCreated.packageId, commitDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Bank Balance tie-out', () => {
    it('fails an import whose bank statement closing balance differs from TB bank control', async () => {
      // TB Bank account (1020) has 8,000,000 Rials
      // Statement closing balance says 7,500,000 Rials (diff: 500,000 Rials)
      const tbCreated = await harness.service.createPackage(TENANT_ID, {
        originalname: 'bank_tb.csv',
        buffer: csvBuffer([
          ['کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
          ['1020', 'بانک ملت', '8000000', '0'],
          ['3010', 'سرمایه', '0', '8000000'],
        ]),
      });

      const commitDto: PackageCommitDto = {
        tables: [
          {
            name: 'data',
            entity: 'accounting-opening-balances',
            mapping: {
              'کد حساب': 'accountCode',
              شرح: 'description',
              بدهکار: 'debit',
              بستانکار: 'credit',
            },
          },
        ],
        controlTotals: {
          bankBalance: '7500000',
        },
      };

      const report = await harness.service.reconcile(
        TENANT_ID,
        tbCreated.packageId,
        commitDto,
      );

      expect(report.balanced).toBe(false);
      const bankCheck = report.tieOut?.items.find(
        (i) => i.category === 'BANK_BALANCE',
      );
      expect(bankCheck).toBeDefined();
      expect(bankCheck?.matched).toBe(false);
      expect(bankCheck?.expectedMoney).toBe('7,500,000 ریال');
      expect(bankCheck?.actualMoney).toBe('8,000,000 ریال');
      expect(bankCheck?.differenceMoney).toBe('500,000 ریال');
      expect(bankCheck?.blockerFa).toContain('500,000 ریال');

      await expect(
        harness.service.commitPackage(TENANT_ID, tbCreated.packageId, commitDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Multi-Table Cross Tie-Out (All Controls Matched)', () => {
    it('passes when TB, AR, Stock and Bank all tie out cleanly', async () => {
      const tbCreated = await harness.service.createPackage(TENANT_ID, {
        originalname: 'full_cutover.csv',
        buffer: csvBuffer([
          ['کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
          ['1020', 'بانک تجارت', '10000000', '0'],
          ['1030', 'حساب‌های دریافتنی', '5000000', '0'],
          ['1050', 'موجودی کالا', '3000000', '0'],
          ['2010', 'حساب‌های پرداختنی', '0', '2000000'],
          ['3010', 'سرمایه', '0', '16000000'],
        ]),
      });

      const commitDto: PackageCommitDto = {
        tables: [
          {
            name: 'data',
            entity: 'accounting-opening-balances',
            mapping: {
              'کد حساب': 'accountCode',
              شرح: 'description',
              بدهکار: 'debit',
              بستانکار: 'credit',
            },
          },
        ],
        controlTotals: {
          accountsReceivable: '5000000',
          accountsPayable: '2000000',
          inventoryStock: '3000000',
          bankBalance: '10000000',
        },
      };

      const report = await harness.service.reconcile(
        TENANT_ID,
        tbCreated.packageId,
        commitDto,
      );

      expect(report.balanced).toBe(true);
      expect(report.tieOut?.passed).toBe(true);
      expect(report.tieOut?.discrepanciesCount).toBe(0);
      expect(report.tieOut?.items.length).toBe(5); // TB, AR, AP, Stock, Bank all checked!
      expect(report.blockersFa).toHaveLength(0);

      const commitResult = await harness.service.commitPackage(
        TENANT_ID,
        tbCreated.packageId,
        commitDto,
      );
      expect(commitResult.batchId).toBeDefined();
    });
  });

  describe('Effective-Dated Configuration resolution', () => {
    it('resolves historical and modern configurations accurately', () => {
      const reg = new EffectiveTieOutConfigRegistry();

      const pre2024 = reg.resolveConfig('2023-05-15');
      expect(pre2024.id).toBe('legacy-standard-pre-2024');

      const post2024 = reg.resolveConfig('2025-01-01');
      expect(post2024.id).toBe('standard-2024-onward');
    });

    it('allows registering custom effective-dated control rules', () => {
      const reg = new EffectiveTieOutConfigRegistry();
      reg.registerConfig({
        id: 'gulf-pack-2026',
        effectiveFrom: '2026-01-01',
        currency: 'AED',
        accountsReceivable: {
          accountCodes: ['1200'],
          namePatterns: ['customer receivable'],
        },
        accountsPayable: {
          accountCodes: ['2200'],
          namePatterns: ['vendor payable'],
        },
        inventory: {
          accountCodes: ['1400'],
          namePatterns: ['goods for sale'],
        },
        bank: {
          accountCodes: ['1100'],
          namePatterns: ['enbd bank'],
        },
      });

      const resolved = reg.resolveConfig('2026-06-01');
      expect(resolved.id).toBe('gulf-pack-2026');
      expect(resolved.currency).toBe('AED');
      expect(resolved.accountsReceivable.accountCodes).toEqual(['1200']);
    });
  });

  describe('Fix #1216 Part 1: AP mismatch, fractional/zero qty, 3-decimal currencies, bank tie-out, disambiguation & 400 errors', () => {
    it('fails AP tie-out when AP subledger differs from TB AP without controlTotal and never fakes matched=true when controlless', () => {
      const mismatch = harness.tieOutEngine.evaluateTieOuts({
        recordsByEntity: new Map([
          [
            'accounting-opening-balances',
            [
              { rowNumber: 2, values: { accountCode: '2010', description: 'حساب‌های پرداختنی', debit: 0, credit: 2000000 } },
              { rowNumber: 3, values: { accountCode: '3010', description: 'سرمایه', debit: 2000000, credit: 0 } },
            ],
          ],
          ['purchase-invoices', [{ rowNumber: 2, values: { totalAmount: '1500000' } }]],
        ]),
      });
      expect(mismatch.passed).toBe(false);
      expect(mismatch.items.find((i) => i.category === 'ACCOUNTS_PAYABLE')).toMatchObject({
        matched: false,
        expectedMinor: '2000000',
        actualMinor: '1500000',
        differenceMinor: '-500000',
      });

      const controlless = harness.tieOutEngine.evaluateTieOuts({
        recordsByEntity: new Map([
          [
            'accounting-opening-balances',
            [
              { rowNumber: 2, values: { accountCode: '1020', description: 'بانک', debit: 1000000, credit: 0 } },
              { rowNumber: 3, values: { accountCode: '1030', description: 'دریافتنی', debit: 500000, credit: 0 } },
              { rowNumber: 4, values: { accountCode: '1050', description: 'موجودی کالا', debit: 300000, credit: 0 } },
              { rowNumber: 5, values: { accountCode: '2010', description: 'پرداختنی', debit: 0, credit: 200000 } },
              { rowNumber: 6, values: { accountCode: '3010', description: 'سرمایه', debit: 0, credit: 1600000 } },
            ],
          ],
        ]),
      });
      // AP check without controlTotal or subledger must never pass:
      expect(controlless.passed).toBe(false);
      expect(controlless.items.find((i) => i.category === 'ACCOUNTS_PAYABLE')).toMatchObject({
        matched: false,
        expectedMinor: 'انجام نشد',
        expectedMoney: 'انجام نشد',
        actualMinor: '200000',
        differenceMinor: 'انجام نشد',
      });
      expect(controlless.warningsFa?.length).toBe(4);

      // When AP has controlTotal matching opening balance, tie-out passes cleanly
      const withApControl = harness.tieOutEngine.evaluateTieOuts({
        controlTotals: { ACCOUNTS_PAYABLE: 200000 },
        recordsByEntity: new Map([
          [
            'accounting-opening-balances',
            [
              { rowNumber: 2, values: { accountCode: '2010', description: 'پرداختنی', debit: 0, credit: 200000 } },
              { rowNumber: 3, values: { accountCode: '3010', description: 'سرمایه', debit: 200000, credit: 0 } },
            ],
          ],
        ]),
      });
      expect(withApControl.passed).toBe(true);
      expect(withApControl.items.find((i) => i.category === 'ACCOUNTS_PAYABLE')).toMatchObject({
        matched: true,
        expectedMinor: '200000',
        actualMinor: '200000',
      });
    });

    it('matches accounts strictly by exact code and never falls through to description or substring when code is present', () => {
      const summary = harness.tieOutEngine.evaluateTieOuts({
        recordsByEntity: new Map([
          [
            'accounting-opening-balances',
            [
              // Code 9999 has description 'حساب‌های پرداختنی' but code is NOT 2010 -> must NOT match AP
              { rowNumber: 2, values: { accountCode: '9999', description: 'حساب‌های پرداختنی متفرقه', debit: 0, credit: 500000 } },
              // Code 2010 is exact match for AP
              { rowNumber: 3, values: { accountCode: '2010', description: 'بستانکاران تجاری', debit: 0, credit: 300000 } },
              { rowNumber: 4, values: { accountCode: '3010', description: 'سرمایه', debit: 800000, credit: 0 } },
            ],
          ],
        ]),
        controlTotals: { ACCOUNTS_PAYABLE: 300000 },
      });
      const apItem = summary.items.find((i) => i.category === 'ACCOUNTS_PAYABLE');
      expect(apItem).toMatchObject({
        matched: true,
        actualMinor: '300000',
        expectedMinor: '300000',
      });
    });

    it('computes fractional and explicit zero quantities accurately in AR, Inventory, and 3-decimal currencies (KWD/OMR)', () => {
      expect(multiplyMinorByDecimalQuantity(1000n, 2.5, '1')).toBe(2500n);
      expect(multiplyMinorByDecimalQuantity(1000n, 0.5, '1')).toBe(500n);
      expect(multiplyMinorByDecimalQuantity(1000n, 0, '1')).toBe(0n);
      expect(multiplyMinorByDecimalQuantity(10125n, '2.5', '1')).toBe(25313n);
      expect(multiplyMinorByDecimalQuantity(12345n, '0.125', '1')).toBe(1543n);
      expect(multiplyMinorByDecimalQuantity(10000n, '0.005', '1')).toBe(50n);
      expect(formatTieOutMoney(30863n, 'OMR')).toBe('30.863 OMR');
      expect(formatTieOutMoney(1543n, 'BHD')).toBe('1.543 BHD');

      const summary = harness.tieOutEngine.evaluateTieOuts({
        currency: 'KWD',
        recordsByEntity: new Map([
          [
            'accounting-opening-balances',
            [
              { rowNumber: 2, values: { accountCode: '1030', debit: '30.375', credit: '0' } },
              { rowNumber: 3, values: { accountCode: '1050', debit: '12.656', credit: '0' } },
              { rowNumber: 4, values: { accountCode: '3010', debit: '0', credit: '43.031' } },
            ],
          ],
          [
            'sales-invoices',
            [
              { rowNumber: 2, values: { unitPrice: '10.125', quantity: 2.5 } },
              { rowNumber: 3, values: { unitPrice: '10.125', quantity: 0.5 } },
              { rowNumber: 4, values: { unitPrice: '99.999', quantity: 0 } },
            ],
          ],
          [
            'inventory-items',
            [
              { rowNumber: 2, values: { unitCost: '10.125', quantity: 1.25 } },
              { rowNumber: 3, values: { unitCost: '5.000', quantity: 0 } },
            ],
          ],
        ]),
      });

      expect(summary.items.find((i) => i.category === 'ACCOUNTS_RECEIVABLE')).toMatchObject({
        matched: false,
        expectedMoney: '30.375 KWD',
        actualMoney: '30.376 KWD',
        differenceMoney: '0.001 KWD',
      });
      expect(summary.items.find((i) => i.category === 'INVENTORY_STOCK')).toMatchObject({
        matched: true,
        expectedMoney: '12.656 KWD',
        actualMoney: '12.656 KWD',
      });
    });

    it('runs bank-statement tie-out in reconcilePackage, disambiguates overlapping names, and throws 400 on bad amounts/currencies', async () => {
      const zipBuf = Buffer.from(
        zipSync({
          'opening.csv': strToU8(
            'کد حساب,شرح,بدهکار,بستانکار\n1020,بانک - وصولی دریافتنی,8000000,0\n9999,بانک انبار,1000000,0\n3010,سرمایه,0,9000000\n',
          ),
          'bank.csv': strToU8(
            'تاریخ,شرح,واریز,برداشت,مانده\n1403/07/01,واریز,8000000,0,8000000\n1403/07/02,برداشت,0,500000,7500000\n',
          ),
        }),
      );
      const created = await harness.service.createPackage(TENANT_ID, {
        originalname: 'tb_and_bank.zip',
        buffer: zipBuf,
      });

      const report = await harness.service.reconcile(TENANT_ID, created.packageId, {
        tables: [
          {
            name: 'opening',
            entity: 'accounting-opening-balances',
            mapping: { 'کد حساب': 'accountCode', شرح: 'description', بدهکار: 'debit', بستانکار: 'credit' },
          },
          {
            name: 'bank',
            entity: 'bank-statement',
            mapping: { تاریخ: 'date', شرح: 'description', واریز: 'deposit', برداشت: 'withdrawal', مانده: 'balance' },
          },
        ],
      });
      expect(report.balanced).toBe(false);
      expect(report.tieOut?.items.find((i) => i.category === 'BANK_BALANCE')).toMatchObject({
        matched: false,
        expectedMinor: '8000000',
        actualMinor: '7500000',
        differenceMinor: '-500000',
      });
      expect(report.tieOut?.items.find((i) => i.category === 'ACCOUNTS_RECEIVABLE')).toBeUndefined();
      expect((report.tieOut?.warningsFa ?? []).some((w) => w.includes('9999'))).toBe(false);

      expect(() => parseMoneyValue('not-a-number', 'IRR')).toThrow(BadRequestException);
      expect(() => parseMoneyValue('10.5', 'IRR')).toThrow(BadRequestException);
      expect(() => harness.tieOutEngine.evaluateTieOuts({ recordsByEntity: new Map(), currency: 'FAKE' })).toThrow(BadRequestException);
    });
  });
});
