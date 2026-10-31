import { ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AccountingJournalLinesRegistry } from './registry/accounting-journal-lines.registry';
import { BankStatementRegistry } from './registry/bank-statement.registry';
import { EntityRegistryService } from './registry/entity-registry.service';
import { ChunkedUploadService } from './services/chunked-upload.service';
import { MappingMemoryService } from './services/mapping-memory.service';
import { PackageAnalysisService } from './services/package-analysis.service';
import { PackageCommitService } from './services/package-commit.service';
import { PackageImportService } from './services/package-import.service';
import { PackageProgressService } from './services/package-progress.service';
import { PackageReconciliationService } from './services/package-reconciliation.service';
import { PackageStoreService } from './services/package-store.service';
import { maskValue } from './masking';
import { matchSourceProfile } from './readers/profiles/source-profiles';

const FIX = path.join(__dirname, '__fixtures__', 'formats');
const load = (name: string): Buffer => fs.readFileSync(path.join(FIX, name));

interface Harness {
  service: PackageImportService;
  store: PackageStoreService;
  chunked: ChunkedUploadService;
  journalCalls: Array<{ lines: unknown[] }>;
  remembered: Map<string, { entity: string; mapping: Record<string, string | null> }>;
  commitSpy: jest.SpyInstance;
  root: string;
}

function build(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-universal-'));
  process.env.IMPORT_TMP_DIR = root;
  const journalCalls: Array<{ lines: unknown[] }> = [];
  const accounting = {
    createJournalEntry: async (_t: string, dto: { lines: unknown[] }) => {
      journalCalls.push(dto);
      return { id: journalCalls.length };
    },
    removeImportedJournalEntries: async () => ({ removed: 0 }),
  };
  const bank = { createStatementLines: async () => [] };
  const registry = new EntityRegistryService([
    new AccountingJournalLinesRegistry(accounting as never),
    new BankStatementRegistry(bank as never),
  ] as never);

  const remembered = new Map<string, { entity: string; mapping: Record<string, string | null> }>();
  const memory = {
    recall: async (_t: string, sig: string) => remembered.get(sig) ?? null,
    remember: async (_t: string, sig: string, entity: string, mapping: Record<string, string | null>) => {
      remembered.set(sig, { entity, mapping });
    },
  } as unknown as MappingMemoryService;

  const store = new PackageStoreService();
  const analysis = new PackageAnalysisService(store, registry, memory);
  const progress = new PackageProgressService();
  const batchRepo = {
    createBatch: async () => undefined,
    setInserted: async () => undefined,
    removeBatch: async () => undefined,
    addItems: async () => undefined,
  };
  const commit = new PackageCommitService(store, analysis, registry, progress, batchRepo as never, memory);
  const commitSpy = jest.spyOn(commit, 'commit');
  const quota = { assertWithinQuota: async () => undefined, recordImport: async () => undefined };
  const reconciliation = new PackageReconciliationService(store, analysis, registry);
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
  return { service, store, chunked, journalCalls, remembered, commitSpy, root };
}

const T = '11111111-1111-4111-8111-111111111111';
const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(',')).join('\n') + '\n');
const HEAD = ['شماره سند', 'تاریخ', 'کد حساب', 'بدهکار', 'بستانکار'];

afterEach(() => {
  delete process.env.IMPORT_TMP_DIR;
  delete process.env.IMPORT_MAX_FILE_BYTES;
  delete process.env.IMPORT_MIN_FREE_DISK_BYTES;
  delete process.env.IMPORT_TMP_MAX_BYTES;
});

describe('reconciliation and the imbalance gate', () => {
  const selection = (name: string, extra: Record<string, unknown> = {}): { tables: never[]; confirmImbalance?: boolean } => ({
    tables: [{ name, entity: 'accounting-journal-lines', mapping: {}, ...extra }] as never[],
  });

  it('a balanced journal reconciles and commits', async () => {
    const h = build();
    const created = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500', '0'], ['1', '1403/07/15', '4101', '0', '500']]),
    });
    const status = await h.service.getPackage(T, created.packageId);
    expect(status.status).toBe('ready');
    expect(status.tables[0].detectedEntity).toBe('accounting-journal-lines');
    const report = await h.service.reconcile(T, created.packageId, selection('data'));
    expect(report.balanced).toBe(true);
    expect(report.tables[0]).toMatchObject({ rowCount: 2, validRows: 2, invalidRows: 0 });
    expect(report.totals).toEqual({ debit: 500, credit: 500, difference: 0 });
    await h.service.commitPackage(T, created.packageId, selection('data'));
    expect(h.journalCalls).toHaveLength(1);
  });

  it('an unbalanced voucher blocks the commit with a 409 and a report', async () => {
    const h = build();
    const created = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500', '0'], ['1', '1403/07/15', '4101', '0', '400']]),
    });
    const report = await h.service.reconcile(T, created.packageId, selection('data'));
    expect(report.balanced).toBe(false);
    expect(report.tables[0].unbalancedVouchers).toBe(1);
    expect(report.tables[0].unbalancedSample).toEqual([{ voucher: '1', difference: 100 }]);
    await expect(h.service.commitPackage(T, created.packageId, selection('data'))).rejects.toBeInstanceOf(ConflictException);
    expect(h.commitSpy).not.toHaveBeenCalled();
    expect(h.journalCalls).toHaveLength(0);
  });

  it('confirmImbalance without the owner/admin role does NOT unlock the commit', async () => {
    const h = build();
    const created = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500', '0']]),
    });
    await expect(
      h.service.commitPackage(T, created.packageId, { ...selection('data'), confirmImbalance: true }, { canOverrideImbalance: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.commitSpy).not.toHaveBeenCalled();
  });

  it('owner/admin can confirm; the ledger then still posts only what it accepts', async () => {
    const h = build();
    const created = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500', '0']]),
    });
    const res = await h.service.commitPackage(
      T,
      created.packageId,
      { ...selection('data'), confirmImbalance: true },
      { canOverrideImbalance: true, userId: 'owner-1' },
    );
    expect(res.batchId).toBeTruthy();
    expect(h.commitSpy).toHaveBeenCalledTimes(1);
  });

  it('toman: a unit written in the cells is detected and applied; plain numbers need the user choice', async () => {
    const h = build();
    const withUnit = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500 تومان', '0'], ['1', '1403/07/15', '4101', '0', '500 تومان']]),
    });
    const s1 = await h.service.getPackage(T, withUnit.packageId);
    expect(s1.tables[0].moneyUnit).toMatchObject({ unit: 'toman', toRial: 10 });
    expect((await h.service.reconcile(T, withUnit.packageId, selection('data'))).totals.debit).toBe(5000);

    const plain = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500', '0'], ['1', '1403/07/15', '4101', '0', '500']]),
    });
    expect((await h.service.reconcile(T, plain.packageId, selection('data'))).totals.debit).toBe(500);
    expect((await h.service.reconcile(T, plain.packageId, selection('data', { moneyToRial: 10 }))).totals.debit).toBe(5000);
  });

  it('unknown money unit is reported, never guessed', async () => {
    const h = build();
    const created = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([HEAD, ['1', '1403/07/15', '1101', '500', '0'], ['1', '1403/07/15', '4101', '0', '500']]),
    });
    const status = await h.service.getPackage(T, created.packageId);
    expect(status.tables[0].moneyUnit?.unit).toBe('unknown');
    const report = await h.service.reconcile(T, created.packageId, selection('data'));
    expect(report.warningsFa.join(' ')).toMatch(/ریال یا تومان/);
  });

  it('in-file duplicates and unmapped columns are counted', async () => {
    const h = build();
    const created = await h.service.createPackage(T, {
      originalname: 'j.csv',
      buffer: csv([
        [...HEAD, 'ستون اضافی'],
        ['1', '1403/07/15', '1101', '500', '0', 'x'],
        ['1', '1403/07/15', '4101', '0', '500', 'y'],
      ]),
    });
    const report = await h.service.reconcile(T, created.packageId, selection('data'));
    expect(report.tables[0].unmappedColumns).toEqual(['ستون اضافی']);
  });
});

describe('profiles, reader hints and the per-tenant mapping memory', () => {
  it('IIF gets its mapping from the reader (spec-defined), flagged as such', async () => {
    const h = build();
    const created = await h.service.createPackage(T, { originalname: 'q.iif', buffer: load('quickbooks.iif') });
    const status = await h.service.getPackage(T, created.packageId);
    const journal = status.tables.find((t) => t.name === 'JOURNAL');
    expect(journal).toMatchObject({ detectedEntity: 'accounting-journal-lines', mappingSource: 'reader' });
    expect(status.format?.id).toBe('iif');
  });

  it('OFX maps to the bank statement', async () => {
    const h = build();
    const created = await h.service.createPackage(T, { originalname: 'b.ofx', buffer: load('bank.ofx') });
    const status = await h.service.getPackage(T, created.packageId);
    expect(status.tables.find((t) => t.name === 'bank_transactions')).toMatchObject({
      detectedEntity: 'bank-statement',
      mappingSource: 'reader',
    });
  });

  it('Xero bank-statement CSV matches a profile that is honestly labelled heuristic', () => {
    const m = matchSourceProfile(['*Date', '*Amount', 'Payee', 'Description', 'Reference', 'Check Number']);
    expect(m?.profile.id).toBe('xero-bank-statement');
    expect(m?.profile.evidence).toBe('heuristic');
    expect(m?.mapping['*Date']).toBe('date');
    expect(m?.mapping['*Amount']).toBe('amount');
  });

  it('no profile exists for Sepidar/Hamkaran/Rahkaran/Mahak (no proven headers)', () => {
    expect(matchSourceProfile(['کد کالا', 'نام کالا', 'واحد', 'قیمت'])).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ids = require('./readers/profiles/source-profiles').SOURCE_PROFILES.map((p: { id: string; vendor: string }) => p.vendor.toLowerCase());
    for (const name of ['sepidar', 'hamkaran', 'rahkaran', 'mahak']) {
      expect(ids.join(' ')).not.toContain(name);
    }
  });

  it('a mapping the tenant confirmed is remembered and pre-applied to the next file with the same headers', async () => {
    const h = build();
    const headers = ['کد', 'ش.س', 'مبلغ بد', 'مبلغ بس']; // unrecognisable layout
    const first = await h.service.createPackage(T, {
      originalname: 'a.csv',
      buffer: csv([headers, ['1101', '1', '500', '0'], ['4101', '1', '0', '500']]),
    });
    const s1 = await h.service.getPackage(T, first.packageId);
    expect(s1.tables[0].mappingSource).not.toBe('memory');
    await h.service.commitPackage(T, first.packageId, {
      tables: [
        {
          name: 'data',
          entity: 'accounting-journal-lines',
          mapping: { 'کد': 'accountCode', 'ش.س': 'voucherNo', 'مبلغ بد': 'debitRial', 'مبلغ بس': 'creditRial' },
        },
      ],
    } as never);
    expect(h.remembered.size).toBe(1);

    const second = await h.service.createPackage(T, {
      originalname: 'b.csv',
      buffer: csv([[...headers].reverse(), ['0', '500', '1', '1101']]),
    });
    const s2 = await h.service.getPackage(T, second.packageId);
    expect(s2.tables[0]).toMatchObject({ mappingSource: 'memory', detectedEntity: 'accounting-journal-lines' });
    expect(s2.tables[0].mapping['کد']).toBe('accountCode');
  });
});

describe('chunked, resumable upload and folder / multi-file packages', () => {
  const MB = 1024 * 1024;

  async function send(h: Harness, data: Buffer, name: string, chunkSize = 256 * 1024, skip: number[] = []): Promise<string> {
    const init = await h.chunked.init(T, { fileName: name, size: data.length, chunkSize, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    for (let i = 0; i < init.totalChunks; i += 1) {
      if (skip.includes(i)) continue;
      await h.chunked.writeChunk(T, init.uploadId, i, data.subarray(i * init.chunkSize, (i + 1) * init.chunkSize));
    }
    return init.uploadId;
  }

  it('resumes after a dropped connection: status lists the missing chunks, resend is idempotent', async () => {
    const h = build();
    const data = crypto.randomBytes(256 * 1024 * 3 + 100);
    const id = await send(h, data, 'x.bin', 256 * 1024, [1]);
    const status = await h.chunked.status(T, id);
    expect(status).toMatchObject({ complete: false, missing: [1], totalChunks: 4 });
    await expect(h.chunked.complete(T, id)).rejects.toThrow(/هنوز نرسیده/);
    await h.chunked.writeChunk(T, id, 1, data.subarray(256 * 1024, 512 * 1024));
    await h.chunked.writeChunk(T, id, 1, data.subarray(256 * 1024, 512 * 1024)); // resend
    const done = await h.chunked.complete(T, id);
    expect(fs.readFileSync(done.filePath).equals(data)).toBe(true);
  });

  it('rejects a wrong-sized chunk, a bad index and a corrupted file (sha256)', async () => {
    const h = build();
    const data = crypto.randomBytes(256 * 1024 + 10);
    const init = await h.chunked.init(T, { fileName: 'x.bin', size: data.length, chunkSize: 256 * 1024, sha256: 'a'.repeat(64) });
    await expect(h.chunked.writeChunk(T, init.uploadId, 0, Buffer.alloc(5))).rejects.toThrow(/باید/);
    await expect(h.chunked.writeChunk(T, init.uploadId, 9, Buffer.alloc(5))).rejects.toThrow(/نامعتبر/);
    await h.chunked.writeChunk(T, init.uploadId, 0, data.subarray(0, 256 * 1024));
    await h.chunked.writeChunk(T, init.uploadId, 1, data.subarray(256 * 1024));
    await expect(h.chunked.complete(T, init.uploadId)).rejects.toThrow(/SHA-256/);
  });

  it('enforces the per-file cap, the disk-free floor and the temp-dir cap BEFORE creating anything', async () => {
    const h = build();
    process.env.IMPORT_MAX_FILE_BYTES = String(1 * MB);
    await expect(h.chunked.init(T, { fileName: 'big', size: 2 * MB })).rejects.toThrow(/حجم فایل/);
    delete process.env.IMPORT_MAX_FILE_BYTES;
    process.env.IMPORT_MIN_FREE_DISK_BYTES = String(Number.MAX_SAFE_INTEGER);
    await expect(h.chunked.init(T, { fileName: 'f', size: 10 })).rejects.toThrow(/فضای آزاد/);
    delete process.env.IMPORT_MIN_FREE_DISK_BYTES;
    process.env.IMPORT_TMP_MAX_BYTES = '100';
    await expect(h.chunked.init(T, { fileName: 'f', size: 1000 })).rejects.toThrow(/ظرفیت موقت/);
    expect(fs.readdirSync(h.root).filter((n) => n.startsWith('up-'))).toEqual([]);
  });

  it('is tenant-scoped: another tenant (or a forged id) cannot see or write an upload', async () => {
    const h = build();
    const id = await send(h, Buffer.from('a,b\n1,2\n'), 'x.csv', 256 * 1024);
    await expect(h.chunked.status('22222222-2222-4222-8222-222222222222', id)).rejects.toThrow(/یافت نشد/);
    await expect(h.chunked.status(T, '../../etc/passwd')).rejects.toThrow(/یافت نشد/);
  });

  it('sanitises the client file name', async () => {
    const h = build();
    const init = await h.chunked.init(T, { fileName: '../../etc/passwd', size: 10 });
    await h.chunked.writeChunk(T, init.uploadId, 0, Buffer.alloc(10));
    const done = await h.chunked.complete(T, init.uploadId);
    expect(done.fileName).toBe('passwd');
    expect(done.filePath.startsWith(h.root)).toBe(true);
  });

  it('a dropped folder (several files, mixed formats) becomes one package with one table per file', async () => {
    const h = build();
    const ids = [
      await send(h, load('journal.csv'), 'folder/journal.csv'),
      await send(h, load('journal.xls'), 'folder/sub/journal2.xls'),
      await send(h, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]), 'folder/readme.exe'),
    ];
    const created = await h.service.createFromUploads(T, ids);
    const status = await h.service.getPackage(T, created.packageId);
    expect(status.status).toBe('ready');
    expect(status.tables.map((t) => t.name).sort()).toEqual(['journal', 'journal2__accounts', 'journal2__journal']);
    expect(status.format?.notes.join(' ')).toMatch(/readme\.exe/);
    // the temp upload dirs were moved/removed
    expect(fs.readdirSync(path.join(h.root, T)).filter((n) => n.startsWith('up-'))).toEqual([]);
  });

  it('a single large file goes through createFromUploads without being buffered by the API', async () => {
    const h = build();
    const big = Buffer.from('a,b\n' + '1,2\n'.repeat(200_000));
    const id = await send(h, big, 'big.csv', 256 * 1024);
    const created = await h.service.createFromUploads(T, [id]);
    const status = await h.service.getPackage(T, created.packageId);
    expect(status.tables[0].rowCount).toBe(200_000);
  });
});

describe('masking before any LLM call', () => {
  it('keeps the shape, drops the content', () => {
    expect(maskValue('09121234567')).toBe('99999999999');
    expect(maskValue('علی رضایی')).toBe('ااا ااااا');
    expect(maskValue('ali@example.com')).toBe('<email>');
    expect(maskValue('IR062960000000100324200001')).toBe('<id>');
    expect(maskValue('۱۲٬۰۰۰ ریال')).toBe('99٬999 اااا');
    expect(maskValue('')).toBe('');
  });
});

describe('header signature', () => {
  it('ignores column order and Arabic/Persian letter variants', () => {
    const { headerSignature } = require('./services/mapping-memory.service');
    expect(headerSignature(['کد', 'نام'])).toBe(headerSignature(['نام', 'كد']));
  });
});
