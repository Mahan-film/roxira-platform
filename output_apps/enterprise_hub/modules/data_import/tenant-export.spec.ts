import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { TenantExportService } from './services/tenant-export.service';
import { TenantRestoreService } from './services/tenant-restore.service';
import {
  TenantExportRepository,
  CORE_TENANT_TABLES,
} from './repositories/tenant-export.repository';
import { TenantExportController } from './controllers/tenant-export.controller';
import { TenantScope } from '../access/services/tenant-scope';

describe('Tenant Data Export & Restore / GoBD Z3 & EU Data Act (#230 / T77 / #1057 / T262 R26)', () => {
  let exportService: TenantExportService;
  let restoreService: TenantRestoreService;
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
      { id: 1, entry_id: 1, account_id: 1, debit: '1000', credit: '0', tenant_id: mockTenantId },
    ],
    erp_parties: [
      { id: 1, code: 'CUST-001', name: 'شرکت فناوران', tenant_id: mockTenantId },
      { id: 2, code: 'SUPP-001', name: 'بازرگانی پارس', tenant_id: mockTenantId },
    ],
    invoices: [
      { id: 1, invoice_number: 'INV-01', total_amount: '50000', tenant_id: mockTenantId },
    ],
    fin_cheques: [
      { id: 1, sayad_number: '1234567890123456', amount: '20000', tenant_id: mockTenantId },
    ],
    erp_stock_items: [
      { id: 1, sku: 'ITEM-01', name: 'کالای نمونه الف', tenant_id: mockTenantId },
    ],
  };

  beforeEach(() => {
    mockExportRepo = {
      fetchTenantData: jest.fn().mockResolvedValue(sampleTenantData),
    } as unknown as jest.Mocked<TenantExportRepository>;

    mockTenantScope = {
      within: jest.fn(async (tenantId: string, manager: any, work: (em: any) => Promise<any>) => {
        const mockEm = {
          query: jest.fn().mockResolvedValue([]),
        };
        return work(mockEm);
      }),
    } as unknown as jest.Mocked<TenantScope>;

    exportService = new TenantExportService(mockExportRepo);
    restoreService = new TenantRestoreService(mockTenantScope);
    controller = new TenantExportController(exportService, restoreService);
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

      expect(data.fin_chart_of_accounts).toHaveLength(1);
      expect(data.fin_journal_entries).toHaveLength(1);
      expect(data.erp_parties).toHaveLength(1);
    });
  });

  describe('Formula Injection Neutralization (Lesson 9 / #686)', () => {
    it('neutralizes =, +, -, @, and control characters at the start of cells', () => {
      expect(exportService.sanitizeCellForSpreadsheet('=cmd|\'/C calc\'!A0')).toBe('\'=cmd|\'/C calc\'!A0');
      expect(exportService.sanitizeCellForSpreadsheet('+123456')).toBe('\'+123456');
      expect(exportService.sanitizeCellForSpreadsheet('-SUM(A1:A10)')).toBe('\'-SUM(A1:A10)');
      expect(exportService.sanitizeCellForSpreadsheet('@SUM(A1:A10)')).toBe('\'@SUM(A1:A10)');
      expect(exportService.sanitizeCellForSpreadsheet('\tmalicious_tab')).toBe('\'\tmalicious_tab');
      expect(exportService.sanitizeCellForSpreadsheet('\rmalicious_cr')).toBe('\'\rmalicious_cr');
    });

    it('neutralizes formula injection even with leading spaces or newlines', () => {
      expect(exportService.sanitizeCellForSpreadsheet('   =cmd|\'/C calc\'!A0')).toBe('\'   =cmd|\'/C calc\'!A0');
      expect(exportService.sanitizeCellForSpreadsheet('\n  @ATTACK')).toBe('\'\n  @ATTACK');
    });

    it('leaves standard strings, numbers, and Persian text unaltered', () => {
      expect(exportService.sanitizeCellForSpreadsheet('سند افتتاحیه')).toBe('سند افتتاحیه');
      expect(exportService.sanitizeCellForSpreadsheet(12345)).toBe('12345');
      expect(exportService.sanitizeCellForSpreadsheet('Standard text without symbols')).toBe('Standard text without symbols');
      expect(exportService.sanitizeCellForSpreadsheet(null)).toBe('');
      expect(exportService.sanitizeCellForSpreadsheet(undefined)).toBe('');
    });
  });

  describe('Full JSON Archive Export', () => {
    it('exports structured JSON archive with SHA-256 checksum and metadata', async () => {
      const archive = await exportService.exportTenantJson(mockTenantId);

      expect(mockExportRepo.fetchTenantData).toHaveBeenCalledWith(mockTenantId);
      expect(archive.metadata.tenantId).toBe(mockTenantId);
      expect(archive.metadata.version).toBe('1.0');
      expect(archive.metadata.checksum).toBeDefined();
      expect(archive.metadata.checksum).toHaveLength(64); // SHA-256 hex
      expect(archive.metadata.tableCounts.fin_chart_of_accounts).toBe(2);
      expect(archive.metadata.tableCounts.erp_parties).toBe(2);
      expect(archive.metadata.tableCounts.invoices).toBe(1);

      expect(archive.data.fin_chart_of_accounts).toEqual(sampleTenantData.fin_chart_of_accounts);
      expect(archive.data.erp_parties).toEqual(sampleTenantData.erp_parties);
    });
  });

  describe('Tabular / Excel Sheets Export', () => {
    it('generates sanitized tabular rows and headers per table', async () => {
      const injectionData = {
        erp_parties: [
          { code: 'CUST-01', name: '=1+1', note: '  -malicious' },
        ],
      };

      const result = await exportService.exportTenantTabular(mockTenantId, injectionData);

      expect(result.tables.erp_parties.headers).toEqual(['code', 'name', 'note']);
      expect(result.tables.erp_parties.rows).toHaveLength(1);
      expect(result.tables.erp_parties.rows[0]).toEqual(['CUST-01', '\'=1+1', '\'  -malicious']);
      expect(result.metadata.checksum).toHaveLength(64);
    });
  });

  describe('GoBD Z3 / EU Data Act Export (#1057 / T262 R26)', () => {
    it('generates GDPdU-conformant index.xml with media, table descriptors, and primary keys', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      expect(archive.indexXml).toBeDefined();
      expect(archive.indexXml).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">');
      expect(archive.indexXml).toContain('<Name>Roxira Enterprise Hub</Name>');
      expect(archive.indexXml).toContain(`Tenant: ${mockTenantId}`);
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
      expect(invoicesJson[0].invoice_number).toBe('INV-01');
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
          insertedQueries.push({ sql, values });
          return [];
        }),
      };

      (mockTenantScope.within as jest.Mock).mockImplementationOnce(
        async (tId: string, manager: any, work: (em: any) => Promise<any>) => work(mockEm),
      );

      const result = await restoreService.restoreTenantFromExport(targetTenantId, archive);

      expect(mockTenantScope.within).toHaveBeenCalledWith(targetTenantId, undefined, expect.any(Function));
      expect(result.success).toBe(true);
      expect(result.targetTenantId).toBe(targetTenantId);
      expect(result.totalRecordsRestored).toBe(9); // 2 accounts + 1 entry + 1 line + 2 parties + 1 invoice + 1 cheque + 1 item
      expect(result.restoredTables.fin_chart_of_accounts).toBe(2);
      expect(result.restoredTables.erp_parties).toBe(2);

      // Verify EVERY single inserted query overwrote tenant_id with targetTenantId
      expect(insertedQueries.length).toBe(9);
      for (const q of insertedQueries) {
        expect(q.sql).toContain('INSERT INTO');
        expect(q.values).toContain(targetTenantId);
        expect(q.values).not.toContain(mockTenantId); // Source tenant ID strictly wiped/overwritten
      }
    });

    it('supports dryRun option to validate integrity without database writes', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);

      const mockEm = { query: jest.fn() };
      (mockTenantScope.within as jest.Mock).mockImplementationOnce(
        async (tId: string, manager: any, work: (em: any) => Promise<any>) => work(mockEm),
      );

      const result = await restoreService.restoreTenantFromExport(targetTenantId, archive, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.totalRecordsRestored).toBe(9);
      expect(mockEm.query).not.toHaveBeenCalled();
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

    it('exportGoBDZ3 delegates to service with authenticated tenant id', async () => {
      const req = { user: { tenantId: mockTenantId, sub: 'user-owner' } } as any;
      const res = await controller.exportGoBDZ3(req);

      expect(mockExportRepo.fetchTenantData).toHaveBeenCalledWith(mockTenantId);
      expect(res.manifest.tenantId).toBe(mockTenantId);
      expect(res.manifest.version).toBe('GoBD-Z3/2026');
      expect(res.indexXml).toBeDefined();
    });

    it('restoreTenant delegates to restore service with authenticated tenant id', async () => {
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      const req = { user: { tenantId: targetTenantId, sub: 'user-admin' } } as any;

      const res = await controller.restoreTenant(req, archive);
      expect(res.success).toBe(true);
      expect(res.targetTenantId).toBe(targetTenantId);
    });

    it('restoreTenant throws if restoreService is not injected', async () => {
      const controllerWithoutRestore = new TenantExportController(exportService);
      const archive = await exportService.exportTenantGoBDZ3(mockTenantId);
      const req = { user: { tenantId: targetTenantId, sub: 'user-admin' } } as any;

      await expect(controllerWithoutRestore.restoreTenant(req, archive)).rejects.toThrow(BadRequestException);
    });
  });
});
