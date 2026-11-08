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
    expect(compiled.sql).not.toContain("OR '1'='1");
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
    expect(compiled.sql).toContain('LIMIT $2 OFFSET $3');
    expect(compiled.params).toEqual(['1000000']);
    expect(compiled.queryParams).toEqual(['1000000', 50, 0]);
  });

  it('enforces upper bound on limit to protect against unbounded scans', () => {
    const compiled = service.compileQuery({
      dataset: 'accounting_ledger',
      limit: 999999,
    });
    expect(compiled.sql).toContain('LIMIT $1 OFFSET $2');
    expect(compiled.queryParams).toEqual([5000, 0]);
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

  it('never lets caller text into the SQL string: alias, direction, operator, limit and values', () => {
    const bad = (dto: unknown) => expect(() => service.compileQuery(dto as never)).toThrow(BadRequestException);
    bad({
      dataset: 'accounting_ledger',
      aggregates: [{ column: 'debit', func: 'sum', alias: 'x" , (SELECT 1) AS "y' }],
    });
    bad({ dataset: 'accounting_ledger', aggregates: [{ column: 'debit', func: 'sum; DROP TABLE x', alias: 'a' }] });
    bad({ dataset: 'accounting_ledger', columns: ['debit'], limit: '1; DROP TABLE x' });
    bad({ dataset: 'accounting_ledger', offset: -1 });
    bad({ dataset: 'accounting_ledger', filters: [{ column: 'debit', op: 'gt', value: '1 OR 1=1' }] });
    bad({ dataset: 'accounting_ledger', filters: [{ column: 'account_code', op: 'eq', value: { $ne: 1 } }] });
    bad({ dataset: 'accounting_ledger', filters: [{ column: 'a"; DROP', op: 'eq', value: 'x' }] });
    bad({ dataset: 'accounting_ledger', groupBy: ['status; --'] });
    bad({ dataset: 'accounting_ledger', orderBy: [{ column: 'debit; --', direction: 'asc' }] });
    // A direction that is not 'desc' becomes the literal ASC.
    const c = service.compileQuery({
      dataset: 'accounting_ledger',
      columns: ['debit'],
      orderBy: [{ column: 'debit', direction: 'asc; DROP' as never }],
    });
    expect(c.sql).toContain('ORDER BY l."debit" ASC');
    expect(c.sql).not.toContain('DROP');
  });

  it('scopes every query to the bound tenant and groups consistently', () => {
    const c = service.compileQuery({
      dataset: 'accounting_ledger',
      groupBy: ['account_code'],
      aggregates: [{ column: 'debit', func: 'sum' }, { column: 'credit', func: 'sum', alias: 'total_credit' }],
    });
    expect(c.sql).toContain(`l."tenant_id" = current_setting('app.tenant_id', true)::uuid`);
    expect(c.sql).toContain('GROUP BY a."code"');
    expect(c.sql).toContain('SUM(l."debit") AS "sum_debit"');
    expect(c.selectedColumns.map((x) => [x.id, x.type])).toEqual([
      ['account_code', 'string'],
      ['sum_debit', 'money'],
      ['total_credit', 'money'],
    ]);
    expect(() =>
      service.compileQuery({ dataset: 'accounting_ledger', columns: ['status'], groupBy: ['account_code'] }),
    ).toThrow(BadRequestException);
  });

  it('escapes LIKE wildcards in contains and caps in-lists', () => {
    const c = service.compileQuery({
      dataset: 'accounting_ledger',
      filters: [{ column: 'description', op: 'contains', value: '50%_off\\' }],
    });
    expect(c.params[0]).toBe('%50\\%\\_off\\\\%');
    expect(() =>
      service.compileQuery({
        dataset: 'accounting_ledger',
        filters: [{ column: 'account_code', op: 'in', value: Array.from({ length: 201 }, (_, i) => String(i)) }],
      }),
    ).toThrow(BadRequestException);
  });
});
