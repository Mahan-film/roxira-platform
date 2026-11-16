import 'reflect-metadata';
import { Job } from 'bullmq';
import { TenantPurgeProcessor } from './tenant-purge.processor';

describe('TenantPurgeProcessor', () => {
  let processor: TenantPurgeProcessor;
  let cancellationService: any;

  beforeEach(() => {
    cancellationService = {
      purgeTenant: jest.fn(),
      purgeExpiredTenants: jest.fn(),
    };
    processor = new TenantPurgeProcessor(cancellationService);
  });

  it('handles purge-single action for a specific tenant', async () => {
    cancellationService.purgeTenant.mockResolvedValue({
      success: true,
      tenantId: 'tenant-abc',
      purgedTables: ['fin_journal_entry_lines'],
    });

    const job = {
      id: 'job-purge-1',
      data: { action: 'purge-single', tenantId: 'tenant-abc' },
    } as unknown as Job;

    const res = await processor.process(job);

    expect(cancellationService.purgeTenant).toHaveBeenCalledWith('tenant-abc');
    expect(res.success).toBe(true);
    expect(res.result.tenantId).toBe('tenant-abc');
  });

  it('handles purge-expired action across all expired tenants', async () => {
    cancellationService.purgeExpiredTenants.mockResolvedValue({
      purgedCount: 3,
      tenantIds: ['t1', 't2', 't3'],
    });

    const job = {
      id: 'job-purge-2',
      data: { action: 'purge-expired' },
    } as unknown as Job;

    const res = await processor.process(job);

    expect(cancellationService.purgeExpiredTenants).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.result.purgedCount).toBe(3);
  });
});
