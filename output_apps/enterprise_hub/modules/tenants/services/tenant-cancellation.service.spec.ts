import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantStatus } from '../enums/tenant-status.enum';
import { TenantCancellationService } from './tenant-cancellation.service';

describe('TenantCancellationService', () => {
  let service: TenantCancellationService;
  let tenantsRepo: any;
  let dataSource: any;
  let exportQueue: any;
  let purgeQueue: any;
  let queryRunner: any;

  let mockTenantScope: any;
  let mockManager: any;

  beforeEach(() => {
    mockManager = {
      query: jest.fn(),
    };

    mockTenantScope = {
      run: jest.fn(async (_id: string, fn: any) => fn(mockManager)),
    };

    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn(),
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      query: jest.fn(),
    };

    tenantsRepo = {
      findById: jest.fn(),
      updateCancellation: jest.fn(),
      findExpiredCancelledTenants: jest.fn(),
      markPurged: jest.fn(),
    };

    exportQueue = {
      add: jest.fn(),
    };

    purgeQueue = {
      add: jest.fn(),
    };

    service = new TenantCancellationService(
      tenantsRepo,
      dataSource,
      mockTenantScope,
      exportQueue,
      purgeQueue,
    );
  });

  describe('cancelTenant', () => {
    it('throws BadRequestException if gracePeriodDays is outside 30..90', async () => {
      await expect(service.cancelTenant('t1', 'reason', 15)).rejects.toThrow(BadRequestException);
      await expect(service.cancelTenant('t1', 'reason', 95)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if tenant does not exist', async () => {
      tenantsRepo.findById.mockResolvedValue(null);
      await expect(service.cancelTenant('t1', 'reason', 30)).rejects.toThrow(NotFoundException);
    });

    it('returns existing status without error if already cancelled_readonly', async () => {
      const tenant = {
        id: 't1',
        status: TenantStatus.CANCELLED_READONLY,
        deleteAfter: new Date(Date.now() + 10 * 86400000),
        cancelledAt: new Date(),
        cancellationReason: 'Already cancelled',
      };
      tenantsRepo.findById.mockResolvedValue(tenant);

      const res = await service.cancelTenant('t1', 'reason', 30);
      expect(res.status).toBe(TenantStatus.CANCELLED_READONLY);
      expect(res.isReadonly).toBe(true);
      expect(res.cancellationReason).toBe('Already cancelled');
    });

    it('throws BadRequestException if tenant is already purged', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.PURGED });
      await expect(service.cancelTenant('t1', 'reason', 30)).rejects.toThrow(BadRequestException);
    });

    it('updates tenant status to cancelled_readonly, sets deleteAfter, and enqueues export job', async () => {
      const activeTenant = { id: 't1', status: TenantStatus.ACTIVE };
      tenantsRepo.findById.mockResolvedValue(activeTenant);

      const futureDate = new Date(Date.now() + 45 * 86400000);
      const updatedTenant = {
        id: 't1',
        status: TenantStatus.CANCELLED_READONLY,
        deleteAfter: futureDate,
        cancelledAt: new Date(),
        cancellationReason: 'Moving away',
      };
      tenantsRepo.updateCancellation.mockResolvedValue(updatedTenant);

      const res = await service.cancelTenant('t1', 'Moving away', 45);

      expect(tenantsRepo.updateCancellation).toHaveBeenCalledWith(
        't1',
        TenantStatus.CANCELLED_READONLY,
        expect.any(Date),
        expect.any(Date),
        'Moving away',
      );
      expect(exportQueue.add).toHaveBeenCalledWith(
        'tenant-full-export',
        expect.objectContaining({ tenantId: 't1', reason: 'Moving away' }),
        expect.any(Object),
      );
      expect(res.status).toBe(TenantStatus.CANCELLED_READONLY);
      expect(res.isReadonly).toBe(true);
      expect(res.daysRemaining).toBeGreaterThanOrEqual(44);
    });
  });

  describe('getCancellationStatus', () => {
    it('throws NotFoundException if tenant not found', async () => {
      tenantsRepo.findById.mockResolvedValue(null);
      await expect(service.getCancellationStatus('t1')).rejects.toThrow(NotFoundException);
    });

    it('returns status with null daysRemaining when deleteAfter is unset', async () => {
      tenantsRepo.findById.mockResolvedValue({
        id: 't1',
        status: TenantStatus.ACTIVE,
        deleteAfter: null,
        cancelledAt: null,
      });

      const res = await service.getCancellationStatus('t1');
      expect(res.status).toBe(TenantStatus.ACTIVE);
      expect(res.isReadonly).toBe(false);
      expect(res.daysRemaining).toBeNull();
    });
  });

  describe('purgeTenant', () => {
    it('throws NotFoundException if tenant does not exist', async () => {
      tenantsRepo.findById.mockResolvedValue(null);
      await expect(service.purgeTenant('t1')).rejects.toThrow(NotFoundException);
    });

    it('deletes tenant data across discovered tables and updates status to PURGED inside transaction', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.CANCELLED_READONLY });

      mockManager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [{ id: 't1' }];
        }
        if (sql.includes('information_schema.columns')) {
          return [{ table_name: 'fin_journal_entry_lines' }, { table_name: 'crm_contacts' }];
        }
        return [];
      });

      const res = await service.purgeTenant('t1');

      expect(mockTenantScope.run).toHaveBeenCalledWith('t1', expect.any(Function));
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        ['t1'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "tenants" SET "status" = $1'),
        [TenantStatus.PURGED, 't1'],
      );
      expect(res.success).toBe(true);
      expect(res.tenantId).toBe('t1');
      expect(res.purgedTables).toContain('fin_journal_entry_lines');
      expect(res.purgedTables).toContain('crm_contacts');
    });

    it('skips purge when FOR UPDATE SKIP LOCKED returns no rows', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.CANCELLED_READONLY });
      mockManager.query.mockResolvedValueOnce([]);

      const res = await service.purgeTenant('t1');
      expect(res.success).toBe(false);
      expect(res.purgedTables).toEqual([]);
    });

    it('sets transaction-local roxira.tenant_purge and propagates errors', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.CANCELLED_READONLY });
      mockManager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [{ id: 't1' }];
        }
        if (sql.includes('information_schema.columns')) {
          return [{ table_name: 'fin_journal_entries' }];
        }
        if (sql.includes("set_config('roxira.tenant_purge'")) {
          throw new Error('failed to set purge flag');
        }
        return [];
      });

      await expect(service.purgeTenant('t1')).rejects.toThrow('failed to set purge flag');
    });

    it('aborts and does not mark PURGED when a table DELETE fails', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.CANCELLED_READONLY });
      mockManager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [{ id: 't1' }];
        }
        if (sql.includes('information_schema.columns')) {
          return [{ table_name: 'crm_contacts' }];
        }
        if (sql.includes('DELETE FROM "crm_contacts"')) {
          throw new Error('FK constraint prevented delete');
        }
        return [];
      });

      await expect(service.purgeTenant('t1')).rejects.toThrow('FK constraint prevented delete');
      expect(mockManager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "tenants" SET "status" = $1'),
        expect.anything(),
      );
    });

    it('deletes child tables before parent tables according to FK constraints', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.CANCELLED_READONLY });
      const deletedOrder: string[] = [];

      mockManager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [{ id: 't1' }];
        }
        if (sql.includes('information_schema.columns')) {
          // Alphabetically parent comes before child
          return [
            { table_name: 'fin_journal_entries' },
            { table_name: 'fin_journal_entry_lines' },
            { table_name: 'crm_contacts' },
          ];
        }
        if (sql.includes('pg_constraint')) {
          return [
            { child_table: 'fin_journal_entry_lines', parent_table: 'fin_journal_entries' },
          ];
        }
        const m = sql.match(/^DELETE FROM "([^"]+)"/);
        if (m) {
          deletedOrder.push(m[1]);
        }
        return [];
      });

      const res = await service.purgeTenant('t1');

      expect(res.success).toBe(true);
      expect(deletedOrder.indexOf('fin_journal_entry_lines')).toBeLessThan(
        deletedOrder.indexOf('fin_journal_entries'),
      );
    });

    it('propagates error if tenantScope.run fails', async () => {
      tenantsRepo.findById.mockResolvedValue({ id: 't1', status: TenantStatus.CANCELLED_READONLY });
      mockTenantScope.run.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.purgeTenant('t1')).rejects.toThrow('Database error');
    });
  });

  describe('purgeExpiredTenants', () => {
    it('finds expired tenants and purges each one', async () => {
      tenantsRepo.findExpiredCancelledTenants.mockResolvedValue([
        { id: 'exp1' },
        { id: 'exp2' },
      ]);

      const purgeSpy = jest.spyOn(service, 'purgeTenant').mockResolvedValue({
        success: true,
        tenantId: 'exp',
        purgedTables: ['t'],
      });

      const res = await service.purgeExpiredTenants();
      expect(res.purgedCount).toBe(2);
      expect(res.tenantIds).toEqual(['exp1', 'exp2']);
      expect(purgeSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('automated purge scheduler (T148)', () => {
    it('registers repeatable purge sweep job in BullMQ', async () => {
      await service.registerPurgeSchedule();

      expect(purgeQueue.add).toHaveBeenCalledWith(
        'purge-expired',
        { action: 'purge-expired' },
        {
          repeat: { every: 6 * 60 * 60 * 1000 },
          jobId: 'tenant-purge-sweep',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
    });

    it('gracefully handles missing queue in registerPurgeSchedule', async () => {
      const unqueuedService = new TenantCancellationService(
        tenantsRepo,
        dataSource,
        mockTenantScope,
      );

      await expect(unqueuedService.registerPurgeSchedule()).resolves.toBeUndefined();
    });
  });
});
