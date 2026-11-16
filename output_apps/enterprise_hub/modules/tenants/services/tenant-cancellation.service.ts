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
    const deleteAfter = new Date(now.getTime() + gracePeriodDays * 24 * 3600 * 1000);

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
   * Runs in an atomic transaction.
   */
  async purgeTenant(tenantId: string): Promise<{ success: boolean; tenantId: string; purgedTables: string[] }> {
    const tenant = await this.tenantsRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('سازمان یافت نشد.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const purgedTables: string[] = [];

    try {
      // 1. Discover all tables that have tenant_id column
      const tableRows: { table_name: string }[] = await queryRunner.query(`
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'tenant_id'
          AND table_name NOT IN ('tenants', 'users')
        ORDER BY table_name ASC
      `);

      const tables = (tableRows || []).map((r) => r.table_name);
      const targetTables = tables.length > 0 ? tables : [...CORE_TENANT_TABLES];

      // 2. Temporarily disable TRG_fin_journal_entry_lines_guard_posted if table is being purged
      if (targetTables.includes('fin_journal_entry_lines')) {
        await queryRunner.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM pg_trigger WHERE tgname = 'TRG_fin_journal_entry_lines_guard_posted'
            ) THEN
              ALTER TABLE "fin_journal_entry_lines" DISABLE TRIGGER "TRG_fin_journal_entry_lines_guard_posted";
            END IF;
          END $$;
        `);
      }

      // 3. Delete records from each tenant table
      for (const table of targetTables) {
        try {
          await queryRunner.query(`DELETE FROM "${table}" WHERE "tenant_id" = $1`, [tenantId]);
          purgedTables.push(table);
        } catch (tableErr) {
          this.logger.warn(`Could not purge table ${table} for tenant ${tenantId}: ${tableErr}`);
        }
      }

      // 4. Re-enable guard trigger on journal entry lines
      if (targetTables.includes('fin_journal_entry_lines')) {
        await queryRunner.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM pg_trigger WHERE tgname = 'TRG_fin_journal_entry_lines_guard_posted'
            ) THEN
              ALTER TABLE "fin_journal_entry_lines" ENABLE TRIGGER "TRG_fin_journal_entry_lines_guard_posted";
            END IF;
          END $$;
        `);
      }

      // 5. Update tenant record status to PURGED
      await queryRunner.query(
        `UPDATE "tenants" SET "status" = $1, "purged_at" = NOW(), "is_active" = false WHERE "id" = $2`,
        [TenantStatus.PURGED, tenantId],
      );

      await queryRunner.commitTransaction();
      this.logger.log(`Tenant ${tenantId} purged successfully across ${purgedTables.length} tables.`);
      return { success: true, tenantId, purgedTables };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Purge failed for tenant ${tenantId}: ${err}`);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Discovers and purges all cancelled tenants whose retention period (delete_after) has expired.
   */
  async purgeExpiredTenants(now = new Date()): Promise<{ purgedCount: number; tenantIds: string[] }> {
    const expiredTenants = await this.tenantsRepo.findExpiredCancelledTenants(now);
    const purgedIds: string[] = [];

    for (const tenant of expiredTenants) {
      try {
        await this.purgeTenant(tenant.id);
        purgedIds.push(tenant.id);
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
