import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../access/services/audit.service';
import { ReportBuilderRepository } from './repositories/report-builder.repository';
import { ReportBuilderService } from './services/report-builder.service';

describe('ReportBuilderService (unit)', () => {
  let service: ReportBuilderService;
  let repo: jest.Mocked<ReportBuilderRepository>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(() => {
    repo = {
      executeReadOnlyQuery: jest.fn(),
      saveTemplate: jest.fn(),
      listTemplates: jest.fn(),
      findTemplateById: jest.fn(),
      deleteTemplate: jest.fn(),
    } as unknown as jest.Mocked<ReportBuilderRepository>;

    audit = {
      record: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<AuditService>;

    service = new ReportBuilderService(repo, audit);
  });

  it('lists available datasets and whitelisted columns with Persian labels', () => {
    const datasets = service.getAvailableDatasets();
    expect(datasets.length).toBeGreaterThanOrEqual(3);
    const ledger = datasets.find((d) => d.id === 'accounting_ledger');
    expect(ledger).toBeDefined();
    expect(ledger?.columns.some((c) => c.id === 'debit' && c.type === 'money')).toBe(true);
  });

  it('rejects an invalid dataset with BadRequestException', () => {
    expect(() =>
      service.compileQuery({
        dataset: 'malicious_table',
        columns: ['id'],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-whitelisted column with BadRequestException', () => {
    expect(() =>
      service.compileQuery({
        dataset: 'accounting_ledger',
        columns: ['debit', 'password_hash'],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects SQL injection attempts in filters and binds values safely as parameters', () => {
    const compiled = service.compileQuery({
      dataset: 'accounting_ledger',
      columns: ['entry_number', 'debit'],
      filters: [
        {
          column: 'entry_number',
          op: 'eq',
          value: "' OR '1'='1",
        },
      ],
    });

    // The SQL must use $1 and not interpolate the string literal
    expect(compiled.sql).toContain('e."entry_number" = $1');
    expect(compiled.params).toEqual(["' OR '1'='1"]);
  });

  it('compiles combined sales-accounting cross-domain queries correctly', () => {
    const compiled = service.compileQuery({
      dataset: 'combined_sales_accounting',
      columns: ['invoice_number', 'invoice_amount', 'voucher_number', 'line_debit'],
      filters: [
        { column: 'invoice_amount', op: 'gte', value: '1000000' },
      ],
      limit: 50,
    });

    expect(compiled.sql).toContain('invoices');
    expect(compiled.sql).toContain('fin_journal_entries');
    expect(compiled.sql).toContain('LIMIT 50 OFFSET 0');
    expect(compiled.params).toEqual(['1000000']);
  });

  it('enforces upper bound on limit to protect against unbounded scans', () => {
    const compiled = service.compileQuery({
      dataset: 'accounting_ledger',
      limit: 999999,
    });
    expect(compiled.sql).toContain('LIMIT 5000 OFFSET 0');
  });

  it('maps PostgreSQL statement_timeout error into a clear Persian 400 error', async () => {
    repo.executeReadOnlyQuery.mockRejectedValueOnce(
      new Error('canceling statement due to statement timeout'),
    );

    await expect(
      service.executeQuery('tenant-1', {
        dataset: 'accounting_ledger',
      }),
    ).rejects.toThrow(/سقف مجاز \(۵ ثانیه\)/);
  });
});
