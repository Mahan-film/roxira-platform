import { NotFoundException } from '@nestjs/common';
import { EntityRegistryService } from './registry/entity-registry.service';
import { EntityImportAdapter } from './registry/import-registry.types';
import { DataImportBatchRepository } from './repositories/data-import-batch.repository';
import { ImportMappingMemoryRepository } from './repositories/import-mapping-memory.repository';
import { DailyImportQuotaService } from './services/daily-import-quota.service';
import { EntityImportService } from './services/entity-import.service';
import {
  alignMappingToHeaders,
  headerSignature,
  MappingMemoryService,
} from './services/mapping-memory.service';
import { OpenRouterMappingService } from './services/openrouter-mapping.service';
import { UploadStoreService } from './services/upload-store.service';

describe('Mapping templates & per-entity blank templates (T329 / #1152)', () => {
  function makeInMemoryMappingMemory() {
    const store = new Map<
      string,
      {
        id: string;
        tenantId: string;
        signature: string;
        entity: string;
        mapping: Record<string, string | null>;
        uses: number;
      }
    >();

    const repo = {
      find: jest.fn(async (tenantId: string, signature: string) => {
        return store.get(`${tenantId}:${signature}`) ?? null;
      }),
      upsert: jest.fn(
        async (
          tenantId: string,
          signature: string,
          entity: string,
          mapping: Record<string, string | null>,
        ) => {
          const key = `${tenantId}:${signature}`;
          const existing = store.get(key);
          if (existing) {
            existing.entity = entity;
            existing.mapping = mapping;
            existing.uses += 1;
            return;
          }
          store.set(key, {
            id: `mem-${store.size + 1}`,
            tenantId,
            signature,
            entity,
            mapping,
            uses: 1,
          });
        },
      ),
    } as unknown as ImportMappingMemoryRepository;

    return { memory: new MappingMemoryService(repo), repo };
  }

  function makeHarness() {
    const { memory } = makeInMemoryMappingMemory();

    const invoiceAdapter: jest.Mocked<EntityImportAdapter> = {
      key: 'sales-invoices',
      labelFa: 'فاکتور فروش',
      fields: [
        {
          key: 'invoiceNumber',
          labelFa: 'شماره فاکتور',
          required: true,
          type: 'text',
          synonyms: ['invoiceNumber', 'شماره فاکتور'],
        },
        {
          key: 'issueDate',
          labelFa: 'تاریخ صدور',
          required: true,
          type: 'date',
          synonyms: ['issueDate', 'تاریخ صدور'],
        },
        {
          key: 'totalAmount',
          labelFa: 'مبلغ کل',
          required: true,
          type: 'money',
          synonyms: ['totalAmount', 'مبلغ کل'],
        },
      ],
      duplicateKeys: jest.fn((r) => [String(r.values.invoiceNumber)]),
      findExistingDuplicateKeys: jest.fn().mockResolvedValue([]),
      commit: jest.fn().mockResolvedValue({
        inserted: [{ ownerId: 'inv-1', rowNumber: 2 }],
        failed: [],
      }),
      undo: jest.fn(),
    };

    const formulaHeaderAdapter: EntityImportAdapter = {
      key: 'formula-test',
      labelFa: 'تست فرمول',
      fields: [
        { key: 'a', labelFa: '=SUM(A1)', required: false, type: 'text', synonyms: [] },
        { key: 'b', labelFa: 'نام, مشتری', required: false, type: 'text', synonyms: [] },
      ],
      duplicateKeys: () => [],
      findExistingDuplicateKeys: async () => [],
      commit: async () => ({ inserted: [], failed: [] }),
      undo: async () => ({ removed: 0, refused: [] }),
    };

    const registry = {
      all: jest.fn().mockReturnValue([invoiceAdapter]),
      get: jest.fn((key: string) => {
        if (key === 'sales-invoices') return invoiceAdapter;
        if (key === 'formula-test') return formulaHeaderAdapter;
        return null;
      }),
      descriptors: jest.fn().mockReturnValue([]),
      keys: jest.fn().mockReturnValue(['sales-invoices']),
    } as unknown as EntityRegistryService;

    const openRouter = {
      proposeEntity: jest.fn().mockResolvedValue('sales-invoices'),
      proposeMappingForFields: jest.fn().mockResolvedValue({}),
    } as unknown as OpenRouterMappingService;

    const uploadStore = new UploadStoreService();
    const batchRepo = {
      tryReserveBatch: jest.fn().mockResolvedValue(true),
      addItems: jest.fn().mockResolvedValue(undefined),
      setInserted: jest.fn().mockResolvedValue(undefined),
      removeBatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as DataImportBatchRepository;

    const quota = {
      assertWithinQuota: jest.fn().mockResolvedValue(undefined),
      recordImport: jest.fn().mockResolvedValue(undefined),
    } as unknown as DailyImportQuotaService;

    const service = new EntityImportService(
      registry,
      openRouter,
      uploadStore,
      batchRepo,
      quota,
      memory,
    );

    return { service, memory, openRouter, invoiceAdapter };
  }

  it('reuses a saved versioned mapping with dateFormat on a second upload', async () => {
    const { service, openRouter } = makeHarness();

    const csv1 = [
      'شماره فاکتور,تاریخ صدور,مبلغ کل',
      'INV-1,1403/07/15,۱۲٬۵۰۰٬۰۰۰ ریال',
    ].join('\n');

    const preview1 = await service.preview('tenant-1', {
      originalname: 'first.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(csv1, 'utf8'),
    });
    expect(preview1.templateVersion).toBeUndefined();

    await service.commit('tenant-1', {
      uploadId: preview1.uploadId,
      entity: 'sales-invoices',
      mapping: {
        'شماره فاکتور': 'invoiceNumber',
        'تاریخ صدور': 'issueDate',
        'مبلغ کل': 'totalAmount',
      },
      dateFormat: 'jalali',
    });

    (openRouter.proposeMappingForFields as jest.Mock).mockClear();

    const csv2 = [
      'شماره فاکتور,تاریخ صدور,مبلغ کل',
      'INV-2,1403/07/16,۵٬۰۰۰٬۰۰۰ ریال',
    ].join('\n');

    const preview2 = await service.preview('tenant-1', {
      originalname: 'second.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(csv2, 'utf8'),
    });

    expect(preview2.detectedEntity).toBe('sales-invoices');
    expect(preview2.templateVersion).toBe(1);
    expect(preview2.dateFormat).toBe('jalali');
    expect(preview2.mapping).toEqual({
      'شماره فاکتور': 'invoiceNumber',
      'تاریخ صدور': 'issueDate',
      'مبلغ کل': 'totalAmount',
    });
    expect(openRouter.proposeMappingForFields).not.toHaveBeenCalled();

    await service.commit('tenant-1', {
      uploadId: preview2.uploadId,
      entity: 'sales-invoices',
      mapping: preview2.mapping,
      dateFormat: 'jalali',
    });

    const preview3 = await service.preview('tenant-1', {
      originalname: 'third.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(csv2, 'utf8'),
    });
    expect(preview3.templateVersion).toBe(2);
  });

  it('matches Persian and Arabic header aliases (ي/ی, ك/ک, ZWNJ, reordered columns)', async () => {
    const { service } = makeHarness();

    const persianHeaders = ['شماره فاکتور', 'تاریخ صدور', 'مبلغ کل'];
    const arabicReorderedHeaders = ['مبلغ\u200cكل', 'تاريخ صدور', 'شماره فاكتور'];

    expect(headerSignature(persianHeaders)).toBe(
      headerSignature(arabicReorderedHeaders),
    );

    const aligned = alignMappingToHeaders(arabicReorderedHeaders, {
      'شماره فاکتور': 'invoiceNumber',
      'تاریخ صدور': 'issueDate',
      'مبلغ کل': 'totalAmount',
    });
    expect(aligned).toEqual({
      'مبلغ\u200cكل': 'totalAmount',
      'تاريخ صدور': 'issueDate',
      'شماره فاكتور': 'invoiceNumber',
    });

    const csv1 = [
      'شماره فاکتور,تاریخ صدور,مبلغ کل',
      'INV-10,1403/08/01,1000000',
    ].join('\n');
    const p1 = await service.preview('tenant-1', {
      originalname: 'persian.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(csv1, 'utf8'),
    });
    await service.commit('tenant-1', {
      uploadId: p1.uploadId,
      entity: 'sales-invoices',
      mapping: {
        'شماره فاکتور': 'invoiceNumber',
        'تاریخ صدور': 'issueDate',
        'مبلغ کل': 'totalAmount',
      },
      dateFormat: 'jalali',
    });

    const csv2Arabic = [
      'مبلغ\u200cكل,تاريخ صدور,شماره فاكتور',
      '2000000,1403/08/02,INV-11',
    ].join('\n');
    const p2 = await service.preview('tenant-1', {
      originalname: 'arabic-reordered.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(csv2Arabic, 'utf8'),
    });

    expect(p2.templateVersion).toBe(1);
    expect(p2.mapping).toEqual({
      'مبلغ\u200cكل': 'totalAmount',
      'تاريخ صدور': 'issueDate',
      'شماره فاكتور': 'invoiceNumber',
    });
    expect(p2.errors).toEqual([]);
  });

  it('generates per-entity blank CSV templates with UTF-8 BOM and formula neutralization', () => {
    const { service } = makeHarness();

    const tpl = service.getBlankTemplate('sales-invoices');
    expect(tpl.entity).toBe('sales-invoices');
    expect(tpl.fileName).toBe('sales-invoices-template.csv');
    expect(tpl.headers).toEqual(['شماره فاکتور', 'تاریخ صدور', 'مبلغ کل']);
    expect(tpl.csv.startsWith('\uFEFF')).toBe(true);
    expect(tpl.csv).toBe('\uFEFFشماره فاکتور,تاریخ صدور,مبلغ کل\n');

    const safeTpl = service.getBlankTemplate('formula-test');
    expect(safeTpl.csv).toBe('\uFEFF\'=SUM(A1),"نام, مشتری"\n');

    expect(() => service.getBlankTemplate('unknown-entity')).toThrow(
      NotFoundException,
    );
  });
});
