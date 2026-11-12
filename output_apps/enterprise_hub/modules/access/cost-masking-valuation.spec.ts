import { StreamableFile } from '@nestjs/common';
import { of } from 'rxjs';
import { SystemRole } from './catalogue';
import { CostMaskingInterceptor } from './cost-masking.interceptor';
import { CostMaskingService, isValuationPath } from './services/cost-masking.service';

/** Route-aware masking of cost-derived money on inventory valuation / report routes (#740 review blocker). */
describe('Cost masking on inventory valuation routes', () => {
  const interceptor = new CostMaskingInterceptor(new CostMaskingService());

  function run(url: string, role: SystemRole, body: unknown): Promise<any> {
    const request = { url, originalUrl: url, user: { sub: 'u1', tenantRole: role } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    return new Promise((resolve, reject) => {
      interceptor.intercept(context, { handle: () => of(body) }).subscribe({ next: resolve, error: reject });
    });
  }

  const cardex = {
    sku: 'S1',
    openingQty: '5',
    openingValue: '5000',
    closingQty: '9',
    closingValue: '9000',
    opening: { qty: '5', value: '5000' },
    closing: { qty: '9', value: '9000' },
    rows: [{ date: '2026-01-01', inQty: '4', unitCost: '1000', runningQty: '9', runningValue: '9000' }],
    costCenter: 'CC-1',
  };
  const balance = {
    asOf: '2026-01-01',
    lines: [{ itemId: 'i1', quantity: '3', value: '3000', shortageQty: '0' }],
    items: [{ itemId: 'i1', quantity: '3', value: '3000', costCenter: 'CC-2' }],
  };

  it('masks cardex values for SALES but keeps quantities and costCenter', async () => {
    const out = await run('/enterprise-hub/inventory/reports/cardex?sku=S1', SystemRole.SALES, cardex);
    expect(out.openingValue).toBeNull();
    expect(out.closingValue).toBeNull();
    expect(out.opening.value).toBeNull();
    expect(out.closing.value).toBeNull();
    expect(out.rows[0].runningValue).toBeNull();
    expect(out.rows[0].unitCost).toBeNull();
    expect(out.rows[0].runningQty).toBe('9');
    expect(out.openingQty).toBe('5');
    expect(out.costCenter).toBe('CC-1');
  });

  it('masks stock-balance value per line for SALES, including under a version prefix', async () => {
    const out = await run('/v1/enterprise-hub/inventory/reports/stock-balance', SystemRole.SALES, balance);
    expect(out.lines[0].value).toBeNull();
    expect(out.items[0].value).toBeNull();
    expect(out.lines[0].quantity).toBe('3');
    expect(out.items[0].costCenter).toBe('CC-2');
  });

  it('returns real values to a role with cost visibility (owner)', async () => {
    const out = await run('/enterprise-hub/inventory/reports/cardex', SystemRole.OWNER, cardex);
    expect(out).toBe(cardex);
    expect(out.rows[0].runningValue).toBe('9000');
  });

  it('does not mask selling-side amounts on sales routes', async () => {
    const out = await run('/enterprise-hub/invoicing/invoices/1', SystemRole.SALES, { totalAmount: 100, amount: 5 });
    expect(out.totalAmount).toBe(100);
    expect(out.amount).toBe(5);
  });

  it('covers landed cost, FIFO valuation, production and COGS routes', async () => {
    for (const url of [
      '/enterprise-hub/inventory/valuation',
      '/enterprise-hub/inventory/purchasing/receipts/1/landed-costs',
      '/enterprise-hub/manufacturing/orders/1',
      '/enterprise-hub/production/runs',
      '/enterprise-hub/reports/cogs',
    ]) {
      expect(isValuationPath(url)).toBe(true);
      const out = await run(url, SystemRole.SALES, { fifoValue: 1, totalInventoryValue: 2, amount: 3, tagMinor: 4, qty: 5 });
      expect(out).toEqual({ fifoValue: null, totalInventoryValue: null, amount: null, tagMinor: null, qty: 5 });
    }
    expect(isValuationPath('/enterprise-hub/sales/invoices')).toBe(false);
  });

  it('handles nested arrays and cyclic objects without crashing', async () => {
    const row: any = { value: 1, qty: 2, tags: [[{ runningValue: 3, n: 1 }]] };
    row.self = row;
    const out = await run('/enterprise-hub/inventory/reports/cardex', SystemRole.SALES, { rows: [row, row] });
    expect(out.rows[0].value).toBeNull();
    expect(out.rows[0].tags[0][0].runningValue).toBeNull();
    expect(out.rows[0].tags[0][0].n).toBe(1);
    expect(out.rows[0].self).toBe(out.rows[0]);
    expect(out.rows[1]).toBe(out.rows[0]);
  });

  it('refuses file exports of valuation reports to roles without cost visibility', async () => {
    await expect(
      run('/enterprise-hub/inventory/reports/cardex?format=xlsx', SystemRole.SALES, new StreamableFile(Buffer.from('x'))),
    ).rejects.toThrow();
  });
});
