import { SepidarMappingAdapter } from './migration/bak/sepidar-mapping.adapter';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_ITEMS,
  SYNTHETIC_SEPIDAR_OPENING_VOUCHER,
  SYNTHETIC_SEPIDAR_PARTIES,
} from './__fixtures__/synthetic-sepidar.fixture';
import { SepidarRawAccount, SepidarRawItem, SepidarRawVoucherItem } from './migration/bak/sepidar-raw-types';

describe('Sepidar Migration In-Memory Mapper (#230 / T78)', () => {
  let adapter: SepidarMappingAdapter;

  beforeEach(() => {
    adapter = new SepidarMappingAdapter();
  });

  describe('Chart of Accounts Mapping & Hierarchy Validation', () => {
    it('maps 4-tier hierarchy and floating details with deterministic fingerprints', () => {
      const mapped = adapter.mapAccounts(SYNTHETIC_SEPIDAR_ACCOUNTS);

      expect(mapped).toHaveLength(SYNTHETIC_SEPIDAR_ACCOUNTS.length);

      const gorouh1 = mapped.find((a) => a.code === '1')!;
      expect(gorouh1.level).toBe(1);
      expect(gorouh1.levelName).toBe('gorouh');
      expect(gorouh1.parentCode).toBeNull();
      expect(gorouh1.fingerprint).toHaveLength(64);

      const kol10 = mapped.find((a) => a.code === '10')!;
      expect(kol10.level).toBe(2);
      expect(kol10.levelName).toBe('kol');
      expect(kol10.parentCode).toBe('1');

      const moein1020 = mapped.find((a) => a.code === '1020')!;
      expect(moein1020.level).toBe(3);
      expect(moein1020.levelName).toBe('moein');
      expect(moein1020.parentCode).toBe('10');

      const tafsili102001 = mapped.find((a) => a.code === '102001')!;
      expect(tafsili102001.level).toBe(4);
      expect(tafsili102001.levelName).toBe('tafsili');
      expect(tafsili102001.parentCode).toBe('1020');

      const floatingF001 = mapped.find((a) => a.code === 'F-001')!;
      expect(floatingF001.isFloatingDetail).toBe(true);
      expect(floatingF001.parentCode).toBeNull();
    });

    it('rejects duplicate account codes', () => {
      const duplicateAccounts: SepidarRawAccount[] = [
        { AccountID: 1, Code: '1010', Title: 'صندوق ۱', Level: 3, ParentAccountID: null },
        { AccountID: 2, Code: '1010', Title: 'صندوق ۲', Level: 3, ParentAccountID: null },
      ];
      expect(() => adapter.mapAccounts(duplicateAccounts)).toThrow(/Duplicate Sepidar account code: 1010/);
    });

    it('rejects accounts with dangling non-existent parent IDs', () => {
      const danglingAccounts: SepidarRawAccount[] = [
        { AccountID: 2, Code: '1020', Title: 'بانک', Level: 3, ParentAccountID: 999 },
      ];
      expect(() => adapter.mapAccounts(danglingAccounts)).toThrow(/references missing parent ID 999/);
    });

    it('rejects accounts with invalid levels outside 1-4', () => {
      const badLevel: SepidarRawAccount[] = [
        { AccountID: 1, Code: '99', Title: 'نامعتبر', Level: 5, ParentAccountID: null },
      ];
      expect(() => adapter.mapAccounts(badLevel)).toThrow(/Invalid account level 5/);
    });
  });

  describe('Parties Normalization & Role Derivation', () => {
    it('maps customers, suppliers, and dual-role parties accurately', () => {
      const mapped = adapter.mapParties(SYNTHETIC_SEPIDAR_PARTIES);

      expect(mapped).toHaveLength(3);

      const customer = mapped.find((p) => p.code === 'PRT-1001')!;
      expect(customer.role).toBe('customer');
      expect(customer.nationalId).toBe('10102030405');

      const supplier = mapped.find((p) => p.code === 'PRT-1002')!;
      expect(supplier.role).toBe('supplier');
      expect(supplier.economicCode).toBe('4111555666');

      const dual = mapped.find((p) => p.code === 'PRT-1003')!;
      expect(dual.role).toBe('both');
    });

    it('rejects duplicate party codes', () => {
      const duplicates = [
        { PartyID: 1, Code: 'P-1', Title: 'الف', IsCustomer: true, IsVendor: false },
        { PartyID: 2, Code: 'P-1', Title: 'ب', IsCustomer: true, IsVendor: false },
      ];
      expect(() => adapter.mapParties(duplicates)).toThrow(/Duplicate Sepidar party code: P-1/);
    });
  });

  describe('Inventory Items Mapping', () => {
    it('maps dual units, conversion ratios, and barcodes correctly', () => {
      const mapped = adapter.mapItems(SYNTHETIC_SEPIDAR_ITEMS);

      expect(mapped).toHaveLength(2);

      const item1 = mapped.find((i) => i.sku === 'SKU-SEP-001')!;
      expect(item1.primaryUnit).toBe('عدد');
      expect(item1.secondaryUnit).toBe('کارتن');
      expect(item1.unitRatio).toBe('10');
      expect(item1.barcode).toBe('6269988776655');

      const item2 = mapped.find((i) => i.sku === 'SKU-SEP-002')!;
      expect(item2.primaryUnit).toBe('متر');
      expect(item2.secondaryUnit).toBe('کلاف');
      expect(item2.unitRatio).toBe('100');
    });

    it('rejects items missing primary unit', () => {
      const missingUnit: SepidarRawItem[] = [
        { ItemID: 1, Code: 'SKU-BAD', Title: 'بدون واحد', UnitTitle: '' },
      ];
      expect(() => adapter.mapItems(missingUnit)).toThrow(/missing mandatory primary unit/);
    });
  });

  describe('Opening Balance Voucher Invariants & Mathematical Parity', () => {
    it('validates synthetic opening voucher is 100% balanced (0 Rials variance)', () => {
      const result = adapter.mapOpeningBalance(SYNTHETIC_SEPIDAR_OPENING_VOUCHER);

      expect(result.lines).toHaveLength(5);
      expect(result.totalDebitMinor).toBe(250_000_000n);
      expect(result.totalCreditMinor).toBe(250_000_000n);
      expect(result.varianceMinor).toBe(0n);
      expect(result.isBalanced).toBe(true);
    });

    it('rejects opening lines with both Debit and Credit greater than zero', () => {
      const invalidLine: SepidarRawVoucherItem[] = [
        { VoucherItemID: 1, AccountCode: '1010', Debit: 1000, Credit: 500 },
      ];
      expect(() => adapter.mapOpeningBalance(invalidLine)).toThrow(
        /cannot have both Debit and Credit greater than zero/,
      );
    });

    it('rejects negative amounts, NaN, and Infinity', () => {
      expect(() =>
        adapter.mapOpeningBalance([{ VoucherItemID: 1, AccountCode: '1010', Debit: -100, Credit: 0 }]),
      ).toThrow(/Negative amount/);

      expect(() =>
        adapter.mapOpeningBalance([{ VoucherItemID: 1, AccountCode: '1010', Debit: NaN, Credit: 0 }]),
      ).toThrow(/Invalid non-finite number/);

      expect(() =>
        adapter.mapOpeningBalance([{ VoucherItemID: 1, AccountCode: '1010', Debit: Infinity, Credit: 0 }]),
      ).toThrow(/Invalid non-finite number/);
    });

    it('rejects unknown account codes when validAccountCodes is specified', () => {
      const validCodes = new Set(['1010', '1020']);
      const unknownLine: SepidarRawVoucherItem[] = [
        { VoucherItemID: 1, AccountCode: '9999', Debit: 5000, Credit: 0 },
      ];
      expect(() =>
        adapter.mapOpeningBalance(unknownLine, { validAccountCodes: validCodes }),
      ).toThrow(/references unknown account code: 9999/);
    });

    it('throws when requireBalanced is true and voucher is unbalanced', () => {
      const unbalanced: SepidarRawVoucherItem[] = [
        { VoucherItemID: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
      ];
      expect(() =>
        adapter.mapOpeningBalance(unbalanced, { requireBalanced: true }),
      ).toThrow(/Sepidar opening balance is unbalanced/);
    });
  });

  describe('Reconciliation Certificate with SHA-256 Signature', () => {
    it('generates cryptographic certificate certifying 0 Rials variance with valid SHA-256 checksum', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_SEPIDAR_ACCOUNTS);
      const parties = adapter.mapParties(SYNTHETIC_SEPIDAR_PARTIES);
      const items = adapter.mapItems(SYNTHETIC_SEPIDAR_ITEMS);

      const cert = adapter.generateReconciliationCertificate(
        accounts,
        parties,
        items,
        SYNTHETIC_SEPIDAR_OPENING_VOUCHER,
      );

      expect(cert.balanced).toBe(true);
      expect(cert.totalDebitMinor).toBe(250_000_000n);
      expect(cert.totalCreditMinor).toBe(250_000_000n);
      expect(cert.varianceMinor).toBe(0n);
      expect(cert.totalAccounts).toBe(SYNTHETIC_SEPIDAR_ACCOUNTS.length);
      expect(cert.totalParties).toBe(3);
      expect(cert.totalItems).toBe(2);
      expect(cert.openingLinesCount).toBe(5);
      expect(cert.checksum).toBeDefined();
      expect(cert.checksum).toHaveLength(64); // Valid SHA-256 hex string
    });
  });
});
