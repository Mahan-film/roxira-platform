import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Runs `fn` in a transaction whose `app.tenant_id` setting is the given tenant.
 * Row-level-security policies on tenant tables read that setting, so even a
 * repository bug cannot return another tenant's rows. `set_config(..., true)`
 * is transaction-local, which makes this safe with PgBouncer transaction pooling
 * (the value never leaks to the next client of the same server connection).
 */
@Injectable()
export class TenantScope {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
      throw new Error('TenantScope needs a valid tenant id');
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return fn(manager);
    });
  }
}
