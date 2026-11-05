/**
 * تست رجیستری کالاهای انبار بدون پایگاه‌داده (فقط mock).
 *
 * پوشش: نگاشت سربرگ «بهای واحد (ریال)» به فیلد unitCost، عبور کامل
 * unitCost/quantity/batchNumber به سرویس انبارداری، ردیف‌های شکست‌خورده
 * (BadRequestException) که فقط در failed می‌روند و بقیه ردیف‌ها درج می‌شوند،
 * و کلید تکراری sku:<SKU>.
 */
import { BadRequestException } from '@nestjs/common';
import { InventoryItemsRegistry } from './inventory-items.registry';
import { buildEntityFallbackMapping } from './entity-detect';
import { normaliseAndValidate } from './field-validation';
import { NormalisedRecord } from './import-registry.types';

const stub = {} as never;
const registry = new InventoryItemsRegistry(stub);

const record = (rowNumber: number, values: Record<string, unknown>): NormalisedRecord => ({
  rowNumber,
  values,
});

describe('InventoryItemsRegistry fields', () => {
  it('exposes the unitCost field mapping the «بهای واحد (ریال)» header', () => {
    const field = registry.fields.find((f) => f.key === 'unitCost');
    expect(field).toBeDefined();
    expect(field?.labelFa).toBe('بهای واحد (ریال)');
    expect(field?.type).toBe('number');
    expect(field?.required).toBe(false);
    expect(field?.synonyms).toContain('بهای واحد (ریال)');
  });

  it('maps the Persian unit-cost header to unitCost in the fallback mapping', () => {
    const headers = ['کد کالا (SKU)', 'نام کالا', 'موجودی', 'بهای واحد (ریال)', 'شماره دسته'];
    const mapping = buildEntityFallbackMapping(registry.fields, headers);
    expect(mapping['بهای واحد (ریال)']).toBe('unitCost');
    expect(mapping['موجودی']).toBe('quantity');
    expect(mapping['شماره دسته']).toBe('batchNumber');
  });

  it('parses cost cells without rounding, so the service can reject fractions', () => {
    const field = registry.fields.find((f) => f.key === 'unitCost')!;
    expect(normaliseAndValidate(field, '14,900,000')).toEqual({ value: 14900000, error: null });
    expect(normaliseAndValidate(field, '۱۴٬۹۰۰٬۰۰۰')).toEqual({ value: 14900000, error: null });
    // 12.5 stays 12.5 here (never rounded to 13); the inventory service rejects non-integer rials.
    expect(normaliseAndValidate(field, '12.5')).toEqual({ value: 12.5, error: null });
    expect(normaliseAndValidate(field, '-1')).toEqual({
      value: -1,
      error: 'بهای واحد (ریال) نمی‌تواند منفی باشد.',
    });
  });
});

describe('InventoryItemsRegistry.commit', () => {
  let inventory: {
    importStockItemWithOpeningStock: jest.Mock;
    findExistingSkus: jest.Mock;
  };

  const commitRegistry = () => new InventoryItemsRegistry(inventory as never);

  beforeEach(() => {
    inventory = {
      importStockItemWithOpeningStock: jest.fn(),
      findExistingSkus: jest.fn().mockResolvedValue([]),
    };
  });

  it('passes unitCost, quantity and batchNumber through to importStockItemWithOpeningStock', async () => {
    inventory.importStockItemWithOpeningStock.mockResolvedValue(11);
    const result = await commitRegistry().commit('tenant-a', [
      record(2, {
        sku: ' ITM-1 ',
        name: ' کالا یک ',
        barcode: 'B-1',
        quantity: 88,
        unitCost: 14900000,
        batchNumber: ' LOT-1 ',
        minQuantity: 5,
      }),
    ]);
    expect(inventory.importStockItemWithOpeningStock).toHaveBeenCalledTimes(1);
    expect(inventory.importStockItemWithOpeningStock).toHaveBeenCalledWith('tenant-a', {
      sku: 'ITM-1',
      barcode: 'B-1',
      name: 'کالا یک',
      quantity: 88,
      minQuantity: 5,
      batchNumber: 'LOT-1',
      unitCost: 14900000,
    });
    expect(result.inserted).toEqual([{ rowNumber: 2, ownerId: 11 }]);
    expect(result.failed).toEqual([]);
  });

  it('defaults barcode to the trimmed sku and passes a file batch only when present', async () => {
    inventory.importStockItemWithOpeningStock.mockResolvedValue(12);
    await commitRegistry().commit('tenant-a', [
      record(3, { sku: 'ITM-2', name: 'کالا دو', quantity: 86, unitCost: 8900000 }),
    ]);
    expect(inventory.importStockItemWithOpeningStock).toHaveBeenCalledWith('tenant-a', {
      sku: 'ITM-2',
      barcode: 'ITM-2',
      name: 'کالا دو',
      quantity: 86,
      unitCost: 8900000,
    });
    const arg = inventory.importStockItemWithOpeningStock.mock.calls[0][1];
    expect('batchNumber' in arg).toBe(false);
  });

  it('a row with cost but no quantity passes no quantity at all', async () => {
    inventory.importStockItemWithOpeningStock.mockResolvedValue(13);
    await commitRegistry().commit('tenant-a', [
      record(4, { sku: 'ITM-3', name: 'کالا سه', unitCost: 5000000 }),
    ]);
    const arg = inventory.importStockItemWithOpeningStock.mock.calls[0][1];
    expect('quantity' in arg).toBe(false);
    expect(arg.unitCost).toBe(5000000);
  });

  it('a rejected promise (BadRequestException) lands in failed with its message and the other rows still insert', async () => {
    inventory.importStockItemWithOpeningStock
      .mockResolvedValueOnce(21)
      .mockRejectedValueOnce(new BadRequestException('بهای واحد در صورت وجود موجودی اولیه الزامی است.'))
      .mockResolvedValueOnce(22);
    const result = await commitRegistry().commit('tenant-a', [
      record(2, { sku: 'A', name: 'کالای A' }),
      record(3, { sku: 'B', name: 'کالای B', quantity: 5, unitCost: 100 }),
      record(4, { sku: 'C', name: 'کالای C' }),
    ]);
    expect(result.inserted).toEqual([
      { rowNumber: 2, ownerId: 21 },
      { rowNumber: 4, ownerId: 22 },
    ]);
    expect(result.failed).toEqual([
      { rowNumber: 3, message: 'بهای واحد در صورت وجود موجودی اولیه الزامی است.' },
    ]);
  });

  it('a plain error still lands in failed with the fallback message', async () => {
    inventory.importStockItemWithOpeningStock.mockRejectedValue(new Error('boom'));
    const result = await commitRegistry().commit('tenant-a', [record(2, { sku: 'X', name: 'X' })]);
    expect(result.inserted).toEqual([]);
    expect(result.failed).toEqual([{ rowNumber: 2, message: 'boom' }]);
  });
});

describe('InventoryItemsRegistry duplicate keys', () => {
  it('duplicateKeys stays sku:<trimmed sku>', () => {
    expect(registry.duplicateKeys(record(2, { sku: 'ITM-1' }))).toEqual(['sku:ITM-1']);
    expect(registry.duplicateKeys(record(2, { sku: ' ITM-1 ' }))).toEqual(['sku:ITM-1']);
    expect(registry.duplicateKeys(record(2, { sku: '   ' }))).toEqual([]);
    expect(registry.duplicateKeys(record(2, {}))).toEqual([]);
  });

  it('findExistingDuplicateKeys reports existing skus as sku: keys only', async () => {
    const inventory = { findExistingSkus: jest.fn().mockResolvedValue(['ITM-1']) };
    const adapter = new InventoryItemsRegistry(inventory as never);
    await expect(
      adapter.findExistingDuplicateKeys('tenant-a', ['sku:ITM-1', 'sku:ITM-2', 'other:x']),
    ).resolves.toEqual(['sku:ITM-1']);
    expect(inventory.findExistingSkus).toHaveBeenCalledWith('tenant-a', ['ITM-1', 'ITM-2']);
  });
});
