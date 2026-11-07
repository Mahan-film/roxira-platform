import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TenantScope } from '../../../access/services/tenant-scope';
import { SalesOrderEntity, SalesOrderLineEntity } from '../../entities/sales-order.entity';
import { SalesDeliveryEntity, SalesDeliveryLineEntity } from '../entities/sales-delivery.entity';
import { QuerySalesDeliveryDto } from '../dto/sales-delivery.dto';

/** Raw row of the open order lines of confirmed orders (backorder report). */
export interface OpenOrderLineRow {
  order_id: number;
  order_number: string;
  party_code: string;
  item_id: number;
  quantity: string;
  delivered_quantity: string;
}

export interface NewDeliveryLine {
  lineNo: number;
  orderLineId: number;
  itemId: number;
  sku: string;
  quantity: string;
  lineCost: string;
}

/**
 * Persistence of delivery notes (#536 T1). Every method takes the manager of the one tenant
 * transaction the service opened, so the order lock, the stock issue, the stock document, the
 * voucher and these rows commit or roll back together.
 */
@Injectable()
export class SalesDeliveryRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  /**
   * Locks the order row and its lines `FOR UPDATE` on the given manager. Query builders map the
   * rows to entities, so camelCase fields such as `deliveredQuantity` are populated.
   */
  async lockOrder(
    tenantId: string,
    manager: EntityManager,
    orderId: number,
  ): Promise<{ order: SalesOrderEntity; lines: SalesOrderLineEntity[] } | null> {
    const order = await manager
      .getRepository(SalesOrderEntity)
      .createQueryBuilder('o')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.id = :orderId', { orderId })
      .setLock('pessimistic_write')
      .getOne();
    if (!order) return null;
    const lines = await manager
      .getRepository(SalesOrderLineEntity)
      .createQueryBuilder('l')
      .where('l.tenantId = :tenantId', { tenantId })
      .andWhere('l.orderId = :orderId', { orderId })
      .orderBy('l.lineNo', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    return { order, lines };
  }

  /** Order header and lines without a lock, for reads. */
  async findOrderWithLines(
    tenantId: string,
    manager: EntityManager,
    orderId: number,
  ): Promise<{ order: SalesOrderEntity; lines: SalesOrderLineEntity[] } | null> {
    const order = await manager.getRepository(SalesOrderEntity).findOne({ where: { tenantId, id: orderId } });
    if (!order) return null;
    const lines = await manager.getRepository(SalesOrderLineEntity).find({
      where: { tenantId, orderId },
      order: { lineNo: 'ASC', id: 'ASC' },
    });
    return { order, lines };
  }

  /** SKU of each stock item, read from `erp_stock_items` by id (the tenant filter is the guard). */
  async skusForItems(tenantId: string, manager: EntityManager, itemIds: number[]): Promise<Map<number, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await manager.query<Array<{ id: number; sku: string }>>(
      `SELECT id, sku FROM erp_stock_items WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [tenantId, itemIds],
    );
    return new Map(rows.map((row) => [Number(row.id), row.sku]));
  }

  async countDeliveries(tenantId: string, manager: EntityManager): Promise<number> {
    return manager.getRepository(SalesDeliveryEntity).count({ where: { tenantId } });
  }

  async findByIdempotencyKey(
    tenantId: string,
    manager: EntityManager,
    key: string,
  ): Promise<SalesDeliveryEntity | null> {
    return manager.getRepository(SalesDeliveryEntity).findOne({ where: { tenantId, idempotencyKey: key } });
  }

  async findDelivery(tenantId: string, manager: EntityManager, id: number): Promise<SalesDeliveryEntity | null> {
    return manager.getRepository(SalesDeliveryEntity).findOne({ where: { tenantId, id } });
  }

  async insertDelivery(
    tenantId: string,
    manager: EntityManager,
    data: Partial<SalesDeliveryEntity>,
  ): Promise<SalesDeliveryEntity> {
    const repo = manager.getRepository(SalesDeliveryEntity);
    return repo.save(repo.create({ ...data, tenantId }));
  }

  async insertLines(
    tenantId: string,
    manager: EntityManager,
    deliveryId: number,
    lines: NewDeliveryLine[],
  ): Promise<SalesDeliveryLineEntity[]> {
    const repo = manager.getRepository(SalesDeliveryLineEntity);
    return repo.save(repo.create(lines.map((line) => ({ ...line, tenantId, deliveryId }))));
  }

  /** One update for the stock document and the voucher links, set after both exist. */
  async setPostingLinks(
    tenantId: string,
    manager: EntityManager,
    id: number,
    links: { stockDocumentId: number; journalEntryId: number | null },
  ): Promise<void> {
    await manager.getRepository(SalesDeliveryEntity).update({ tenantId, id }, links);
  }

  /** Adds a delivered quantity (decimal text) to an order line; the table CHECK is the last guard. */
  async addDelivered(
    tenantId: string,
    manager: EntityManager,
    orderLineId: number,
    quantity: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE erp_sales_order_lines SET delivered_quantity = delivered_quantity + $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, orderLineId, quantity],
    );
  }

  async linesOf(tenantId: string, manager: EntityManager, deliveryIds: number[]): Promise<SalesDeliveryLineEntity[]> {
    if (deliveryIds.length === 0) return [];
    return manager.getRepository(SalesDeliveryLineEntity).find({
      where: { tenantId, deliveryId: In(deliveryIds) },
      order: { deliveryId: 'ASC', lineNo: 'ASC' },
    });
  }

  async listDeliveries(
    tenantId: string,
    manager: EntityManager,
    filter: QuerySalesDeliveryDto,
  ): Promise<{ rows: SalesDeliveryEntity[]; total: number }> {
    const qb = manager
      .getRepository(SalesDeliveryEntity)
      .createQueryBuilder('d')
      .where('d.tenantId = :tenantId', { tenantId });
    if (filter.orderId) qb.andWhere('d.orderId = :orderId', { orderId: filter.orderId });
    if (filter.partyCode) qb.andWhere('d.partyCode = :partyCode', { partyCode: filter.partyCode });
    const total = await qb.getCount();
    const rows = await qb.orderBy('d.id', 'DESC').offset(filter.offset).limit(filter.limit).getMany();
    return { rows, total };
  }

  /** Open lines (order lines of CONFIRMED orders) for the backorder report, oldest order first. */
  async openConfirmedLines(
    tenantId: string,
    manager: EntityManager,
    partyCode: string | null,
  ): Promise<OpenOrderLineRow[]> {
    return manager.query<OpenOrderLineRow[]>(
      `SELECT o.id AS order_id, o.number AS order_number, o.party_code, l.item_id, l.quantity, l.delivered_quantity
         FROM erp_sales_orders o
         JOIN erp_sales_order_lines l ON l.order_id = o.id AND l.tenant_id = o.tenant_id
        WHERE o.tenant_id = $1 AND o.status = 'CONFIRMED' AND ($2::varchar IS NULL OR o.party_code = $2)
        ORDER BY o.id, l.line_no, l.id`,
      [tenantId, partyCode],
    );
  }
}
