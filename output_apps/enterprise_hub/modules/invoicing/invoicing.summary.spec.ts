import 'reflect-metadata';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';

/** QueryBuilder ساختگی که شرط‌ها و پارامترها را ثبت می‌کند. */
function fakeQueryBuilder(rows: unknown[]) {
  const wheres: Array<{ sql: string; params?: Record<string, unknown> }> = [];
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['select', 'addSelect', 'groupBy', 'addGroupBy']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.where = jest.fn((sql: string, params?: Record<string, unknown>) => {
    wheres.push({ sql, params });
    return builder;
  });
  builder.andWhere = builder.where;
  builder.getRawMany = jest.fn(async () => rows);
  return { builder, wheres };
}

describe('InvoicingRepository.summarize (assistant read model)', () => {
  it('always scopes to the tenant and binds every filter as a parameter', async () => {
    const { builder, wheres } = fakeQueryBuilder([
      { currency: 'IRR', status: 'PAID', count: '2', total: '150.50', tax: '13.5' },
    ]);
    const repository = new InvoicingRepository({
      createQueryBuilder: () => builder,
    } as never);

    const from = new Date('2026-08-22T20:30:00Z');
    const rows = await repository.summarize('tenant-a', {
      statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
      from,
      buyerSearch: "x' OR 1=1 --",
    });

    expect(wheres[0]).toEqual({
      sql: 'invoice.tenantId = :tenantId',
      params: { tenantId: 'tenant-a' },
    });
    expect(wheres.some((w) => w.params?.from === from)).toBe(true);
    expect(wheres.some((w) => w.params?.to !== undefined)).toBe(false);
    const buyer = wheres.find((w) => w.params?.buyer !== undefined);
    expect(buyer?.sql).not.toContain('OR 1=1');
    expect(buyer?.params?.buyer).toBe("%x' OR 1=1 --%");
    expect(rows).toEqual([
      { currency: 'IRR', status: 'PAID', count: 2, total: 150.5, tax: 13.5 },
    ]);
  });

  it('service returns nothing for an empty status list without querying', async () => {
    const repository = { summarize: jest.fn() };
    const service = new InvoicingService(repository as never, {} as never);
    await expect(service.summarize('tenant-a', { statuses: [] })).resolves.toEqual([]);
    expect(repository.summarize).not.toHaveBeenCalled();
  });
});
