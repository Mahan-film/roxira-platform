import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { TenantStatus } from '../enums/tenant-status.enum';
import { TenantsRepository } from '../repositories/tenants.repository';
import { TenantScope } from '../../access/services/tenant-scope';
import { CORE_TENANT_TABLES } from '../../data_import/repositories/tenant-export.repository';
import { TenantCancellationStatusResponseDto } from '../dto/tenant-cancellation.dto';

export const TENANT_EXPORT_QUEUE = 'tenant-export';
export const TENANT_PURGE_QUEUE = 'tenant-purge';

@Injectable()
export class TenantCancellationService {
  private readonly logger = new Logger(TenantCancellationService.name);

  constructor(
    private readonly tenantsRepo: TenantsRepository,
    private readonly dataSource: DataSource,
    private readonly tenantScope: TenantScope,
    @Optional()
    @InjectQueue(TENANT_EXPORT_QUEUE)
    private readonly exportQueue?: Queue,
    @Optional()
    @InjectQueue(TENANT_PURGE_QUEUE)
    private readonly purgeQueue?: Queue,
  ) {}

  /**
   * Puts an organisation into `cancelled_readonly` status with retention period (Task T148).
   * Grace period is configurable between 30 and 90 days (R5 decision 6).
   */
  async cancelTenant(
    tenantId: string,
    reason?: string,
    gracePeriodDays = 30,
  ): Promise<TenantCancellationStatusResponseDto> {
    if (gracePeriodDays < 30 || gracePeriodDays > 90) {
      throw new BadRequestException('مهلت نگهداری داده‌ها پیش از حذف دائم باید بین ۳۰ تا ۹۰ روز باشد.');
    }

    const tenant = await this.tenantsRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('سازمان یافت نشد.');
    }

    if (tenant.status === TenantStatus.CANCELLED_READONLY) {
      return this.getCancellationStatus(tenantId);
    }

    if (tenant.status === TenantStatus.PURGED) {
      throw new BadRequestException('سازمان قبلاً پاکسازی شده است.');
    }

    const now = new Date();
    const deleteAfter = new Date(now);
    deleteAfter.setDate(deleteAfter.getDate() + gracePeriodDays);

    const updated = await this.tenantsRepo.updateCancellation(
      tenantId,
      TenantStatus.CANCELLED_READONLY,
      deleteAfter,
      now,
      reason ?? null,
    );

    // Queue full export job automatically so a fresh complete archive is ready
    if (this.exportQueue) {
      try {
        await this.exportQueue.add(
          'export-tenant-archive',
          { tenantId, requestedAt: now.toISOString(), reason },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
      } catch (err) {
        this.logger.warn(`Could not enqueue export job for tenant ${tenantId}: ${err}`);
      }
    }

    return this.mapToStatusDto(updated ?? tenant);
  }

  async getCancellationStatus(tenantId: string): Promise<TenantCancellationStatusResponseDto> {
    const tenant = await this.tenantsRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('سازمان یافت نشد.');
    }
    return this.mapToStatusDto(tenant);
  }

  /**
   * Permanently purges all records belonging to tenantId across every tenant table (Task T148).
   * Runs in an atomic transaction inside TenantScope under PostgreSQL RLS (NOSUPERUSER NOBYPASSRLS).
   */
  async purgeTenant(tenantId: string): Promise<{ success: boolean; tenantId: string; purgedTables: string[] }> {
    const tenant = await this.tenantsRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('سازمان یافت نشد.');
    }

    const TABLE_NAME_PATTERN = /^[a-zA-Z0-9_]{1,63}$/;
    const purgedTables: string[] = [];
    let skipped = false;

    await this.tenantScope.run(tenantId, async (manager) => {
      // 0. Acquire row lock on tenant to prevent concurrent purge workers colliding
      const lockedRows: { id: string }[] = await manager.query(
        `SELECT "id" FROM "tenants" WHERE "id" = $1 FOR UPDATE SKIP LOCKED`,
        [tenantId],
      );
      if (!lockedRows || lockedRows.length === 0) {
        this.logger.warn(`Purge skipped for tenant ${tenantId}: lock held by another worker or tenant missing.`);
        skipped = true;
        return;
      }

      // 1. Discover all tables that have tenant_id column
      const tableRows: { table_name: string }[] = await manager.query(`
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'tenant_id'
          AND table_name NOT IN ('tenants', 'users')
        ORDER BY table_name ASC
      `);

      const tables = (tableRows || []).map((r) => r.table_name);
      const targetTables = tables.length > 0 ? tables : [...CORE_TENANT_TABLES];

      // 2. Prevent posted lines trigger block by marking journal entries PURGED first if exists.
      // Do not swallow errors: if this UPDATE fails, abort and roll back the purge transaction.
      if (targetTables.includes('fin_journal_entries')) {
        await manager.query(
          `UPDATE "fin_journal_entries" SET "status" = 'PURGED' WHERE "tenant_id" = $1`,
          [tenantId],
        );
      }

      // 3. Delete records from each tenant table
      for (const table of targetTables) {
        if (!TABLE_NAME_PATTERN.test(table)) continue;
        try {
          await manager.query(`DELETE FROM "${table}" WHERE "tenant_id" = $1`, [tenantId]);
          purgedTables.push(table);
        } catch (tableErr) {
          this.logger.warn(`Could not purge table ${table} for tenant ${tenantId}: ${tableErr}`);
        }
      }

      // 4. Update tenant record status to PURGED atomically inside the same transaction
      await manager.query(
        `UPDATE "tenants" SET "status" = $1, "purged_at" = NOW(), "is_active" = false WHERE "id" = $2`,
        [TenantStatus.PURGED, tenantId],
      );
    });

    if (skipped) {
      return { success: false, tenantId, purgedTables: [] };
    }

    this.logger.log(`Tenant ${tenantId} purged successfully across ${purgedTables.length} tables.`);
    return { success: true, tenantId, purgedTables };
  }

  /**
   * Discovers and purges all cancelled tenants whose retention period (delete_after) has expired.
   */
  async purgeExpiredTenants(now = new Date()): Promise<{ purgedCount: number; tenantIds: string[] }> {
    const expiredTenants = await this.tenantsRepo.findExpiredCancelledTenants(now);
    const purgedIds: string[] = [];

    for (const tenant of expiredTenants) {
      try {
        const res = await this.purgeTenant(tenant.id);
        if (res.success) {
          purgedIds.push(tenant.id);
        }
      } catch (err) {
        this.logger.error(`Failed to purge expired tenant ${tenant.id}: ${err}`);
      }
    }

    return { purgedCount: purgedIds.length, tenantIds: purgedIds };
  }

  private mapToStatusDto(tenant: any): TenantCancellationStatusResponseDto {
    const isReadonly = tenant.status === TenantStatus.CANCELLED_READONLY;
    const deleteAfter = tenant.deleteAfter ? new Date(tenant.deleteAfter) : null;
    const cancelledAt = tenant.cancelledAt ? new Date(tenant.cancelledAt) : null;

    let daysRemaining: number | null = null;
    if (deleteAfter) {
      const diffMs = deleteAfter.getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (24 * 3600 * 1000)));
    }

    return {
      status: tenant.status ?? TenantStatus.ACTIVE,
      isReadonly,
      cancelledAt: cancelledAt ? cancelledAt.toISOString() : null,
      deleteAfter: deleteAfter ? deleteAfter.toISOString() : null,
      daysRemaining,
      cancellationReason: tenant.cancellationReason ?? null,
    };
  }
}
