import {
  convertPrimaryToSecondary,
  convertSecondaryToPrimary,
  MAX_ITEM_ATTRIBUTES,
  validateItemAttributes,
  validateSerialNumbers,
} from './entities/item-attributes.domain';
import { StockItemEntity } from './entities/stock-item.entity';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockDocumentLineEntity } from './entities/stock-document.entity';

describe('Inventory Dual Units, Serials, and Attributes (#230 / T73)', () => {
  describe('Dual Unit Conversions', () => {
    it('converts secondary unit quantity to primary unit accurately', () => {
      // 1 carton = 24 pieces
      const pieces = convertSecondaryToPrimary(5, 24);
      expect(pieces).toBe(120);

      // Fractional cartons (e.g. 2.5 boxes = 30 pieces)
      expect(convertSecondaryToPrimary(2.5, 12)).toBe(30);

      // 0 cartons = 0 pieces
      expect(convertSecondaryToPrimary(0, 10)).toBe(0);
    });

    it('converts primary unit quantity to secondary unit accurately', () => {
      // 120 pieces at 24 per carton = 5 cartons
      const cartons = convertPrimaryToSecondary(120, 24);
      expect(cartons).toBe(5);

      // 15 pieces at 6 per pack = 2.5 packs
      expect(convertPrimaryToSecondary(15, 6)).toBe(2.5);
    });

    it('preserves 2 decimal place scale without float precision leaks', () => {
      // 1.33 cartons * 7 = 9.31 pieces
      const result = convertSecondaryToPrimary(1.33, 7);
      expect(result).toBe(9.31);
    });

    it('rejects invalid quantities or ratios', () => {
      expect(() => convertSecondaryToPrimary(-1, 10)).toThrow(
        'Secondary quantity must be a non-negative finite number',
      );
      expect(() => convertSecondaryToPrimary(10, 0)).toThrow(
        'Unit conversion ratio must be a positive number',
      );
      expect(() => convertSecondaryToPrimary(10, -5)).toThrow(
        'Unit conversion ratio must be a positive number',
      );
      expect(() => convertPrimaryToSecondary(-5, 10)).toThrow(
        'Primary quantity must be a non-negative finite number',
      );
    });
  });

  describe('Item Attributes Validation (Max 10)', () => {
    it('accepts null, undefined, or empty attributes', () => {
      expect(validateItemAttributes(null)).toBeNull();
      expect(validateItemAttributes(undefined)).toBeNull();
      expect(validateItemAttributes({})).toBeNull();
    });

    it('accepts up to 10 valid attributes and trims them', () => {
      const attrs = {
        color: ' آبی ',
        size: 'XL',
        brand: 'Roxira',
        weight: '500g',
        material: 'Cotton',
        origin: 'Iran',
        warranty: '18 Months',
        voltage: '220V',
        grade: 'A+',
        packaging: 'Standard Box',
      };
      const validated = validateItemAttributes(attrs);
      expect(validated).toBeDefined();
      expect(Object.keys(validated!)).toHaveLength(10);
      expect(validated!.color).toBe('آبی');
    });

    it('rejects more than 10 attributes strictly', () => {
      const elevenAttrs: Record<string, string> = {};
      for (let i = 1; i <= 11; i++) {
        elevenAttrs[`attr_${i}`] = `val_${i}`;
      }
      expect(() => validateItemAttributes(elevenAttrs)).toThrow(
        `Maximum ${MAX_ITEM_ATTRIBUTES} attributes allowed per item, received 11`,
      );
    });

    it('rejects empty attribute keys or oversized values', () => {
      expect(() => validateItemAttributes({ ' ': 'valid' })).toThrow(
        'Attribute key cannot be empty',
      );
      expect(() =>
        validateItemAttributes({ [ 'a'.repeat(65) ]: 'value' }),
      ).toThrow("exceeds maximum length of 64 characters");
      expect(() =>
        validateItemAttributes({ validKey: 'b'.repeat(256) }),
      ).toThrow("exceeds maximum length of 255 characters");
    });
  });

  describe('Serial Numbers on Receipts & Issues', () => {
    it('returns null when no serials provided and match not required', () => {
      expect(validateSerialNumbers(null, 5, false)).toBeNull();
      expect(validateSerialNumbers([], 5, false)).toBeNull();
    });

    it('validates serial numbers when count matches integer quantity', () => {
      const serials = ['SN-1001', 'SN-1002', 'SN-1003'];
      const validated = validateSerialNumbers(serials, 3, true);
      expect(validated).toEqual(['SN-1001', 'SN-1002', 'SN-1003']);
    });

    it('rejects duplicate serial numbers in the same document line', () => {
      const dupSerials = ['SN-1001', 'SN-1002', 'SN-1001'];
      expect(() => validateSerialNumbers(dupSerials, 3, true)).toThrow(
        'Duplicate serial numbers detected in movement line',
      );
    });

    it('rejects serial count mismatch when serialization is required', () => {
      const serials = ['SN-1001', 'SN-1002'];
      expect(() => validateSerialNumbers(serials, 3, true)).toThrow(
        'Serial count mismatch: expected 3 serial numbers, received 2',
      );
    });

    it('requires serials if requireMatch is true and quantity > 0', () => {
      expect(() => validateSerialNumbers(null, 2, true)).toThrow(
        'Serial numbers required: expected 2 serials, received none',
      );
    });
  });

  describe('Entity Schema Property Verification', () => {
    it('StockItemEntity contains dual unit, ratio, and attribute fields', () => {
      const item = new StockItemEntity();
      item.sku = 'SKU-TEST';
      item.name = 'کالای دوواحدی';
      item.barcode = '1234567890';
      item.primaryUnit = 'piece';
      item.secondaryUnit = 'carton';
      item.unitRatio = 12;
      item.attributes = { color: 'Red', size: 'M' };

      expect(item.primaryUnit).toBe('piece');
      expect(item.secondaryUnit).toBe('carton');
      expect(item.unitRatio).toBe(12);
      expect(item.attributes).toEqual({ color: 'Red', size: 'M' });
    });

    it('FifoBatchEntity supports serial numbers and attributes', () => {
      const batch = new FifoBatchEntity();
      batch.sku = 'SKU-TEST';
      batch.batchNumber = 'BATCH-001';
      batch.serialNumbers = ['SN-1', 'SN-2'];
      batch.attributes = { lot: 'Alpha' };

      expect(batch.serialNumbers).toEqual(['SN-1', 'SN-2']);
      expect(batch.attributes).toEqual({ lot: 'Alpha' });
    });

    it('StockDocumentLineEntity supports secondaryQuantity and serialNumbers', () => {
      const line = new StockDocumentLineEntity();
      line.sku = 'SKU-TEST';
      line.quantity = 24;
      line.secondaryQuantity = 2;
      line.serialNumbers = ['SN-A', 'SN-B'];

      expect(line.quantity).toBe(24);
      expect(line.secondaryQuantity).toBe(2);
      expect(line.serialNumbers).toEqual(['SN-A', 'SN-B']);
    });
  });
});
