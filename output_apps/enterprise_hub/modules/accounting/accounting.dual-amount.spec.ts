import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { FxRateEntity } from './entities/fx-rate.entity';
import { FxRateType, JournalEntryStatus } from './enums/accounting.enum';
import {
  AccountingRepository,
  JournalLineInput,
} from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import { minorToDecimal } from './money';

const currencyService = {
  convert: (value: number) => value,
  round: (value: number) => value,
} as unknown as CurrencyService;

interface PersistedHeader {
  entryNumber: string;
  date: Date;
  description: string;
  status: string;
}

class FakeAccountingRepository {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  fxRates: FxRateEntity[] = [];
  private seq = 0;

  async countAccounts(tenantId: string): Promise<number> {
    return this.accounts.filter((row) => row.tenantId === tenantId).length;
  }

  async findAllAccounts(tenantId: string): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter((row) => row.tenantId === tenantId);
  }

  async insertMissingAccounts(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>[],
  ): Promise<void> {
    const existing = new Set(
      this.accounts
        .filter((row) => row.tenantId === tenantId)
        .map((row) => row.code),
    );
    await this.createAccounts(
      tenantId,
      data.filter((item) => !existing.has(item.code as string)),
    );
  }

  async createAccounts(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>[],
  ): Promise<ChartOfAccountEntity[]> {
    return data.map((item) => {
      const entity = {
        ...item,
        id: ++this.seq,
        tenantId,
        balance: item.balance ?? '0',
      } as ChartOfAccountEntity;
      this.accounts.push(entity);
      return entity;
    });
  }

  async findEntryByNumber(): Promise<JournalEntryEntity | null> {
    return null;
  }

  async findAccountsByCodes(
    tenantId: string,
    codes: string[],
  ): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter(
      (row) => row.tenantId === tenantId && codes.includes(row.code),
    );
  }

  async findEntryByIdempotencyKey(): Promise<JournalEntryEntity | null> {
    return null;
  }

  async persistJournalEntry(
    tenantId: string,
    header: PersistedHeader,
    lineInputs: JournalLineInput[],
  ): Promise<JournalEntryEntity> {
    const entry = {
      id: ++this.seq,
      tenantId,
      ...header,
      lines: [] as JournalEntryLineEntity[],
    } as unknown as JournalEntryEntity;

    for (const input of lineInputs) {
      const account = this.accounts.find(
        (row) => row.id === input.accountId && row.tenantId === tenantId,
      );
      entry.lines.push({
        id: ++this.seq,
        tenantId,
        journalEntryId: entry.id,
        accountId: input.accountId,
        account,
        debit: minorToDecimal(input.debitMinor),
        credit: minorToDecimal(input.creditMinor),
        currency: input.currency ?? 'IRR',
        amountFx: input.amountFx ?? null,
        fxRate: input.fxRate ?? null,
        partyCode: input.partyCode ?? null,
        description: input.description ?? null,
        txCurrencyCode: input.txCurrencyCode ?? input.currency ?? 'IRR',
        fxRateApplied: input.fxRateApplied ?? input.fxRate ?? '1.0',
        txDebit: minorToDecimal(input.txDebitMinor != null ? input.txDebitMinor : input.debitMinor),
        txCredit: minorToDecimal(input.txCreditMinor != null ? input.txCreditMinor : input.creditMinor),
        bookDebit: minorToDecimal(input.bookDebitMinor != null ? input.bookDebitMinor : input.debitMinor),
        bookCredit: minorToDecimal(input.bookCreditMinor != null ? input.bookCreditMinor : input.creditMinor),
        isRounding: input.isRounding ?? false,
      } as unknown as JournalEntryLineEntity);
    }

    this.entries.push(entry);
    return entry;
  }

  async upsertFxRate(
    tenantId: string,
    data: {
      baseCurrency: string;
      quoteCurrency: string;
      rateDate: string;
      rateType: FxRateType;
      rate: string;
      source?: string;
    },
  ): Promise<FxRateEntity> {
    const existingIndex = this.fxRates.findIndex(
      (r) =>
        r.tenantId === tenantId &&
        r.baseCurrency === data.baseCurrency.toUpperCase() &&
        r.quoteCurrency === data.quoteCurrency.toUpperCase() &&
        r.rateDate === data.rateDate &&
        r.rateType === data.rateType,
    );

    const entity: FxRateEntity = {
      id: existingIndex >= 0 ? this.fxRates[existingIndex].id : `fx-${++this.seq}`,
      tenantId,
      baseCurrency: data.baseCurrency.toUpperCase(),
      quoteCurrency: data.quoteCurrency.toUpperCase(),
      rateDate: data.rateDate,
      rateType: data.rateType,
      rate: data.rate,
      source: data.source ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (existingIndex >= 0) {
      this.fxRates[existingIndex] = entity;
    } else {
      this.fxRates.push(entity);
    }
    return entity;
  }

  async findFxRate(
    tenantId: string,
    baseCurrency: string,
    quoteCurrency: string,
    rateDate: string,
    rateType: FxRateType = FxRateType.SPOT,
  ): Promise<FxRateEntity | null> {
    return (
      this.fxRates.find(
        (r) =>
          r.tenantId === tenantId &&
          r.baseCurrency === baseCurrency.toUpperCase() &&
          r.quoteCurrency === quoteCurrency.toUpperCase() &&
          r.rateDate === rateDate &&
          r.rateType === rateType,
      ) ?? null
    );
  }

  async listFxRates(
    tenantId: string,
    options: {
      baseCurrency?: string;
      quoteCurrency?: string;
      rateDate?: string;
      rateType?: FxRateType;
    } = {},
  ): Promise<FxRateEntity[]> {
    return this.fxRates.filter((r) => {
      if (r.tenantId !== tenantId) return false;
      if (options.baseCurrency && r.baseCurrency !== options.baseCurrency.toUpperCase()) return false;
      if (options.quoteCurrency && r.quoteCurrency !== options.quoteCurrency.toUpperCase()) return false;
      if (options.rateDate && r.rateDate !== options.rateDate) return false;
      if (options.rateType && r.rateType !== options.rateType) return false;
      return true;
    });
  }
}

describe('AccountingService - Dual-Amount Ledger & FX Rates (T138)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let repo: FakeAccountingRepository;
  let service: AccountingService;

  beforeEach(() => {
    repo = new FakeAccountingRepository();
    service = new AccountingService(
      repo as unknown as AccountingRepository,
      currencyService,
    );
  });

  describe('Dual-Amount Line Normalization and Balance Enforcement', () => {
    it('normalizes lines with explicit dual amounts and persists them', async () => {
      const entry = await service.createJournalEntry(tenantId, {
        entryNumber: 'DUAL-001',
        description: 'سند تسعیر ارز دوطرفه',
        lines: [
          {
            accountCode: '1010',
            txCurrencyCode: 'USD',
            txDebit: 100,
            txCredit: 0,
            bookDebit: 92000000,
            bookCredit: 0,
            fxRateApplied: 920000,
          },
          {
            accountCode: '4010',
            txCurrencyCode: 'USD',
            txDebit: 0,
            txCredit: 100,
            bookDebit: 0,
            bookCredit: 92000000,
            fxRateApplied: 920000,
          },
        ],
      });

      expect(entry.id).toBeDefined();
      expect(entry.lines).toHaveLength(2);

      const [line1, line2] = entry.lines;
      expect(line1.txCurrencyCode).toBe('USD');
      expect(line1.txDebit).toBe(100);
      expect(line1.txCredit).toBe(0);
      expect(line1.bookDebit).toBe(92000000);
      expect(line1.bookCredit).toBe(0);
      expect(line1.fxRateApplied).toBe(920000);
      expect(line1.isRounding).toBe(false);

      expect(line2.txCurrencyCode).toBe('USD');
      expect(line2.txDebit).toBe(0);
      expect(line2.txCredit).toBe(100);
      expect(line2.bookDebit).toBe(0);
      expect(line2.bookCredit).toBe(92000000);
    });

    it('rejects entries unbalanced in book reporting currency', async () => {
      await expect(
        service.createJournalEntry(tenantId, {
          entryNumber: 'UNBAL-BOOK',
          description: 'عدم تراز در دفاتر',
          lines: [
            {
              accountCode: '1010',
              txCurrencyCode: 'USD',
              txDebit: 100,
              txCredit: 0,
              bookDebit: 92000000,
              bookCredit: 0,
            },
            {
              accountCode: '4010',
              txCurrencyCode: 'USD',
              txDebit: 0,
              txCredit: 100,
              bookDebit: 0,
              bookCredit: 91000000, // 1,000,000 IRR unbalanced
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces single transaction currency balance when all non-rounding lines share one currency', async () => {
      // Book balances (92,000,000 IRR = 92,000,000 IRR) but USD amounts are unbalanced (100 USD vs 90 USD)
      await expect(
        service.createJournalEntry(tenantId, {
          entryNumber: 'UNBAL-TX',
          description: 'عدم تراز در ارز معامله',
          lines: [
            {
              accountCode: '1010',
              txCurrencyCode: 'USD',
              txDebit: 100,
              txCredit: 0,
              bookDebit: 92000000,
              bookCredit: 0,
            },
            {
              accountCode: '4010',
              txCurrencyCode: 'USD',
              txDebit: 0,
              txCredit: 90, // Unbalanced in USD!
              bookDebit: 0,
              bookCredit: 92000000,
            },
          ],
        }),
      ).rejects.toThrow(/در ارز معامله/);
    });

    it('allows multi-currency entries when transaction currencies differ but book currency balances', async () => {
      // Line 1 in USD, Line 2 in EUR - book currency balances in IRR
      const entry = await service.createJournalEntry(tenantId, {
        entryNumber: 'MULTI-TX-001',
        description: 'سند تسعیر چندارزی',
        lines: [
          {
            accountCode: '1010',
            txCurrencyCode: 'USD',
            txDebit: 100,
            txCredit: 0,
            bookDebit: 92000000,
            bookCredit: 0,
            fxRateApplied: 920000,
          },
          {
            accountCode: '1020',
            txCurrencyCode: 'EUR',
            txDebit: 0,
            txCredit: 92,
            bookDebit: 0,
            bookCredit: 92000000,
            fxRateApplied: 1000000,
          },
        ],
      });

      expect(entry.id).toBeDefined();
      expect(entry.totalDebit).toBe(92000000);
      expect(entry.totalCredit).toBe(92000000);
    });
  });

  describe('Rounding Adjustment Lines (is_rounding = true)', () => {
    it('accepts rounding line absorbing book residual <= 100 minor units (1 IRR)', async () => {
      // 100 USD at 920000.5 gives 92,000,050 IRR.
      // Other side has 92,000,000 IRR and a rounding adjustment line of 50 minor units (0.50 IRR).
      const entry = await service.createJournalEntry(tenantId, {
        entryNumber: 'ROUND-001',
        description: 'سند با سطر تعدیل گردکردن',
        lines: [
          {
            accountCode: '1010',
            txCurrencyCode: 'USD',
            txDebit: 100,
            txCredit: 0,
            bookDebit: '920000.50',
            bookCredit: 0,
          },
          {
            accountCode: '4010',
            txCurrencyCode: 'USD',
            txDebit: 0,
            txCredit: 100,
            bookDebit: 0,
            bookCredit: '920000.00',
          },
          {
            accountCode: '2010',
            txCurrencyCode: 'IRR',
            txDebit: 0,
            txCredit: 0,
            bookDebit: 0,
            bookCredit: '0.50',
            isRounding: true,
          },
        ],
      });

      expect(entry.id).toBeDefined();
      const roundingLine = entry.lines.find((l) => l.isRounding);
      expect(roundingLine).toBeDefined();
      expect(roundingLine?.bookCredit).toBe(0.5);
      expect(roundingLine?.txDebit).toBe(0);
      expect(roundingLine?.txCredit).toBe(0);
    });

    it('rejects rounding line exceeding 100 minor units (1 IRR)', async () => {
      await expect(
        service.createJournalEntry(tenantId, {
          entryNumber: 'ROUND-TOO-HIGH',
          description: 'گردکردن بیش از حد مجاز',
          lines: [
            {
              accountCode: '1010',
              txCurrencyCode: 'USD',
              txDebit: 100,
              bookDebit: '102.00',
            },
            {
              accountCode: '4010',
              txCurrencyCode: 'USD',
              txCredit: 100,
              bookCredit: '100.00',
            },
            {
              accountCode: '2010',
              bookCredit: '2.00', // 200 minor units > 100 minor units
              isRounding: true,
            },
          ],
        }),
      ).rejects.toThrow(/سطر گردکردن نمی‌تواند بیش از ۱ ریال/);
    });

    it('rejects rounding line with non-zero transaction currency amount', async () => {
      await expect(
        service.createJournalEntry(tenantId, {
          entryNumber: 'ROUND-WITH-TX',
          description: 'گردکردن با مبلغ ارزی',
          lines: [
            {
              accountCode: '1010',
              bookDebit: '100.50',
              txDebit: 100,
            },
            {
              accountCode: '4010',
              bookCredit: '100.00',
              txCredit: 100,
            },
            {
              accountCode: '2010',
              bookCredit: '0.50',
              txCredit: 0.5, // Not allowed!
              isRounding: true,
            },
          ],
        }),
      ).rejects.toThrow(/سطر گردکردن نباید مبلغی در ارز معامله داشته باشد/);
    });

    it('applyRoundingResidual automatically balances small residual up to 100 minor units', () => {
      const initialLines = [
        {
          accountCode: '1010',
          txCurrencyCode: 'USD',
          txDebit: 100,
          bookDebit: '920000.40',
        },
        {
          accountCode: '4010',
          txCurrencyCode: 'USD',
          txCredit: 100,
          bookCredit: '920000.00',
        },
      ];

      const balancedLines = service.applyRoundingResidual(initialLines, '7010');
      expect(balancedLines).toHaveLength(3);

      const roundLine = balancedLines[2];
      expect(roundLine.isRounding).toBe(true);
      expect(roundLine.bookCredit).toBe(0.4);
      expect(roundLine.txDebit).toBe(0);
      expect(roundLine.txCredit).toBe(0);
    });
  });

  describe('FX Rates Service API', () => {
    it('creates, finds, and lists FX rates', async () => {
      const created = await service.upsertFxRate(tenantId, {
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rateDate: '2026-11-16',
        rateType: FxRateType.SPOT,
        rate: 920000,
        source: 'CBI',
      });

      expect(created.id).toBeDefined();
      expect(created.baseCurrency).toBe('USD');
      expect(created.quoteCurrency).toBe('IRR');
      expect(created.rate).toBe(920000);
      expect(created.rateType).toBe(FxRateType.SPOT);

      const found = await service.findFxRate(
        tenantId,
        'usd',
        'irr',
        '2026-11-16',
        FxRateType.SPOT,
      );
      expect(found).not.toBeNull();
      expect(found?.rate).toBe(920000);

      const list = await service.listFxRates(tenantId, {
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
      });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
    });
  });
});
