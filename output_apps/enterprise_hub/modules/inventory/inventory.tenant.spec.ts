import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { AddInventoryTenantIsolation1789170000000 } from '../../migrations/1789170000000-AddInventoryTenantIsolation';
import { InventoryController } from './controllers/inventory.controller';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import {
  InboundStockDto,
  OutboundStockDto,
} from './dto/stock-movement.dto';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import {
  InsufficientStockError,
  StockItemMissingError,
  WarehouseMissingError,
} from './errors/inventory.errors';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryService } from './services/inventory.service';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

const warehouseDto = (name: string): CreateWarehouseDto => ({
  name,
  locationCode: 'LOC-1',
});

const itemDto = (sku: string): CreateStockItemDto => ({
  sku,
  barcode: `BAR-${sku}`,
  name: `Item ${sku}`,
});

const inboundDto = (sku: string, warehouseId?: number): InboundStockDto => ({
  sku,
  quantity: 10,
  unitPurchaseCost: 5,
  warehouseId,
});

const outboundDto = (sku: string, warehouseId?: number): OutboundStockDto => ({
  sku,
  quantity: 4,
  warehouseId,
});

/**
 * Repository درون‌حافظه‌ای که دقیقاً مثل نسخه واقعی هر خواندن/نوشتن را به
 * `tenantId` محدود می‌کند تا رفتار جداسازی مستأجر در سطح سرویس/کنترلر سنجیده شود.
 */
class InMemoryInventoryRepository {
  private warehouses: WarehouseEntity[] = [];
  private items: StockItemEntity[] = [];
  private batchRows: FifoBatchEntity[] = [];
  private sequence = 0;

  async createWarehouse(
    tenantId: string,
    data: { name: string; locationCode: string },
  ): Promise<WarehouseEntity> {
    const entity = {
      ...data,
      id: ++this.sequence,
      tenantId,
      createdAt: new Date(),
    } as WarehouseEntity;
    this.warehouses.push(entity);
    return entity;
  }

  async findAllWarehouses(tenantId: string): Promise<WarehouseEntity[]> {
    return this.warehouses.filter((row) => row.tenantId === tenantId);
  }

  async findWarehouseById(
    tenantId: string,
    id: number,
  ): Promise<WarehouseEntity | null> {
    return (
      this.warehouses.find(
        (row) => row.id === id && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findWarehouseByName(
    tenantId: string,
    name: string,
  ): Promise<WarehouseEntity | null> {
    return (
      this.warehouses.find(
        (row) => row.name === name && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async createStockItem(
    tenantId: string,
    data: Partial<StockItemEntity>,
  ): Promise<StockItemEntity> {
    const entity = {
      quantity: 0,
      minQuantity: 0,
      batchNumber: null,
      ...data,
      id: ++this.sequence,
      tenantId,
    } as StockItemEntity;
    this.items.push(entity);
    return entity;
  }

  async saveStockItem(
    tenantId: string,
    entity: StockItemEntity,
  ): Promise<StockItemEntity> {
    const index = this.items.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index === -1) {
      return entity;
    }
    this.items[index] = { ...this.items[index], ...entity, tenantId };
    return this.items[index];
  }

  async findStockItemById(
    tenantId: string,
    id: number,
  ): Promise<StockItemEntity | null> {
    return (
      this.items.find((row) => row.id === id && row.tenantId === tenantId) ??
      null
    );
  }

  async findStockItemBySku(
    tenantId: string,
    sku: string,
  ): Promise<StockItemEntity | null> {
    return (
      this.items.find((row) => row.sku === sku && row.tenantId === tenantId) ??
      null
    );
  }

  async findAllStockItems(tenantId: string): Promise<StockItemEntity[]> {
    return this.items.filter((row) => row.tenantId === tenantId);
  }

  async findStockItemsAndCount(
    tenantId: string,
    _options: {
      search?: string;
      lowStockOnly: boolean;
      skip: number;
      take: number;
    },
  ): Promise<[StockItemEntity[], number]> {
    const rows = this.items.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }

  async findBatchesBySku(
    tenantId: string,
    sku: string,
    warehouseId: number | null = null,
  ): Promise<FifoBatchEntity[]> {
    return this.batchRows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.sku === sku &&
        (warehouseId === null || row.warehouseId === warehouseId),
    );
  }

  async getBatchAggregates(tenantId: string) {
    const aggregates = new Map<
      string,
      { quantity: number; value: number; count: number }
    >();
    for (const batch of this.batchRows.filter(
      (row) => row.tenantId === tenantId && row.quantityRemaining > 0,
    )) {
      const aggregate = aggregates.get(batch.sku) ?? {
        quantity: 0,
        value: 0,
        count: 0,
      };
      aggregate.quantity += Number(batch.quantityRemaining);
      aggregate.value +=
        Number(batch.quantityRemaining) * Number(batch.unitPurchaseCost);
      aggregate.count += 1;
      aggregates.set(batch.sku, aggregate);
    }
    return Array.from(aggregates.entries()).map(([sku, aggregate]) => ({
      sku,
      batchQuantity: String(aggregate.quantity),
      fifoValue: String(aggregate.value),
      openBatchCount: String(aggregate.count),
    }));
  }

  async getWarehouseStock(tenantId: string, warehouseId: number) {
    const rows = new Map<
      string,
      { name: string; quantity: number; value: number; count: number }
    >();
    for (const batch of this.batchRows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.warehouseId === warehouseId &&
        row.quantityRemaining > 0,
    )) {
      const item = this.items.find(
        (row) => row.sku === batch.sku && row.tenantId === tenantId,
      );
      const aggregate = rows.get(batch.sku) ?? {
        name: item?.name ?? batch.sku,
        quantity: 0,
        value: 0,
        count: 0,
      };
      aggregate.quantity += Number(batch.quantityRemaining);
      aggregate.value +=
        Number(batch.quantityRemaining) * Number(batch.unitPurchaseCost);
      aggregate.count += 1;
      rows.set(batch.sku, aggregate);
    }
    return Array.from(rows.entries()).map(([sku, aggregate]) => ({
      sku,
      name: aggregate.name,
      quantity: String(aggregate.quantity),
      fifoValue: String(aggregate.value),
      openBatchCount: String(aggregate.count),
    }));
  }

  async persistInbound(tenantId: string, input: {
    sku: string;
    quantity: number;
    unitPurchaseCost: number;
    warehouseId: number | null;
    batchNumber: string;
  }) {
    const item = this.items.find(
      (row) => row.sku === input.sku && row.tenantId === tenantId,
    );
    if (!item) {
      throw new StockItemMissingError(input.sku);
    }
    if (
      input.warehouseId !== null &&
      !this.warehouses.find(
        (row) => row.id === input.warehouseId && row.tenantId === tenantId,
      )
    ) {
      throw new WarehouseMissingError(input.warehouseId);
    }
    const batch = {
      id: ++this.sequence,
      tenantId,
      sku: input.sku,
      batchNumber: input.batchNumber,
      quantityRemaining: input.quantity,
      unitPurchaseCost: input.unitPurchaseCost,
      receivedDate: new Date(),
      warehouseId: input.warehouseId,
    } as FifoBatchEntity;
    this.batchRows.push(batch);
    item.quantity = Number(item.quantity) + input.quantity;
    if (!item.batchNumber) {
      item.batchNumber = input.batchNumber;
    }
    return { item, batch };
  }

  async persistOutbound(tenantId: string, input: {
    sku: string;
    quantity: number;
    warehouseId: number | null;
  }) {
    const item = this.items.find(
      (row) => row.sku === input.sku && row.tenantId === tenantId,
    );
    if (!item) {
      throw new StockItemMissingError(input.sku);
    }
    if (
      input.warehouseId !== null &&
      !this.warehouses.find(
        (row) => row.id === input.warehouseId && row.tenantId === tenantId,
      )
    ) {
      throw new WarehouseMissingError(input.warehouseId);
    }

    let remaining = input.quantity;
    const layers: Array<{
      batchId: number;
      batchNumber: string;
      quantity: number;
      unitPurchaseCost: number;
      warehouseId: number | null;
    }> = [];

    const candidates = this.batchRows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.sku === input.sku &&
        row.quantityRemaining > 0 &&
        (input.warehouseId === null || row.warehouseId === input.warehouseId),
    );
    for (const batch of candidates) {
      if (remaining <= 0) {
        break;
      }
      const take = Math.min(Number(batch.quantityRemaining), remaining);
      batch.quantityRemaining = Number(batch.quantityRemaining) - take;
      layers.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantity: take,
        unitPurchaseCost: Number(batch.unitPurchaseCost),
        warehouseId: batch.warehouseId,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new InsufficientStockError(
        input.sku,
        input.quantity,
        input.quantity - remaining,
      );
    }

    item.quantity = Number(item.quantity) - input.quantity;
    return { item, layers };
  }
}

const buildService = () => {
  const repository =
    new InMemoryInventoryRepository() as unknown as InventoryRepository;
  return { repository, service: new InventoryService(repository) };
};

describe('InventoryRepository — tenant scoping', () => {
  it('stamps tenantId on createWarehouse', async () => {
    const warehouses = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new InventoryRepository(
      warehouses as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await repository.createWarehouse('tenant-a', {
      name: 'WH-1',
      locationCode: 'LOC-1',
    });

    expect(warehouses.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', name: 'WH-1' }),
    );
  });

  it('scopes findWarehouseById by tenantId', async () => {
    const warehouses = { findOne: jest.fn(async () => null) };
    const repository = new InventoryRepository(
      warehouses as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await repository.findWarehouseById('tenant-a', 7);

    expect(warehouses.findOne).toHaveBeenCalledWith({
      where: { id: 7, tenantId: 'tenant-a' },
    });
  });

  it('stamps tenantId on createStockItem', async () => {
    const stockItems = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new InventoryRepository(
      {} as never,
      stockItems as never,
      {} as never,
      {} as never,
    );

    await repository.createStockItem('tenant-a', { sku: 'SKU-1' });

    expect(stockItems.create).toHaveBeenCalledWith({
      sku: 'SKU-1',
      tenantId: 'tenant-a',
    });
  });

  it('updates stock item by (id, tenantId) so a foreign id affects zero rows', async () => {
    const stockItems = { update: jest.fn(async () => undefined) };
    const repository = new InventoryRepository(
      {} as never,
      stockItems as never,
      {} as never,
      {} as never,
    );

    await repository.saveStockItem('tenant-a', {
      id: 9,
      tenantId: 'tenant-b',
      sku: 'SKU-1',
    } as StockItemEntity);

    expect(stockItems.update).toHaveBeenCalledWith(
      { id: 9, tenantId: 'tenant-a' },
      expect.any(Object),
    );
  });

  it('injects tenantId into the findStockItemsAndCount query', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };
    const stockItems = { createQueryBuilder: jest.fn(() => query) };
    const repository = new InventoryRepository(
      {} as never,
      stockItems as never,
      {} as never,
      {} as never,
    );

    await repository.findStockItemsAndCount('tenant-a', {
      lowStockOnly: false,
      skip: 0,
      take: 10,
    });

    expect(query.where).toHaveBeenCalledWith('item.tenantId = :tenantId', {
      tenantId: 'tenant-a',
    });
  });

  it('scopes persistInbound to the tenant inside the transaction', async () => {
    const manager = {
      findOne: jest.fn(async () => ({
        sku: 'SKU-1',
        quantity: 0,
        batchNumber: null,
      })),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (m: unknown) => unknown) =>
        callback(manager),
      ),
    };
    const repository = new InventoryRepository(
      {} as never,
      {} as never,
      {} as never,
      dataSource as never,
    );

    await repository.persistInbound('tenant-a', {
      sku: 'SKU-1',
      quantity: 5,
      unitPurchaseCost: 2,
      warehouseId: null,
      batchNumber: 'B-1',
    });

    expect(manager.findOne).toHaveBeenCalledWith(StockItemEntity, {
      where: { sku: 'SKU-1', tenantId: 'tenant-a' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.create).toHaveBeenCalledWith(
      FifoBatchEntity,
      expect.objectContaining({ tenantId: 'tenant-a', sku: 'SKU-1' }),
    );
  });
});

describe('InventoryService — cross-tenant isolation', () => {
  it('does not read another tenant stock item (404)', async () => {
    const { service } = buildService();
    const created = await service.createStockItem('tenant-a', itemDto('SKU-A'));

    await expect(
      service.getStockItem('tenant-b', created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not update another tenant stock item (404) and leaves it unchanged', async () => {
    const { service } = buildService();
    const created = await service.createStockItem('tenant-a', itemDto('SKU-A'));

    await expect(
      service.updateStockItem('tenant-b', created.id, { name: 'Hacked' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stillOriginal = await service.getStockItem('tenant-a', created.id);
    expect(stillOriginal.name).toBe('Item SKU-A');
  });

  it('does not read another tenant warehouse stock (404)', async () => {
    const { service } = buildService();
    const warehouse = await service.createWarehouse('tenant-a', warehouseDto('WA'));

    await expect(
      service.getWarehouseStock('tenant-b', warehouse.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects receiveStock with another tenant warehouseId (404)', async () => {
    const { service } = buildService();
    await service.createStockItem('tenant-a', itemDto('SKU-A'));
    const warehouseB = await service.createWarehouse(
      'tenant-b',
      warehouseDto('WB'),
    );

    await expect(
      service.receiveStock('tenant-a', inboundDto('SKU-A', warehouseB.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects issueStock with another tenant warehouseId (404)', async () => {
    const { service } = buildService();
    await service.createStockItem('tenant-a', itemDto('SKU-A'));
    const warehouseB = await service.createWarehouse(
      'tenant-b',
      warehouseDto('WB'),
    );

    await expect(
      service.issueStock('tenant-a', outboundDto('SKU-A', warehouseB.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only the current tenant stock items', async () => {
    const { service } = buildService();
    await service.createStockItem('tenant-a', itemDto('SKU-A'));
    await service.createStockItem('tenant-b', itemDto('SKU-B'));

    const list = await service.listStockItems('tenant-a', {
      page: 1,
      limit: 20,
    } as never);
    expect(list.total).toBe(1);
    expect(list.data[0].sku).toBe('SKU-A');
  });

  it('excludes another tenant batches and valuation', async () => {
    const { service } = buildService();
    await service.createStockItem('tenant-a', itemDto('SKU-X'));
    await service.createStockItem('tenant-b', itemDto('SKU-X'));
    const warehouseA = await service.createWarehouse(
      'tenant-a',
      warehouseDto('WA'),
    );
    const warehouseB = await service.createWarehouse(
      'tenant-b',
      warehouseDto('WB'),
    );
    await service.receiveStock('tenant-a', inboundDto('SKU-X', warehouseA.id));
    await service.receiveStock('tenant-b', inboundDto('SKU-X', warehouseB.id));

    const batchesA = await service.getStockItemBatches('tenant-a', 'SKU-X');
    expect(batchesA).toHaveLength(1);

    const valuationA = await service.getFifoValuation('tenant-a');
    const rowA = valuationA.rows.find((row) => row.sku === 'SKU-X');
    expect(valuationA.itemCount).toBe(1);
    expect(rowA?.quantity).toBe(10);
  });

  it('allows the same sku / warehouse name in two tenants but not twice in one', async () => {
    const { service } = buildService();

    await expect(
      service.createWarehouse('tenant-a', warehouseDto('SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.createWarehouse('tenant-b', warehouseDto('SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.createWarehouse('tenant-a', warehouseDto('SHARED')),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.createStockItem('tenant-a', itemDto('SKU-SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.createStockItem('tenant-b', itemDto('SKU-SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.createStockItem('tenant-a', itemDto('SKU-SHARED')),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('InventoryController — tenant access rules', () => {
  const setup = async () => {
    const { service } = buildService();
    const controller = new InventoryController(service);
    const created = await service.createStockItem('tenant-a', itemDto('SKU-A'));
    return { controller, itemId: created.id };
  };

  it('denies a user with a null tenant (403)', async () => {
    const { controller, itemId } = await setup();

    await expect(
      controller.getStockItem(
        requestWith({ tenantId: null, role: UserRole.ADMIN }),
        itemId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });


  it('allows the platform ADMIN of the owning tenant', async () => {
    const { controller, itemId } = await setup();

    const result = await controller.getStockItem(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      itemId,
    );

    expect(result.id).toBe(itemId);
  });

  it('allows the tenant OWNER', async () => {
    const { controller, itemId } = await setup();

    const result = await controller.getStockItem(
      requestWith({
        tenantId: 'tenant-a',
        role: UserRole.USER,
        tenantRole: TenantRole.OWNER,
      }),
      itemId,
    );

    expect(result.id).toBe(itemId);
  });

  it('does not let the OWNER of another tenant read tenant A items (404)', async () => {
    const { controller, itemId } = await setup();

    await expect(
      controller.getStockItem(
        requestWith({
          tenantId: 'tenant-b',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
        itemId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AddInventoryTenantIsolation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddInventoryTenantIsolation1789170000000();
    expect(migration.name).toBe('AddInventoryTenantIsolation1789170000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });
});
