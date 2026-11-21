import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityImportService } from './entity-import.service';
import { EntityRegistryService } from '../registry/entity-registry.service';
import { OpenRouterMappingService } from './openrouter-mapping.service';
import { UploadStoreService } from './upload-store.service';
import {
  DataImportBatchRepository,
  hashImportMapping,
} from '../repositories/data-import-batch.repository';
import { DailyImportQuotaService } from './daily-import-quota.service';
import {
  AdapterCommitResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from '../registry/import-registry.types';
import { PeriodLockedException } from '../../accounting/exceptions/ledger.exceptions';

describe('Import Idempotency, Batch Tagging & Undo (T326 R32)', () => {
  let service: EntityImportService;
  let registry: EntityRegistryService;
  let openRouter: OpenRouterMappingService;
  let uploadStore: UploadStoreService;
  let batchRepo: DataImportBatchRepository;
  let quota: DailyImportQuotaService;

  const mockAdapter: jest.Mocked<EntityImportAdapter> = {
    key: 'crm-leads',
    labelFa: 'سرنخ‌های CRM',
    fields: [
      { key: 'name', labelFa: 'نام', required: true, type: 'text', synonyms: ['name', 'نام'] },
      { key: 'mobile', labelFa: 'موبایل', required: true, type: 'phone', synonyms: ['mobile', 'موبایل'] },
    ],
    duplicateKeys: jest.fn((record) => (record?.values?.mobile ? [String(record.values.mobile)] : [])),
    findExistingDuplicateKeys: jest.fn().mockResolvedValue([]),
    commit: jest.fn(),
    undo: jest.fn(),
  };

  const accountingAdapter: jest.Mocked<EntityImportAdapter> = {
    key: 'accounting-journal-lines',
    labelFa: 'سطرهای دفتر روزنامه',
    fields: [
      { key: 'voucherNo', labelFa: 'شماره سند', required: true, type: 'text', synonyms: ['voucherNo', 'شماره سند'] },
      { key: 'accountCode', labelFa: 'کد حساب', required: true, type: 'text', synonyms: ['accountCode', 'کد حساب'] },
      { key: 'debit', labelFa: 'بدهکار', required: false, type: 'money', synonyms: ['debit', 'بدهکار'] },
      { key: 'credit', labelFa: 'بستانکار', required: false, type: 'money', synonyms: ['credit', 'بستانکار'] },
    ],
    duplicateKeys: jest.fn().mockReturnValue([]),
    findExistingDuplicateKeys: jest.fn().mockResolvedValue([]),
    commit: jest.fn(),
    undo: jest.fn(),
  };

  beforeEach(() => {
    registry = {
      all: jest.fn().mockReturnValue([mockAdapter, accountingAdapter]),
      get: jest.fn((key: string) => {
        if (key === 'crm-leads') return mockAdapter;
        if (key === 'accounting-journal-lines') return accountingAdapter;
        return null;
      }),
      descriptors: jest.fn().mockReturnValue([]),
      keys: jest.fn().mockReturnValue(['crm-leads', 'accounting-journal-lines']),
    } as unknown as EntityRegistryService;

    openRouter = {
      detectEntity: jest.fn(),
      mapHeaders: jest.fn(),
    } as unknown as OpenRouterMappingService;

    uploadStore = new UploadStoreService();

    batchRepo = {
      createBatch: jest.fn().mockResolvedValue(undefined),
      addItems: jest.fn().mockResolvedValue(undefined),
      findBatch: jest.fn(),
      findByFileHash: jest.fn(),
      listBatches: jest.fn(),
      findItems: jest.fn(),
      setInserted: jest.fn().mockResolvedValue(undefined),
      removeBatch: jest.fn().mockResolvedValue(undefined),
      markUndone: jest.fn().mockResolvedValue(undefined),
      removeItems: jest.fn().mockResolvedValue(undefined),
      countCreatedSince: jest.fn().mockResolvedValue(0),
    } as unknown as DataImportBatchRepository;

    quota = {
      assertWithinQuota: jest.fn().mockResolvedValue(undefined),
      recordImport: jest.fn().mockResolvedValue(undefined),
    } as unknown as DailyImportQuotaService;

    service = new EntityImportService(registry, openRouter, uploadStore, batchRepo, quota);
  });

  describe('Idempotent re-import: the same file twice creates 0 new rows', () => {
    it('creates 0 new rows when the exact same file is imported a second time', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const csvContent = 'name,mobile\nReza,09123456789\nSara,09129876543';
      const fileBuffer = Buffer.from(csvContent, 'utf8');
      const expectedHash = createHash('sha256').update(fileBuffer).digest('hex');

      const mockFile = {
        originalname: 'leads.csv',
        mimetype: 'text/csv',
        buffer: fileBuffer,
      };

      // 1. First import: preview
      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce(null);
      const preview1 = await service.preview(tenantId, mockFile, 'crm-leads');
      expect(preview1.rowCount).toBe(2);

      // Commit first import
      (mockAdapter.commit as jest.Mock).mockResolvedValueOnce({
        inserted: [
          { rowNumber: 1, ownerId: 101 },
          { rowNumber: 2, ownerId: 102 },
        ],
        failed: [],
      });

      const commit1 = await service.commit(tenantId, {
        uploadId: preview1.uploadId,
        entity: 'crm-leads',
        mapping: { name: 'name', mobile: 'mobile' },
      });

      expect(commit1.inserted).toBe(2);
      expect(mockAdapter.commit).toHaveBeenCalledTimes(1);
      const expectedMappingHash = hashImportMapping({ name: 'name', mobile: 'mobile' });
      expect(batchRepo.createBatch).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          entity: 'crm-leads',
          fileHash: expectedHash,
          mappingHash: expectedMappingHash,
          inserted: 0,
        }),
        undefined,
      );
      expect(batchRepo.setInserted).toHaveBeenCalledWith(tenantId, commit1.batchId, 2, undefined);
      expect(batchRepo.addItems).toHaveBeenCalledWith(
        tenantId,
        commit1.batchId,
        'crm-leads',
        [
          { ownerId: 101, rowNumber: 1 },
          { ownerId: 102, rowNumber: 2 },
        ],
        undefined,
      );

      // 2. Second import of the EXACT same file: preview
      const preview2 = await service.preview(tenantId, mockFile, 'crm-leads');

      // An active batch with the fileHash already exists in the repository
      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce({
        id: commit1.batchId,
        tenantId,
        entity: 'crm-leads',
        fileName: 'leads.csv',
        fileHash: expectedHash,
        inserted: 2,
        undone: false,
        createdAt: new Date(),
      });

      const commit2 = await service.commit(tenantId, {
        uploadId: preview2.uploadId,
        entity: 'crm-leads',
        mapping: { name: 'name', mobile: 'mobile' },
      });

      // Done when: the same file twice creates 0 new rows!
      expect(commit2.inserted).toBe(0);
      expect(commit2.skippedDuplicates).toBe(2);
      expect(commit2.batchId).toBe(commit1.batchId);
      // Adapter commit was NOT called a second time
      expect(mockAdapter.commit).toHaveBeenCalledTimes(1);
    });

    it('creates 0 new rows when natural key deduplication skips all rows', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const csvContent = 'name,mobile\nReza,09123456789\nSara,09129876543';
      const mockFile = {
        originalname: 'leads-copy.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from(csvContent, 'utf8'),
      };

      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce(null);
      // Both mobile keys already exist in the database
      (mockAdapter.findExistingDuplicateKeys as jest.Mock).mockResolvedValueOnce([
        '09123456789',
        '09129876543',
      ]);

      const preview = await service.preview(tenantId, mockFile, 'crm-leads');
      (mockAdapter.commit as jest.Mock).mockResolvedValueOnce({
        inserted: [],
        failed: [],
      });

      const commitResult = await service.commit(tenantId, {
        uploadId: preview.uploadId,
        entity: 'crm-leads',
        mapping: { name: 'name', mobile: 'mobile' },
      });

      expect(commitResult.inserted).toBe(0);
      expect(commitResult.skippedDuplicates).toBe(2);
      // Commit was called with empty array (0 unique rows)
      expect(mockAdapter.commit).toHaveBeenCalledWith(tenantId, [], expect.any(Object));
      // Batch reservation is released when 0 rows are inserted so subsequent imports are not blocked
      expect(batchRepo.removeBatch).toHaveBeenCalledWith(tenantId, expect.any(String));
    });
  });

  describe('Undo removes a batch or posts compensating reversals', () => {
    it('removes created rows for master data / unposted entities (CRM leads)', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const batchId = 'batch-uuid-1';

      (batchRepo.findBatch as jest.Mock).mockResolvedValueOnce({
        id: batchId,
        tenantId,
        entity: 'crm-leads',
        fileName: 'leads.csv',
        inserted: 2,
        undone: false,
        createdAt: new Date(),
      });

      (batchRepo.findItems as jest.Mock).mockResolvedValueOnce([
        { tenantId, batchId, entity: 'crm-leads', ownerId: '101', rowNumber: 1 },
        { tenantId, batchId, entity: 'crm-leads', ownerId: '102', rowNumber: 2 },
      ]);

      (mockAdapter.undo as jest.Mock).mockResolvedValueOnce({
        removed: 2,
        refused: [],
      });

      const undoResult = await service.undoBatch(tenantId, batchId);

      expect(undoResult.removed).toBe(2);
      expect(undoResult.refused).toEqual([]);
      expect(mockAdapter.undo).toHaveBeenCalledWith(tenantId, [101, 102]);
      expect(batchRepo.markUndone).toHaveBeenCalledWith(tenantId, batchId);
      expect(batchRepo.removeItems).toHaveBeenCalledWith(tenantId, batchId);
    });

    it('posts compensating reversals for append-only accounting ledger entries', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const batchId = 'batch-uuid-accounting';

      (batchRepo.findBatch as jest.Mock).mockResolvedValueOnce({
        id: batchId,
        tenantId,
        entity: 'accounting-journal-lines',
        fileName: 'vouchers.csv',
        inserted: 2,
        undone: false,
        createdAt: new Date(),
      });

      (batchRepo.findItems as jest.Mock).mockResolvedValueOnce([
        { tenantId, batchId, entity: 'accounting-journal-lines', ownerId: '501', rowNumber: 1 },
        { tenantId, batchId, entity: 'accounting-journal-lines', ownerId: '502', rowNumber: 2 },
      ]);

      // Accounting adapter undo posts compensating reversals in the append-only ledger
      (accountingAdapter.undo as jest.Mock).mockResolvedValueOnce({
        removed: 2, // 2 entries reversed with compensating reversals
        refused: [],
      });

      const undoResult = await service.undoBatch(tenantId, batchId);

      expect(undoResult.removed).toBe(2);
      expect(accountingAdapter.undo).toHaveBeenCalledWith(tenantId, [501, 502]);
      expect(batchRepo.markUndone).toHaveBeenCalledWith(tenantId, batchId);
      expect(batchRepo.removeItems).toHaveBeenCalledWith(tenantId, batchId);
    });

    it('fails closed when an accounting period is locked during undo', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const batchId = 'batch-locked-period';

      (batchRepo.findBatch as jest.Mock).mockResolvedValueOnce({
        id: batchId,
        tenantId,
        entity: 'accounting-journal-lines',
        fileName: 'vouchers.csv',
        inserted: 1,
        undone: false,
        createdAt: new Date(),
      });

      (batchRepo.findItems as jest.Mock).mockResolvedValueOnce([
        { tenantId, batchId, entity: 'accounting-journal-lines', ownerId: '501', rowNumber: 1 },
      ]);

      (accountingAdapter.undo as jest.Mock).mockRejectedValueOnce(
        new PeriodLockedException('Import rollback refused: entry is in a locked period'),
      );

      await expect(service.undoBatch(tenantId, batchId)).rejects.toThrow(PeriodLockedException);
      // Batch must NOT be marked undone if rollback was rejected
      expect(batchRepo.markUndone).not.toHaveBeenCalled();
    });

    it('rejects undo on an already undone batch', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const batchId = 'batch-already-undone';

      (batchRepo.findBatch as jest.Mock).mockResolvedValueOnce({
        id: batchId,
        tenantId,
        entity: 'crm-leads',
        fileName: 'leads.csv',
        inserted: 2,
        undone: true,
        createdAt: new Date(),
      });

      await expect(service.undoBatch(tenantId, batchId)).rejects.toThrow(BadRequestException);
    });

    it('rejects undo on an unknown batch', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      (batchRepo.findBatch as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.undoBatch(tenantId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('allows re-import after a batch has been undone', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const csvContent = 'name,mobile\nReza,09123456789';
      const fileBuffer = Buffer.from(csvContent, 'utf8');

      const mockFile = {
        originalname: 'leads.csv',
        mimetype: 'text/csv',
        buffer: fileBuffer,
      };

      // Since the prior batch was marked undone: true, findByFileHash returns null (only active batches match)
      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce(null);

      const preview = await service.preview(tenantId, mockFile, 'crm-leads');

      (mockAdapter.commit as jest.Mock).mockResolvedValueOnce({
        inserted: [{ rowNumber: 1, ownerId: 103 }],
        failed: [],
      });

      const commitResult = await service.commit(tenantId, {
        uploadId: preview.uploadId,
        entity: 'crm-leads',
        mapping: { name: 'name', mobile: 'mobile' },
      });

      expect(commitResult.inserted).toBe(1);
      expect(batchRepo.createBatch).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ entity: 'crm-leads', inserted: 0 }),
        undefined,
      );
      expect(batchRepo.setInserted).toHaveBeenCalledWith(tenantId, commitResult.batchId, 1, undefined);
    });

    it('scopes fileHash lookup by entity and mappingHash so another entity or mapping imports cleanly (#1216)', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const fileBuffer = Buffer.from('a,b\nReza,09123456789', 'utf8');
      const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
      const file = { originalname: 'same.csv', mimetype: 'text/csv', buffer: fileBuffer };

      const p1 = await service.preview(tenantId, file, 'crm-leads');
      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce(null);
      (mockAdapter.commit as jest.Mock).mockResolvedValueOnce({ inserted: [{ rowNumber: 2, ownerId: 1 }], failed: [] });
      await service.commit(tenantId, { uploadId: p1.uploadId, entity: 'crm-leads', mapping: { a: 'name', b: 'mobile' } });

      const p2 = await service.preview(tenantId, file, 'crm-leads');
      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce(null);
      (mockAdapter.commit as jest.Mock).mockResolvedValueOnce({ inserted: [{ rowNumber: 2, ownerId: 2 }], failed: [] });
      await service.commit(tenantId, { uploadId: p2.uploadId, entity: 'crm-leads', mapping: { b: 'name', a: 'mobile' } });

      const calls = (batchRepo.findByFileHash as jest.Mock).mock.calls;
      expect(calls[0]).toEqual([tenantId, fileHash, 'crm-leads', hashImportMapping({ a: 'name', b: 'mobile' }), undefined]);
      expect(calls[1]).toEqual([tenantId, fileHash, 'crm-leads', hashImportMapping({ b: 'name', a: 'mobile' }), undefined]);
      expect(calls[0][3]).not.toBe(calls[1][3]);
    });

    it('compensates via adapter.undo and removes batch when addItems fails mid-commit (#1216)', async () => {
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const file = { originalname: 'fail.csv', mimetype: 'text/csv', buffer: Buffer.from('name,mobile\nAli,09120000001') };
      const preview = await service.preview(tenantId, file, 'crm-leads');

      (batchRepo.findByFileHash as jest.Mock).mockResolvedValueOnce(null);
      (mockAdapter.commit as jest.Mock).mockResolvedValueOnce({ inserted: [{ rowNumber: 2, ownerId: 777 }], failed: [] });
      (batchRepo.addItems as jest.Mock).mockRejectedValueOnce(new Error('db write failed'));
      (mockAdapter.undo as jest.Mock).mockResolvedValueOnce({ removed: 1, refused: [] });

      await expect(
        service.commit(tenantId, { uploadId: preview.uploadId, entity: 'crm-leads', mapping: { name: 'name', mobile: 'mobile' } }),
      ).rejects.toThrow('db write failed');
      expect(mockAdapter.undo).toHaveBeenCalledWith(tenantId, [777]);
      expect(batchRepo.removeBatch).toHaveBeenCalled();
    });
  });
});
