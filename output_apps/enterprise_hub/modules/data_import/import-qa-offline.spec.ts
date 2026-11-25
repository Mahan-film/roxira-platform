import { BadRequestException } from '@nestjs/common';
import { deflateRawSync } from 'zlib';
import { EffectiveTieOutConfigRegistry } from './analysis/effective-tie-out-config.registry';
import { ImportTieOutEngine, parseMoneyValue } from './analysis/import-tie-out.engine';
import { parseMoneyRials } from './normaliser/normalise';
import { parseCsv } from './parsers/csv.parser';
import { parseXlsx } from './parsers/xlsx.parser';
import { EntityRegistryService } from './registry/entity-registry.service';
import { EntityImportAdapter, NormalisedRecord } from './registry/import-registry.types';
import { DataImportBatchRepository } from './repositories/data-import-batch.repository';
import { DailyImportQuotaService } from './services/daily-import-quota.service';
import { EntityImportService } from './services/entity-import.service';
import { OpenRouterMappingService } from './services/openrouter-mapping.service';
import { UploadStoreService } from './services/upload-store.service';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data);
    const utf8Flag = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function colLetter(index: number): string {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function buildXlsxBuffer(rows: string[][]): Buffer {
  const sheetRows = rows
    .map((cells, rIdx) => {
      const rowNum = rIdx + 1;
      const cellsXml = cells
        .map((cell, cIdx) => {
          const ref = `${colLetter(cIdx)}${rowNum}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}">${cellsXml}</row>`;
    })
    .join('');

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="${NS}"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const relsXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;

  return makeZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') },
  ]);
}

describe('Offline Import QA (#1418): malformed money cells, Persian digits, duplicate batches', () => {
  describe('Malformed XLSX/CSV money cells (Lesson 28: throw 400 with column and row)', () => {
    it('parseMoneyValue never returns 0n on non-empty malformed money strings', () => {
      for (const bad of ['ریال', 'تومان', '---', '()', '12abc34', 'not-a-number', '10.5']) {
        expect(() => parseMoneyValue(bad, 'IRR')).toThrow(BadRequestException);
      }
    });

    it('throws 400 citing column and row number when CSV has a malformed money cell in tie-out', () => {
      const csv = [
        'accountCode,debit,credit',
        '1100,1000000,0',
        '2100,۱۲abc,1000000',
      ].join('\n');
      const parsed = parseCsv(csv, 100);
      const records = parsed.rows.map((row, idx) => ({
        rowNumber: idx + 2,
        values: {
          accountCode: row[0],
          debit: row[1],
          credit: row[2],
        },
      }));

      const engine = new ImportTieOutEngine(new EffectiveTieOutConfigRegistry());
      let thrown: unknown;
      try {
        engine.evaluateTieOuts({
          recordsByEntity: new Map([['accounting-opening-balances', records]]),
          currency: 'IRR',
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getStatus()).toBe(400);
      expect((thrown as BadRequestException).message).toContain('debit');
      expect((thrown as BadRequestException).message).toContain('3');
    });

    it('throws 400 citing column and row number when XLSX has a malformed money cell in tie-out', () => {
      const xlsx = buildXlsxBuffer([
        ['invoiceNo', 'totalAmount'],
        ['INV-1', '۵٬۰۰۰٬۰۰۰ ریال'],
        ['INV-2', 'ریال'],
      ]);
      const parsed = parseXlsx(xlsx);
      const records = parsed.rows.map((row, idx) => ({
        rowNumber: idx + 2,
        values: {
          invoiceNo: row[0],
          totalAmount: row[1],
        },
      }));

      const engine = new ImportTieOutEngine(new EffectiveTieOutConfigRegistry());
      let thrown: unknown;
      try {
        engine.evaluateTieOuts({
          recordsByEntity: new Map<string, NormalisedRecord[]>([
            ['accounting-opening-balances', [{ rowNumber: 2, values: { accountCode: '1103', debit: '5000000', credit: '0' } }]],
            ['sales-invoices', records],
          ]),
          currency: 'IRR',
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getStatus()).toBe(400);
      expect((thrown as BadRequestException).message).toContain('totalAmount');
      expect((thrown as BadRequestException).message).toContain('3');
    });

    it('parseMoneyRials returns null (never 0 or partial digits) on malformed cells', () => {
      expect(parseMoneyRials('12abc34')).toBeNull();
      expect(parseMoneyRials('ریال')).toBeNull();
      expect(parseMoneyRials('--100')).toBeNull();
      expect(parseMoneyRials('10.20.30')).toBeNull();
      expect(parseMoneyRials('not-a-number')).toBeNull();
    });
  });

  describe('Persian and Arabic-Indic digits in amounts', () => {
    it('parses Persian/Arabic digits, thousand separators, decimal slash, and Toman conversion', () => {
      expect(parseMoneyRials('۱۲٬۵۰۰٬۰۰۰ ریال')).toBe(12500000);
      expect(parseMoneyRials('۲٬۵۰۰٬۰۰۰ تومان')).toBe(25000000);
      expect(parseMoneyRials('١٢٣٬٤٥٦')).toBe(123456);
      expect(parseMoneyRials('(۱٬۰۰۰)')).toBe(-1000);
      expect(parseMoneyRials('۱۰٫۰')).toBe(10);

      expect(parseMoneyValue('۱۲٬۵۰۰٬۰۰۰ ریال', 'IRR')).toBe(12500000n);
      expect(parseMoneyValue('۲٬۵۰۰٬۰۰۰ تومان', 'IRR')).toBe(25000000n);
      expect(parseMoneyValue('۱٬۲۳۴٫۵۶', 'USD')).toBe(123456n);
      expect(parseMoneyValue('١٢٣٬٤٥٦', 'IRR')).toBe(123456n);
    });

    it('evaluates balanced trial balance from XLSX with Persian-digit amounts', () => {
      const xlsx = buildXlsxBuffer([
        ['accountCode', 'debit', 'credit'],
        ['1103', '۱۲٬۵۰۰٬۰۰۰ ریال', '۰'],
        ['3100', '۰', '۱٬۲۵۰٬۰۰۰ تومان'],
      ]);
      const parsed = parseXlsx(xlsx);
      const records = parsed.rows.map((row, idx) => ({
        rowNumber: idx + 2,
        values: { accountCode: row[0], debit: row[1], credit: row[2] },
      }));

      const engine = new ImportTieOutEngine(new EffectiveTieOutConfigRegistry());
      const report = engine.evaluateTieOuts({
        recordsByEntity: new Map([['accounting-opening-balances', records]]),
        currency: 'IRR',
      });

      expect(report.passed).toBe(true);
      expect(report.items[0].actualMinor).toBe('12500000');
      expect(report.items[0].expectedMinor).toBe('12500000');
    });
  });

  describe('Duplicate import batches (offline EntityImportService)', () => {
    function makeImportHarness() {
      const adapter: jest.Mocked<EntityImportAdapter> = {
        key: 'sales-invoices',
        labelFa: 'فاکتور فروش',
        fields: [
          { key: 'invoiceNumber', labelFa: 'شماره فاکتور', required: true, type: 'text', synonyms: ['invoiceNumber', 'شماره فاکتور'] },
          { key: 'totalAmount', labelFa: 'مبلغ کل', required: true, type: 'money', synonyms: ['totalAmount', 'مبلغ کل'] },
        ],
        duplicateKeys: jest.fn((r) => [String(r.values.invoiceNumber)]),
        findExistingDuplicateKeys: jest.fn().mockResolvedValue([]),
        commit: jest.fn().mockResolvedValue({
          inserted: [{ ownerId: 'inv-1', rowNumber: 2 }],
          failed: [],
        }),
        undo: jest.fn(),
      };

      const registry = {
        all: jest.fn().mockReturnValue([adapter]),
        get: jest.fn((key: string) => (key === 'sales-invoices' ? adapter : null)),
        descriptors: jest.fn().mockReturnValue([]),
        keys: jest.fn().mockReturnValue(['sales-invoices']),
      } as unknown as EntityRegistryService;

      const openRouter = {
        proposeEntity: jest.fn().mockResolvedValue('sales-invoices'),
        proposeMappingForFields: jest.fn().mockResolvedValue({}),
      } as unknown as OpenRouterMappingService;

      const uploadStore = new UploadStoreService();
      const batchRepo = {
        tryReserveBatch: jest.fn(),
        createBatch: jest.fn().mockResolvedValue(undefined),
        addItems: jest.fn().mockResolvedValue(undefined),
        findBatch: jest.fn(),
        findByFileHash: jest.fn(),
        listBatches: jest.fn(),
        findItems: jest.fn(),
        setInserted: jest.fn().mockResolvedValue(undefined),
        removeBatch: jest.fn().mockResolvedValue(undefined),
        markUndone: jest.fn(),
        removeItems: jest.fn(),
      } as unknown as DataImportBatchRepository;

      const quota = {
        assertWithinQuota: jest.fn().mockResolvedValue(undefined),
        recordImport: jest.fn().mockResolvedValue(undefined),
      } as unknown as DailyImportQuotaService;

      const service = new EntityImportService(registry, openRouter, uploadStore, batchRepo, quota);
      return { service, adapter, batchRepo };
    }

    it('skips duplicate XLSX batch when tryReserveBatch returns false for same fileHash+mapping', async () => {
      const { service, adapter, batchRepo } = makeImportHarness();
      const xlsx = buildXlsxBuffer([
        ['شماره فاکتور', 'مبلغ کل'],
        ['INV-101', '۵٬۰۰۰٬۰۰۰ ریال'],
      ]);

      (batchRepo.tryReserveBatch as jest.Mock).mockResolvedValueOnce(true);
      const preview1 = await service.preview('tenant-1', {
        originalname: 'invoices.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: xlsx,
      }, 'sales-invoices');
      expect(preview1.errors).toEqual([]);

      const firstCommit = await service.commit('tenant-1', {
        uploadId: preview1.uploadId,
        entity: 'sales-invoices',
        mapping: { 'شماره فاکتور': 'invoiceNumber', 'مبلغ کل': 'totalAmount' },
      });
      expect(firstCommit.inserted).toBe(1);

      (batchRepo.tryReserveBatch as jest.Mock).mockResolvedValueOnce(false);
      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce({
        id: firstCommit.batchId,
        inserted: 1,
      });

      const preview2 = await service.preview('tenant-1', {
        originalname: 'invoices.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: xlsx,
      }, 'sales-invoices');
      const secondCommit = await service.commit('tenant-1', {
        uploadId: preview2.uploadId,
        entity: 'sales-invoices',
        mapping: { 'شماره فاکتور': 'invoiceNumber', 'مبلغ کل': 'totalAmount' },
      });

      expect(secondCommit).toEqual({
        batchId: firstCommit.batchId,
        inserted: 0,
        skippedDuplicates: 1,
        failed: [],
      });
      expect(adapter.commit).toHaveBeenCalledTimes(1);
    });

    it('reports malformed XLSX money cell row & field in preview without committing', async () => {
      const { service } = makeImportHarness();
      const xlsx = buildXlsxBuffer([
        ['شماره فاکتور', 'مبلغ کل'],
        ['INV-102', '۱۲abc۳۴'],
      ]);

      const preview = await service.preview('tenant-1', {
        originalname: 'bad-money.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: xlsx,
      }, 'sales-invoices');

      expect(preview.errors).toHaveLength(1);
      expect(preview.errors[0]).toMatchObject({
        row: 2,
        field: 'totalAmount',
      });
    });
  });
});
