import 'reflect-metadata';
import { EntityRegistryService } from '../registry/entity-registry.service';
import { EntityImportAdapter } from '../registry/import-registry.types';
import { EntityImportService } from './entity-import.service';
import { UploadedFilePayload } from './data-import.service';

function makeAdapter() {
  const adapter = {
    key: 'hr-employees',
    labelFa: 'کارمندان',
    fields: [
      {
        key: 'nationalId',
        labelFa: 'کد ملی',
        required: true,
        type: 'national_id',
        synonyms: ['کد ملی', 'national id'],
      },
      {
        key: 'firstName',
        labelFa: 'نام',
        required: true,
        type: 'text',
        synonyms: ['نام', 'name'],
      },
    ],
    duplicateKeys: (record: { values: Record<string, unknown> }) => [
      `national_id:${record.values.nationalId}`,
    ],
    findExistingDuplicateKeys: jest.fn().mockResolvedValue([]),
    commit: jest.fn(),
    undo: jest.fn().mockResolvedValue({ removed: 0, refused: [] }),
  };
  adapter.commit.mockImplementation(
    async (_tenantId: string, records: { rowNumber: number }[]) => ({
      inserted: records.map((record, index) => ({
        rowNumber: record.rowNumber,
        ownerId: 100 + index,
      })),
      failed: [],
    }),
  );
  return adapter;
}

function makeService() {
  const adapter = makeAdapter();
  const registry = new EntityRegistryService([
    adapter as unknown as EntityImportAdapter,
  ]);
  const openRouter = {
    proposeEntity: jest.fn().mockResolvedValue(null),
    proposeMappingForFields: jest.fn().mockResolvedValue({}),
  };
  const uploadStore = {
    save: jest.fn(),
    get: jest.fn(),
    remove: jest.fn(),
  };
  const batchRepository = {
    createBatch: jest.fn().mockResolvedValue(undefined),
    addItems: jest.fn().mockResolvedValue(undefined),
    findBatch: jest.fn(),
    listBatches: jest.fn().mockResolvedValue([]),
    findItems: jest.fn().mockResolvedValue([]),
    markUndone: jest.fn().mockResolvedValue(undefined),
    removeItems: jest.fn().mockResolvedValue(undefined),
    countCreatedSince: jest.fn().mockResolvedValue(0),
  };
  const quota = {
    assertWithinQuota: jest.fn().mockResolvedValue(undefined),
    recordImport: jest.fn().mockResolvedValue(undefined),
    usedToday: jest.fn().mockResolvedValue(0),
  };

  const service = new EntityImportService(
    registry,
    openRouter as never,
    uploadStore as never,
    batchRepository as never,
    quota as never,
  );

  return { service, adapter, openRouter, uploadStore, batchRepository, quota };
}

function csvFile(content: string, name = 'employees.csv'): UploadedFilePayload {
  return {
    originalname: name,
    mimetype: 'text/csv',
    size: content.length,
    buffer: Buffer.from(content, 'utf8'),
  };
}

function storedUpload(
  headers: string[],
  rows: string[][],
  fileName = 'employees.csv',
) {
  return { headers, rows, fileName, expiresAt: Date.now() + 60_000 };
}

describe('EntityImportService.preview', () => {
  it('detects the entity and maps columns with synonyms', async () => {
    const { service, uploadStore } = makeService();

    const result = await service.preview(
      'tenant-1',
      csvFile('کد ملی,نام\n۰۰۷۹۵۴۱۲۳۴,علی'),
    );

    expect(result.detectedEntity).toBe('hr-employees');
    expect(result.confidence).toBe(1);
    expect(result.mapping).toEqual({
      'کد ملی': 'nationalId',
      نام: 'firstName',
    });
    expect(result.errors).toEqual([]);
    expect(result.rowCount).toBe(1);
    expect(uploadStore.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      expect.objectContaining({
        headers: ['کد ملی', 'نام'],
        fileName: 'employees.csv',
      }),
    );
  });

  it('forces the entity when provided', async () => {
    const { service, openRouter } = makeService();
    const result = await service.preview(
      'tenant-1',
      csvFile('کد ملی,نام\n۰۰۷۹۵۴۱۲۳۴,علی'),
      'hr-employees',
    );
    expect(result.detectedEntity).toBe('hr-employees');
    expect(openRouter.proposeEntity).not.toHaveBeenCalled();
  });

  it('calls the LLM to pick the entity when detection is ambiguous', async () => {
    const { service, openRouter } = makeService();
    openRouter.proposeEntity.mockResolvedValue('hr-employees');

    const result = await service.preview(
      'tenant-1',
      csvFile('ستون ناشناس\nمقدار'),
    );

    expect(openRouter.proposeEntity).toHaveBeenCalled();
    expect(result.detectedEntity).toBe('hr-employees');
  });

  it('rejects a missing file', async () => {
    const { service } = makeService();
    await expect(service.preview('tenant-1', undefined)).rejects.toThrow();
  });

  it('rejects the preview when the daily file cap is reached', async () => {
    const { service, quota } = makeService();
    quota.assertWithinQuota.mockRejectedValue(new Error('daily cap reached'));

    await expect(
      service.preview('tenant-1', csvFile('کد ملی,نام\n۰۰۷۹۵۴۱۲۳۴,علی')),
    ).rejects.toThrow('daily cap reached');
  });
});

describe('EntityImportService.commit', () => {
  it('imports, skips duplicates and records the batch', async () => {
    const { service, adapter, uploadStore, batchRepository, quota } =
      makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(
        ['کد ملی', 'نام'],
        [
          ['0079541234', 'علی'],
          ['0079541234', 'حسن'],
          ['1111111111', 'سارا'],
        ],
      ),
    );

    const result = await service.commit('tenant-1', {
      uploadId: '11111111-1111-4111-8111-111111111111',
      entity: 'hr-employees',
      mapping: { 'کد ملی': 'nationalId', نام: 'firstName' },
    });

    expect(result.inserted).toBe(2);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.failed).toEqual([]);
    expect(batchRepository.createBatch).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        entity: 'hr-employees',
        fileName: 'employees.csv',
        inserted: 2,
      }),
    );
    expect(batchRepository.addItems).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      'hr-employees',
      expect.arrayContaining([{ ownerId: 100, rowNumber: 2 }]),
    );
    expect(uploadStore.remove).toHaveBeenCalled();
    expect(quota.recordImport).toHaveBeenCalledWith('tenant-1');
  });

  it('rejects the import when the daily file cap is reached', async () => {
    const { service, uploadStore, quota, adapter } = makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(['کد ملی', 'نام'], [['0079541234', 'علی']]),
    );
    quota.assertWithinQuota.mockRejectedValue(new Error('daily cap reached'));

    await expect(
      service.commit('tenant-1', {
        uploadId: '11111111-1111-4111-8111-111111111111',
        entity: 'hr-employees',
        mapping: { 'کد ملی': 'nationalId', نام: 'firstName' },
      }),
    ).rejects.toThrow('daily cap reached');

    expect(adapter.commit).not.toHaveBeenCalled();
    expect(quota.recordImport).not.toHaveBeenCalled();
  });

  it('reports validation errors per row', async () => {
    const { service, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(
      storedUpload(['کد ملی', 'نام'], [['123', 'علی']]),
    );

    const result = await service.commit('tenant-1', {
      uploadId: '11111111-1111-4111-8111-111111111111',
      entity: 'hr-employees',
      mapping: { 'کد ملی': 'nationalId', نام: 'firstName' },
    });

    expect(result.inserted).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].row).toBe(2);
    expect(result.failed[0].message).toContain('nationalId');
  });

  it('rejects an unknown entity', async () => {
    const { service, uploadStore } = makeService();
    uploadStore.get.mockReturnValue(storedUpload(['a'], [['1']]));

    await expect(
      service.commit('tenant-1', {
        uploadId: '11111111-1111-4111-8111-111111111111',
        entity: 'nope',
        mapping: {},
      }),
    ).rejects.toThrow();
  });
});

describe('EntityImportService.undoBatch', () => {
  it('removes rows and reports refusals', async () => {
    const { service, adapter, batchRepository } = makeService();
    batchRepository.findBatch.mockResolvedValue({
      id: 'b1',
      tenantId: 'tenant-1',
      entity: 'hr-employees',
      fileName: 'employees.csv',
      inserted: 2,
      undone: false,
      createdAt: new Date(),
    });
    batchRepository.findItems.mockResolvedValue([
      { entity: 'hr-employees', ownerId: 1 },
      { entity: 'hr-employees', ownerId: 1 },
      { entity: 'hr-employees', ownerId: 2 },
    ]);
    adapter.undo.mockResolvedValue({
      removed: 1,
      refused: [{ ownerId: 2, message: 'referenced' }],
    });

    const result = await service.undoBatch('tenant-1', 'b1');

    expect(adapter.undo).toHaveBeenCalledWith('tenant-1', [1, 2]);
    expect(result.removed).toBe(1);
    expect(result.refused).toHaveLength(1);
    expect(batchRepository.markUndone).toHaveBeenCalledWith('tenant-1', 'b1');
    expect(batchRepository.removeItems).toHaveBeenCalledWith('tenant-1', 'b1');
  });

  it('refuses to undo an already-undone batch', async () => {
    const { service, batchRepository } = makeService();
    batchRepository.findBatch.mockResolvedValue({
      id: 'b1',
      tenantId: 'tenant-1',
      entity: 'hr-employees',
      fileName: 'employees.csv',
      inserted: 0,
      undone: true,
      createdAt: new Date(),
    });

    await expect(service.undoBatch('tenant-1', 'b1')).rejects.toThrow();
  });

  it('rejects an unknown batch', async () => {
    const { service, batchRepository } = makeService();
    batchRepository.findBatch.mockResolvedValue(null);
    await expect(service.undoBatch('tenant-1', 'missing')).rejects.toThrow();
  });
});
