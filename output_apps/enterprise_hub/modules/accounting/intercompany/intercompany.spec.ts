import { IntercompanyService } from './intercompany.service';
import {
  ConsolidationGroupConfig,
  EntityFinancialProfile,
  IntercompanyInvoiceInput,
  SCALE_1M,
} from './intercompany.types';
import { m } from '../acceptance/r16-fixtures';

describe('IntercompanyService (T182)', () => {
  let service: IntercompanyService;

  beforeEach(() => {
    service = new IntercompanyService();
  });

  describe('createIntercompanyPair', () => {
    it('generates symmetric seller invoice and buyer mirror bill entries', () => {
      const input: IntercompanyInvoiceInput = {
        invoiceNumber: 'INV-IC-1001',
        date: '2026-10-15',
        sellerEntityId: 'tenant-parent',
        buyerEntityId: 'tenant-sub',
        currency: 'EUR',
        amountMinor: m('10000.00'),
        description: 'Management Fee Q3',
      };

      const result = service.createIntercompanyPair(input);

      expect(result.pairId).toBe('IC-20261015-INV-IC-1001');

      // Seller entry
      expect(result.sellerInvoiceEntry.entityId).toBe('tenant-parent');
      expect(result.sellerInvoiceEntry.lines).toHaveLength(2);
      expect(result.sellerInvoiceEntry.lines[0].accountCode).toBe('1150');
      expect(result.sellerInvoiceEntry.lines[0].debitMinor).toBe(m('10000.00'));
      expect(result.sellerInvoiceEntry.lines[1].accountCode).toBe('4100');
      expect(result.sellerInvoiceEntry.lines[1].creditMinor).toBe(m('10000.00'));

      // Buyer mirror bill entry
      expect(result.buyerMirrorBillEntry.entityId).toBe('tenant-sub');
      expect(result.buyerMirrorBillEntry.lines).toHaveLength(2);
      expect(result.buyerMirrorBillEntry.lines[0].accountCode).toBe('6100');
      expect(result.buyerMirrorBillEntry.lines[0].debitMinor).toBe(m('10000.00'));
      expect(result.buyerMirrorBillEntry.lines[1].accountCode).toBe('2150');
      expect(result.buyerMirrorBillEntry.lines[1].creditMinor).toBe(m('10000.00'));
    });

    it('rejects invalid inputs (zero/negative amount or identical entities)', () => {
      expect(() =>
        service.createIntercompanyPair({
          invoiceNumber: 'INV-1',
          date: '2026-10-15',
          sellerEntityId: 'P',
          buyerEntityId: 'S',
          currency: 'EUR',
          amountMinor: 0n,
          description: 'Zero fee',
        }),
      ).toThrow();

      expect(() =>
        service.createIntercompanyPair({
          invoiceNumber: 'INV-2',
          date: '2026-10-15',
          sellerEntityId: 'P',
          buyerEntityId: 'P',
          currency: 'EUR',
          amountMinor: m('100.00'),
          description: 'Self-bill',
        }),
      ).toThrow();
    });
  });

  describe('consolidateGroup', () => {
    it('eliminates IC revenue/expense, AR/AP, investment vs equity, and attributes NCI (R16 Test 1)', () => {
      const config: ConsolidationGroupConfig = {
        groupId: 'group-c',
        groupName: 'Group C',
        reportingCurrency: 'EUR',
        parentEntityId: 'parent-p',
        subsidiaries: [
          {
            subsidiaryEntityId: 'sub-s',
            ownershipRatioScaled6: 800_000n, // 80%
            acquisitionEquityMinor: m('50000.00'),
            investmentAccountCode: '1500',
            subsidiaryEquityAccountCode: '3000',
            nciEquityAccountCode: '3500',
            intercompanyReceivableCode: '1150',
            intercompanyPayableCode: '2150',
            intercompanyRevenueCode: '4100',
            intercompanyExpenseCode: '6100',
          },
        ],
      };

      const profiles: EntityFinancialProfile[] = [
        {
          entityId: 'parent-p',
          entityName: 'Parent P',
          currency: 'EUR',
          balances: [
            // P standalone external revenue & expenses: net external profit = 90,000.00
            { accountCode: '4000', accountName: 'External Sales', category: 'REVENUE', debitMinor: 0n, creditMinor: m('190000.00') },
            { accountCode: '5000', accountName: 'External Expenses', category: 'EXPENSE', debitMinor: m('100000.00'), creditMinor: 0n },
            // IC Revenue from S: 10,000.00
            { accountCode: '4100', accountName: 'IC Revenue', category: 'REVENUE', debitMinor: 0n, creditMinor: m('10000.00') },
            // IC Receivable from S: 10,000.00
            { accountCode: '1150', accountName: 'IC Receivable', category: 'ASSET', debitMinor: m('10000.00'), creditMinor: 0n },
            // Investment in S (80% of 50,000): 40,000.00
            { accountCode: '1500', accountName: 'Investment in Sub S', category: 'ASSET', debitMinor: m('40000.00'), creditMinor: 0n },
            // External Cash/Assets: 150,000.00
            { accountCode: '1000', accountName: 'Cash and Bank', category: 'ASSET', debitMinor: m('150000.00'), creditMinor: 0n },
            // External Liabilities: 20,000.00
            { accountCode: '2000', accountName: 'Accounts Payable', category: 'LIABILITY', debitMinor: 0n, creditMinor: m('20000.00') },
            // Share Capital: 80,000.00
            { accountCode: '3000', accountName: 'Share Capital', category: 'EQUITY', debitMinor: 0n, creditMinor: m('80000.00') },
          ],
        },
        {
          entityId: 'sub-s',
          entityName: 'Subsidiary S',
          currency: 'EUR',
          balances: [
            // S external sales 120,000.00, external expenses 60,000.00
            { accountCode: '4000', accountName: 'External Sales', category: 'REVENUE', debitMinor: 0n, creditMinor: m('120000.00') },
            { accountCode: '5000', accountName: 'External Expenses', category: 'EXPENSE', debitMinor: m('60000.00'), creditMinor: 0n },
            // IC Expense from P: 10,000.00
            { accountCode: '6100', accountName: 'IC Expense', category: 'EXPENSE', debitMinor: m('10000.00'), creditMinor: 0n },
            // IC Payable to P: 10,000.00
            { accountCode: '2150', accountName: 'IC Payable', category: 'LIABILITY', debitMinor: 0n, creditMinor: m('10000.00') },
            // Cash/Assets in S: 120,000.00
            { accountCode: '1000', accountName: 'Cash and Bank', category: 'ASSET', debitMinor: m('120000.00'), creditMinor: 0n },
            // External Liabilities: 10,000.00
            { accountCode: '2000', accountName: 'Accounts Payable', category: 'LIABILITY', debitMinor: 0n, creditMinor: m('10000.00') },
            // S Equity at acquisition: 50,000.00
            { accountCode: '3000', accountName: 'Share Capital S', category: 'EQUITY', debitMinor: 0n, creditMinor: m('50000.00') },
          ],
        },
      ];

      const result = service.consolidateGroup(config, profiles);

      // Verify eliminations
      expect(result.eliminations).toHaveLength(3);
      expect(result.eliminations.map((e) => e.type)).toEqual([
        'INTERCOMPANY_PL',
        'INTERCOMPANY_BS',
        'INVESTMENT_EQUITY',
      ]);

      // Check elimination 1: IC P&L Dr IC Revenue 10,000 / Cr IC Expense 10,000
      const plElim = result.eliminations.find((e) => e.type === 'INTERCOMPANY_PL')!;
      expect(plElim.lines[0].accountCode).toBe('4100');
      expect(plElim.lines[0].debitMinor).toBe(m('10000.00'));
      expect(plElim.lines[1].accountCode).toBe('6100');
      expect(plElim.lines[1].creditMinor).toBe(m('10000.00'));

      // Check elimination 2: IC BS Dr IC Payable 10,000 / Cr IC Receivable 10,000
      const bsElim = result.eliminations.find((e) => e.type === 'INTERCOMPANY_BS')!;
      expect(bsElim.lines[0].accountCode).toBe('2150');
      expect(bsElim.lines[0].debitMinor).toBe(m('10000.00'));
      expect(bsElim.lines[1].accountCode).toBe('1150');
      expect(bsElim.lines[1].creditMinor).toBe(m('10000.00'));

      // Check elimination 3: Investment vs Equity (Dr S Equity 50,000 / Cr Investment 40,000 / Cr NCI Equity 10,000)
      const invElim = result.eliminations.find((e) => e.type === 'INVESTMENT_EQUITY')!;
      expect(invElim.lines[0].accountCode).toBe('3000');
      expect(invElim.lines[0].debitMinor).toBe(m('50000.00'));
      expect(invElim.lines[1].accountCode).toBe('1500');
      expect(invElim.lines[1].creditMinor).toBe(m('40000.00'));
      expect(invElim.lines[2].accountCode).toBe('3500');
      expect(invElim.lines[2].creditMinor).toBe(m('10000.00'));

      // Check Income Statement
      expect(result.incomeStatement.consolidatedNetIncomeBeforeNciMinor).toBe(m('150000.00'));
      expect(result.incomeStatement.nciShareMinor).toBe(m('10000.00'));
      expect(result.incomeStatement.controllingNetIncomeMinor).toBe(m('140000.00'));

      // Check Balance Sheet
      expect(result.balanceSheet.totalAssetsMinor).toBe(m('270000.00')); // 150,000 (P) + 120,000 (S)
      expect(result.balanceSheet.totalLiabilitiesMinor).toBe(m('30000.00')); // 20,000 (P) + 10,000 (S)
      expect(result.balanceSheet.controllingEquityMinor).toBe(m('220000.00')); // 80,000 (Capital) + 140,000 (Profit)
      expect(result.balanceSheet.nciEquityMinor).toBe(m('20000.00')); // 10,000 (Acq) + 10,000 (Profit share)
      expect(result.balanceSheet.totalEquityMinor).toBe(m('240000.00'));
      expect(result.balanceSheet.isBalanced).toBe(true);
    });

    it('handles wholly-owned subsidiary (100% ownership, zero NCI)', () => {
      const config: ConsolidationGroupConfig = {
        groupId: 'group-wholly',
        groupName: 'Group 100',
        reportingCurrency: 'EUR',
        parentEntityId: 'P',
        subsidiaries: [
          {
            subsidiaryEntityId: 'S',
            ownershipRatioScaled6: SCALE_1M, // 100%
            acquisitionEquityMinor: m('20000.00'),
          },
        ],
      };

      const profiles: EntityFinancialProfile[] = [
        {
          entityId: 'P',
          entityName: 'Parent',
          currency: 'EUR',
          balances: [
            { accountCode: '4000', accountName: 'Sales', category: 'REVENUE', debitMinor: 0n, creditMinor: m('100000.00') },
            { accountCode: '1000', accountName: 'Cash', category: 'ASSET', debitMinor: m('80000.00'), creditMinor: 0n },
            { accountCode: '1500', accountName: 'Investment', category: 'ASSET', debitMinor: m('20000.00'), creditMinor: 0n },
            { accountCode: '3000', accountName: 'Equity', category: 'EQUITY', debitMinor: 0n, creditMinor: m('0.00') },
          ],
        },
        {
          entityId: 'S',
          entityName: 'Sub',
          currency: 'EUR',
          balances: [
            { accountCode: '4000', accountName: 'Sales', category: 'REVENUE', debitMinor: 0n, creditMinor: m('50000.00') },
            { accountCode: '1000', accountName: 'Cash', category: 'ASSET', debitMinor: m('70000.00'), creditMinor: 0n },
            { accountCode: '3000', accountName: 'Equity', category: 'EQUITY', debitMinor: 0n, creditMinor: m('20000.00') },
          ],
        },
      ];

      const result = service.consolidateGroup(config, profiles);

      expect(result.incomeStatement.consolidatedNetIncomeBeforeNciMinor).toBe(m('150000.00'));
      expect(result.incomeStatement.nciShareMinor).toBe(0n);
      expect(result.incomeStatement.controllingNetIncomeMinor).toBe(m('150000.00'));
      expect(result.balanceSheet.nciEquityMinor).toBe(0n);
      expect(result.balanceSheet.isBalanced).toBe(true);
    });
  });
});
