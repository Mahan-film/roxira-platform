import { Injectable } from '@nestjs/common';
import {
  InventoryImportItemInput,
  InventoryService,
} from '../../inventory/services/inventory.service';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/** رجیستری ورود داده کالاهای انبار. */
@Injectable()
export class InventoryItemsRegistry implements EntityImportAdapter {
  readonly key = 'inventory-items';
  readonly labelFa = 'کالاهای انبار';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'sku',
      labelFa: 'کد کالا (SKU)',
      required: true,
      type: 'text',
      synonyms: [
        'sku',
        'code',
        'item code',
        'product code',
        'stock code',
        'کد کالا',
        'کد',
        'شناسه کالا',
      ],
    },
    {
      key: 'barcode',
      labelFa: 'بارکد',
      required: false,
      type: 'text',
      synonyms: ['barcode', 'bar code', 'بارکد', 'بار کد'],
    },
    {
      key: 'name',
      labelFa: 'نام کالا',
      required: true,
      type: 'text',
      synonyms: [
        'name',
        'item name',
        'product name',
        'title',
        'نام کالا',
        'نام',
        'شرح کالا',
      ],
    },
    {
      key: 'quantity',
      labelFa: 'موجودی',
      required: false,
      type: 'number',
      synonyms: [
        'quantity',
        'qty',
        'stock',
        'on hand',
        'موجودی',
        'تعداد',
        'مقدار',
      ],
    },
    {
      key: 'minQuantity',
      labelFa: 'حداقل موجودی',
      required: false,
      type: 'number',
      synonyms: [
        'minQuantity',
        'min quantity',
        'reorder level',
        'حداقل موجودی',
        'نقطه سفارش',
      ],
    },
    {
      key: 'batchNumber',
      labelFa: 'شماره دسته',
      required: false,
      type: 'text',
      synonyms: [
        'batchNumber',
        'batch',
        'lot',
        'lot number',
        'شماره دسته',
        'بچ',
        'لات',
      ],
    },
  ];

  constructor(private readonly inventoryService: InventoryService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const sku = record.values.sku;
    if (typeof sku === 'string' && sku.trim()) {
      return [`sku:${sku.trim()}`];
    }
    return [];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const skus = keys
      .filter((key) => key.startsWith('sku:'))
      .map((key) => key.slice('sku:'.length));
    const found = await this.inventoryService.findExistingSkus(tenantId, skus);
    return found.map((sku) => `sku:${sku}`);
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const inserted: CommitRowResult[] = [];
    const failed = [];

    for (const record of records) {
      try {
        const ids = await this.inventoryService.importStockItems(tenantId, [
          this.toInput(record),
        ]);
        inserted.push({ rowNumber: record.rowNumber, ownerId: ids[0] });
      } catch (error) {
        failed.push({
          rowNumber: record.rowNumber,
          message: this.errorMessage(error, 'درج کالا ناموفق بود.'),
        });
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const { removed, refused } = await this.inventoryService.removeImportedItems(
      tenantId,
      ownerIds,
    );
    return {
      removed,
      refused: refused.map((ownerId) => ({
        ownerId,
        message: 'این کالا گردش انبار دارد و قابل حذف نیست.',
      })),
    };
  }

  private toInput(record: NormalisedRecord): InventoryImportItemInput {
    const values = record.values;
    const sku = String(values.sku ?? '').trim();
    const input: InventoryImportItemInput = {
      sku,
      barcode: values.barcode ? String(values.barcode).trim() : sku,
      name: String(values.name ?? '').trim(),
    };
    if (typeof values.quantity === 'number') {
      input.quantity = values.quantity;
    }
    if (typeof values.minQuantity === 'number') {
      input.minQuantity = values.minQuantity;
    }
    if (values.batchNumber) {
      input.batchNumber = String(values.batchNumber).trim();
    }
    return input;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}
