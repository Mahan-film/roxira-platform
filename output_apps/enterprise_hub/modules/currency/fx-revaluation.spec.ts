import { ConfigService } from '@nestjs/config';
import { Currency } from './enums/currency.enum';
import { CurrencyService } from './services/currency.service';
import { FxRevaluationService, ForeignAccountBalance } from './services/fx-revaluation.service';
import { findTemplate, POSTING_TEMPLATES } from '../posting_rules/domain/posting-templates';
import { buildProposal } from '../posting_rules/domain/posting-engine';
import { PostingRulesService, PostingResult } from '../posting_rules/services/posting-rules.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { AccountingService } from '../accounting/services/accounting.service';

describe('FX Revaluation / تسعیر ارز (#230 / T75)', () => {
  let currencyService: CurrencyService;
  let revaluationService: FxRevaluationService;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string, defaultVal: string) => defaultVal),
    } as unknown as ConfigService;

    currencyService = new CurrencyService(configService);
    revaluationService = new FxRevaluationService(currencyService);
  });

  describe('Exchange Rate to Rial Calculations', () => {
    it('returns 1 for IRR and 10 for IRT', () => {
      expect(revaluationService.getRateToRial(Currency.IRR)).toBe(1n);
      expect(revaluationService.getRateToRial(Currency.IRT)).toBe(10n);
    });

    it('calculates USD to Rial rate from reference table', () => {
      // Default rates: USD = 1, IRR = 920,000 per USD => 1 USD = 920,000 Rials
      const rate = revaluationService.getRateToRial(Currency.USD);
      expect(rate).toBe(920000n);
    });

    it('calculates EUR to Rial rate accurately', () => {
      // EUR = 0.92 per USD, IRR = 920,000 per USD => 1 EUR = 920,000 / 0.92 = 1,000,000 Rials
      const rate = revaluationService.getRateToRial(Currency.EUR);
      expect(rate).toBe(1000000n);
    });
  });

  describe('Single Balance Revaluation (Assets & Liabilities)', () => {
    it('recognizes FX Gain on Asset when foreign currency appreciated against Rial', () => {
      // 10,000.00 USD (1,000,000 minor cents) booked at 8,500,000,000 Rials (historical rate 850,000)
      // Current rate 920,000 => current value 9,200,000,000 Rials
      // Gain = 700,000,000 Rials
      // Using account 1012 (بانک‌ها) from iran-chart-template.ts
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'حساب جاری ارزی دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n, // 10,000 USD
        bookValueRialMinor: 8_500_000_000n,
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('gain');
      expect(result.currentValueRialMinor).toBe(9_200_000_000n);
      expect(result.gainMinor).toBe(700_000_000n);
      expect(result.lossMinor).toBe(0n);
      expect(result.diffRialMinor).toBe(700_000_000n);
    });

    it('recognizes FX Loss on Asset when foreign currency depreciated or booked higher', () => {
      // 5,000.00 EUR (500,000 minor cents) booked at 5,500,000,000 Rials (historical rate 1,100,000)
      // Current rate 1,000,000 => current value 5,000,000,000 Rials
      // Loss = 500,000,000 Rials
      // Using account 1020 (حساب‌های دریافتنی تجاری) from iran-chart-template.ts
      const balance: ForeignAccountBalance = {
        accountCode: '1020',
        accountName: 'حساب دریافتنی ارزی یورو',
        currency: Currency.EUR,
        foreignAmountMinor: 500000n, // 5,000 EUR
        bookValueRialMinor: 5_500_000_000n,
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('loss');
      expect(result.currentValueRialMinor).toBe(5_000_000_000n);
      expect(result.lossMinor).toBe(500_000_000n);
      expect(result.gainMinor).toBe(0n);
      expect(result.diffRialMinor).toBe(-500_000_000n);
    });

    it('handles Liability (AP) balances correctly with inverted sign', () => {
      // Accounts Payable (2010): We owe 10,000.00 USD (1,000,000 minor cents).
      // Book value was 8,000,000,000 Rials (booked at 800,000).
      // Current rate is 920,000 => current obligation is 9,200,000,000 Rials.
      // Rate increased on liability => obligation increased by 1,200,000,000 Rials => LOSS!
      const apLiabilityIncreased: ForeignAccountBalance = {
        accountCode: '2010',
        accountName: 'حساب پرداختنی تجاری دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n,
        bookValueRialMinor: 8_000_000_000n,
        isLiability: true,
      };

      const lossResult = revaluationService.revalueBalance(apLiabilityIncreased);
      expect(lossResult.type).toBe('loss');
      expect(lossResult.lossMinor).toBe(1_200_000_000n);
      expect(lossResult.gainMinor).toBe(0n);

      // Conversely, if current rate drops (obligation decreases), it is a GAIN:
      const apLiabilityDecreased: ForeignAccountBalance = {
        accountCode: '2010',
        accountName: 'حساب پرداختنی تجاری دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n,
        bookValueRialMinor: 10_000_000_000n, // booked at 1,000,000
        isLiability: true,
      };
      // Current value 9,200,000,000 Rials < book value 10,000,000,000 => GAIN 800,000,000!
      const gainResult = revaluationService.revalueBalance(apLiabilityDecreased);
      expect(gainResult.type).toBe('gain');
      expect(gainResult.gainMinor).toBe(800_000_000n);
      expect(gainResult.lossMinor).toBe(0n);
    });

    it('identifies neutral revaluation when rate has zero variance', () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'بانک ارزی',
        currency: Currency.USD,
        foreignAmountMinor: 100000n, // 1000 USD
        bookValueRialMinor: 920_000_000n, // exactly 920,000 rate
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('neutral');
      expect(result.diffRialMinor).toBe(0n);
      expect(result.gainMinor).toBe(0n);
      expect(result.lossMinor).toBe(0n);
    });
  });

  describe('Month-End Revaluation Voucher Generation & Iran Chart Compliance', () => {
    it('creates perfectly balanced voucher lines using standard accounts 4120 and 5210', () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1012', // بانک‌ها
          accountName: 'بانک ارزی دلاری',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 8_500_000_000n, // Gain: 700,000,000
        },
        {
          accountCode: '1020', // حساب‌های دریافتنی تجاری
          accountName: 'حساب دریافتنی یورویی',
          currency: Currency.EUR,
          foreignAmountMinor: 500000n,
          bookValueRialMinor: 5_500_000_000n, // Loss: 500,000,000
        },
      ];

      const voucher = revaluationService.generateMonthEndVoucher('1405-08', balances);

      expect(voucher.period).toBe('1405-08');
      expect(voucher.totalGainMinor).toBe(700_000_000n);
      expect(voucher.totalLossMinor).toBe(500_000_000n);
      expect(voucher.netImpactMinor).toBe(200_000_000n);

      // Verify that accounts are only those in iran-chart-template.ts
      for (const line of voucher.voucherLines) {
        expect(['1012', '1020', '4120', '5210']).toContain(line.accountCode);
      }

      // Verify that total debit equals total credit down to 0 Rials
      let totalDebit = 0n;
      let totalCredit = 0n;
      for (const line of voucher.voucherLines) {
        totalDebit += line.debitMinor;
        totalCredit += line.creditMinor;
      }

      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(1_200_000_000n); // 700M + 500M
    });

    it('posting rules template exists and builds proposal cleanly through posting engine', () => {
      const template = findTemplate('currency.fx_revaluation');
      expect(template).toBeDefined();
      expect(template!.docType).toBe('currency.fx_revaluation');
      expect(template!.amounts).toContain('gain');
      expect(template!.amounts).toContain('loss');
      expect(template!.defaults?.fx_gain).toBe('4120');
      expect(template!.defaults?.fx_loss).toBe('5210');
      expect(template!.defaults?.monetary_asset).toBe('1012');

      // Test buildProposal with posting engine
      const proposal = buildProposal({
        docType: 'currency.fx_revaluation',
        amounts: {
          gain: 300_000_000n,
          loss: 0n,
        },
        mapping: {},
        overrides: {
          monetary_asset: '1012',
        },
      });

      expect(proposal.total).toBe(300_000_000n);
      expect(proposal.lines).toHaveLength(2);
      expect(proposal.lines[0].accountCode).toBe('1012'); // Dr monetary asset
      expect(proposal.lines[0].debit).toBe(300_000_000n);
      expect(proposal.lines[0].credit).toBe(0n);
      expect(proposal.lines[1].accountCode).toBe('4120'); // Cr fx_gain
      expect(proposal.lines[1].debit).toBe(0n);
      expect(proposal.lines[1].credit).toBe(300_000_000n);
    });

    it('postMonthEndRevaluation posts through PostingRulesService with idempotency', async () => {
      const mockPostingRules: Partial<PostingRulesService> = {
        post: jest.fn().mockResolvedValue({
          entryId: 42,
          entryNumber: 'V-1405-08-01',
          replayed: false,
        }),
      };

      const wiredService = new FxRevaluationService(
        currencyService,
        mockPostingRules as PostingRulesService,
      );

      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1012',
          accountName: 'بانک ارزی دلاری',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 8_500_000_000n, // Gain: 700M
        },
      ];

      const res = await wiredService.postMonthEndRevaluation('tenant-1', {
        period: '1405-08',
        date: '2026-11-21',
        balances,
      });

      expect(mockPostingRules.post).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          docType: 'currency.fx_revaluation',
          sourceType: 'currency_revaluation',
          sourceId: '1405-08:1012',
          date: '2026-11-21',
          amounts: { gain: 700_000_000n, loss: 0n },
          overrides: { monetary_asset: '1012' },
        }),
        undefined,
      );

      expect(res.postingResults).toHaveLength(1);
      expect(res.postingResults[0].entryId).toBe(42);
    });
  });
});
