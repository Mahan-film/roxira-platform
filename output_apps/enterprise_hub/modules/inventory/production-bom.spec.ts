import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BomService } from './services/bom.service';
import { ProductionOrderService } from './services/production-order.service';
import { BomRepository } from './repositories/bom.repository';
import { ProductionOrderRepository } from './repositories/production-order.repository';
import { InventoryRepository } from './repositories/inventory.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { BomHeaderEntity } from './entities/bom-header.entity';
import { BomItemEntity } from './entities/bom-item.entity';
import { ProductionOrderEntity, ProductionOrderStatus } from './entities/production-order.entity';

describe('Production BOM and Production Orders with FIFO costing (T83 / #764)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  let bomService: BomService;
  let productionOrderService: ProductionOrderService;
  let mockBomRepo: jest.Mocked<BomRepository>;
  let mockOrderRepo: jest.Mocked<ProductionOrderRepository>;
  let mockInventoryRepo: jest.Mocked<InventoryRepository>;
  let mockPostingRules: jest.Mocked<PostingRulesService>;

  beforeEach(() => {
    mockBomRepo = {
      createBom: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      list: jest.fn(),
      deleteById: jest.fn(),
    } as unknown as jest.Mocked<BomRepository>;

    mockOrderRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByNumber: jest.fn(),
      list: jest.fn(),
      updateStatus: jest.fn(),
      updateCompletion: jest.fn(),
    } as unknown as jest.Mocked<ProductionOrderRepository>;

    mockInventoryRepo = {
      persistOutbound: jest.fn(),
      persistInbound: jest.fn(),
    } as unknown as jest.Mocked<InventoryRepository>;

    mockPostingRules = {
      post: jest.fn(),
    } as unknown as jest.Mocked<PostingRulesService>;

    bomService = new BomService(mockBomRepo);
    productionOrderService = new ProductionOrderService(
      mockOrderRepo,
      bomService,
      mockInventoryRepo,
      mockPostingRules,
    );
  });

  describe('Multi-level BOM & Waste % Explosion', () => {
    // Finished Good: ROX-DESK-01 (1 wooden desk)
    // - Sub-assembly: ROX-LEG-SET (1 set of legs, sub_bom_id: 2), qty: 1, waste: 0%
    // - Leaf component: ROX-WOOD-PLANK (wood top), qty: 2 planks, waste: 10%
    //
    // Sub-BOM 2 (ROX-LEG-SET, output: 1 set):
    // - Leaf component: ROX-STEEL-TUBE, qty: 4 tubes, waste: 5%
    // - Leaf component: ROX-SCREW, qty: 16 screws, waste: 0%

    const subBom: BomHeaderEntity = {
      id: 2,
      tenantId,
      bomCode: 'BOM-LEG-SET',
      name: 'پایه میز فلزی',
      finishedItemSku: 'ROX-LEG-SET',
      outputQuantity: 1,
      version: 1,
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 11,
          tenantId,
          bomId: 2,
          componentSku: 'ROX-STEEL-TUBE',
          subBomId: null,
          subBom: null,
          quantity: 4,
          wastePercent: 5.0, // 5% waste
          notes: null,
          createdAt: new Date(),
        } as BomItemEntity,
        {
          id: 12,
          tenantId,
          bomId: 2,
          componentSku: 'ROX-SCREW',
          subBomId: null,
          subBom: null,
          quantity: 16,
          wastePercent: 0,
          notes: null,
          createdAt: new Date(),
        } as BomItemEntity,
      ],
    };

    const mainBom: BomHeaderEntity = {
      id: 1,
      tenantId,
      bomCode: 'BOM-DESK-01',
      name: 'میز کار اداری',
      finishedItemSku: 'ROX-DESK-01',
      outputQuantity: 1,
      version: 1,
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 1,
          tenantId,
          bomId: 1,
          componentSku: 'ROX-LEG-SET',
          subBomId: 2, // references Sub-BOM
          subBom,
          quantity: 1,
          wastePercent: 0,
          notes: null,
          createdAt: new Date(),
        } as BomItemEntity,
        {
          id: 2,
          tenantId,
          bomId: 1,
          componentSku: 'ROX-WOOD-PLANK',
          subBomId: null,
          subBom: null,
          quantity: 2,
          wastePercent: 10.0, // 10% waste
          notes: null,
          createdAt: new Date(),
        } as BomItemEntity,
      ],
    };

    it('explodes multi-level BOM correctly with waste percentages for 10 units', async () => {
      mockBomRepo.findById.mockImplementation(async (_t, id) => {
        if (id === 1) return mainBom;
        if (id === 2) return subBom;
        return null;
      });

      const explosion = await bomService.explodeBom(tenantId, 1, 10);

      expect(explosion.requestedQuantity).toBe(10);
      expect(explosion.tree.components).toHaveLength(2);

      // 1. Wood plank (direct leaf): 10 * 2 = 20 net, +10% waste = 22 gross
      const wood = explosion.leafComponents.find((c) => c.sku === 'ROX-WOOD-PLANK')!;
      expect(wood).toBeDefined();
      expect(wood.totalNetQuantity).toBe(20);
      expect(wood.totalGrossQuantity).toBe(22);
      expect(wood.totalWasteQuantity).toBe(2);

      // 2. Steel tube (sub-BOM leaf): 10 units * 4 tubes = 40 net, +5% waste = 42 gross
      const tubes = explosion.leafComponents.find((c) => c.sku === 'ROX-STEEL-TUBE')!;
      expect(tubes).toBeDefined();
      expect(tubes.totalNetQuantity).toBe(40);
      expect(tubes.totalGrossQuantity).toBe(42);
      expect(tubes.totalWasteQuantity).toBe(2);

      // 3. Screws (sub-BOM leaf): 10 units * 16 screws = 160 net, 0% waste = 160 gross
      const screws = explosion.leafComponents.find((c) => c.sku === 'ROX-SCREW')!;
      expect(screws).toBeDefined();
      expect(screws.totalNetQuantity).toBe(160);
      expect(screws.totalGrossQuantity).toBe(160);
      expect(screws.totalWasteQuantity).toBe(0);
    });

    it('detects and prevents circular BOM dependencies (e.g. A -> B -> A)', async () => {
      const bomA = {
        id: 10,
        bomCode: 'BOM-A',
        outputQuantity: 1,
        items: [{ componentSku: 'B-SKU', subBomId: 20, quantity: 1, wastePercent: 0 }],
      } as unknown as BomHeaderEntity;

      const bomB = {
        id: 20,
        bomCode: 'BOM-B',
        outputQuantity: 1,
        items: [{ componentSku: 'A-SKU', subBomId: 10, quantity: 1, wastePercent: 0 }], // cycle back to A
      } as unknown as BomHeaderEntity;

      mockBomRepo.findById.mockImplementation(async (_t, id) => {
        if (id === 10) return bomA;
        if (id === 20) return bomB;
        return null;
      });

      await expect(bomService.explodeBom(tenantId, 10, 1)).rejects.toThrow(BadRequestException);
      await expect(bomService.explodeBom(tenantId, 10, 1)).rejects.toThrow(/Circular BOM dependency/);
    });
  });

  describe('Production Order Lifecycle & FIFO Cost Accounting', () => {
    const activeBom: BomHeaderEntity = {
      id: 1,
      tenantId,
      bomCode: 'BOM-PROD-01',
      name: 'محصول الف',
      finishedItemSku: 'PROD-A',
      outputQuantity: 1,
      version: 1,
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 1,
          tenantId,
          bomId: 1,
          componentSku: 'RAW-01',
          subBomId: null,
          subBom: null,
          quantity: 2,
          wastePercent: 0,
          notes: null,
          createdAt: new Date(),
        } as BomItemEntity,
      ],
    };

    it('creates a production order in DRAFT status', async () => {
      mockBomRepo.findByCode.mockResolvedValueOnce(null);
      mockBomRepo.findById.mockResolvedValueOnce(activeBom);
      mockOrderRepo.findByNumber.mockResolvedValueOnce(null);
      mockOrderRepo.create.mockResolvedValueOnce({
        id: 101,
        tenantId,
        orderNumber: 'PO-2026-001',
        bomId: 1,
        finishedSku: 'PROD-A',
        warehouseId: 1,
        plannedQuantity: 50,
        completedQuantity: 0,
        status: ProductionOrderStatus.DRAFT,
        totalCostMinor: 0n,
        unitCostMinor: 0n,
        voucherId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        bom: activeBom,
      });

      const order = await productionOrderService.createOrder(tenantId, {
        orderNumber: 'PO-2026-001',
        bomId: 1,
        warehouseId: 1,
        plannedQuantity: 50,
      });

      expect(order.orderNumber).toBe('PO-2026-001');
      expect(order.status).toBe(ProductionOrderStatus.DRAFT);
      expect(mockOrderRepo.create).toHaveBeenCalled();
    });

    it('completes production order, consumes FIFO layers, calculates unit cost, inbounds finished good and posts voucher', async () => {
      const draftOrder: ProductionOrderEntity = {
        id: 101,
        tenantId,
        orderNumber: 'PO-2026-001',
        bomId: 1,
        finishedSku: 'PROD-A',
        warehouseId: 1,
        plannedQuantity: 10,
        completedQuantity: 0,
        status: ProductionOrderStatus.IN_PROGRESS,
        totalCostMinor: 0n,
        unitCostMinor: 0n,
        voucherId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        bom: activeBom,
      };

      mockOrderRepo.findById.mockResolvedValue(draftOrder);
      mockBomRepo.findById.mockResolvedValue(activeBom);

      // Exploding for 10 units of PROD-A requires 20 units of RAW-01 (10 * 2)
      // FIFO batches available for RAW-01:
      // Layer 1: 15 units @ 10,000 Rials each = 150,000 Rials
      // Layer 2: 5 units @ 12,000 Rials each = 60,000 Rials
      // Total Raw Cost = 210,000 Rials
      // Unit Cost of Finished Good = 210,000 / 10 = 21,000 Rials
      mockInventoryRepo.persistOutbound.mockResolvedValueOnce({
        item: {} as never,
        layers: [
          {
            batchId: 1,
            batchNumber: 'B1',
            quantity: 15,
            unitPurchaseCost: 10_000,
            warehouseId: 1,
          },
          {
            batchId: 2,
            batchNumber: 'B2',
            quantity: 5,
            unitPurchaseCost: 12_000,
            warehouseId: 1,
          },
        ],
      });

      mockPostingRules.post.mockResolvedValueOnce({
        entryId: 999,
        entryNumber: 'JV-2026-999',
        replayed: false,
      });

      mockOrderRepo.updateCompletion.mockImplementation(async (_t, _id, data) => ({
        ...draftOrder,
        completedQuantity: data.completedQuantity,
        totalCostMinor: data.totalCostMinor,
        unitCostMinor: data.unitCostMinor,
        voucherId: data.voucherId ?? null,
        status: data.status,
      }));

      const completed = await productionOrderService.completeOrder(tenantId, 101, {
        completedQuantity: 10,
      });

      // Assert FIFO consumption was called for 20 units of RAW-01
      expect(mockInventoryRepo.persistOutbound).toHaveBeenCalledWith(tenantId, {
        sku: 'RAW-01',
        quantity: 20,
        warehouseId: 1,
      });

      // Total raw cost = 150,000 + 60,000 = 210,000 Rials
      expect(completed.totalCostMinor).toBe(210_000n);
      // Unit cost = 210,000 / 10 = 21,000 Rials
      expect(completed.unitCostMinor).toBe(21_000n);
      expect(completed.status).toBe(ProductionOrderStatus.COMPLETED);

      // Finished good inbounded into warehouse at unit cost 21,000
      expect(mockInventoryRepo.persistInbound).toHaveBeenCalledWith(tenantId, {
        sku: 'PROD-A',
        quantity: 10,
        unitPurchaseCost: 21_000,
        batchNumber: 'BATCH-PROD-PO-2026-001',
        warehouseId: 1,
      });

      // Posting rules voucher created for 210,000 Rials
      expect(mockPostingRules.post).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          docType: 'inventory.production',
          sourceType: 'production_order',
          sourceId: 'PO-2026-001',
          amounts: { amount: 210_000n },
        }),
      );
      expect(completed.voucherId).toBe(999);
    });
  });
});
