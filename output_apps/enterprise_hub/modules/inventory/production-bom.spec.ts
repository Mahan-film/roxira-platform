import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { BomHeaderEntity } from './entities/bom-header.entity';
import { BomItemEntity } from './entities/bom-item.entity';
import { ProductionOrderEntity, ProductionOrderStatus } from './entities/production-order.entity';
import { BomRepository } from './repositories/bom.repository';
import { InventoryRepository } from './repositories/inventory.repository';
import { ProductionOrderRepository } from './repositories/production-order.repository';
import { BomService } from './services/bom.service';
import { ProductionOrderService } from './services/production-order.service';

describe('Production BOM and Production Orders with FIFO costing (T83 / #764)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  let bomService: BomService;
  let productionOrderService: ProductionOrderService;
  let mockBomRepo: jest.Mocked<BomRepository>;
  let mockOrderRepo: jest.Mocked<ProductionOrderRepository>;
  let mockInventoryRepo: jest.Mocked<InventoryRepository>;
  let mockPostingRules: jest.Mocked<PostingRulesService>;
  let mockTenantScope: Partial<TenantScope>;
  let mockEntityManager: Partial<EntityManager>;

  beforeEach(() => {
    mockBomRepo = {
      createBom: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      list: jest.fn(),
      deleteById: jest.fn(),
      isUsedAsSubBom: jest.fn().mockResolvedValue(false),
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

    mockEntityManager = {
      getRepository: jest.fn(),
    };

    mockTenantScope = {
      run: jest.fn((_t: string, fn: (em: EntityManager) => any) =>
        fn(mockEntityManager as EntityManager),
      ),
    };

    bomService = new BomService(mockBomRepo, mockOrderRepo);
    productionOrderService = new ProductionOrderService(
      mockOrderRepo,
      bomService,
      mockInventoryRepo,
      mockPostingRules,
      mockTenantScope as TenantScope,
    );
  });

  describe('Multi-level BOM & Waste % Explosion', () => {
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

    it('prevents deleting a BOM with active or existing production orders', async () => {
      mockBomRepo.findById.mockResolvedValueOnce(mainBom);
      mockOrderRepo.list.mockResolvedValueOnce([
        {
          id: 1,
          bomId: 1,
          orderNumber: 'PO-01',
          status: ProductionOrderStatus.IN_PROGRESS,
        } as ProductionOrderEntity,
      ]);

      await expect(bomService.deleteBom(tenantId, 1)).rejects.toThrow(BadRequestException);
      expect(mockBomRepo.deleteById).not.toHaveBeenCalled();
    });

    it('prevents deleting a BOM when it is referenced as a sub-BOM in other BOM items', async () => {
      mockBomRepo.findById.mockResolvedValue({
        id: 2,
        tenantId,
        bomCode: 'BOM-SUB-01',
      } as BomHeaderEntity);
      mockOrderRepo.list.mockResolvedValue([]);
      mockBomRepo.isUsedAsSubBom.mockResolvedValue(true);

      await expect(bomService.deleteBom(tenantId, 2)).rejects.toThrow(
        'امکان حذف فرمول ساختی که به عنوان زیرمجموعه در فرمول ساخت دیگری استفاده شده است وجود ندارد.',
      );
      expect(mockBomRepo.deleteById).not.toHaveBeenCalled();
    });

    it('rejects createBom when sub-BOM is inactive or self-referencing', async () => {
      mockBomRepo.findByCode.mockResolvedValue(null);
      mockBomRepo.findById.mockResolvedValueOnce({
        id: 99,
        tenantId,
        bomCode: 'BOM-INACTIVE',
        isActive: false,
      } as BomHeaderEntity);

      await expect(
        bomService.createBom(tenantId, {
          bomCode: 'BOM-NEW',
          name: 'تست',
          finishedItemSku: 'FG-01',
          items: [{ componentSku: 'SUB-SKU', subBomId: 99, quantity: 1 }],
        }),
      ).rejects.toThrow('is inactive');

      mockBomRepo.findById.mockResolvedValueOnce({
        id: 100,
        tenantId,
        bomCode: 'BOM-SELF',
        isActive: true,
      } as BomHeaderEntity);

      await expect(
        bomService.createBom(tenantId, {
          bomCode: 'BOM-SELF',
          name: 'تست خودارجاعی',
          finishedItemSku: 'FG-01',
          items: [{ componentSku: 'SUB-SKU', subBomId: 100, quantity: 1 }],
        }),
      ).rejects.toThrow('Self-referencing');
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

    it('rejects completeOrder when order is in DRAFT status (must start first)', async () => {
      const draftOrder: ProductionOrderEntity = {
        id: 101,
        tenantId,
        orderNumber: 'PO-2026-001',
        bomId: 1,
        finishedSku: 'PROD-A',
        warehouseId: 1,
        plannedQuantity: 10,
        completedQuantity: 0,
        status: ProductionOrderStatus.DRAFT, // Still in DRAFT!
        totalCostMinor: 0n,
        unitCostMinor: 0n,
        voucherId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        bom: activeBom,
      };

      (mockEntityManager.getRepository as jest.Mock).mockReturnValue({
        findOne: jest.fn().mockResolvedValue(draftOrder),
      });

      await expect(
        productionOrderService.completeOrder(tenantId, 101, {
          completedQuantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns existing order idempotently if already COMPLETED without moving stock', async () => {
      const alreadyCompletedOrder: ProductionOrderEntity = {
        id: 101,
        tenantId,
        orderNumber: 'PO-2026-001',
        bomId: 1,
        finishedSku: 'PROD-A',
        warehouseId: 1,
        plannedQuantity: 10,
        completedQuantity: 10,
        status: ProductionOrderStatus.COMPLETED,
        totalCostMinor: 210000n,
        unitCostMinor: 21000n,
        voucherId: 999,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        bom: activeBom,
      };

      (mockEntityManager.getRepository as jest.Mock).mockReturnValue({
        findOne: jest.fn().mockResolvedValue(alreadyCompletedOrder),
      });

      const res = await productionOrderService.completeOrder(tenantId, 101, {
        completedQuantity: 10,
      });

      expect(res.status).toBe(ProductionOrderStatus.COMPLETED);
      expect(mockInventoryRepo.persistOutbound).not.toHaveBeenCalled();
      expect(mockPostingRules.post).not.toHaveBeenCalled();
    });

    it('completes production order, consumes FIFO layers, calculates unit cost, inbounds finished good and posts voucher', async () => {
      const inProgressOrder: ProductionOrderEntity = {
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

      (mockEntityManager.getRepository as jest.Mock).mockReturnValue({
        findOne: jest.fn().mockResolvedValue(inProgressOrder),
      });
      mockBomRepo.findById.mockResolvedValue(activeBom);

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
        ...inProgressOrder,
        completedQuantity: data.completedQuantity,
        totalCostMinor: data.totalCostMinor,
        unitCostMinor: data.unitCostMinor,
        voucherId: data.voucherId ?? null,
        status: data.status,
      }));

      const completed = await productionOrderService.completeOrder(tenantId, 101, {
        completedQuantity: 10,
      });

      expect(mockInventoryRepo.persistOutbound).toHaveBeenCalledWith(
        tenantId,
        {
          sku: 'RAW-01',
          quantity: 20,
          warehouseId: 1,
        },
        mockEntityManager,
      );

      expect(completed.totalCostMinor).toBe(21_000_000n);
      expect(completed.unitCostMinor).toBe(2_100_000n);
      expect(completed.status).toBe(ProductionOrderStatus.COMPLETED);

      expect(mockInventoryRepo.persistInbound).toHaveBeenCalledWith(
        tenantId,
        {
          sku: 'PROD-A',
          quantity: 10,
          unitPurchaseCost: 21_000,
          batchNumber: 'BATCH-PROD-PO-2026-001',
          warehouseId: 1,
        },
        mockEntityManager,
      );

      expect(mockPostingRules.post).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          docType: 'inventory.production',
          sourceType: 'production_order',
          sourceId: 'PO-2026-001',
          amounts: { amount: 21_000_000n },
        }),
        mockEntityManager,
      );
      expect(completed.voucherId).toBe(999);
    });

    it('fails closed and rolls back without inbounding or posting if outbound throws (insufficient stock)', async () => {
      const inProgressOrder: ProductionOrderEntity = {
        id: 102,
        tenantId,
        orderNumber: 'PO-2026-002',
        bomId: 1,
        finishedSku: 'PROD-A',
        warehouseId: 1,
        plannedQuantity: 5,
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

      (mockEntityManager.getRepository as jest.Mock).mockReturnValue({
        findOne: jest.fn().mockResolvedValue(inProgressOrder),
      });
      mockBomRepo.findById.mockResolvedValue(activeBom);

      mockInventoryRepo.persistOutbound.mockRejectedValueOnce(
        new Error('کسری موجودی کالا'),
      );

      await expect(
        productionOrderService.completeOrder(tenantId, 102, {
          completedQuantity: 5,
        }),
      ).rejects.toThrow('کسری موجودی کالا');

      expect(mockInventoryRepo.persistInbound).not.toHaveBeenCalled();
      expect(mockPostingRules.post).not.toHaveBeenCalled();
      expect(mockOrderRepo.updateCompletion).not.toHaveBeenCalled();
    });

    it('verifies startOrder and cancelOrder enforce status guards', async () => {
      mockOrderRepo.findById.mockResolvedValueOnce({
        id: 201,
        tenantId,
        orderNumber: 'PO-DRAFT',
        status: ProductionOrderStatus.DRAFT,
      } as ProductionOrderEntity);

      mockOrderRepo.updateStatus.mockResolvedValueOnce({
        id: 201,
        tenantId,
        orderNumber: 'PO-DRAFT',
        status: ProductionOrderStatus.IN_PROGRESS,
      } as ProductionOrderEntity);

      await productionOrderService.startOrder(tenantId, 201);
      expect(mockOrderRepo.updateStatus).toHaveBeenCalledWith(
        tenantId,
        201,
        ProductionOrderStatus.IN_PROGRESS,
        [ProductionOrderStatus.DRAFT],
      );

      mockOrderRepo.findById.mockResolvedValueOnce({
        id: 202,
        tenantId,
        orderNumber: 'PO-COMPLETED',
        status: ProductionOrderStatus.COMPLETED,
      } as ProductionOrderEntity);

      await expect(productionOrderService.cancelOrder(tenantId, 202)).rejects.toThrow(
        'Cannot cancel completed order',
      );
    });
  });
});
