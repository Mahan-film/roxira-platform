import { SearchService, normalizeSearchQuery } from './services/search.service';
import { TenantScope } from '../access/services/tenant-scope';

describe('SearchService', () => {
  let service: SearchService;
  let mockTenantScope: Partial<TenantScope>;
  let mockManagerQuery: jest.Mock;

  const TENANT_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    mockManagerQuery = jest.fn();
    mockTenantScope = {
      run: jest.fn(async (_tenantId, fn) => {
        return fn({ query: mockManagerQuery } as any);
      }) as any,
    };
    service = new SearchService(mockTenantScope as TenantScope, {} as any);
  });

  describe('normalizeSearchQuery', () => {
    it('normalizes Persian and Arabic digits to ASCII digits', () => {
      expect(normalizeSearchQuery('فاکتور ۱۴۰۳')).toBe('فاکتور 1403');
      expect(normalizeSearchQuery('چک ٥٦٧۸۹')).toBe('چک 56789');
    });

    it('normalizes Arabic Yeh and Kaf to Persian characters', () => {
      expect(normalizeSearchQuery('شركت تجاري')).toBe('شرکت تجاری');
    });

    it('trims whitespace', () => {
      expect(normalizeSearchQuery('   کالا   ')).toBe('کالا');
      expect(normalizeSearchQuery('')).toBe('');
    });
  });

  describe('search', () => {
    it('returns empty result when query is blank', async () => {
      const res = await service.search(TENANT_ID, '   ');
      expect(res.total).toBe(0);
      expect(res.items).toEqual([]);
      expect(mockTenantScope.run).not.toHaveBeenCalled();
    });

    it('matches static pages without hitting DB when only page matches', async () => {
      mockManagerQuery.mockResolvedValue([]);
      const res = await service.search(TENANT_ID, 'داشبورد');
      expect(res.total).toBeGreaterThan(0);
      const pageItem = res.items.find((i) => i.type === 'page');
      expect(pageItem).toBeDefined();
      expect(pageItem?.title).toBe('داشبورد');
      expect(pageItem?.url).toBe('/app');
    });

    it('queries parties, stock items, invoices, cheques, and chart of accounts', async () => {
      mockManagerQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('erp_parties')) {
          return [
            {
              id: 10,
              code: 'C-101',
              name: 'شرکت آلفا',
              role: 'CUSTOMER',
              national_id: '10100000000',
              phone: '02188888888',
              sim: 0.9,
            },
          ];
        }
        if (sql.includes('erp_stock_items')) {
          return [
            {
              id: 20,
              sku: 'SKU-001',
              barcode: '6260000000001',
              name: 'لپ‌تاپ آلفا',
              primary_unit: 'دستگاه',
              quantity: 5,
              sim: 0.85,
            },
          ];
        }
        if (sql.includes('invoices')) {
          return [
            {
              id: 'inv-1',
              tax_invoice_number: 'INV-1403-001',
              direction: 'OUTBOUND',
              final_payable: 15000000,
              currency: 'IRR',
              buyer_info: { name: 'خریدار آلفا' },
              created_at: new Date(),
              sim: 0.8,
            },
          ];
        }
        if (sql.includes('fin_cheques')) {
          return [
            {
              id: 30,
              cheque_number: 'CHQ-555',
              sayad_number: '1234567890123456',
              party_name: 'آلفا تجارت',
              bank_name: 'بانک ملت',
              amount: '5000000.00',
              due_date: '1403/10/15',
              direction: 'RECEIVED',
              status: 'REGISTERED',
              sim: 0.75,
            },
          ];
        }
        if (sql.includes('fin_chart_of_accounts')) {
          return [
            {
              id: 40,
              code: '10101',
              name: 'صندوق شرکت آلفا',
              level: 'معین',
              account_type: 'ASSET',
              sim: 0.7,
            },
          ];
        }
        return [];
      });

      const res = await service.search(TENANT_ID, 'آلفا', 10);
      expect(res.total).toBeGreaterThanOrEqual(5);

      const customer = res.items.find((i) => i.type === 'customer');
      expect(customer).toBeDefined();
      expect(customer?.title).toBe('شرکت آلفا');
      expect(customer?.url).toBe('/app/crm?search=C-101');
      expect(customer?.subtitle).toContain('کد: C-101');

      const product = res.items.find((i) => i.type === 'product');
      expect(product).toBeDefined();
      expect(product?.title).toBe('لپ‌تاپ آلفا');
      expect(product?.url).toBe('/app/inventory?search=SKU-001');

      const invoice = res.items.find((i) => i.type === 'invoice');
      expect(invoice).toBeDefined();
      expect(invoice?.title).toContain('INV-1403-001');

      const cheque = res.items.find((i) => i.type === 'cheque');
      expect(cheque).toBeDefined();
      expect(cheque?.title).toContain('CHQ-555');

      const account = res.items.find((i) => i.type === 'account');
      expect(account).toBeDefined();
      expect(account?.title).toBe('10101 - صندوق شرکت آلفا');

      // Verify latency reporting
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('respects entity type filter when provided', async () => {
      mockManagerQuery.mockResolvedValue([]);
      await service.search(TENANT_ID, 'آلفا', 10, ['customer']);

      // Should only query erp_parties
      const queries = mockManagerQuery.mock.calls.map((c) => c[0]);
      expect(queries.some((q) => q.includes('erp_parties'))).toBe(true);
      expect(queries.some((q) => q.includes('erp_stock_items'))).toBe(false);
      expect(queries.some((q) => q.includes('fin_cheques'))).toBe(false);
    });

    it('handles database errors in one table gracefully without failing entire search', async () => {
      mockManagerQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('erp_parties')) {
          throw new Error('Table temporary lock');
        }
        if (sql.includes('erp_stock_items')) {
          return [
            {
              id: 20,
              sku: 'SKU-OK',
              name: 'کالای سالم',
              sim: 0.9,
            },
          ];
        }
        return [];
      });

      const res = await service.search(TENANT_ID, 'کالا');
      expect(res.total).toBeGreaterThan(0);
      expect(res.items.some((i) => i.title === 'کالای سالم')).toBe(true);
    });
  });
});
