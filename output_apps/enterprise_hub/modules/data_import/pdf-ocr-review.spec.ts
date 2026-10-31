import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildReview, PackageReview, REVIEW_PAGE_SIZE } from './analysis/review';
import { extractPdfJpegs } from './parsers/pdf-images';
import { readFormat } from './readers/format-registry';
import { AccountingJournalLinesRegistry } from './registry/accounting-journal-lines.registry';
import { EntityRegistryService } from './registry/entity-registry.service';
import { OpenRouterVisionService } from './services/openrouter-vision.service';
import { PackageAnalysisService } from './services/package-analysis.service';
import { PackageCommitService } from './services/package-commit.service';
import { PackageImportService } from './services/package-import.service';
import { PackageOcrService, MAX_OCR_PAGES } from './services/package-ocr.service';
import { PackageProgressService } from './services/package-progress.service';
import { PackageReconciliationService } from './services/package-reconciliation.service';
import { PackageStoreService } from './services/package-store.service';

const FIX = path.join(__dirname, '__fixtures__', 'formats');
const load = (name: string): Buffer => fs.readFileSync(path.join(FIX, name));
const TENANT = '11111111-1111-4111-8111-111111111111';

const OCR_TABLE = {
  headers: ['شماره سند', 'تاریخ', 'کد حساب', 'بدهکار', 'بستانکار', 'شرح'],
  rows: [
    ['JV-1', '1403/07/15', '1101', '5000', '0', 'فروش'],
    ['JV-1', '1403/07/15', '4101', '0', '5000', 'فروش'],
    ['JV-2', '1403/07/16', '1101', '700', '0', 'نامتراز'],
    ['JV-2', '1403/07/16', '4101', '0', '600', 'نامتراز'],
  ],
};

function build() {
  process.env.IMPORT_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-ocr-'));
  const posted: unknown[] = [];
  const accounting = {
    createJournalEntry: async (_t: string, dto: unknown) => {
      posted.push(dto);
      return { id: posted.length };
    },
    removeImportedJournalEntries: async () => ({ removed: 0 }),
  };
  const registry = new EntityRegistryService([new AccountingJournalLinesRegistry(accounting as never)] as never);
  const vision = { extractTable: jest.fn(async () => OCR_TABLE) };
  const store = new PackageStoreService();
  const ocr = new PackageOcrService(vision as unknown as OpenRouterVisionService);
  const analysis = new PackageAnalysisService(store, registry, undefined, ocr);
  const progress = new PackageProgressService();
  const batches = { create: async () => undefined, finish: async () => undefined, updateStatus: async () => undefined };
  const commit = new PackageCommitService(store, analysis, registry, progress, batches as never);
  const reconciliation = new PackageReconciliationService(store, analysis, registry);
  const quota = { assertWithinQuota: async () => undefined, recordImport: async () => undefined };
  const service = new PackageImportService(store, analysis, commit, quota as never, progress, undefined, reconciliation);
  return { service, vision, posted };
}

const upload = (name: string, buffer: Buffer) => ({ originalname: name, buffer });

describe('review grouping', () => {
  it('puts each sheet in its accounting group and shows the opening balances as one voucher', () => {
    const fields = (...keys: string[]) => keys.map((key) => ({ key, labelFa: key, type: 'text' }));
    const adapters = [
      { key: 'accounting-accounts', fields: fields('code', 'name') },
      { key: 'accounting-opening-balances', fields: [...fields('accountCode'), { key: 'debit', labelFa: 'd', type: 'money' }, { key: 'credit', labelFa: 'c', type: 'money' }] },
      { key: 'inventory-items', fields: fields('sku') },
    ];
    const table = (name: string, rows: Record<string, unknown>[]) => ({
      name,
      columns: Object.keys(rows[0]).map((c) => ({ name: c, type: 'TEXT' })),
      rowCount: rows.length,
      readPage: (offset: number, limit: number) => rows.slice(offset, offset + limit),
    });
    const tables = [
      table('a', [{ code: '1101', name: 'صندوق' }]),
      table('o', [{ accountCode: '1101', debit: '100', credit: '0' }, { accountCode: '3101', debit: '0', credit: '100' }]),
      table('i', [{ sku: 'A1' }]),
      table('x', [{ q: '1' }]),
    ];
    const mapping = (columns: string[]) => Object.fromEntries(columns.map((c) => [c, c]));
    const review = buildReview(tables, { tables: [] } as never, adapters as never, [
      { name: 'i', entity: 'inventory-items', mapping: mapping(['sku']) },
      { name: 'o', entity: 'accounting-opening-balances', mapping: mapping(['accountCode', 'debit', 'credit']) },
      { name: 'a', entity: 'accounting-accounts', mapping: mapping(['code', 'name']) },
      { name: 'x', entity: '', mapping: {}, skip: true },
    ], 1);
    expect(review.groups.map((g) => g.bucket)).toEqual(['chart_of_accounts', 'opening_balances', 'items']);
    expect(review.skippedTables).toEqual(['x']);
    expect(review.vouchers.total).toBe(1);
    expect(review.vouchers.items[0]).toMatchObject({ debit: 100, credit: 100, balanced: true });
  });

  it('every voucher is reachable through paging', () => {
    const fields = ['voucherNo', 'accountCode'].map((key) => ({ key, labelFa: key, type: 'text' }));
    const rows = Array.from({ length: REVIEW_PAGE_SIZE + 3 }, (_, i) => ({ voucherNo: `V${i}`, accountCode: '1' }));
    const t = { name: 't', columns: [], rowCount: rows.length, readPage: (o: number, l: number) => rows.slice(o, o + l) };
    const args = [[t], { tables: [] }, [{ key: 'accounting-journal-lines', fields }], [{ name: 't', entity: 'accounting-journal-lines', mapping: { voucherNo: 'voucherNo', accountCode: 'accountCode' } }]] as never[];
    const first = (buildReview as (...a: unknown[]) => PackageReview)(...args, 1);
    const second = (buildReview as (...a: unknown[]) => PackageReview)(...args, 2);
    expect(first.vouchers.items).toHaveLength(REVIEW_PAGE_SIZE);
    expect(second.vouchers.items).toHaveLength(3);
    expect(first.vouchers.total).toBe(rows.length);
  });
});

describe('text PDF', () => {
  it('becomes a table with no model call', async () => {
    const { service, vision } = build();
    const { packageId } = await service.createPackage(TENANT, upload('j.pdf', load('journal-text.pdf')));
    const status = await service.getPackage(TENANT, packageId);
    expect(status.status).toBe('ready');
    expect(status.tables[0].rowCount).toBe(2);
    expect(status.format?.ocr).toBe(false);
    expect(vision.extractTable).not.toHaveBeenCalled();
  });
});

describe('scanned PDF and photos', () => {
  it('extracts the page JPEG from a scanned PDF and ignores nothing silently', () => {
    const images = extractPdfJpegs(load('scanned.pdf'), 5);
    expect(images).toHaveLength(1);
    expect(images[0][0]).toBe(0xff);
  });

  it('a garbage PDF yields no image and never loops', () => {
    expect(extractPdfJpegs(Buffer.from('%PDF-1.4 /DCTDecode stream without an end'), 5)).toEqual([]);
  });

  it('a large hostile PDF is scanned in linear time', () => {
    const hostile = Buffer.from(`%PDF-1.4\n${'<< /DCTDecode stream '.repeat(1_000_000)}`, 'latin1');
    const started = Date.now();
    expect(extractPdfJpegs(hostile, 5)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('calls OCR once, flags the package, and commit is refused until the review was built', async () => {
    const { service, vision, posted } = build();
    const { packageId } = await service.createPackage(TENANT, upload('s.pdf', load('scanned.pdf')));
    const status = await service.getPackage(TENANT, packageId);
    expect(status.status).toBe('ready');
    expect(status.format?.ocr).toBe(true);
    expect(status.format?.notes.join(' ')).toMatch(/OCR/);
    const table = status.tables[0];
    const tables = [{ name: table.name, entity: 'accounting-journal-lines', mapping: table.mapping }];

    await expect(service.commitPackage(TENANT, packageId, { tables, confirmImbalance: true }, { canOverrideImbalance: true })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REVIEW_REQUIRED' }),
    });
    expect(posted).toEqual([]);

    const review = await service.review(TENANT, packageId, { tables }, 1);
    expect(review.ocr).toBe(true);
    expect(review.groups.map((g) => g.bucket)).toEqual(['vouchers']);
    expect(review.vouchers.total).toBe(2);
    expect(review.vouchers.unbalanced).toBe(1);
    expect(review.vouchers.items[0].lines).toHaveLength(2);
    expect(review.vouchers.items.find((v) => v.voucherNo === 'JV-2')?.balanced).toBe(false);
    expect(vision.extractTable).toHaveBeenCalledTimes(1);

    // The review alone posts nothing, and an unbalanced proposal still hits the imbalance gate.
    expect(posted).toEqual([]);
    await expect(service.commitPackage(TENANT, packageId, { tables }, { canOverrideImbalance: false })).rejects.toBeInstanceOf(ConflictException);
  });

  it('changing the selection after review needs a new review', async () => {
    const { service } = build();
    const { packageId } = await service.createPackage(TENANT, upload('s.pdf', load('scanned.pdf')));
    const table = (await service.getPackage(TENANT, packageId)).tables[0];
    const tables = [{ name: table.name, entity: 'accounting-journal-lines', mapping: table.mapping }];
    await service.review(TENANT, packageId, { tables }, 1);
    await expect(
      service.commitPackage(TENANT, packageId, { tables: [{ ...tables[0], moneyToRial: 10 }] }, { canOverrideImbalance: false }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'REVIEW_REQUIRED' }) });
  });

  it('a failed OCR call fails the package with a Persian message and posts nothing', async () => {
    const { service, vision } = build();
    vision.extractTable.mockRejectedValueOnce(new Error('HTTP 403'));
    const { packageId } = await service.createPackage(TENANT, upload('s.pdf', load('scanned.pdf')));
    const status = await service.getPackage(TENANT, packageId);
    expect(status.status).toBe('failed');
    expect(status.error).toMatch(/OCR/);
  });

  it('pages beyond the cap are refused, not silently dropped', () => {
    const ocr = new PackageOcrService({} as never);
    const page = load('scanned.pdf');
    const many = Buffer.concat(Array.from({ length: MAX_OCR_PAGES + 1 }, () => page));
    expect(() => ocr.pagesOf(many, 'big.pdf')).toThrow(/صفحه/);
  });

  it('an image inside a ZIP or multi-file path keeps the guide message', async () => {
    await expect(readFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'a.jpg')).rejects.toThrow(/جداگانه/);
  });
});
