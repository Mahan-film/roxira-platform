import { TenantExportService } from './services/tenant-export.service';
import {
  TenantExportRepository,
  CORE_TENANT_TABLES,
} from './repositories/tenant-export.repository';
import { TenantExportController } from './controllers/tenant-export.controller';
import { TenantScope } from '../access/services/tenant-scope';

describe('Tenant Data Export / Customer Owns the Data (#230 / T77)', () => {
  let exportService: TenantExportService;
  let mockExportRepo: jest.Mocked<TenantExportRepository>;
  let controller: TenantExportController;

  const mockTenantId = '99999999-9999-9999-9999-999999999999';

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

    exportService = new TenantExportService(mockExportRepo);
    controller = new TenantExportController(exportService);
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
      expect(exportService.sanitizeCellForSpreadsheet('@HYPERLINK("http://evil.com")')).toBe('\'@HYPERLINK("http://evil.com")');
      expect(exportService.sanitizeCellForSpreadsheet('\t=test')).toBe('\'\t=test');
      expect(exportService.sanitizeCellForSpreadsheet('\r+exec')).toBe('\'\r+exec');
    });

    it('neutralizes formula injection even with leading spaces or newlines', () => {
      expect(exportService.sanitizeCellForSpreadsheet('  =1+1')).toBe('\'  =1+1');
      expect(exportService.sanitizeCellForSpreadsheet('\n+dangerous')).toBe('\'\n+dangerous');
      expect(exportService.sanitizeCellForSpreadsheet('   @link')).toBe('\'   @link');
    });

    it('leaves standard strings, numbers, and Persian text unaltered', () => {
      expect(exportService.sanitizeCellForSpreadsheet('روکسیرا')).toBe('روکسیرا');
      expect(exportService.sanitizeCellForSpreadsheet('INV-1001')).toBe('INV-1001');
      expect(exportService.sanitizeCellForSpreadsheet(1250000)).toBe('1250000');
      expect(exportService.sanitizeCellForSpreadsheet('')).toBe('');
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

  describe('TenantExportController', () => {
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
  });
});
