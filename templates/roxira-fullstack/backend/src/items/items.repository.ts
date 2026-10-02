import { Injectable } from '@nestjs/common';

export interface Item {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
}

export interface Queryable {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}

const ITEM_COLUMNS = 'id, tenant_id AS "tenantId", name, description';

@Injectable()
export class ItemsRepository {
  constructor(private readonly db: Queryable) {}

  async findAll(tenantId: string): Promise<Item[]> {
    return this.db.query<Item>(
      `SELECT ${ITEM_COLUMNS} FROM items WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
  }

  async findById(tenantId: string, id: string): Promise<Item | null> {
    const rows = await this.db.query<Item>(
      `SELECT ${ITEM_COLUMNS} FROM items WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async create(
    tenantId: string,
    id: string,
    name: string,
    description: string | null,
  ): Promise<Item> {
    const rows = await this.db.query<Item>(
      `INSERT INTO items (id, tenant_id, name, description)
       VALUES ($1, $2, $3, $4) RETURNING ${ITEM_COLUMNS}`,
      [id, tenantId, name, description],
    );
    return rows[0];
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.db.query('DELETE FROM items WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      id,
    ]);
  }
}
