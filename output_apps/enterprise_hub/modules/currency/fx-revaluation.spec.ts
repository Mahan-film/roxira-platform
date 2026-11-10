import { ConfigService } from '@nestjs/config';
import { Currency } from './enums/currency.enum';
import { CurrencyService } from './services/currency.service';
import { FxRevaluationService, ForeignAccountBalance } from './services/fx-revaluation.service';
import { findTemplate } from '../posting_rules/domain/posting-templates';

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
      expect(revaluationService.getRateToRial(Currency.IRR)).toBe(1);
      expect(revaluationService.getRateToRial(Currency.IRT)).toBe(10);
    });

    it('calculates USD to Rial rate from reference table', () => {
      // Default rates: USD = 1, IRR = 920,000 per USD => 1 USD = 920,000 Rials
      const rate = revaluationService.getRateToRial(Currency.USD);
      expect(rate).toBe(920000);
    });

    it('calculates EUR to Rial rate accurately', () => {
      // EUR = 0.92 per USD, IRR = 920,000 per USD => 1 EUR = 920,000 / 0.92 = 1,000,000 Rials
      const rate = revaluationService.getRateToRial(Currency.EUR);
      expect(rate).toBe(1000000);
    });
  });

  describe('Single Balance Revaluation', () => {
    it('recognizes FX Gain when foreign currency appreciated against Rial', () => {
      // 10,000 USD booked at 8,500,000,000 Rials (historical rate 850,000)
      // Current rate 920,000 => current value 9,200,000,000 Rials
      // Gain = 700,000,000 Rials
      const balance: ForeignAccountBalance = {
        accountCode: '1015',
        accountName: 'حساب جاری ارزی دلاری',
        currency: Currency.USD,
        foreignAmount: 10000,
        bookValueRial: BigInt(8_500_000_000),
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('gain');
      expect(result.currentValueRial).toBe(BigInt(9_200_000_000));
      expect(result.gainMinor).toBe(BigInt(700_000_000));
      expect(result.lossMinor).toBe(BigInt(0));
      expect(result.diffRial).toBe(BigInt(700_000_000));
    });

    it('recognizes FX Loss when foreign currency depreciated or booked higher', () => {
      // 5,000 EUR booked at 5,500,000,000 Rials (historical rate 1,100,000)
      // Current rate 1,000,000 => current value 5,000,000,000 Rials
      // Loss = 500,000,000 Rials
      const balance: ForeignAccountBalance = {
        accountCode: '1016',
        accountName: 'حساب ارزی یورو',
        currency: Currency.EUR,
        foreignAmount: 5000,
        bookValueRial: BigInt(5_500_000_000),
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('loss');
      expect(result.currentValueRial).toBe(BigInt(5_000_000_000));
      expect(result.lossMinor).toBe(BigInt(500_000_000));
      expect(result.gainMinor).toBe(BigInt(0));
      expect(result.diffRial).toBe(BigInt(-500_000_000));
    });

    it('identifies neutral revaluation when rate has zero variance', () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1015',
        accountName: 'دلار',
        currency: Currency.USD,
        foreignAmount: 1000,
        bookValueRial: BigInt(920_000_000), // Exactly 920,000 rate
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('neutral');
      expect(result.diffRial).toBe(BigInt(0));
      expect(result.gainMinor).toBe(BigInt(0));
      expect(result.lossMinor).toBe(BigInt(0));
    });
  });

  describe('Month-End Revaluation Voucher Generation', () => {
    it('creates perfectly balanced voucher lines down to 0 Rials', () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1015',
          accountName: 'بانک ارزی دلاری',
          currency: Currency.USD,
          foreignAmount: 10000,
          bookValueRial: BigInt(8_500_000_000), // Gain: 700,000,000
        },
        {
          accountCode: '1016',
          accountName: 'بانک ارزی یورویی',
          currency: Currency.EUR,
          foreignAmount: 5000,
          bookValueRial: BigInt(5_500_000_000), // Loss: 500,000,000
        },
      ];

      const voucher = revaluationService.generateMonthEndVoucher('1405-08', balances);

      expect(voucher.period).toBe('1405-08');
      expect(voucher.totalGainMinor).toBe(BigInt(700_000_000));
      expect(voucher.totalLossMinor).toBe(BigInt(500_000_000));
      expect(voucher.netImpactMinor).toBe(BigInt(200_000_000)); // 200M net profit

      // Verify that the voucher is balanced: sum(debit) === sum(credit)
      let totalDebit = BigInt(0);
      let totalCredit = BigInt(0);
      for (const line of voucher.voucherLines) {
        totalDebit += line.debitMinor;
        totalCredit += line.creditMinor;
      }

      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(BigInt(1_200_000_000)); // 700M gain + 500M loss
    });

    it('posting rules template exists for currency.fx_revaluation', () => {
      const template = findTemplate('currency.fx_revaluation');
      expect(template).toBeDefined();
      expect(template!.docType).toBe('currency.fx_revaluation');
      expect(template!.amounts).toContain('gain');
      expect(template!.amounts).toContain('loss');
    });
  });
});
