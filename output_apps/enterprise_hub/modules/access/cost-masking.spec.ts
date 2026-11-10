import { SystemRole } from './catalogue';
import { CostMaskingService } from './services/cost-masking.service';

describe('Hidden Purchase Price and Cost API Protection (#230 / T76)', () => {
  let maskingService: CostMaskingService;

  beforeEach(() => {
    maskingService = new CostMaskingService();
  });

  describe('Role-based Cost Viewing Permission', () => {
    it('denies cost visibility to SALES and CHEQUE_REVIEWER roles', () => {
      expect(maskingService.canViewCost(SystemRole.SALES)).toBe(false);
      expect(maskingService.canViewCost(SystemRole.CHEQUE_REVIEWER)).toBe(false);
    });

    it('allows cost visibility to OWNER, ADMIN, and ACCOUNTANT roles', () => {
      expect(maskingService.canViewCost(SystemRole.OWNER)).toBe(true);
      expect(maskingService.canViewCost(SystemRole.ADMIN)).toBe(true);
      expect(maskingService.canViewCost(SystemRole.ACCOUNTANT)).toBe(true);
    });

    it('fails closed on unknown or empty role', () => {
      expect(maskingService.canViewCost('')).toBe(false);
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
      unitPurchaseCost: 85000000,
      landedCost: 5000000,
      valuation: 1275000000,
      primaryUnit: 'دستگاه',
    };

    it('scrubs purchase price and cost fields from item payload when user cannot view cost', () => {
      const masked = maskingService.maskCostFields(rawStockItem, false);

      expect(masked.sku).toBe('ROX-SERVER-2U');
      expect(masked.name).toBe('سرور سازمانی ۲ یونیت');
      expect(masked.quantity).toBe(15);
      expect(masked.unitPrice).toBe(120000000); // Selling price is kept

      // Sensitive purchase price & valuation fields are masked to null
      expect(masked.unitPurchaseCost).toBeNull();
      expect(masked.landedCost).toBeNull();
      expect(masked.valuation).toBeNull();
    });

    it('preserves all cost fields untouched when user has cost view entitlement', () => {
      const original = maskingService.maskCostFields(rawStockItem, true);

      expect(original.unitPurchaseCost).toBe(85000000);
      expect(original.landedCost).toBe(5000000);
      expect(original.valuation).toBe(1275000000);
    });

    it('masks cost fields recursively in arrays of inventory movements or documents', () => {
      const lines = [
        { sku: 'ITEM-A', quantity: 2, unitPrice: 5000, unitCost: 3500 },
        { sku: 'ITEM-B', quantity: 1, unitPrice: 8000, unitCost: 6000 },
      ];

      const maskedLines = maskingService.maskCostFields(lines, false);

      expect(maskedLines[0].unitPrice).toBe(5000);
      expect(maskedLines[0].unitCost).toBeNull();
      expect(maskedLines[1].unitPrice).toBe(8000);
      expect(maskedLines[1].unitCost).toBeNull();
    });
  });
});
