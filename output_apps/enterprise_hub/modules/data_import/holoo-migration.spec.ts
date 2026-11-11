import { HolooMappingAdapter } from './migration/bak/holoo-mapping.adapter';
import {
  SYNTHETIC_HOLOO_ACCOUNTS,
  SYNTHETIC_HOLOO_ITEMS,
  SYNTHETIC_HOLOO_OPENING_VOUCHER,
  SYNTHETIC_HOLOO_PARTIES,
  HolooRawAccount,
  HolooRawItem,
  HolooRawParty,
  HolooRawVoucherItem,
} from './__fixtures__/synthetic-holoo.fixture';

describe('Holoo In-Memory Migration Mapper (T89 / #776)', () => {
  let adapter: HolooMappingAdapter;

  beforeEach(() => {
    adapter = new HolooMappingAdapter();
  });

  describe('Chart of Accounts: 3-Level to 4-Tier Mapping & Floating Detail', () => {
    it('correctly maps Holoo 3-level accounts (Group/Kol/Moein) and floating details', () => {
      const mapped = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);

      expect(mapped).toHaveLength(SYNTHETIC_HOLOO_ACCOUNTS.length);

      const groupAcc = mapped.find((a) => a.code === '1');
      expect(groupAcc).toBeDefined();
      expect(groupAcc?.level).toBe(1);
      expect(groupAcc?.levelName).toBe('gorouh');
      expect(groupAcc?.parentCode).toBeNull();
      expect(groupAcc?.isFloatingDetail).toBe(false);

      const kolAcc = mapped.find((a) => a.code === '10');
      expect(kolAcc).toBeDefined();
      expect(kolAcc?.level).toBe(2);
      expect(kolAcc?.levelName).toBe('kol');
      expect(kolAcc?.parentCode).toBe('1');
      expect(kolAcc?.isFloatingDetail).toBe(false);

      const moeinAcc = mapped.find((a) => a.code === '1010');
      expect(moeinAcc).toBeDefined();
      expect(moeinAcc?.level).toBe(3);
      expect(moeinAcc?.levelName).toBe('moein');
      expect(moeinAcc?.parentCode).toBe('10');
      expect(moeinAcc?.isFloatingDetail).toBe(false);

      const tafsiliAcc = mapped.find((a) => a.code === '102001');
      expect(tafsiliAcc).toBeDefined();
      expect(tafsiliAcc?.level).toBe(4);
      expect(tafsiliAcc?.levelName).toBe('tafsili');
      expect(tafsiliAcc?.parentCode).toBe('1020');
      expect(tafsiliAcc?.isFloatingDetail).toBe(false);

      const floatingAcc = mapped.find((a) => a.code === 'F-101');
      expect(floatingAcc).toBeDefined();
      expect(floatingAcc?.isFloatingDetail).toBe(true);
      expect(floatingAcc?.parentCode).toBeNull();
    });

    it('rejects duplicate Holoo account codes', () => {
      const duplicate: HolooRawAccount[] = [
        { AccountId: 1, Code: '10', Name: 'حساب الف', Level: 2, ParentCode: '1' },
        { AccountId: 2, Code: '10', Name: 'حساب تکراری', Level: 2, ParentCode: '1' },
      ];

      expect(() => adapter.mapAccounts(duplicate)).toThrow('Duplicate Holoo account code: 10');
    });

    it('rejects accounts with invalid levels outside 1..4', () => {
      const invalidLevel: HolooRawAccount[] = [
        { AccountId: 1, Code: '10', Name: 'سطح نامعتبر', Level: 5, ParentCode: '1' },
      ];

      expect(() => adapter.mapAccounts(invalidLevel)).toThrow('Invalid account level 5');
    });

    it('validates parent hierarchy and rejects accounts referencing missing parent codes', () => {
      const missingParent: HolooRawAccount[] = [
        { AccountId: 10, Code: '10', Name: 'کل بدون گروه', Level: 2, ParentCode: '99' },
      ];

      expect(() => adapter.mapAccounts(missingParent)).toThrow(
        'references missing parent code "99"',
      );
    });

    it('generates deterministic SHA-256 fingerprints for mapped accounts', () => {
      const mapped1 = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const mapped2 = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);

      expect(mapped1[0].fingerprint).toBe(mapped2[0].fingerprint);
      expect(mapped1[0].fingerprint).toHaveLength(64);
    });
  });

  describe('Parties (Ashkhas) Role Mapping', () => {
    it('maps Holoo parties with accurate customer, supplier, and dual-role flags', () => {
      const mapped = adapter.mapParties(SYNTHETIC_HOLOO_PARTIES);

      expect(mapped).toHaveLength(3);

      const customer = mapped.find((p) => p.code === 'HLO-CUS-01');
      expect(customer).toBeDefined();
      expect(customer?.role).toBe('customer');
      expect(customer?.nationalId).toBe('10102030405');

      const supplier = mapped.find((p) => p.code === 'HLO-SUP-01');
      expect(supplier).toBeDefined();
      expect(supplier?.role).toBe('supplier');

      const both = mapped.find((p) => p.code === 'HLO-BOTH-01');
      expect(both).toBeDefined();
      expect(both?.role).toBe('both');
    });

    it('rejects duplicate Holoo party codes', () => {
      const duplicate: HolooRawParty[] = [
        { PartyId: 1, Code: 'P-1', Name: 'طرف الف', IsCustomer: true, IsSupplier: false },
        { PartyId: 2, Code: 'P-1', Name: 'طرف تکراری', IsCustomer: false, IsSupplier: true },
      ];

      expect(() => adapter.mapParties(duplicate)).toThrow('Duplicate Holoo party code: P-1');
    });
  });

  describe('Inventory Items (Kala) Mapping', () => {
    it('maps inventory items with primary and secondary units and conversion ratios', () => {
      const mapped = adapter.mapItems(SYNTHETIC_HOLOO_ITEMS);

      expect(mapped).toHaveLength(2);

      const item1 = mapped.find((i) => i.sku === 'HLO-SKU-001');
      expect(item1).toBeDefined();
      expect(item1?.primaryUnit).toBe('عدد');
      expect(item1?.secondaryUnit).toBe('بسته');
      expect(item1?.unitRatio).toBe('12');
      expect(item1?.barcode).toBe('6261122334455');
    });

    it('throws error when primary unit is missing', () => {
      const missingUnit: HolooRawItem[] = [
        { ItemId: 1, Code: 'SKU-NO-UNIT', Name: 'کالای بدون واحد', Unit: '' },
      ];

      expect(() => adapter.mapItems(missingUnit)).toThrow('missing mandatory primary unit');
    });

    it('rejects duplicate item SKUs', () => {
      const duplicate: HolooRawItem[] = [
        { ItemId: 1, Code: 'SKU-1', Name: 'کالای ۱', Unit: 'عدد' },
        { ItemId: 2, Code: 'SKU-1', Name: 'کالای ۱ تکراری', Unit: 'عدد' },
      ];

      expect(() => adapter.mapItems(duplicate)).toThrow('Duplicate Holoo item SKU: SKU-1');
    });
  });

  describe('Opening Balance Voucher Invariants & Balancing', () => {
    it('maps balanced synthetic opening balance voucher with zero variance', () => {
      const result = adapter.mapOpeningBalance(SYNTHETIC_HOLOO_OPENING_VOUCHER);

      expect(result.lines).toHaveLength(5);
      // 30M + 70M + 50M = 150,000,000 IRR
      expect(result.totalDebitMinor).toBe(150000000n);
      // 40M + 110M = 150,000,000 IRR
      expect(result.totalCreditMinor).toBe(150000000n);
      expect(result.varianceMinor).toBe(0n);
      expect(result.isBalanced).toBe(true);
    });

    it('rejects lines with simultaneous positive Debit and Credit', () => {
      const invalidLine: HolooRawVoucherItem[] = [
        {
          SanadId: 1,
          AccountCode: '1010',
          Debit: 5000,
          Credit: 5000,
        },
      ];

      expect(() => adapter.mapOpeningBalance(invalidLine)).toThrow(
        'cannot have both Debit and Credit greater than zero',
      );
    });

    it('rejects negative, NaN, or non-finite amounts', () => {
      expect(() =>
        adapter.mapOpeningBalance([{ SanadId: 1, AccountCode: '1010', Debit: -100, Credit: 0 }]),
      ).toThrow('Negative amount');

      expect(() =>
        adapter.mapOpeningBalance([{ SanadId: 1, AccountCode: '1010', Debit: NaN, Credit: 0 }]),
      ).toThrow('Invalid non-finite number');

      expect(() =>
        adapter.mapOpeningBalance([{ SanadId: 1, AccountCode: '1010', Debit: Infinity, Credit: 0 }]),
      ).toThrow('Invalid non-finite number');
    });

    it('validates account codes against known chart of accounts', () => {
      const validCodes = new Set(['1010', '1020']);
      const unknownLine: HolooRawVoucherItem[] = [
        { SanadId: 1, AccountCode: '9999', Debit: 1000, Credit: 0 },
      ];

      expect(() =>
        adapter.mapOpeningBalance(unknownLine, { validAccountCodes: validCodes }),
      ).toThrow('references unknown account code: 9999');
    });

    it('rejects unbalanced opening voucher when requireBalanced is true', () => {
      const unbalanced: HolooRawVoucherItem[] = [
        { SanadId: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
      ];

      expect(() =>
        adapter.mapOpeningBalance(unbalanced, { requireBalanced: true }),
      ).toThrow('Holoo opening balance is unbalanced');
    });
  });

  describe('Reconciliation Certificate & Digital SHA-256 Digest', () => {
    it('produces certified reconciliation summary with deterministic SHA-256 digest', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const parties = adapter.mapParties(SYNTHETIC_HOLOO_PARTIES);
      const items = adapter.mapItems(SYNTHETIC_HOLOO_ITEMS);

      const cert = adapter.generateReconciliationCertificate(
        accounts,
        parties,
        items,
        SYNTHETIC_HOLOO_OPENING_VOUCHER,
      );

      expect(cert.balanced).toBe(true);
      expect(cert.varianceMinor).toBe(0n);
      expect(cert.totalDebitMinor).toBe(150000000n);
      expect(cert.totalCreditMinor).toBe(150000000n);
      expect(cert.totalAccounts).toBe(SYNTHETIC_HOLOO_ACCOUNTS.length);
      expect(cert.totalParties).toBe(SYNTHETIC_HOLOO_PARTIES.length);
      expect(cert.totalItems).toBe(SYNTHETIC_HOLOO_ITEMS.length);
      expect(cert.openingLinesCount).toBe(5);
      expect(cert.checksum).toHaveLength(64);
    });
  });
});
