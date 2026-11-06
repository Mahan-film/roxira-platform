import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { SalesOrderLineEntity, SalesOrderEntity } from '../entities/sales-order.entity';
import { SalesQuotationLineEntity, SalesQuotationEntity } from '../entities/sales-quotation.entity';
import { SalesOrderStatus, SalesQuotationStatus } from '../enums/sales-status.enum';

export interface SalesLineInput {
  lineNo: number;
  itemId: number;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

export interface QuotationHeaderInput {
  number: string;
  partyCode: string;
  quoteDate: string;
  validUntil: string | null;
  note: string | null;
  totalAmount: string;
  createdBy: string | null;
}

export interface OrderHeaderInput {
  number: string;
  partyCode: string;
  quotationId: number | null;
  warehouseId: number;
  orderDate: string;
  promisedDate: string | null;
  note: string | null;
  totalAmount: string;
  createdBy: string | null;
}

export interface SalesFilter {
  partyCode?: string;
  status?: string;
  limit: number;
  offset: number;
}

export interface QuotationWithLines {
  quotation: SalesQuotationEntity;
  lines: SalesQuotationLineEntity[];
}

export interface OrderWithLines {
  order: SalesOrderEntity;
  lines: SalesOrderLineEntity[];
}

/**
 * The only access point to the four sales tables. Every table has FORCE row-level security, so
 * every call runs in a TenantScope transaction (`app.tenant_id`) and every query filters by
 * `tenantId` itself (AGENTS.md §4). Methods taking a `manager` join the transaction opened by
 * `runInTransaction`, so conversion stays atomic.
 */
@Injectable()
export class SalesRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  // ------------------------------------------------------------------ counters

  countQuotations(tenantId: string, manager: EntityManager): Promise<number> {
    return manager.count(SalesQuotationEntity, { where: { tenantId } });
  }

  countOrders(tenantId: string, manager: EntityManager): Promise<number> {
    return manager.count(SalesOrderEntity, { where: { tenantId } });
  }

  // ------------------------------------------------------------------ quotations

  async insertQuotation(
    tenantId: string,
    manager: EntityManager,
    header: QuotationHeaderInput,
    lines: SalesLineInput[],
  ): Promise<SalesQuotationEntity> {
    const repo = manager.getRepository(SalesQuotationEntity);
    const quotation = await repo.save(
      repo.create({ ...header, tenantId, status: SalesQuotationStatus.DRAFT }),
    );
    await this.insertQuotationLines(tenantId, manager, quotation.id, lines);
    return quotation;
  }

  async insertQuotationLines(
    tenantId: string,
    manager: EntityManager,
    quotationId: number,
    lines: SalesLineInput[],
  ): Promise<void> {
    if (lines.length === 0) return;
    await manager.save(
      lines.map((line) => manager.create(SalesQuotationLineEntity, { ...line, tenantId, quotationId })),
    );
  }

  async updateQuotation(
    tenantId: string,
    manager: EntityManager,
    id: number,
    patch: Partial<SalesQuotationEntity>,
  ): Promise<void> {
    await manager.update(SalesQuotationEntity, { id, tenantId }, patch);
  }

  /** Draft editing: drops every line of the quotation and writes the new set. */
  async replaceQuotationLines(
    tenantId: string,
    manager: EntityManager,
    quotationId: number,
    lines: SalesLineInput[],
  ): Promise<void> {
    await manager.delete(SalesQuotationLineEntity, { tenantId, quotationId });
    await this.insertQuotationLines(tenantId, manager, quotationId, lines);
  }

  findQuotation(tenantId: string, id: number): Promise<QuotationWithLines | null> {
    return this.within(tenantId, undefined, async (m) => {
      const quotation = await m.getRepository(SalesQuotationEntity).findOne({ where: { tenantId, id } });
      if (!quotation) return null;
      const lines = await m.getRepository(SalesQuotationLineEntity).find({
        where: { tenantId, quotationId: id },
        order: { lineNo: 'ASC' },
      });
      return { quotation, lines };
    });
  }

  listQuotations(tenantId: string, filter: SalesFilter): Promise<{ rows: SalesQuotationEntity[]; total: number }> {
    return this.within(tenantId, undefined, async (m) => {
      const qb = m
        .getRepository(SalesQuotationEntity)
        .createQueryBuilder('q')
        .where('q.tenant_id = :tenantId', { tenantId });
      if (filter.partyCode) qb.andWhere('q.party_code = :partyCode', { partyCode: filter.partyCode });
      if (filter.status) qb.andWhere('q.status = :status', { status: filter.status });
      const total = await qb.getCount();
      const rows = await qb.orderBy('q.id', 'DESC').limit(filter.limit).offset(filter.offset).getMany();
      return { rows, total };
    });
  }

  // ------------------------------------------------------------------ orders

  async insertOrder(
    tenantId: string,
    manager: EntityManager,
    header: OrderHeaderInput,
    lines: SalesLineInput[],
  ): Promise<SalesOrderEntity> {
    const repo = manager.getRepository(SalesOrderEntity);
    const order = await repo.save(repo.create({ ...header, tenantId, status: SalesOrderStatus.DRAFT }));
    await this.insertOrderLines(tenantId, manager, order.id, lines);
    return order;
  }

  async insertOrderLines(
    tenantId: string,
    manager: EntityManager,
    orderId: number,
    lines: SalesLineInput[],
  ): Promise<void> {
    if (lines.length === 0) return;
    await manager.save(
      lines.map((line) =>
        manager.create(SalesOrderLineEntity, {
          ...line,
          tenantId,
          orderId,
          deliveredQuantity: '0.00',
          invoicedQuantity: '0.00',
        }),
      ),
    );
  }

  async updateOrder(
    tenantId: string,
    manager: EntityManager,
    id: number,
    patch: Partial<SalesOrderEntity>,
  ): Promise<void> {
    await manager.update(SalesOrderEntity, { id, tenantId }, patch);
  }

  /** Draft editing: drops every line of the order and writes the new set. */
  async replaceOrderLines(
    tenantId: string,
    manager: EntityManager,
    orderId: number,
    lines: SalesLineInput[],
  ): Promise<void> {
    await manager.delete(SalesOrderLineEntity, { tenantId, orderId });
    await this.insertOrderLines(tenantId, manager, orderId, lines);
  }

  findOrder(tenantId: string, id: number): Promise<OrderWithLines | null> {
    return this.within(tenantId, undefined, async (m) => {
      const order = await m.getRepository(SalesOrderEntity).findOne({ where: { tenantId, id } });
      if (!order) return null;
      const lines = await m.getRepository(SalesOrderLineEntity).find({
        where: { tenantId, orderId: id },
        order: { lineNo: 'ASC' },
      });
      return { order, lines };
    });
  }

  listOrders(tenantId: string, filter: SalesFilter): Promise<{ rows: SalesOrderEntity[]; total: number }> {
    return this.within(tenantId, undefined, async (m) => {
      const qb = m
        .getRepository(SalesOrderEntity)
        .createQueryBuilder('o')
        .where('o.tenant_id = :tenantId', { tenantId });
      if (filter.partyCode) qb.andWhere('o.party_code = :partyCode', { partyCode: filter.partyCode });
      if (filter.status) qb.andWhere('o.status = :status', { status: filter.status });
      const total = await qb.getCount();
      const rows = await qb.orderBy('o.id', 'DESC').limit(filter.limit).offset(filter.offset).getMany();
      return { rows, total };
    });
  }

  // ------------------------------------------------------------------ cross-module checks (within the scope)

  /** Item ids from `ids` that exist as stock items of this tenant. */
  async existingItemIds(tenantId: string, manager: EntityManager, ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const rows: Array<{ id: number }> = await manager.query(
      `SELECT "id" FROM "erp_stock_items" WHERE "tenant_id" = $1 AND "id" = ANY($2::int[])`,
      [tenantId, ids],
    );
    return new Set(rows.map((row) => Number(row.id)));
  }

  /** True when the warehouse exists for this tenant (active or not; the caller decides). */
  async warehouseExists(tenantId: string, manager: EntityManager, warehouseId: number): Promise<boolean> {
    const rows: Array<{ id: number }> = await manager.query(
      `SELECT "id" FROM "erp_warehouses" WHERE "tenant_id" = $1 AND "id" = $2 LIMIT 1`,
      [tenantId, warehouseId],
    );
    return rows.length > 0;
  }
}
