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
    });

    it('preserves Buffer, Date, and primitive values inside payload', () => {
      const payload = {
        id: 1,
        date: new Date('2026-11-10T12:00:00Z'),
        buf: Buffer.from('test-data'),
        count: 42,
        active: true,
        unitCost: 1000,
      };

      const masked = maskingService.maskCostFields(payload, false);
      expect(masked.date).toBeInstanceOf(Date);
      expect(Buffer.isBuffer(masked.buf)).toBe(true);
      expect(masked.count).toBe(42);
      expect(masked.active).toBe(true);
      expect(masked.unitCost).toBeNull();
    });

    it('masks cost fields recursively in nested objects and arrays', () => {
      const report = {
        reportName: 'موجودی انبار',
        generatedAt: new Date('2026-11-11T00:00:00Z'),
        summary: {
          totalItems: 100,
          totalCost: 500000000,
        },
        items: [
          { sku: 'A', quantity: 10, unitPrice: 2000, unitCost: 1500 },
          { sku: 'B', quantity: 5, unitPrice: 4000, unitCost: 3000 },
        ],
      };

      const masked = maskingService.maskCostFields(report, false);
      expect(masked.reportName).toBe('موجودی انبار');
      expect(masked.summary.totalItems).toBe(100);
      expect(masked.summary.totalCost).toBeNull();
      expect(masked.items[0].unitCost).toBeNull();
      expect(masked.items[1].unitCost).toBeNull();
    });
  });

  describe('CostMaskingInterceptor', () => {
    it('masks response data when caller role lacks cost visibility', (done) => {
      const interceptor = new CostMaskingInterceptor(maskingService);

      const mockRequest = {
        access: {
          roleKey: SystemRole.SALES,
          permissions: new Set(['inventory:read']),
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;

      const mockHandler = {
        handle: () => of({ sku: 'ITEM-1', name: 'کالا', unitCost: 5000, quantity: 10 }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe({
        next: (result: any) => {
          expect(result.sku).toBe('ITEM-1');
          expect(result.name).toBe('کالا');
          expect(result.quantity).toBe(10);
          expect(result.unitCost).toBeNull();
          done();
        },
      });
    });

    it('leaves response untouched when caller role has cost visibility', (done) => {
      const interceptor = new CostMaskingInterceptor(maskingService);

      const mockRequest = {
        access: {
          roleKey: SystemRole.ADMIN,
          permissions: new Set(['inventory:read']),
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;

      const mockHandler = {
        handle: () => of({ sku: 'ITEM-1', unitCost: 5000 }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe({
        next: (result: any) => {
          expect(result.unitCost).toBe(5000);
          done();
        },
      });
    });
  });
});
