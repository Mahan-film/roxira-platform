import 'reflect-metadata';
import { CostingMethod } from './enums/costing-method.enum';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { InventoryRepository } from './repositories/inventory.repository';

const T = 'tenant-test-costing';

describe('Inventory Costing Methods (T195: FIFO, AVCO, STANDARD)', () => {
  let repository: InventoryRepository;
  let items: Map<string, StockItemEntity>;
  let batches: FifoBatchEntity[];
  let nextBatchId = 1;

  beforeEach(() => {
    items = new Map();
    batches = [];
    nextBatchId = 1;

    const fakeManager: any = {
      findOne: jest.fn(async (entityClass: any, opts: any) => {
        if (entityClass === StockItemEntity) {
          return items.get(opts.where.sku) ?? null;
        }
        return null;
      }),
      create: jest.fn((entityClass: any, data: any) => ({ ...data })),
      save: jest.fn(async (entity: any) => {
        if (entity.sku && entity.quantityRemaining !== undefined) {
          if (!entity.id) {
            entity.id = nextBatchId++;
            batches.push(entity);
          } else {
            const idx = batches.findIndex((b) => b.id === entity.id);
            if (idx >= 0) batches[idx] = entity;
          }
          return entity;
        }
        if (entity.sku && entity.quantity !== undefined) {
          items.set(entity.sku, entity);
          return entity;
        }
        return entity;
      }),
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () =>
          batches.filter((b) => b.tenantId === T && b.quantityRemaining > 0),
        ),
      })),
    };

    repository = new InventoryRepository({} as any, {} as any, {} as any, {} as any, {} as any);
    (repository as any).runInTransaction = jest.fn(
      (_t: string, work: (m: any) => any) => work(fakeManager),
    );
    (repository as any).assertWarehouseExists = jest.fn(async () => undefined);
  });

  it('FIFO: receive 10 @ 10 then 10 @ 12, issue 12 => COGS 124, ending 96', async () => {
    const item: StockItemEntity = {
      id: 1,
      tenantId: T,
      sku: 'SKU-FIFO',
      barcode: 'B-FIFO',
      name: 'Item FIFO',
      quantity: 0,
      minQuantity: 0,
      batchNumber: null,
      costingMethod: CostingMethod.FIFO,
    };
    items.set('SKU-FIFO', item);

    await repository.persistInbound(T, {
      sku: 'SKU-FIFO',
      quantity: 10,
      unitPurchaseCost: 10,
      warehouseId: 1,
      batchNumber: 'B1',
      receivedDate: new Date('2026-11-01'),
    });
    await repository.persistInbound(T, {
      sku: 'SKU-FIFO',
      quantity: 10,
      unitPurchaseCost: 12,
      warehouseId: 1,
      batchNumber: 'B2',
      receivedDate: new Date('2026-11-02'),
    });

    const outbound = await repository.persistOutbound(T, {
      sku: 'SKU-FIFO',
      quantity: 12,
      warehouseId: 1,
    });

    const cogs = outbound.layers.reduce((sum, l) => sum + l.quantity * Number(l.unitPurchaseCost), 0); // money-ok: test assertion on small integer unit costs
    expect(cogs).toBe(124);

    const ending = batches
      .filter((b) => b.sku === 'SKU-FIFO')
      .reduce((sum, b) => sum + b.quantityRemaining * Number(b.unitPurchaseCost), 0); // money-ok: test assertion on small integer unit costs
    expect(ending).toBe(96);
  });

  it('AVCO: receive 10 @ 10 then 10 @ 12, issue 12 => COGS 132, ending 88', async () => {
    const item: StockItemEntity = {
      id: 2,
      tenantId: T,
      sku: 'SKU-AVCO',
      barcode: 'B-AVCO',
      name: 'Item AVCO',
      quantity: 0,
      minQuantity: 0,
      batchNumber: null,
      costingMethod: CostingMethod.AVCO,
    };
    items.set('SKU-AVCO', item);

    await repository.persistInbound(T, {
      sku: 'SKU-AVCO',
      quantity: 10,
      unitPurchaseCost: 10,
      warehouseId: 1,
      batchNumber: 'B1',
      receivedDate: new Date('2026-11-01'),
    });
    // First batch has cost 10
    expect(batches[0].unitPurchaseCost).toBe(10);

    await repository.persistInbound(T, {
      sku: 'SKU-AVCO',
      quantity: 10,
      unitPurchaseCost: 12,
      warehouseId: 1,
      batchNumber: 'B2',
      receivedDate: new Date('2026-11-02'),
    });
    // Both batches updated to average cost (100 + 120) / 20 = 11
    expect(batches[0].unitPurchaseCost).toBe(11);
    expect(batches[1].unitPurchaseCost).toBe(11);

    const outbound = await repository.persistOutbound(T, {
      sku: 'SKU-AVCO',
      quantity: 12,
      warehouseId: 1,
    });

    const cogs = outbound.layers.reduce((sum, l) => sum + l.quantity * Number(l.unitPurchaseCost), 0); // money-ok: test assertion on small integer unit costs
    expect(cogs).toBe(132);

    const ending = batches
      .filter((b) => b.sku === 'SKU-AVCO')
      .reduce((sum, b) => sum + b.quantityRemaining * Number(b.unitPurchaseCost), 0); // money-ok: test assertion on small integer unit costs
    expect(ending).toBe(88);
  });

  it('STANDARD: receive 10 @ 10 (PPV +10) then 10 @ 12 (PPV -10), issue 12 => COGS 132, ending 88', async () => {
    const item: StockItemEntity = {
      id: 3,
      tenantId: T,
      sku: 'SKU-STD',
      barcode: 'B-STD',
      name: 'Item STD',
      quantity: 0,
      minQuantity: 0,
      batchNumber: null,
      costingMethod: CostingMethod.STANDARD,
      standardCost: 11,
    };
    items.set('SKU-STD', item);

    const in1 = await repository.persistInbound(T, {
      sku: 'SKU-STD',
      quantity: 10,
      unitPurchaseCost: 10,
      warehouseId: 1,
      batchNumber: 'B1',
      receivedDate: new Date('2026-11-01'),
    });
    expect(in1.priceVariance).toBe(10);
    expect(batches[0].unitPurchaseCost).toBe(11);

    const in2 = await repository.persistInbound(T, {
      sku: 'SKU-STD',
      quantity: 10,
      unitPurchaseCost: 12,
      warehouseId: 1,
      batchNumber: 'B2',
      receivedDate: new Date('2026-11-02'),
    });
    expect(in2.priceVariance).toBe(-10);
    expect(batches[1].unitPurchaseCost).toBe(11);

    const outbound = await repository.persistOutbound(T, {
      sku: 'SKU-STD',
      quantity: 12,
      warehouseId: 1,
    });

    const cogs = outbound.layers.reduce((sum, l) => sum + l.quantity * Number(l.unitPurchaseCost), 0); // money-ok: test assertion on small integer unit costs
    expect(cogs).toBe(132);

    const ending = batches
      .filter((b) => b.sku === 'SKU-STD')
      .reduce((sum, b) => sum + b.quantityRemaining * Number(b.unitPurchaseCost), 0); // money-ok: test assertion on small integer unit costs
    expect(ending).toBe(88);
  });
});
