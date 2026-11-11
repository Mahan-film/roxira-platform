import { of } from 'rxjs';
import { AccessContext } from './access-context';
import { SystemRole } from './catalogue';
import { CostMaskingInterceptor } from './cost-masking.interceptor';
import { CostMaskingService } from './services/cost-masking.service';

describe('Hidden Purchase Price and Cost API Protection (#230 / T76)', () => {
  let maskingService: CostMaskingService;

  beforeEach(() => {
    maskingService = new CostMaskingService();
  });

  describe('Role-based Cost Viewing Permission', () => {
    it('denies cost visibility to SALES, CHEQUE_REVIEWER, and HR roles', () => {
      expect(maskingService.canViewCost(SystemRole.SALES)).toBe(false);
      expect(maskingService.canViewCost(SystemRole.CHEQUE_REVIEWER)).toBe(false);
      expect(maskingService.canViewCost(SystemRole.HR)).toBe(false);
    });

    it('allows cost visibility to OWNER, ADMIN, ACCOUNTANT, and READ_ONLY roles', () => {
      expect(maskingService.canViewCost(SystemRole.OWNER)).toBe(true);
      expect(maskingService.canViewCost(SystemRole.ADMIN)).toBe(true);
      expect(maskingService.canViewCost(SystemRole.ACCOUNTANT)).toBe(true);
      expect(maskingService.canViewCost(SystemRole.READ_ONLY)).toBe(true);
    });

    it('evaluates fieldVisibility from AccessContext for custom roles', () => {
      const allowedCtx: Partial<AccessContext> = {
        roleKey: 'custom_buyer',
        fieldVisibility: { cost: true, margin: true, salary: false },
      };
      expect(maskingService.canViewCost(allowedCtx as AccessContext)).toBe(true);

      const deniedCtx: Partial<AccessContext> = {
        roleKey: 'custom_sales_agent',
        fieldVisibility: { cost: false, margin: false, salary: false },
      };
      expect(maskingService.canViewCost(deniedCtx as AccessContext)).toBe(false);
    });

    it('fails closed on unknown or empty role or undefined context (Lesson 25)', () => {
      expect(maskingService.canViewCost('')).toBe(false);
      expect(maskingService.canViewCost(null)).toBe(false);
      expect(maskingService.canViewCost(undefined)).toBe(false);
      expect(maskingService.canViewCost('UNKNOWN_ROLE_FOO')).toBe(false);
    });
  });

  describe('Regex Pattern & Key Matching', () => {
    it('identifies variant cost and valuation field names including *Minor and grossProfit', () => {
      const sensitiveKeys = [
        'unitPurchaseCost',
        'unit_purchase_cost',
        'unitCost',
        'unit_cost',
        'unitCostMinor',
        'totalCostMinor',
        'standardCost',
        'costPrice',
        'lastPurchasePrice',
        'purchasePrice',
        'purchase_price',
        'landedCost',
        'landed_cost',
        'totalCost',
        'total_cost',
        'cogs',
        'valuation',
        'lineCost',
        'grossProfit',
        'gross_profit',
        'buyPrice',
        'buy_price',
      ];
      for (const k of sensitiveKeys) {
        expect(maskingService.isCostField(k)).toBe(true);
      }
    });

    it('does NOT match dimension keys such as costCenter, costCentre or account identifiers', () => {
      const nonCostKeys = [
        'costCenter',
        'cost_center',
        'costCentre',
        'cost_centre',
        'costCenterId',
        'accountCode',
        'accountName',
        'unitPrice',
        'price',
      ];
      for (const k of nonCostKeys) {
        expect(maskingService.isCostField(k)).toBe(false);
      }
    });
  });

  describe('API Response Payload Masking', () => {
    const rawStockItem = {
      id: 101,
      sku: 'ROX-SERVER-2U',
      barcode: '6261234567890',
      name: 'سرور سازمانی ۲ یونیت',
      quantity: 15,
      unitPrice: 120000000,
      unit_price: 120000000,
      unitCost: 85000000,
      unitCostMinor: '8500000000',
      totalCostMinor: '127500000000',
      standardCost: 82000000,
      costPrice: 83000000,
      lastPurchasePrice: 84000000,
      grossProfit: 35000000,
      unit_cost: 85000000,
      unitPurchaseCost: 85000000,
      unit_purchase_cost: 85000000,
      purchasePrice: 85000000,
      purchase_price: 85000000,
      purchaseCost: 85000000,
      purchase_cost: 85000000,
      averageCost: 84000000,
      average_cost: 84000000,
      lineCost: 85000000,
      line_cost: 85000000,
      cost: 85000000,
      buyPrice: 85000000,
      buy_price: 85000000,
      landedCost: 5000000,
      landed_cost: 5000000,
      totalCost: 1275000000,
      total_cost: 1275000000,
      cogs: 85000000,
      valuation: 1275000000,
      costCenter: 'CC-MAIN',
      cost_center: 'CC-MAIN',
      primaryUnit: 'دستگاه',
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
    };

    it('scrubs purchase price and cost fields from item payload when user cannot view cost', () => {
      const masked = maskingService.maskCostFields(rawStockItem, false);

      expect(masked.sku).toBe('ROX-SERVER-2U');
      expect(masked.name).toBe('سرور سازمانی ۲ یونیت');
      expect(masked.quantity).toBe(15);
      expect(masked.primaryUnit).toBe('دستگاه');

      // Sensitive purchase prices & valuation fields are masked to null
      expect(masked.unitCost).toBeNull();
      expect(masked.unitCostMinor).toBeNull();
      expect(masked.totalCostMinor).toBeNull();
      expect(masked.standardCost).toBeNull();
      expect(masked.costPrice).toBeNull();
      expect(masked.lastPurchasePrice).toBeNull();
      expect(masked.grossProfit).toBeNull();
      expect(masked.unit_cost).toBeNull();
      expect(masked.unitPurchaseCost).toBeNull();
      expect(masked.unit_purchase_cost).toBeNull();
      expect(masked.purchasePrice).toBeNull();
      expect(masked.purchase_price).toBeNull();
      expect(masked.purchaseCost).toBeNull();
      expect(masked.purchase_cost).toBeNull();
      expect(masked.averageCost).toBeNull();
      expect(masked.average_cost).toBeNull();
      expect(masked.lineCost).toBeNull();
      expect(masked.line_cost).toBeNull();
      expect(masked.cost).toBeNull();
      expect(masked.buyPrice).toBeNull();
      expect(masked.buy_price).toBeNull();
      expect(masked.landedCost).toBeNull();
      expect(masked.landed_cost).toBeNull();
      expect(masked.totalCost).toBeNull();
      expect(masked.total_cost).toBeNull();
      expect(masked.cogs).toBeNull();
      expect(masked.valuation).toBeNull();

      // Dimension costCenter is preserved!
      expect(masked.costCenter).toBe('CC-MAIN');
      expect(masked.cost_center).toBe('CC-MAIN');

      // Date is preserved intact without being turned into {}
      expect(masked.createdAt).toBeInstanceOf(Date);
      expect(masked.createdAt.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    });

    it('preserves all cost fields untouched when user has cost view entitlement', () => {
      const original = maskingService.maskCostFields(rawStockItem, true);

      expect(original.unitPurchaseCost).toBe(85000000);
      expect(original.landedCost).toBe(5000000);
      expect(original.valuation).toBe(1275000000);
      expect(original.purchaseCost).toBe(85000000);
      expect(original.unitCostMinor).toBe('8500000000');
    });

    it('handles circular references / cyclic graphs safely without stack overflow', () => {
      const parent: any = { name: 'Parent', unitCost: 1000 };
      const child: any = { name: 'Child', unitCost: 500, parent };
      parent.child = child; // Cycle!

      expect(() => {
        const masked = maskingService.maskCostFields(parent, false);
        expect(masked.unitCost).toBeNull();
        expect(masked.child.unitCost).toBeNull();
        expect(masked.child.parent).toBeDefined();
      }).not.toThrow();
    });

    it('scans and sanitizes Maps and Sets without corruption', () => {
      const itemSet = new Set([
        { sku: 'ITEM-1', unitCost: 100 },
        { sku: 'ITEM-2', unitCost: 200 },
      ]);
      const maskedSet = maskingService.maskCostFields(itemSet, false);
      expect(maskedSet).toBeInstanceOf(Set);
      expect(maskedSet.size).toBe(2);
      for (const item of maskedSet) {
        expect((item as any).unitCost).toBeNull();
      }

      const itemMap = new Map<string, any>([
        ['sku', 'ITEM-1'],
        ['unitCost', 100],
        ['nested', { unitCostMinor: 500n }],
      ]);
      const maskedMap = maskingService.maskCostFields(itemMap, false);
      expect(maskedMap).toBeInstanceOf(Map);
      expect(maskedMap.get('sku')).toBe('ITEM-1');
      expect(maskedMap.get('unitCost')).toBeNull();
      expect(maskedMap.get('nested').unitCostMinor).toBeNull();
    });

    it('masks cost fields recursively in nested arrays', () => {
      const report = {
        nestedLevels: [
          [
            { sku: 'A', unitCostMinor: '100' },
            { sku: 'B', unitCostMinor: '200' },
          ],
        ],
      };

      const masked = maskingService.maskCostFields(report, false);
      expect(masked.nestedLevels[0][0].unitCostMinor).toBeNull();
      expect(masked.nestedLevels[0][1].unitCostMinor).toBeNull();
    });
  });

  describe('CostMaskingInterceptor', () => {
    it('masks response data on arbitrary authenticated routes outside old list (e.g. /products, /catalog, /reports)', (done) => {
      const interceptor = new CostMaskingInterceptor(maskingService);

      const mockRequest = {
        url: '/enterprise-hub/catalog/items',
        access: {
          roleKey: SystemRole.SALES,
          permissions: new Set(['catalog:read']),
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;

      const mockHandler = {
        handle: () => of({ sku: 'CAT-1', name: 'کالای کاتالوگ', standardCost: 5000, quantity: 10 }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe({
        next: (result: any) => {
          expect(result.sku).toBe('CAT-1');
          expect(result.standardCost).toBeNull();
          expect(result.quantity).toBe(10);
          done();
        },
      });
    });

    it('masks data when request.access is unset but request.user has role', (done) => {
      const interceptor = new CostMaskingInterceptor(maskingService);

      const mockRequest = {
        url: '/enterprise-hub/manufacturing/orders',
        user: {
          sub: 'user-123',
          tenantRole: SystemRole.SALES,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;

      const mockHandler = {
        handle: () => of({ orderId: 1, unitCostMinor: '500000000' }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe({
        next: (result: any) => {
          expect(result.orderId).toBe(1);
          expect(result.unitCostMinor).toBeNull();
          done();
        },
      });
    });

    it('bypasses explicitly exempt ledger accounting routes', (done) => {
      const interceptor = new CostMaskingInterceptor(maskingService);

      const mockRequest = {
        url: '/enterprise-hub/accounting/vouchers/12',
        user: {
          sub: 'user-123',
          tenantRole: SystemRole.SALES,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;

      const mockHandler = {
        handle: () => of({ voucherId: 12, cost: 5000 }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe({
        next: (result: any) => {
          expect(result.cost).toBe(5000); // Unmasked because route is exempt
          done();
        },
      });
    });
  });
});
