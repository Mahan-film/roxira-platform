import { CustomerGroup } from '../parties/enums/customer-group.enum';
import { PriceTierEntity } from './entities/price-tier.entity';
import { SalesCommissionPolicyEntity } from './entities/sales-commission-policy.entity';
import { PriceTierService, getCurrentTehranDate } from './services/price-tier.service';
import { SalesCommissionService } from './services/sales-commission.service';
import { PriceTiersRepository } from './repositories/price-tiers.repository';
import { CommissionPoliciesRepository } from './repositories/commission-policies.repository';
import { PriceTiersController } from './controllers/price-tiers.controller';

describe('Price Tiers and Commission (#230 / T74)', () => {
  let priceTierService: PriceTierService;
  let commissionService: SalesCommissionService;
  let mockPriceTiersRepo: jest.Mocked<PriceTiersRepository>;
  let mockCommissionRepo: jest.Mocked<CommissionPoliciesRepository>;
  let controller: PriceTiersController;

  beforeEach(() => {
    mockPriceTiersRepo = {
      create: jest.fn(),
      list: jest.fn(),
      findActiveTiers: jest.fn(),
      deleteById: jest.fn(),
    } as unknown as jest.Mocked<PriceTiersRepository>;

    mockCommissionRepo = {
      upsert: jest.fn(),
      list: jest.fn(),
      getRatesMap: jest.fn(),
      deleteById: jest.fn(),
    } as unknown as jest.Mocked<CommissionPoliciesRepository>;

    priceTierService = new PriceTierService(mockPriceTiersRepo);
    commissionService = new SalesCommissionService(mockCommissionRepo);
    controller = new PriceTiersController(priceTierService, commissionService);
  });

  describe('Customer Group & Price Tier Resolution', () => {
    const basePrice = 10_000_000n; // 10,000,000 Rials base retail price

    const tiers: PriceTierEntity[] = [
      {
        id: 1,
        tenantId: '11111111-1111-1111-1111-111111111111',
        sku: 'ROX-PRO-100',
        customerGroup: CustomerGroup.WHOLESALE,
        unitPrice: 7_500_000n, // 25% lower base unit price for wholesale
        discountPercent: 0,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        tenantId: '11111111-1111-1111-1111-111111111111',
        sku: 'ROX-PRO-100',
        customerGroup: CustomerGroup.PARTNER,
        unitPrice: 6_000_000n,
        discountPercent: 10, // Additional 10% discount on 6,000,000 -> 5,400,000
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('resolves wholesale price tier automatically for wholesale customers', () => {
      const res = priceTierService.resolvePrice(
        'ROX-PRO-100',
        CustomerGroup.WHOLESALE,
        basePrice,
        tiers,
        '2026-06-15',
      );

      expect(res.source).toBe('tier');
      expect(res.customerGroup).toBe(CustomerGroup.WHOLESALE);
      expect(res.unitPriceMinor).toBe(7_500_000n);
      expect(res.discountPercent).toBe(0);
      expect(res.discountAmountMinor).toBe(0n);
      expect(res.effectiveUnitPriceMinor).toBe(7_500_000n);
    });

    it('applies discount percent to unit price using exact integer basis points', () => {
      const res = priceTierService.resolvePrice(
        'ROX-PRO-100',
        CustomerGroup.PARTNER,
        basePrice,
        tiers,
        '2026-06-15',
      );

      expect(res.source).toBe('tier');
      expect(res.customerGroup).toBe(CustomerGroup.PARTNER);
      expect(res.unitPriceMinor).toBe(6_000_000n);
      expect(res.discountPercent).toBe(10);
      expect(res.discountAmountMinor).toBe(600_000n);
      expect(res.effectiveUnitPriceMinor).toBe(5_400_000n);
    });

    it('falls back to default base price for consumer tier when no tier is defined', () => {
      const res = priceTierService.resolvePrice(
        'ROX-PRO-100',
        CustomerGroup.CONSUMER,
        basePrice,
        tiers,
        '2026-06-15',
      );

      expect(res.source).toBe('base_default');
      expect(res.customerGroup).toBe(CustomerGroup.CONSUMER);
      expect(res.unitPriceMinor).toBe(basePrice);
      expect(res.effectiveUnitPriceMinor).toBe(basePrice);
      expect(res.discountPercent).toBe(0);
      expect(res.discountAmountMinor).toBe(0n);
    });

    it('respects effective date window and falls back if expired', () => {
      const res = priceTierService.resolvePrice(
        'ROX-PRO-100',
        CustomerGroup.WHOLESALE,
        basePrice,
        tiers,
        '2027-01-01',
      );

      expect(res.source).toBe('base_default');
      expect(res.unitPriceMinor).toBe(basePrice);
      expect(res.effectiveUnitPriceMinor).toBe(basePrice);
    });

    it('uses Tehran local date as default reference date', () => {
      const tehranDate = getCurrentTehranDate();
      expect(tehranDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resolveForTenant queries active tiers from repository', async () => {
      mockPriceTiersRepo.findActiveTiers.mockResolvedValueOnce(tiers);

      const res = await priceTierService.resolveForTenant(
        't-1',
        'ROX-PRO-100',
        CustomerGroup.WHOLESALE,
        basePrice,
        '2026-06-15',
      );

      expect(mockPriceTiersRepo.findActiveTiers).toHaveBeenCalledWith(
        't-1',
        'ROX-PRO-100',
        CustomerGroup.WHOLESALE,
        '2026-06-15',
      );
      expect(res.effectiveUnitPriceMinor).toBe(7_500_000n);
    });
  });

  describe('Sales Representative Category Commission', () => {
    it('calculates commission in minor units with basis points and half-up rounding', () => {
      // Sale: 20,000,000 Rials, Commission: 7.5% -> 20,000,000 * 750 / 10000 = 1,500,000 Rials
      const commission = commissionService.calculateCommission(20_000_000n, 7.5);
      expect(commission).toBe(1_500_000n);

      // Rounding check: 105 Rials at 5.5% -> (105 * 550 + 5000) / 10000 = (57750 + 5000) / 10000 = 6
      expect(commissionService.calculateCommission(105n, 5.5)).toBe(6n);
    });

    it('returns zero commission on zero or negative amounts or zero rate', () => {
      expect(commissionService.calculateCommission(0n, 5.0)).toBe(0n);
      expect(commissionService.calculateCommission(-500_000n, 5.0)).toBe(0n);
      expect(commissionService.calculateCommission(10_000_000n, 0)).toBe(0n);
    });

    it('throws when commission rate exceeds 100%', () => {
      expect(() => commissionService.calculateCommission(1_000_000n, 105)).toThrow(
        /Commission rate cannot exceed 100%/,
      );
    });

    it('generates grouped monthly commission report with exact grand totals', () => {
      const rates = {
        hardware: 5.0, // 5%
        software: 12.0, // 12%
        services: 8.5, // 8.5%
      };

      const lines = [
        {
          salesRepId: 'REP-01',
          salesRepName: 'علی رضایی',
          category: 'hardware',
          saleAmountMinor: 100_000_000n, // 5,000,000 commission
          invoiceNumber: 'INV-2026-001',
        },
        {
          salesRepId: 'REP-01',
          salesRepName: 'علی رضایی',
          category: 'software',
          saleAmountMinor: 50_000_000n, // 6,000,000 commission
          invoiceNumber: 'INV-2026-002',
        },
        {
          salesRepId: 'REP-02',
          salesRepName: 'سارا احمدی',
          category: 'services',
          saleAmountMinor: 40_000_000n, // 3,400,000 commission
          invoiceNumber: 'INV-2026-003',
        },
      ];

      const report = commissionService.generateMonthlyReport('1405-08', lines, rates);

      expect(report.month).toBe('1405-08');
      expect(report.reps).toHaveLength(2);

      const rep1 = report.reps.find((r) => r.salesRepId === 'REP-01')!;
      expect(rep1.totalSalesMinor).toBe(150_000_000n);
      expect(rep1.totalCommissionMinor).toBe(11_000_000n); // 5M + 6M
      expect(rep1.itemsCount).toBe(2);

      const rep2 = report.reps.find((r) => r.salesRepId === 'REP-02')!;
      expect(rep2.totalSalesMinor).toBe(40_000_000n);
      expect(rep2.totalCommissionMinor).toBe(3_400_000n);
      expect(rep2.itemsCount).toBe(1);

      expect(report.grandTotalSalesMinor).toBe(190_000_000n);
      expect(report.grandTotalCommissionMinor).toBe(14_400_000n);
    });

    it('calculateForTenant loads rates from repository and calculates report', async () => {
      mockCommissionRepo.getRatesMap.mockResolvedValueOnce({ hardware: 5.0 });

      const report = await commissionService.calculateForTenant('t-1', '1405-08', [
        {
          salesRepId: 'REP-01',
          salesRepName: 'علی رضایی',
          category: 'hardware',
          saleAmountMinor: 10_000_000n,
          invoiceNumber: 'INV-01',
        },
      ]);

      expect(mockCommissionRepo.getRatesMap).toHaveBeenCalledWith('t-1');
      expect(report.grandTotalCommissionMinor).toBe(500_000n);
    });
  });

  describe('Entity & Controller Wiring', () => {
    it('PriceTiersController resolvePrice endpoint formats response strings', async () => {
      mockPriceTiersRepo.findActiveTiers.mockResolvedValueOnce([]);

      const req = { user: { tenantId: 't-test', sub: 'u-1' } } as never;
      const res = await controller.resolvePrice(req, {
        sku: 'SKU-1',
        basePriceMinor: '5000000',
      });

      expect(res.source).toBe('base_default');
      expect(res.unitPriceMinor).toBe('5000000');
      expect(res.effectiveUnitPriceMinor).toBe('5000000');
      expect(res.discountAmountMinor).toBe('0');
    });

    it('PriceTiersController calculateCommission endpoint returns formatted report', async () => {
      mockCommissionRepo.getRatesMap.mockResolvedValueOnce({ standard: 10 });

      const req = { user: { tenantId: 't-test', sub: 'u-1' } } as never;
      const res = await controller.calculateCommission(req, {
        month: '1405-08',
        lines: [
          {
            salesRepId: 'R1',
            salesRepName: 'Reza',
            category: 'standard',
            saleAmountMinor: '2000000',
            invoiceNumber: 'INV-1',
          },
        ],
      });

      expect(res.grandTotalSalesMinor).toBe('2000000');
      expect(res.grandTotalCommissionMinor).toBe('200000');
      expect(res.reps[0].totalCommissionMinor).toBe('200000');
    });
  });
});
