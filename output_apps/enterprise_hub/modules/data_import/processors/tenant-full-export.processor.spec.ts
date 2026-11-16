import 'reflect-metadata';
import { Job } from 'bullmq';
import { TenantFullExportProcessor } from './tenant-full-export.processor';

describe('TenantFullExportProcessor', () => {
  let processor: TenantFullExportProcessor;
  let exportService: any;

  beforeEach(() => {
    exportService = {
      generateFullExportZip: jest.fn(),
    };
    processor = new TenantFullExportProcessor(exportService);
  });

  it('generates full export zip and returns metadata on success', async () => {
    exportService.generateFullExportZip.mockResolvedValue({
      buffer: Buffer.from('mock-zip'),
      metadata: {
        checksum: 'abc123sha256',
        tenantId: 'tenant-100',
        exportedAt: new Date().toISOString(),
        tableCount: 15,
        totalRows: 120,
        files: ['customers.csv', 'invoices.csv'],
      },
      filename: 'tenant-100-export-20261116.zip',
    });

    const job = {
      id: 'job-1',
      data: { tenantId: 'tenant-100' },
    } as unknown as Job;

    const result = await processor.process(job);

    expect(exportService.generateFullExportZip).toHaveBeenCalledWith('tenant-100');
    expect(result).toEqual({
      success: true,
      filename: 'tenant-100-export-20261116.zip',
      checksum: 'abc123sha256',
    });
  });
});
