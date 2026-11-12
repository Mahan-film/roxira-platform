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

    it('rejects accounts with invalid or non-integer levels outside 1..4', () => {
      const invalidLevel: HolooRawAccount[] = [
        { AccountId: 1, Code: '10', Name: 'سطح نامعتبر', Level: 5, ParentCode: '1' },
      ];
      expect(() => adapter.mapAccounts(invalidLevel)).toThrow('Invalid account level 5');

      const fractionalLevel: HolooRawAccount[] = [
        { AccountId: 2, Code: '20', Name: 'سطح اعشاری', Level: 2.5, ParentCode: null },
      ];
      expect(() => adapter.mapAccounts(fractionalLevel)).toThrow('Invalid account level 2.5');
    });

    it('validates parent hierarchy: rejects missing parents, level mismatches, and cycles', () => {
      const missingParent: HolooRawAccount[] = [
        { AccountId: 10, Code: '10', Name: 'کل بدون گروه', Level: 2, ParentCode: '99' },
      ];
      expect(() => adapter.mapAccounts(missingParent)).toThrow(
        'references missing parent code "99"',
      );

      // Level mismatch: level 3 pointing directly to level 1
      const skippedLevel: HolooRawAccount[] = [
        { AccountId: 1, Code: '1', Name: 'گروه', Level: 1, ParentCode: null },
        { AccountId: 2, Code: '1010', Name: 'معین پریده', Level: 3, ParentCode: '1' },
      ];
      expect(() => adapter.mapAccounts(skippedLevel)).toThrow(
        'incompatible level 1 (expected level 2)',
      );

      // Cycle detection (self-reference)
      const selfCycle: HolooRawAccount[] = [
        { AccountId: 1, Code: '1', Name: 'خودارجاع', Level: 1, ParentCode: '1' },
      ];
      expect(() => adapter.mapAccounts(selfCycle)).toThrow('Circular parent reference');
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

  describe('Opening Balance Voucher Invariants & Ledger Minor Units', () => {
    it('maps balanced synthetic opening balance voucher in MONEY_SCALE=2 minor units (×100)', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const parties = adapter.mapParties(SYNTHETIC_HOLOO_PARTIES);
      const validFloatingDetailCodes = new Set(parties.map((p) => p.code));

      const result = adapter.mapOpeningBalance(SYNTHETIC_HOLOO_OPENING_VOUCHER, {
        validAccounts: accounts,
        validFloatingDetailCodes,
      });

      expect(result.lines).toHaveLength(5);
      // 30M + 70M + 50M = 150,000,000 Rials => 15,000,000,000 minor units (MONEY_SCALE = 2)
      expect(result.totalDebitMinor).toBe(15000000000n);
      expect(result.totalCreditMinor).toBe(15000000000n);
      expect(result.lines[0].debitMinor).toBe(3000000000n);
      expect(result.varianceMinor).toBe(0n);
      expect(result.isBalanced).toBe(true);
    });

    it('fails closed when validAccounts is missing or empty', () => {
      expect(() =>
        adapter.mapOpeningBalance(SYNTHETIC_HOLOO_OPENING_VOUCHER, { validAccounts: [] }),
      ).toThrow('requires a non-empty validAccounts chart');

      expect(() =>
        (adapter.mapOpeningBalance as unknown as (lines: HolooRawVoucherItem[]) => unknown)(
          SYNTHETIC_HOLOO_OPENING_VOUCHER,
        ),
      ).toThrow('requires a non-empty validAccounts chart');
    });

    it('rejects lines with simultaneous positive Debit and Credit', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const invalidLine: HolooRawVoucherItem[] = [
        {
          SanadId: 1,
          AccountCode: '1010',
          Debit: 5000,
          Credit: 5000,
        },
      ];

      expect(() =>
        adapter.mapOpeningBalance(invalidLine, { validAccounts: accounts }),
      ).toThrow('cannot have both Debit and Credit greater than zero');
    });

    it('rejects negative, NaN, non-finite, and >2-decimal fractional amounts without rounding', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);

      expect(() =>
        adapter.mapOpeningBalance(
          [{ SanadId: 1, AccountCode: '1010', Debit: -100, Credit: 0 }],
          { validAccounts: accounts },
        ),
      ).toThrow('Negative amount');

      expect(() =>
        adapter.mapOpeningBalance(
          [{ SanadId: 1, AccountCode: '1010', Debit: NaN, Credit: 0 }],
          { validAccounts: accounts },
        ),
      ).toThrow('Invalid non-finite number');

      expect(() =>
        adapter.mapOpeningBalance(
          [{ SanadId: 1, AccountCode: '1010', Debit: Infinity, Credit: 0 }],
          { validAccounts: accounts },
        ),
      ).toThrow('Invalid non-finite number');

      expect(() =>
        adapter.mapOpeningBalance(
          [{ SanadId: 1, AccountCode: '1010', Debit: 100.125, Credit: 0 }],
          { validAccounts: accounts },
        ),
      ).toThrow('Invalid amount');

      expect(() =>
        adapter.mapOpeningBalance(
          [{ SanadId: 1, AccountCode: '1010', Debit: '100.125', Credit: 0 }],
          { validAccounts: accounts },
        ),
      ).toThrow('Invalid amount');
    });

    it('rejects non-postable accounts (Group/Kol/parent Moein) and unknown floating detail codes', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);

      // Group level 1 ('1') is non-postable
      expect(() =>
        adapter.mapOpeningBalance(
          [
            { SanadId: 1, AccountCode: '1', Debit: 1000, Credit: 0 },
            { SanadId: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
          { validAccounts: accounts },
        ),
      ).toThrow('non-postable account code: 1');

      // Moein with child Tafsili ('1020') is non-postable
      expect(() =>
        adapter.mapOpeningBalance(
          [
            { SanadId: 1, AccountCode: '1020', Debit: 1000, Credit: 0 },
            { SanadId: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
          { validAccounts: accounts },
        ),
      ).toThrow('non-postable account code: 1020');

      // Unknown floating detail code rejected even without passing validFloatingDetailCodes
      expect(() =>
        adapter.mapOpeningBalance(
          [
            { SanadId: 1, AccountCode: '1010', FloatingDetailCode: 'UNKNOWN-FD', Debit: 1000, Credit: 0 },
            { SanadId: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
          ],
          { validAccounts: accounts },
        ),
      ).toThrow('unknown floating detail code: UNKNOWN-FD');
    });

    it('enforces zero variance by default unless requireBalanced is explicitly false', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const unbalanced: HolooRawVoucherItem[] = [
        { SanadId: 1, AccountCode: '1010', Debit: 1000, Credit: 0 },
      ];

      expect(() =>
        adapter.mapOpeningBalance(unbalanced, { validAccounts: accounts }),
      ).toThrow('Holoo opening balance is unbalanced');

      const preview = adapter.mapOpeningBalance(unbalanced, {
        validAccounts: accounts,
        requireBalanced: false,
      });
      expect(preview.isBalanced).toBe(false);
      expect(preview.varianceMinor).toBe(100000n);
    });
  });

  describe('Reconciliation Certificate & Deterministic SHA-256 Digest', () => {
    it('produces identical deterministic SHA-256 checksum across different timestamps and input ordering', async () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const parties = adapter.mapParties(SYNTHETIC_HOLOO_PARTIES);
      const items = adapter.mapItems(SYNTHETIC_HOLOO_ITEMS);

      const cert1 = adapter.generateReconciliationCertificate(
        accounts,
        parties,
        items,
        SYNTHETIC_HOLOO_OPENING_VOUCHER,
      );

      await new Promise((resolve) => setTimeout(resolve, 15));

      const cert2 = adapter.generateReconciliationCertificate(
        [...accounts].reverse(),
        [...parties].reverse(),
        [...items].reverse(),
        [...SYNTHETIC_HOLOO_OPENING_VOUCHER].reverse(),
      );

      expect(cert1.balanced).toBe(true);
      expect(cert1.varianceMinor).toBe(0n);
      expect(cert1.totalDebitMinor).toBe(15000000000n);
      expect(cert1.totalCreditMinor).toBe(15000000000n);
      expect(cert1.totalAccounts).toBe(SYNTHETIC_HOLOO_ACCOUNTS.length);
      expect(cert1.totalParties).toBe(SYNTHETIC_HOLOO_PARTIES.length);
      expect(cert1.totalItems).toBe(SYNTHETIC_HOLOO_ITEMS.length);
      expect(cert1.openingLinesCount).toBe(5);
      expect(cert1.checksum).toHaveLength(64);
      expect(cert1.checksum).toBe(cert2.checksum);
    });

    it('produces identical SHA-256 checksum when two opening lines share accountCode and floatingDetailCode across reversed input order', () => {
      const accounts = adapter.mapAccounts(SYNTHETIC_HOLOO_ACCOUNTS);
      const parties = adapter.mapParties(SYNTHETIC_HOLOO_PARTIES);
      const items = adapter.mapItems(SYNTHETIC_HOLOO_ITEMS);

      const multiLineVoucher: HolooRawVoucherItem[] = [
        { SanadId: 10, AccountCode: '102001', FloatingDetailCode: 'F-101', Debit: 10_000_000, Credit: 0, Description: 'ردیف اول بانک' },
        { SanadId: 11, AccountCode: '102001', FloatingDetailCode: 'F-101', Debit: 25_000_000, Credit: 0, Description: 'ردیف دوم بانک' },
        { SanadId: 12, AccountCode: '102001', FloatingDetailCode: 'F-101', Debit: 25_000_000, Credit: 0, Description: 'ردیف سوم با مبلغ برابر' },
        { SanadId: 13, AccountCode: '3010', Debit: 0, Credit: 60_000_000, Description: 'طرف سرمایه' },
      ];

      const certForward = adapter.generateReconciliationCertificate(
        accounts,
        parties,
        items,
        multiLineVoucher,
      );
      const certReversed = adapter.generateReconciliationCertificate(
        accounts,
        parties,
        items,
        [...multiLineVoucher].reverse(),
      );

      expect(certForward.openingLinesCount).toBe(4);
      expect(certForward.totalDebitMinor).toBe(6000000000n);
      expect(certForward.totalCreditMinor).toBe(6000000000n);
      expect(certForward.checksum).toBe(certReversed.checksum);
    });
  });
});
