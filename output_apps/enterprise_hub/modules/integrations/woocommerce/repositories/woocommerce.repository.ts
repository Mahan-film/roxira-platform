import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { TenantScope } from '../../../access/services/tenant-scope';
import { WooCommerceConfigEntity } from '../entities/woocommerce-config.entity';
import {
  WooCommerceSyncDirection,
  WooCommerceSyncLogEntity,
  WooCommerceSyncStatus,
} from '../entities/woocommerce-sync-log.entity';
import { WooCommerceSyncLogQueryDto } from '../dto/woocommerce-sync-log.dto';

@Injectable()
export class WooCommerceRepository {
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(WooCommerceConfigEntity)
    private readonly configRepo: Repository<WooCommerceConfigEntity>,
    @InjectRepository(WooCommerceSyncLogEntity)
    private readonly logRepo: Repository<WooCommerceSyncLogEntity>,
    private readonly dataSource: DataSource,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(this.dataSource));
    }
    const conn = this.configRepo?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return null;
  }

  async withOrderLock<T>(
    tenantId: string,
    externalId: string,
    fn: (manager?: EntityManager) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (scope) {
      return scope.run(tenantId, async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
          [tenantId, `wc_order:${externalId}`],
        );
        return fn(manager);
      });
    }
    return fn(undefined);
  }

  async findConfig(tenantId: string): Promise<WooCommerceConfigEntity | null> {
    const scope = this.getScope();
    if (scope) {
      return scope.run(tenantId, async (manager) => {
        return manager.getRepository(WooCommerceConfigEntity).findOne({
          where: { tenantId },
        });
      });
    }
    return this.configRepo.findOne({ where: { tenantId } });
  }

  async saveConfig(
    tenantId: string,
    data: Partial<WooCommerceConfigEntity>,
  ): Promise<WooCommerceConfigEntity> {
    const scope = this.getScope();
    if (scope) {
      return scope.run(tenantId, async (manager) => {
        const repo = manager.getRepository(WooCommerceConfigEntity);
        let existing = await repo.findOne({ where: { tenantId } });
        if (!existing) {
          existing = repo.create({ ...data, tenantId });
        } else {
          Object.assign(existing, data, { tenantId });
        }
        return repo.save(existing);
      });
    }
    let existing = await this.configRepo.findOne({ where: { tenantId } });
    if (!existing) {
      existing = this.configRepo.create({ ...data, tenantId });
    } else {
      Object.assign(existing, data, { tenantId });
    }
    return this.configRepo.save(existing);
  }

  async findSyncLogByExternalId(
    tenantId: string,
    direction: WooCommerceSyncDirection,
    externalId: string,
    manager?: EntityManager,
  ): Promise<WooCommerceSyncLogEntity | null> {
    const findInManager = (mgr: EntityManager) =>
      mgr.getRepository(WooCommerceSyncLogEntity).findOne({
        where: { tenantId, direction, externalId, status: WooCommerceSyncStatus.SUCCESS },
      });

    if (manager) {
      return findInManager(manager);
    }
    const scope = this.getScope();
    if (scope) {
      return scope.run(tenantId, findInManager);
    }
    return this.logRepo.findOne({
      where: { tenantId, direction, externalId, status: WooCommerceSyncStatus.SUCCESS },
    });
  }

  async createSyncLog(
    tenantId: string,
    log: Partial<WooCommerceSyncLogEntity>,
    manager?: EntityManager,
  ): Promise<WooCommerceSyncLogEntity> {
    const createInManager = (mgr: EntityManager) => {
      const repo = mgr.getRepository(WooCommerceSyncLogEntity);
      const entity = repo.create({ ...log, tenantId });
      return repo.save(entity);
    };

    if (manager) {
      return createInManager(manager);
    }
    const scope = this.getScope();
    if (scope) {
      return scope.run(tenantId, createInManager);
    }
    const entity = this.logRepo.create({ ...log, tenantId });
    return this.logRepo.save(entity);
  }

  async listSyncLogs(
    tenantId: string,
    query: WooCommerceSyncLogQueryDto,
  ): Promise<{ items: WooCommerceSyncLogEntity[]; total: number }> {
    const scope = this.getScope();
    const where: FindOptionsWhere<WooCommerceSyncLogEntity> = { tenantId };
    if (query.direction) where.direction = query.direction;
    if (query.status) where.status = query.status;

    if (scope) {
      return scope.run(tenantId, async (manager) => {
        const [items, total] = await manager
          .getRepository(WooCommerceSyncLogEntity)
          .findAndCount({
            where,
            order: { createdAt: 'DESC' },
            take: query.limit || 50,
            skip: query.offset || 0,
          });
        return { items, total };
      });
    }

    const [items, total] = await this.logRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit || 50,
      skip: query.offset || 0,
    });
    return { items, total };
  }
}
