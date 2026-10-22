import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import {
  AccountingRepository,
  JournalLineInput,
} from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

/** سرویس ارز ساختگی (بدون ConfigService) برای تست‌های واحد. */
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

/**
 * Repository درون‌حافظه‌ای مینیمال که تنها مسیرهای مورد نیاز ثبت سند را
 * پوشش می‌دهد تا کنترل تراز ریالی و تطبیق ارزی در سطح سرویس سنجیده شود.
 */
class FakeAccountingRepository {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  private seq = 0;

  async countAccounts(tenantId: string): Promise<number> {
    return this.accounts.filter((row) => row.tenantId === tenantId).length;
  }

  async findAllAccounts(tenantId: string): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter((row) => row.tenantId === tenantId);
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
        balance: item.balance ?? 0,
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

  async getTrialBalance() {
    return [];
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
        debit: input.debit,
        credit: input.credit,
        currency: input.currency ?? 'IRR',
        amountFx: input.amountFx ?? null,
        fxRate: input.fxRate ?? null,
        partyCode: input.partyCode ?? null,
        description: input.description ?? null,
      } as unknown as JournalEntryLineEntity);
    }

    this.entries.push(entry);
    return entry;
  }
}

const buildService = () => {
  const repository =
    new FakeAccountingRepository() as unknown as AccountingRepository;
  return new AccountingService(repository, currencyService);
};

const baseEntry = (entryNumber: string, lines: object[]) => ({
  entryNumber,
  description: 'سند آزمایشی چندارزی',
  lines,
});

describe('AccountingService — IRR balance tolerance', () => {
  it('accepts a balanced IRR entry', async () => {
    const service = buildService();
    const entry = await service.createJournalEntry(
      'tenant-a',
      baseEntry('JV-1', [
        { accountCode: '1010', debit: 1_000 },
        { accountCode: '4010', credit: 1_000 },
      ]) as never,
    );

    expect(entry.totalDebit).toBe(1_000);
    expect(entry.totalCredit).toBe(1_000);
  });

  it('accepts an imbalance of exactly 0.5 rial', async () => {
    const service = buildService();
    await expect(
      service.createJournalEntry(
        'tenant-a',
        baseEntry('JV-2', [
          { accountCode: '1010', debit: 1_000.5 },
          { accountCode: '4010', credit: 1_000 },
        ]) as never,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects an imbalance greater than 0.5 rial with a Persian message', async () => {
    const service = buildService();
    await expect(
      service.createJournalEntry(
        'tenant-a',
        baseEntry('JV-3', [
          { accountCode: '1010', debit: 1_001 },
          { accountCode: '4010', credit: 1_000 },
        ]) as never,
      ),
    ).rejects.toThrow(/تراز نیست/);
  });
});

describe('AccountingService — FX line validation', () => {
  it('accepts and persists a consistent FX line', async () => {
    const service = buildService();
    const entry = await service.createJournalEntry(
      'tenant-a',
      baseEntry('JV-FX-1', [
        {
          accountCode: '1010',
          debit: 90_000_000,
          currency: 'USD',
          amountFx: 100,
          fxRate: 900_000,
          partyCode: 'TZ-1',
        },
        {
          accountCode: '4010',
          credit: 90_000_000,
          currency: 'USD',
          amountFx: 100,
          fxRate: 900_000,
        },
      ]) as never,
    );

    expect(entry.currency).toBe('USD');
    expect(entry.lines[0].currency).toBe('USD');
    expect(entry.lines[0].amountFx).toBe(100);
    expect(entry.lines[0].fxRate).toBe(900_000);
    expect(entry.lines[0].partyCode).toBe('TZ-1');
  });

  it('rejects when amount_fx × fx_rate diverges beyond 1 rial', async () => {
    const service = buildService();
    await expect(
      service.createJournalEntry(
        'tenant-a',
        baseEntry('JV-FX-2', [
          {
            accountCode: '1010',
            debit: 90_000_002,
            currency: 'USD',
            amountFx: 100,
            fxRate: 900_000,
          },
          {
            accountCode: '4010',
            credit: 90_000_002,
            currency: 'USD',
            amountFx: 100,
            fxRate: 900_000,
          },
        ]) as never,
      ),
    ).rejects.toThrow(/نمی‌خواند/);
  });

  it('normalises Persian currency synonyms on lines', async () => {
    const service = buildService();
    const entry = await service.createJournalEntry(
      'tenant-a',
      baseEntry('JV-FX-3', [
        { accountCode: '1010', debit: 5_000_000, currency: 'تومان' },
        { accountCode: '4010', credit: 5_000_000, currency: 'تومان' },
      ]) as never,
    );

    expect(entry.lines[0].currency).toBe('IRT');
  });

  it('rejects an unknown line currency', async () => {
    const service = buildService();
    await expect(
      service.createJournalEntry(
        'tenant-a',
        baseEntry('JV-FX-4', [
          { accountCode: '1010', debit: 1_000, currency: 'XYZ' },
          { accountCode: '4010', credit: 1_000 },
        ]) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects the account-level MULTI currency on a line', async () => {
    const service = buildService();
    await expect(
      service.createJournalEntry(
        'tenant-a',
        baseEntry('JV-FX-5', [
          { accountCode: '1010', debit: 1_000, currency: 'MULTI' },
          { accountCode: '4010', credit: 1_000 },
        ]) as never,
      ),
    ).rejects.toThrow(/MULTI/);
  });
});
