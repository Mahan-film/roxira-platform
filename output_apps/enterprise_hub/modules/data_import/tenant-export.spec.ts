import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantExportService } from './services/tenant-export.service';
import { TenantRestoreService } from './services/tenant-restore.service';
import {
  TenantExportRepository,
  CORE_TENANT_TABLES,
} from './repositories/tenant-export.repository';
import { TenantRestoreRepository } from './repositories/tenant-restore.repository';
import { TenantExportController } from './controllers/tenant-export.controller';
import { TenantScope } from '../access/services/tenant-scope';
import { RestoreTenantDto } from './dto/restore-tenant.dto';

describe('Tenant Data Export & Restore / GoBD Z3 & EU Data Act (#230 / T77 / #1057 / T262 R26)', () => {
  let exportService: TenantExportService;
  let restoreService: TenantRestoreService;
  let restoreRepo: TenantRestoreRepository;
  let mockExportRepo: jest.Mocked<TenantExportRepository>;
  let mockTenantScope: jest.Mocked<TenantScope>;
  let controller: TenantExportController;

  const mockTenantId = '99999999-9999-9999-9999-999999999999';
  const targetTenantId = '88888888-8888-8888-8888-888888888888';

  const sampleTenantData = {
    fin_chart_of_accounts: [
      { id: 1, code: '1010', name: 'موجودی نقد و بانک', tenant_id: mockTenantId },
      { id: 2, code: '4010', name: 'فروش کالا', tenant_id: mockTenantId },
    ],
    fin_journal_entries: [
      { id: 1, entry_number: '1', date: '1405-01-01', tenant_id: mockTenantId },
    ],
    fin_journal_entry_lines: [
      { id: 1, journal_entry_id: 1, account_id: 1, debit: '1000', credit: '0', tenant_id: mockTenantId },
    ],
    erp_parties: [
      { id: 1, code: 'CUST-001', name: 'شرکت فناوران', tenant_id: mockTenantId },
      { id: 2, code: 'SUPP-001', name: 'بازرگانی پارس', tenant_id: mockTenantId },
    ],
    invoices: [
      { id: 1, tax_invoice_number: 'INV-01', total_amount: '50000', tenant_id: mockTenantId },
    ],
    fin_cheques: [
      { id: 1, sayad_number: '1234567890123456', amount: '20000', tenant_id: mockTenantId },
    ],
    erp_stock_items: [
      { id: 1, sku: 'ITEM-01', name: 'کالای نمونه الف', tenant_id: mockTenantId },
    ],
  };

  let mockExportQueue: { add: jest.Mock };

  beforeEach(() => {
    mockExportRepo = {
      fetchTenantData: jest.fn().mockResolvedValue(sampleTenantData),
    } as unknown as jest.Mocked<TenantExportRepository>;
    mockExportQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-export-1' }),
    };

    mockTenantScope = {
      within: jest.fn(async (tenantId: string, manager: any, work: (em: any) => Promise<any>) => {
        const mockEm = {
          query: jest.fn().mockResolvedValue([{ cnt: 0 }]),
        };
        return work(mockEm);
      }),
    } as unknown as jest.Mocked<TenantScope>;

    exportService = new TenantExportService(mockExportRepo);
    restoreRepo = new TenantRestoreRepository(mockTenantScope);
    restoreService = new TenantRestoreService(restoreRepo);
    controller = new TenantExportController(exportService, restoreService, mockExportQueue as any);
  });

  describe('Tenant Isolation & Repository', () => {
    it('CORE_TENANT_TABLES contains all 7 core tables with FORCE RLS', () => {
      expect(CORE_TENANT_TABLES).toEqual([
        'fin_chart_of_accounts',
        'fin_journal_entries',
        'fin_journal_entry_lines',
        'erp_parties',
        'invoices',
        'fin_cheques',
        'erp_stock_items',
      ]);
    });

    it('TenantExportRepository executes queries strictly inside TenantScope with tenant_id filter', async () => {
      const recordedQueries: Array<{ sql: string; params: any[] }> = [];
      const mockEntityManager = {
        query: jest.fn(async (sql: string, params: any[]) => {
          recordedQueries.push({ sql, params });
          return [{ id: 1, tenant_id: mockTenantId }];
        }),
      };

      const mockScope = {
        within: jest.fn(async (tenantId: string, manager: any, work: (em: any) => Promise<any>) => {
          return work(mockEntityManager);
        }),
      } as unknown as TenantScope;

      const repo = new TenantExportRepository(mockScope);
      const data = await repo.fetchTenantData(mockTenantId);

      expect(mockScope.within).toHaveBeenCalledWith(mockTenantId, undefined, expect.any(Function));
      expect(recordedQueries).toHaveLength(7);
      for (const q of recordedQueries) {
        expect(q.sql).toContain('WHERE "tenant_id" = $1');
        expect(q.params).toEqual([mockTenantId]);
      }
      expect(Object.keys(data)).toHaveLength(7);
    });
  });

  describe('Formula Injection Neutralization (Lesson 9 / #686)', () => {
    it('neutralizes =, +, -, @, and control characters at the start of cells', () => {
      expect(exportService.sanitizeCellForSpreadsheet('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(exportService.sanitizeCellForSpreadsheet('+100')).toBe("'+100");
      expect(exportService.sanitizeCellForSpreadsheet('-500')).toBe("'-500");
      expect(exportService.sanitizeCellForSpreadsheet('@cmd')).toBe("'@cmd");
      expect(exportService.sanitizeCellForSpreadsheet('\tTabbedVal')).toBe("'\tTabbedVal");
      expect(exportService.sanitizeCellForSpreadsheet('\rCarriage')).toBe("'\rCarriage");
    });

    it('neutralizes formula injection even with leading spaces or newlines', () => {
      expect(exportService.sanitizeCellForSpreadsheet('   =1+1')).toBe("'   =1+1");
      expect(exportService.sanitizeCellForSpreadsheet('\n  @cmd')).toBe("'\n  @cmd");
      expect(exportService.sanitizeCellForSpreadsheet('\u00A0=SUM(A1)')).toBe("'\u00A0=SUM(A1)");
      expect(exportService.sanitizeCellForSpreadsheet('\u00A0+100')).toBe("'\u00A0+100");
    });

    it('leaves standard strings, numbers, and Persian text unaltered', () => {
      expect(exportService.sanitizeCellForSpreadsheet('حساب‌های دریافتنی')).toBe('حساب‌های دریافتنی');
      expect(exportService.sanitizeCellForSpreadsheet('INV-1403-999')).toBe('INV-1403-999');
      expect(exportService.sanitizeCellForSpreadsheet(1250000)).toBe('1250000');
      expect(exportService.sanitizeCellForSpreadsheet(null)).toBe('');
      expect(exportService.sanitizeCellForSpreadsheet(undefined)).toBe('');
    });
  });

  describe('Full JSON Archive Export', () => {
    it('exports structured JSON archive with SHA-256 checksum and metadata', async () => {
      const archive = await exportService.exportTenantJson(mockTenantId);

      expect(archive.metadata.tenantId).toBe(mockTenantId);
      expect(archive.metadata.version).toBe('1.0');
      expect(archive.metadata.checksum).toHaveLength(64);
      expect(archive.metadata.tableCounts.fin_chart_of_accounts).toBe(2);
      expect(archive.metadata.tableCounts.erp_parties).toBe(2);
      expect(archive.data.fin_chart_of_accounts).toHaveLength(2);
      expect(archive.data.invoices).toHaveLength(1);
    });
  });

  describe('Tabular / Excel Sheets Export', () => {
    it('generates sanitized tabular rows and headers per table', async () => {
      const tabular = await exportService.exportTenantTabular(mockTenantId);

      expect(tabular.metadata.tenantId).toBe(mockTenantId);
      const accountsTable = tabular.tables.fin_chart_of_accounts;
      expect(accountsTable.headers).toEqual(['id', 'code', 'name', 'tenant_id']);
      expect(accountsTable.rows).toHaveLength(2);
      expect(accountsTable.rows[0]).toEqual(['1', '1010', 'موجودی نقد و بانک', mockTenantId]);
    });
  });

  describe('Full ZIP Archive Export (T148)', () => {
    it('generates full ZIP archive containing CSVs, JSONs, and metadata.json with SHA-256', async () => {
      mockExportRepo.fetchAllTenantData = jest.fn().mockResolvedValue(sampleTenantData);

      const res = await exportService.generateFullExportZip(mockTenantId);

      expect(mockExportRepo.fetchAllTenantData).toHaveBeenCalledWith(mockTenantId);
      expect(res.buffer).toBeInstanceOf(Buffer);
      expect(res.filename).toContain(`tenant-export-${mockTenantId.slice(0, 8)}-`);
      expect(res.metadata.checksum).toHaveLength(64);
      expect(Object.keys(res.metadata.tableCounts).length).toBeGreaterThan(0);
    });
  });

  describe('GoBD Z3 / EU Data Act Export (#1057 / T262 R26)', () => {
    it('generates GDPdU-conformant index.xml with media, table descriptors, and primary keys', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      expect(archive.indexXml).toBeDefined();
      expect(archive.indexXml).toContain('gdpdu-01-09-2004.dtd');
      expect(archive.indexXml).toContain('<DataSet>');
      expect(archive.indexXml).toContain('<URL>accounting/fin_chart_of_accounts.csv</URL>');
      expect(archive.indexXml).toContain('<URL>commercial/erp_parties.csv</URL>');
      expect(archive.indexXml).toContain('<URL>treasury/fin_cheques.csv</URL>');
      expect(archive.indexXml).toContain('<URL>inventory/erp_stock_items.csv</URL>');
      expect(archive.indexXml).toContain('<ColumnDelimiter>;</ColumnDelimiter>');
      expect(archive.indexXml).toContain('<RecordDelimiter>&#13;&#10;</RecordDelimiter>');
      expect(archive.indexXml).toContain('<VariablePrimaryKey>');
    });

    it('generates per-module CSV files with semicolon delimiters and formula sanitization', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const accountsCsv = archive.files['accounting/fin_chart_of_accounts.csv'];
      expect(accountsCsv).toBeDefined();
      expect(accountsCsv).toContain('id;code;name;tenant_id');
      expect(accountsCsv).toContain('1;1010;موجودی نقد و بانک;');
      expect(accountsCsv.endsWith('\r\n')).toBe(true);

      const partiesCsv = archive.files['commercial/erp_parties.csv'];
      expect(partiesCsv).toBeDefined();
      expect(partiesCsv).toContain('CUST-001;شرکت فناوران;');
    });

    it('generates per-module JSON files with intact data payloads', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const accountsJson = JSON.parse(archive.files['accounting/fin_chart_of_accounts.json']);
      expect(accountsJson).toHaveLength(2);
      expect(accountsJson[0].code).toBe('1010');

      const invoicesJson = JSON.parse(archive.files['commercial/invoices.json']);
      expect(invoicesJson).toHaveLength(1);
      expect(invoicesJson[0].tax_invoice_number).toBe('INV-01');
    });

    it('builds manifest with verifiable SHA-256 hashes and rootHash covering every file', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      const manifest = archive.manifest;

      expect(manifest.tenantId).toBe(mockTenantId);
      expect(manifest.version).toBe('GoBD-Z3/2026');
      expect(manifest.standard).toContain('EU Data Act');
      expect(manifest.rootHash).toHaveLength(64);
      expect(manifest.files.length).toBeGreaterThanOrEqual(15); // index.xml + 7 csv + 7 json

      // Verify every file's hash against actual content in archive.files
      for (const entry of manifest.files) {
        const fileContent = archive.files[entry.path];
        expect(fileContent).toBeDefined();
        const expectedHash = crypto.createHash('sha256').update(fileContent, 'utf8').digest('hex');
        expect(entry.sha256).toBe(expectedHash);
        expect(entry.sizeBytes).toBe(Buffer.byteLength(fileContent, 'utf8'));
      }
    });
  });

  describe('TenantRestoreService (Tamper-Detection, Isolation & Restore #1057)', () => {
    it('verifies archive integrity successfully for an authentic export bundle', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      expect(() => restoreService.verifyArchiveIntegrity(archive)).not.toThrow();
    });

    it('fails closed with BadRequestException if a file content is tampered with', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      // Maliciously tamper with accounting CSV
      archive.files['accounting/fin_chart_of_accounts.csv'] += ';tampered_injection';

      expect(() => restoreService.verifyArchiveIntegrity(archive)).toThrow(BadRequestException);
      expect(() => restoreService.verifyArchiveIntegrity(archive)).toThrow(
        /Archive tamper detected: checksum mismatch for accounting\/fin_chart_of_accounts\.csv/,
      );
    });

    it('fails closed with BadRequestException if manifest rootHash is tampered with', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      archive.manifest.rootHash = '0000000000000000000000000000000000000000000000000000000000000000';

      expect(() => restoreService.verifyArchiveIntegrity(archive)).toThrow(BadRequestException);
      expect(() => restoreService.verifyArchiveIntegrity(archive)).toThrow(/Archive tamper detected: root hash mismatch/);
    });

    it('fails closed with BadRequestException if a declared file is missing from archive', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      delete archive.files['accounting/fin_chart_of_accounts.csv'];

      expect(() => restoreService.verifyArchiveIntegrity(archive)).toThrow(BadRequestException);
      expect(() => restoreService.verifyArchiveIntegrity(archive)).toThrow(/declared file missing/);
    });

    it('restores records into targetTenantId and strictly enforces target tenant isolation', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const insertedQueries: Array<{ sql: string; values: any[] }> = [];
      const mockEm = {
        query: jest.fn(async (sql: string, values: any[]) => {
          if (sql.includes('COUNT(*)')) return [{ cnt: 0 }];
          insertedQueries.push({ sql, values });
          return [{ 1: 1 }]; // Row inserted
        }),
      };

      (mockTenantScope.within as jest.Mock).mockImplementation(
        async (tId: string, manager: any, work: (em: any) => Promise<any>) => work(mockEm),
      );

      const result = await restoreService.restoreTenantFromExport(targetTenantId, archive);

      expect(mockTenantScope.within).toHaveBeenCalledWith(targetTenantId, undefined, expect.any(Function));
      expect(result.success).toBe(true);
      expect(result.targetTenantId).toBe(targetTenantId);
      expect(result.totalRecordsRestored).toBe(9); // 2 accounts + 1 entry + 1 line + 2 parties + 1 invoice + 1 cheque + 1 item
      expect(result.totalRecordsSkipped).toBe(0);
      expect(result.restoredTables.fin_chart_of_accounts).toBe(2);
      expect(result.restoredTables.erp_parties).toBe(2);

      // Verify EVERY single inserted query overwrote tenant_id with targetTenantId
      expect(insertedQueries.length).toBe(9);
      for (const q of insertedQueries) {
        expect(q.sql).toContain('INSERT INTO');
        expect(q.sql).toContain('RETURNING 1');
        expect(q.values).toContain(targetTenantId);
        expect(q.values).not.toContain(mockTenantId); // Source tenant ID strictly wiped/overwritten
      }
    });

    it('counts inserted vs conflicting/skipped rows when ON CONFLICT DO NOTHING takes effect', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const mockEm = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('COUNT(*)')) return [{ cnt: 0 }];
          // Return empty array to simulate conflict skip
          return [];
        }),
      };

      (mockTenantScope.within as jest.Mock).mockImplementation(
        async (tId: string, manager: any, work: (em: any) => Promise<any>) => work(mockEm),
      );

      const result = await restoreService.restoreTenantFromExport(targetTenantId, archive);
      expect(result.success).toBe(true);
      expect(result.totalRecordsRestored).toBe(0);
      expect(result.totalRecordsSkipped).toBe(9);
      expect(result.skippedTables.fin_chart_of_accounts).toBe(2);
    });

    it('rejects restore with SQL injection attempt in column names (Lessons 9, 20)', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      // Craft malicious column in accounting JSON
      const badJson = JSON.stringify([
        { id: 1, 'code"); DROP TABLE users; --': '1010', name: 'Bad' },
      ]);
      archive.files['accounting/fin_chart_of_accounts.json'] = badJson;
      // Re-hash so integrity check passes and catches the SQL injection in restoreRepo
      const hash = crypto.createHash('sha256').update(badJson, 'utf8').digest('hex');
      archive.manifest.files.find((f) => f.path === 'accounting/fin_chart_of_accounts.json')!.sha256 = hash;
      delete (archive.manifest as any).rootHash; // skip rootHash check

      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive),
      ).rejects.toThrow(BadRequestException);
      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive),
      ).rejects.toThrow(/Invalid column identifier.*SQL injection guard/);
    });

    it('rejects restore with unknown column not in whitelist', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const badJson = JSON.stringify([
        { id: 1, code: '1010', unknown_custom_column: 'test', name: 'Bad' },
      ]);
      archive.files['accounting/fin_chart_of_accounts.json'] = badJson;
      const hash = crypto.createHash('sha256').update(badJson, 'utf8').digest('hex');
      archive.manifest.files.find((f) => f.path === 'accounting/fin_chart_of_accounts.json')!.sha256 = hash;
      delete (archive.manifest as any).rootHash;

      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive),
      ).rejects.toThrow(BadRequestException);
      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive),
      ).rejects.toThrow(/not permitted on table/);
    });

    it('refuses non-dry-run restore into a non-empty tenant without allowNonEmptyTenant flag', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const mockEm = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('COUNT(*)')) return [{ cnt: 5 }]; // Tenant already has 5 entries
          return [];
        }),
      };
      (mockTenantScope.within as jest.Mock).mockImplementation(
        async (tId: string, manager: any, work: (em: any) => Promise<any>) => work(mockEm),
      );

      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive, { dryRun: false }),
      ).rejects.toThrow(/already has journal entries.*allowNonEmptyTenant/);

      // Allowed when allowNonEmptyTenant is true
      const result = await restoreService.restoreTenantFromExport(targetTenantId, archive, {
        dryRun: false,
        allowNonEmptyTenant: true,
      });
      expect(result.success).toBe(true);
    });

    it('supports dryRun option to validate integrity without database writes', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const mockEm = { query: jest.fn() };
      (mockTenantScope.within as jest.Mock).mockImplementation(
        async (tId: string, manager: any, work: (em: any) => Promise<any>) => work(mockEm),
      );

      const result = await restoreService.restoreTenantFromExport(targetTenantId, archive, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.totalRecordsRestored).toBe(9);
      expect(mockEm.query).not.toHaveBeenCalled();
    });

    it('dryRun validates column names and rejects malicious or unknown columns (SQL injection guard)', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const badJson = JSON.stringify([
        { id: 1, 'code"); DROP TABLE users; --': '1010', name: 'Bad' },
      ]);
      archive.files['accounting/fin_chart_of_accounts.json'] = badJson;
      const hash = crypto.createHash('sha256').update(badJson, 'utf8').digest('hex');
      archive.manifest.files.find((f) => f.path === 'accounting/fin_chart_of_accounts.json')!.sha256 = hash;
      delete (archive.manifest as any).rootHash;

      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive, { dryRun: true }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        restoreService.restoreTenantFromExport(targetTenantId, archive, { dryRun: true }),
      ).rejects.toThrow(/Invalid column identifier.*SQL injection guard/);
    });
  });

  describe('TenantExportController Endpoints', () => {
    it('exportJson delegates to service with authenticated tenant id', async () => {
      const req = { user: { tenantId: mockTenantId, sub: 'user-owner' } } as any;
      const res = await controller.exportJson(req);

      expect(mockExportRepo.fetchTenantData).toHaveBeenCalledWith(mockTenantId);
      expect(res.metadata.tenantId).toBe(mockTenantId);
    });

    it('exportTabular delegates to service with authenticated tenant id', async () => {
      const req = { user: { tenantId: mockTenantId, sub: 'user-admin' } } as any;
      const res = await controller.exportTabular(req);

      expect(mockExportRepo.fetchTenantData).toHaveBeenCalledWith(mockTenantId);
      expect(res.tables.fin_chart_of_accounts).toBeDefined();
    });

    it('downloadFullArchive sets headers and returns streamable zip file', async () => {
      mockExportRepo.fetchAllTenantData = jest.fn().mockResolvedValue(sampleTenantData);

      const req = { user: { tenantId: mockTenantId, sub: 'user-admin' } } as any;
      const res = { set: jest.fn() } as any;

      const file = await controller.downloadFullArchive(req, res);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/zip',
          'Content-Disposition': expect.stringContaining('attachment; filename='),
        }),
      );
      expect(file).toBeDefined();
    });

    it('queueFullExport enqueues a BullMQ job and returns enqueued status', async () => {
      const req = { user: { tenantId: mockTenantId, sub: 'user-admin' } } as any;
      const res = await controller.queueFullExport(req);

      expect(mockExportQueue.add).toHaveBeenCalledWith(
        'tenant-full-export',
        expect.objectContaining({ tenantId: mockTenantId }),
      );
      expect(res.enqueued).toBe(true);
      expect(res.jobId).toBe('job-export-1');
      expect(res.tenantId).toBe(mockTenantId);
    });

    it('exportGoBDZ3 delegates to service with authenticated tenant id', async () => {
      const req = { user: { tenantId: mockTenantId, sub: 'user-owner' } } as any;
      const res = await controller.exportGoBDZ3(req);

      expect(mockExportRepo.fetchTenantData).toHaveBeenCalledWith(mockTenantId);
      expect(res.manifest.tenantId).toBe(mockTenantId);
      expect(res.manifest.version).toBe('GoBD-Z3/2026');
      expect(res.indexXml).toBeDefined();
    });

    it('restoreTenant delegates to restore service with authenticated tenant id and passes dryRun DTO', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      const req = { user: { tenantId: targetTenantId, sub: 'user-admin' } } as any;

      const dto: RestoreTenantDto = {
        dryRun: true,
        allowNonEmptyTenant: true,
        archive,
      };

      const res = await controller.restoreTenant(req, dto);
      expect(res.success).toBe(true);
      expect(res.dryRun).toBe(true);
      expect(res.targetTenantId).toBe(targetTenantId);
    });

    it('RestoreTenantDto validates dryRun and boolean transforms (Lesson 26)', async () => {
      const dto = plainToInstance(RestoreTenantDto, {
        dryRun: 'true',
        allowNonEmptyTenant: 'false',
        archive: {},
      }, { enableImplicitConversion: true });

      expect(dto.dryRun).toBe(true);
      expect(dto.allowNonEmptyTenant).toBe(false);
      expect(await validate(dto)).toHaveLength(0);
    });
  });
});
