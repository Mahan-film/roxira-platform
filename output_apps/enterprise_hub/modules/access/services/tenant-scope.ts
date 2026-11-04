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
    assertTenantId(tenantId);
    return this.dataSource.transaction(async (manager) => {
      await TenantScope.bind(manager, tenantId);
      return fn(manager);
    });
  }

  /**
   * Runs `fn` on the caller's transaction when there is one, otherwise in a new scope. A caller's
   * manager may come from a transaction that never set the tenant (another module's); binding is
   * idempotent and costs no round trip when the tenant is already set on that connection.
   */
  within<T>(tenantId: string, manager: EntityManager | undefined, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!manager) return this.run(tenantId, fn);
    assertTenantId(tenantId);
    return TenantScope.bind(manager, tenantId).then(() => fn(manager));
  }

  /** Sets `app.tenant_id` for the manager's current transaction (once per query runner and tenant). */
  static async bind(manager: EntityManager, tenantId: string): Promise<void> {
    const data = manager.queryRunner?.data as Record<string, unknown> | undefined;
    if (data && data.appTenantId === tenantId) return;
    await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    if (data) data.appTenantId = tenantId;
  }
}

function assertTenantId(tenantId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error('TenantScope needs a valid tenant id');
  }
}
