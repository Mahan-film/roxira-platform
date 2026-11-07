import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { AccountingController } from './controllers/accounting.controller';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { AccountType, JournalEntryStatus } from './enums/accounting.enum';
import {
  AccountingRepository,
  JournalLineInput,
  LedgerRawRow,
  TrialBalanceRawRow,
} from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import { VoucherToolsService } from './services/voucher-tools.service';
import { fromDb, minorToDecimal } from './money';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

/** سرویس ارز ساختگی (بدون ConfigService) برای تست‌های واحد. */
const currencyService = {
  convert: jest.fn((value: number) => value),
  round: jest.fn((value: number) => value),
} as unknown as CurrencyService;

/**
 * Repository درون‌حافظه‌ای که دقیقاً مثل نسخه واقعی هر خواندن/نوشتن را به
 * `tenantId` محدود می‌کند تا رفتار جداسازی مستأجر در سطح سرویس/کنترلر سنجیده شود.
 */
class InMemoryAccountingRepository {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  lines: JournalEntryLineEntity[] = [];
  private accountSeq = 0;
  private entrySeq = 0;
  private lineSeq = 0;
  private readonly defaultChart = [
    { code: '1010', name: 'موجودی نقد و بانک', accountType: AccountType.ASSET },
    { code: '4010', name: 'درآمد', accountType: AccountType.REVENUE },
  ];

  async findAllAccounts(tenantId: string): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter((row) => row.tenantId === tenantId);
  }

  async findAccountByCode(
    tenantId: string,
    code: string,
  ): Promise<ChartOfAccountEntity | null> {
    return (
      this.accounts.find(
        (row) => row.code === code && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findAccountsByCodes(
    tenantId: string,
    codes: string[],
  ): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter(
      (row) => row.tenantId === tenantId && codes.includes(row.code),
    );
  }

  async countAccounts(tenantId: string): Promise<number> {
    return this.accounts.filter((row) => row.tenantId === tenantId).length;
  }

  async createAccount(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>,
  ): Promise<ChartOfAccountEntity> {
    const entity = {
      ...data,
      id: ++this.accountSeq,
      tenantId,
      balance: data.balance ?? 0,
    } as ChartOfAccountEntity;
    this.accounts.push(entity);
    return entity;
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
    return Promise.all(data.map((item) => this.createAccount(tenantId, item)));
  }

  async findEntryByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<JournalEntryEntity | null> {
    return (
      this.entries.find(
        (row) => row.entryNumber === entryNumber && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findEntryById(
    tenantId: string,
    id: number,
  ): Promise<JournalEntryEntity | null> {
    const entry = this.entries.find(
      (row) => row.id === id && row.tenantId === tenantId,
    );
    return entry ?? null;
  }

  async findAndCountEntries(
    tenantId: string,
    _options: unknown,
  ): Promise<[JournalEntryEntity[], number]> {
    const rows = this.entries.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }

  async searchEntriesByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<JournalEntryEntity[]> {
    return this.entries.filter(
      (row) => row.tenantId === tenantId && row.entryNumber.includes(entryNumber),
    );
  }

  async persistJournalEntry(
    tenantId: string,
    header: {
      entryNumber: string;
      date: Date;
      description: string;
      status: JournalEntryStatus;
    },
    lineInputs: JournalLineInput[],
  ): Promise<JournalEntryEntity> {
    const entry = {
      id: ++this.entrySeq,
      tenantId,
      entryNumber: header.entryNumber,
      date: header.date,
      description: header.description,
      status: header.status,
      lines: [] as JournalEntryLineEntity[],
    } as JournalEntryEntity;

    for (const line of lineInputs) {
      const account =
        this.accounts.find(
          (row) => row.id === line.accountId && row.tenantId === tenantId,
        ) ?? null;
      const lineEntity = {
        id: ++this.lineSeq,
        tenantId,
        journalEntryId: entry.id,
        accountId: line.accountId,
        account: account ?? undefined,
        debit: minorToDecimal(line.debitMinor),
        credit: minorToDecimal(line.creditMinor),
        description: line.description ?? null,
      } as JournalEntryLineEntity;
      this.lines.push(lineEntity);
      entry.lines.push(lineEntity);
      if (account) {
        account.balance = minorToDecimal(
          fromDb(account.balance) + line.debitMinor - line.creditMinor,
        );
      }
    }

    this.entries.push(entry);
    return entry;
  }

  async getTrialBalance(tenantId: string): Promise<TrialBalanceRawRow[]> {
    const grouped = new Map<string, { debit: number; credit: number }>();
    for (const line of this.lines.filter((row) => row.tenantId === tenantId)) {
      const account = this.accounts.find(
        (row) => row.id === line.accountId && row.tenantId === tenantId,
      );
      if (!account) {
        continue;
      }
      const current = grouped.get(account.code) ?? { debit: 0, credit: 0 };
      current.debit += Number(line.debit);
      current.credit += Number(line.credit);
      grouped.set(account.code, current);
    }
    return Array.from(grouped.entries()).map(([code, totals]) => ({
      code,
      name: code,
      accountType: AccountType.ASSET,
      totalDebit: String(totals.debit),
      totalCredit: String(totals.credit),
    }));
  }

  async getAccountLedger(
    tenantId: string,
    accountId: number,
  ): Promise<LedgerRawRow[]> {
    return this.lines
      .filter((row) => row.tenantId === tenantId && row.accountId === accountId)
      .map((line) => {
        const entry = this.entries.find((row) => row.id === line.journalEntryId);
        return {
          id: line.id,
          journalEntryId: line.journalEntryId,
          entryNumber: entry?.entryNumber ?? '',
          date: entry?.date ?? new Date(),
          entryDescription: entry?.description ?? '',
          lineDescription: line.description,
          debit: String(line.debit),
          credit: String(line.credit),
        };
      });
  }

  /** دسترسی آزمون به مانده یک حساب مستأجر. */
  balanceOf(tenantId: string, code: string): number {
    return Number(
      this.accounts.find(
        (row) => row.tenantId === tenantId && row.code === code,
      )?.balance ?? 0,
    );
  }

  /** تعداد ردیف‌های ثبت‌شده در یک مستأجر. */
  countEntries(tenantId: string): number {
    return this.entries.filter((row) => row.tenantId === tenantId).length;
  }

  seedDefaultsFor(tenantId: string): Promise<ChartOfAccountEntity[]> {
    return this.createAccounts(
      tenantId,
      this.defaultChart.map((account) => ({ ...account, currency: 'IRR' })),
    );
  }
}

const buildDto = (entryNumber: string): CreateJournalEntryDto => ({
  entryNumber,
  description: 'سند آزمایشی',
  lines: [
    { accountCode: '1010', debit: 1000 },
    { accountCode: '4010', credit: 1000 },
  ],
});

const buildService = () => {
  const repository =
    new InMemoryAccountingRepository() as unknown as AccountingRepository;
  return { repository, service: new AccountingService(repository, currencyService) };
};

/** A repository whose TenantScope hands the given entity doubles to the query (no database). */
const scopedRepository = (accounts?: object, entries?: object) => {
  const manager = {
    getRepository: (entity: { name: string }) =>
      entity.name === 'ChartOfAccountEntity' ? accounts : entries,
  };
  const scope = { within: async (_t: string, _m: unknown, work: (m: unknown) => unknown) => work(manager) };
  return new AccountingRepository(scope as never);
};

describe('AccountingRepository — tenant scoping', () => {
  it('scopes findEntryById by tenantId', async () => {
    const entries = { findOne: jest.fn(async () => null) };
    const repository = scopedRepository(undefined, entries);

    await repository.findEntryById('tenant-a', 1);

    expect(entries.findOne).toHaveBeenCalledWith({
      where: { id: 1, tenantId: 'tenant-a' },
      relations: { lines: true },
    });
  });

  it('scopes findAccountByCode by tenantId', async () => {
    const accounts = { findOne: jest.fn(async () => null) };
    const repository = scopedRepository(accounts, undefined);

    await repository.findAccountByCode('tenant-a', '1010');

    expect(accounts.findOne).toHaveBeenCalledWith({
      where: { code: '1010', tenantId: 'tenant-a' },
    });
  });

  it('stamps tenantId on createAccount', async () => {
    const accounts = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = scopedRepository(accounts, undefined);

    await repository.createAccount('tenant-a', { code: '9000' });

    expect(accounts.create).toHaveBeenCalledWith({
      code: '9000',
      tenantId: 'tenant-a',
    });
  });

  it('injects tenantId into findAndCountEntries where', async () => {
    const entries = { findAndCount: jest.fn(async () => [[], 0]) };
    const repository = scopedRepository(undefined, entries);

    await repository.findAndCountEntries('tenant-a', {
      where: { status: JournalEntryStatus.POSTED },
    });

    expect(entries.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: JournalEntryStatus.POSTED, tenantId: 'tenant-a' },
      }),
    );
  });
});

describe('AccountingService — cross-tenant isolation', () => {
  it('does not read another tenant journal entry (404)', async () => {
    const { service } = buildService();
    const created = await service.createJournalEntry(
      'tenant-a',
      buildDto('JV-A'),
    );

    await expect(
      service.findOneJournalEntry('tenant-b', created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only the current tenant journal entries', async () => {
    const { service } = buildService();
    await service.createJournalEntry('tenant-a', buildDto('JV-A'));
    await service.createJournalEntry('tenant-b', buildDto('JV-B'));

    const tenantA = await service.findAllJournalEntries('tenant-a', {
      page: 1,
      limit: 20,
    } as never);
    expect(tenantA.total).toBe(1);
    expect(tenantA.data[0].entryNumber).toBe('JV-A');
  });

  it('allows the same entryNumber in two tenants but not twice in one', async () => {
    const { service } = buildService();

    await expect(
      service.createJournalEntry('tenant-a', buildDto('JV-SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.createJournalEntry('tenant-b', buildDto('JV-SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.createJournalEntry('tenant-a', buildDto('JV-SHARED')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same account code in two tenants but not twice in one', async () => {
    const { service } = buildService();
    const dto: CreateAccountDto = {
      code: '9000',
      name: 'حساب سفارشی',
      accountType: AccountType.ASSET,
    };

    await expect(service.createAccount('tenant-a', dto)).resolves.toBeDefined();
    await expect(service.createAccount('tenant-b', dto)).resolves.toBeDefined();
    await expect(service.createAccount('tenant-a', dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lazily seeds the default chart of accounts per tenant', async () => {
    const { service } = buildService();

    const tenantA = await service.listAccounts('tenant-a');
    expect(tenantA.length).toBeGreaterThan(0);
    expect(tenantA.every((account) => account.code.length > 0)).toBe(true);
  });

  it('stamps the tenant on the journal entry and only increments that tenant account', async () => {
    const { service, repository } = buildService();
    const inMemory = repository as unknown as InMemoryAccountingRepository;

    await inMemory.seedDefaultsFor('tenant-a');
    await inMemory.seedDefaultsFor('tenant-b');

    const created = await service.createJournalEntry(
      'tenant-a',
      buildDto('JV-A'),
    );

    expect(created.entryNumber).toBe('JV-A');
    expect(inMemory.countEntries('tenant-a')).toBe(1);
    expect(inMemory.countEntries('tenant-b')).toBe(0);
    expect(inMemory.balanceOf('tenant-a', '1010')).toBe(1000);
    expect(inMemory.balanceOf('tenant-b', '1010')).toBe(0);
  });
});

describe('AccountingController — tenant access rules', () => {
  const setup = async () => {
    const { service } = buildService();
    const controller = new AccountingController(service, {} as VoucherToolsService);
    const created = await service.createJournalEntry(
      'tenant-a',
      buildDto('JV-A'),
    );
    return { controller, entryId: created.id };
  };

  it('denies a user with a null tenant (403)', async () => {
    const { controller, entryId } = await setup();

    await expect(
      controller.getJournalEntry(
        requestWith({ tenantId: null, role: UserRole.ADMIN }),
        entryId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });


  it('allows the platform ADMIN of the owning tenant', async () => {
    const { controller, entryId } = await setup();

    const result = await controller.getJournalEntry(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      entryId,
    );

    expect(result.id).toBe(entryId);
  });

  it('allows the tenant OWNER', async () => {
    const { controller, entryId } = await setup();

    const result = await controller.getJournalEntry(
      requestWith({
        tenantId: 'tenant-a',
        role: UserRole.USER,
        tenantRole: TenantRole.OWNER,
      }),
      entryId,
    );

    expect(result.id).toBe(entryId);
  });

  it('does not let the OWNER of another tenant read tenant A entries (404)', async () => {
    const { controller, entryId } = await setup();

    await expect(
      controller.getJournalEntry(
        requestWith({
          tenantId: 'tenant-b',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
        entryId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});