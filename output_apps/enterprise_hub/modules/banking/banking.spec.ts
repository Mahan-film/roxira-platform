import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { CreateJournalEntryDto } from '../accounting/dto/create-journal-entry.dto';
import { LedgerLineView } from '../accounting/services/accounting.service';
import { BankingController } from './controllers/banking.controller';
import { CreateBankAccountDto } from './dto/bank-account.dto';
import { AutoMatchDto } from './dto/reconciliation.dto';
import { BankAccountEntity } from './entities/bank-account.entity';
import { BankStatementLineEntity } from './entities/bank-statement-line.entity';
import { BankCode, MatchMethod, StatementLineStatus } from './enums/banking.enum';
import {
  bankClosingBalance,
  proposeMatches,
  MatchableBookLine,
  MatchableStatementLine,
} from './matching/reconciliation-matcher';
import {
  BankAccountInput,
  StatementLineFilter,
  StatementLineInput,
} from './repositories/banking.repository';
import { BankingService } from './services/banking.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/* ------------------------------------------------------------------ matcher */

const stmt = (
  id: number,
  txnDate: string,
  amount: number,
  reference: string | null = null,
): MatchableStatementLine => ({
  id,
  txnDate,
  withdrawal: amount < 0 ? -amount : 0,
  deposit: amount > 0 ? amount : 0,
  reference,
});

const book = (
  id: number,
  date: string,
  amount: number,
  entryNumber = `JE-${id}`,
  description: string | null = null,
): MatchableBookLine => ({
  id,
  date: new Date(`${date}T10:00:00Z`),
  debit: amount > 0 ? amount : 0,
  credit: amount < 0 ? -amount : 0,
  entryNumber,
  description,
});

describe('proposeMatches', () => {
  it('matches a deposit to a book debit of the same amount within the window', () => {
    const result = proposeMatches(
      [stmt(1, '2024-10-06', 500_000)],
      [book(10, '2024-10-04', 500_000)],
    );
    expect(result.matches).toEqual([
      { statementLineId: 1, journalLineId: 10, byReference: false },
    ]);
  });

  it('respects direction: a withdrawal never matches a book debit', () => {
    const result = proposeMatches(
      [stmt(1, '2024-10-06', -500_000)],
      [book(10, '2024-10-06', 500_000)],
    );
    expect(result.matches).toEqual([]);
  });

  it('ignores candidates outside the date window and amount tolerance', () => {
    const result = proposeMatches(
      [stmt(1, '2024-10-06', 500_000)],
      [book(10, '2024-10-01', 500_000), book(11, '2024-10-06', 500_002)],
      3,
    );
    expect(result.matches).toEqual([]);
  });

  it('prefers the candidate carrying the reference number over a closer date', () => {
    const result = proposeMatches(
      [stmt(1, '2024-10-06', -120_000, '۸۸۷۷۶۶')],
      [
        book(10, '2024-10-06', -120_000),
        book(11, '2024-10-08', -120_000, 'JE-11', 'چک شماره 887766'),
      ],
    );
    expect(result.matches).toEqual([
      { statementLineId: 1, journalLineId: 11, byReference: true },
    ]);
  });

  it('leaves ties for a person instead of guessing', () => {
    const result = proposeMatches(
      [stmt(1, '2024-10-06', 100)],
      [book(10, '2024-10-05', 100), book(11, '2024-10-07', 100)],
    );
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toEqual([1]);
  });

  it('never uses a book line twice', () => {
    const result = proposeMatches(
      [stmt(1, '2024-10-06', 100), stmt(2, '2024-10-09', 100)],
      [book(10, '2024-10-06', 100), book(11, '2024-10-09', 100)],
    );
    expect(result.matches.map((m) => [m.statementLineId, m.journalLineId])).toEqual([
      [1, 10],
      [2, 11],
    ]);
  });
});

describe('bankClosingBalance', () => {
  const lines = [
    { id: 1, txnDate: '2024-10-06', withdrawal: 0, deposit: 100, balance: 1100 },
    { id: 2, txnDate: '2024-10-06', withdrawal: 50, deposit: 0, balance: 1050 },
    { id: 3, txnDate: '2024-10-07', withdrawal: 0, deposit: 25, balance: 1075 },
  ];

  it('takes the last reported balance of an oldest-first export', () => {
    expect(bankClosingBalance(lines)).toBe(1075);
  });

  it('handles a newest-first export (reverse import order within a day)', () => {
    const newestFirst = [
      { id: 1, txnDate: '2024-10-07', withdrawal: 0, deposit: 25, balance: 1075 },
      { id: 2, txnDate: '2024-10-06', withdrawal: 50, deposit: 0, balance: 1050 },
      { id: 3, txnDate: '2024-10-06', withdrawal: 0, deposit: 100, balance: 1100 },
    ];
    expect(bankClosingBalance(newestFirst)).toBe(1075);
  });

  it('falls back to opening balance + net without a balance column', () => {
    const noBalance = lines.map((line) => ({ ...line, balance: null }));
    expect(bankClosingBalance(noBalance, 1000)).toBe(1075);
  });
});

/* -------------------------------------------------------- in-memory doubles */

class InMemoryBankingRepository {
  accounts: BankAccountEntity[] = [];
  lines: BankStatementLineEntity[] = [];
  private seq = 0;

  async listAccounts(tenantId: string) {
    return this.accounts.filter((a) => a.tenantId === tenantId);
  }
  async findAccount(tenantId: string, id: number) {
    return this.accounts.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
  }
  async findAccountByNumber(tenantId: string, accountNumber: string) {
    return (
      this.accounts.find((a) => a.tenantId === tenantId && a.accountNumber === accountNumber) ??
      null
    );
  }
  async createAccount(tenantId: string, input: BankAccountInput) {
    const account = { ...input, tenantId, id: ++this.seq, createdAt: new Date() } as BankAccountEntity;
    this.accounts.push(account);
    return account;
  }
  async insertStatementLines(tenantId: string, bankAccountId: number, inputs: StatementLineInput[]) {
    return inputs.map((input) => {
      const line = {
        ...input,
        id: ++this.seq,
        tenantId,
        bankAccountId,
        matchedJournalLineId: null,
        matchMethod: null,
        matchedAt: null,
        createdJournalEntryId: null,
        createdAt: new Date(),
      } as BankStatementLineEntity;
      this.lines.push(line);
      return line.id;
    });
  }
  async findExistingDedupeKeys(tenantId: string, keys: string[]) {
    return this.lines.filter((l) => l.tenantId === tenantId && keys.includes(l.dedupeKey)).map((l) => l.dedupeKey);
  }
  async findLines(tenantId: string, bankAccountId: number, filter: StatementLineFilter = {}) {
    return this.lines.filter(
      (l) =>
        l.tenantId === tenantId &&
        l.bankAccountId === bankAccountId &&
        (filter.status !== StatementLineStatus.MATCHED || l.matchedJournalLineId !== null) &&
        (filter.status !== StatementLineStatus.UNMATCHED || l.matchedJournalLineId === null) &&
        (!filter.fromDate || l.txnDate >= filter.fromDate) &&
        (!filter.toDate || l.txnDate <= filter.toDate),
    );
  }
  async findLine(tenantId: string, id: number) {
    return this.lines.find((l) => l.tenantId === tenantId && l.id === id) ?? null;
  }
  async findLinesByIds(tenantId: string, ids: number[]) {
    return this.lines.filter((l) => l.tenantId === tenantId && ids.includes(l.id));
  }
  async deleteLines(tenantId: string, ids: number[]) {
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => !(l.tenantId === tenantId && ids.includes(l.id)));
    return before - this.lines.length;
  }
  async findMatchedPairs(tenantId: string) {
    return this.lines
      .filter((l) => l.tenantId === tenantId && l.matchedJournalLineId !== null)
      .map((l) => ({ id: l.id, journalLineId: l.matchedJournalLineId as number }));
  }
  async setMatch(
    tenantId: string,
    lineId: number,
    journalLineId: number,
    method: MatchMethod,
    createdJournalEntryId: number | null = null,
  ) {
    const line = this.lines.find((l) => l.tenantId === tenantId && l.id === lineId);
    if (!line || line.matchedJournalLineId !== null) {
      return false;
    }
    if (this.lines.some((l) => l.tenantId === tenantId && l.matchedJournalLineId === journalLineId)) {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    }
    Object.assign(line, { matchedJournalLineId: journalLineId, matchMethod: method, matchedAt: new Date() });
    if (createdJournalEntryId !== null) {
      line.createdJournalEntryId = createdJournalEntryId;
    }
    return true;
  }
  /** Mimics a DB transaction: journal lines written inside are rolled back if `work` throws. */
  accountingForTx: { lines: unknown[] } | null = null;
  async runInTransaction<T>(work: (manager: undefined) => Promise<T>): Promise<T> {
    const snapshot = this.accountingForTx ? [...this.accountingForTx.lines] : null;
    try {
      return await work(undefined);
    } catch (error) {
      if (this.accountingForTx && snapshot) this.accountingForTx.lines = snapshot;
      throw error;
    }
  }
  async clearMatch(tenantId: string, lineId: number) {
    const line = this.lines.find((l) => l.tenantId === tenantId && l.id === lineId);
    if (!line) return false;
    Object.assign(line, { matchedJournalLineId: null, matchMethod: null, matchedAt: null });
    return true;
  }
}

interface FakeLedgerLine extends LedgerLineView {
  tenantId: string;
  accountId: number;
}

/** Tenant-scoped stand-in for AccountingService (ledger accounts + lines). */
class FakeAccountingService {
  accounts = [
    { id: 1, tenantId: TENANT_A, code: '1010', name: 'بانک', accountType: 'ASSET', currency: 'IRR', balance: 0 },
    { id: 2, tenantId: TENANT_A, code: '5030', name: 'کارمزد بانکی', accountType: 'EXPENSE', currency: 'IRR', balance: 0 },
    { id: 3, tenantId: TENANT_B, code: '1010', name: 'بانک', accountType: 'ASSET', currency: 'IRR', balance: 0 },
  ];
  lines: FakeLedgerLine[] = [];
  private seq = 1000;
  private entrySeq = 500;

  addLine(tenantId: string, accountId: number, date: string, amount: number, entryNumber?: string) {
    const id = ++this.seq;
    this.lines.push({
      id,
      tenantId,
      accountId,
      journalEntryId: ++this.entrySeq,
      entryNumber: entryNumber ?? `JE-${id}`,
      date: new Date(`${date}T08:00:00Z`),
      description: null,
      entryDescription: 'سند',
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
    });
    return id;
  }
  async listAccounts(tenantId: string) {
    return this.accounts.filter((a) => a.tenantId === tenantId);
  }
  async findAccountById(tenantId: string, id: number) {
    return this.accounts.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
  }
  async listLedgerLines(
    tenantId: string,
    accountId: number,
    options: { fromDate?: Date; toDate?: Date; lineIds?: number[] } = {},
  ) {
    return this.lines.filter(
      (l) =>
        l.tenantId === tenantId &&
        l.accountId === accountId &&
        (!options.lineIds || options.lineIds.includes(l.id)) &&
        (!options.fromDate || l.date >= options.fromDate) &&
        (!options.toDate || l.date <= options.toDate),
    );
  }
  async createJournalEntry(tenantId: string, dto: CreateJournalEntryDto) {
    const journalEntryId = ++this.entrySeq;
    const created = dto.lines.map((line) => {
      const account = this.accounts.find((a) => a.tenantId === tenantId && a.code === line.accountCode);
      if (!account) throw new BadRequestException(`کد(های) حساب یافت نشد: ${line.accountCode}`);
      const id = ++this.seq;
      this.lines.push({
        id,
        tenantId,
        accountId: account.id,
        journalEntryId,
        entryNumber: dto.entryNumber,
        date: new Date(`${dto.date}T00:00:00Z`),
        description: line.description ?? null,
        entryDescription: dto.description,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
      });
      return { id, accountId: account.id };
    });
    return { id: journalEntryId, lines: created };
  }
  async removeImportedJournalEntries(tenantId: string, ids: number[]) {
    this.lines = this.lines.filter((l) => !(l.tenantId === tenantId && ids.includes(l.journalEntryId)));
    return { removed: ids.length, refused: [] };
  }
}

function setup() {
  const repo = new InMemoryBankingRepository();
  const accounting = new FakeAccountingService();
  repo.accountingForTx = accounting;
  const service = new BankingService(repo as never, accounting as never);
  return { repo, accounting, service };
}

const line = (txnDate: string, amount: number, extra: Partial<StatementLineInput> = {}): StatementLineInput => ({
  txnDate,
  description: null,
  withdrawal: amount < 0 ? -amount : 0,
  deposit: amount > 0 ? amount : 0,
  balance: null,
  reference: null,
  dedupeKey: `k-${txnDate}-${amount}-${Math.random()}`,
  ...extra,
});

async function seedAccount(service: BankingService, tenantId = TENANT_A, ledgerAccountId = 1) {
  return service.createAccount(tenantId, {
    name: 'جاری ملت',
    bankCode: BankCode.MELLAT,
    accountNumber: '۱۲۳۴۵۶۷۸',
    ledgerAccountId,
  } as CreateBankAccountDto);
}

/* ---------------------------------------------------------------- service */

describe('BankingService', () => {
  it('creates a bank account linked to a ledger account of the same tenant', async () => {
    const { service } = setup();
    const account = await seedAccount(service);
    expect(account).toEqual(
      expect.objectContaining({ accountNumber: '12345678', ledgerAccountCode: '1010', currency: 'IRR' }),
    );
    await expect(seedAccount(service)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a ledger account that belongs to another tenant', async () => {
    const { service } = setup();
    await expect(seedAccount(service, TENANT_A, 3)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('imports into the only account when none is chosen, and asks when there are several', async () => {
    const { service, repo } = setup();
    await expect(service.importStatementLines(TENANT_A, undefined, [line('2024-10-06', 1)])).rejects.toThrow(
      'ابتدا یک حساب بانکی',
    );
    const account = await seedAccount(service);
    await service.importStatementLines(TENANT_A, undefined, [line('2024-10-06', 1)]);
    expect(repo.lines[0].bankAccountId).toBe(account.id);
    await service.createAccount(TENANT_A, { name: 'دوم', accountNumber: '999', ledgerAccountId: 1 } as CreateBankAccountDto);
    await expect(service.importStatementLines(TENANT_A, undefined, [line('2024-10-06', 1)])).rejects.toThrow(
      'انتخاب کنید',
    );
  });

  it('auto-matches, then reconciles to a zero difference after creating an entry for the fee', async () => {
    const { service, accounting } = setup();
    const account = await seedAccount(service);
    const receipt = accounting.addLine(TENANT_A, 1, '2024-10-05', 5_000_000, 'INV-PAID-77');
    accounting.addLine(TENANT_A, 1, '2024-10-07', -1_200_000); // cheque not yet cleared
    await service.importStatementLines(TENANT_A, account.id, [
      line('2024-10-06', 5_000_000, { balance: 5_000_000 }),
      line('2024-10-06', -25_000, { balance: 4_975_000, description: 'کارمزد' }),
    ]);

    const auto = await service.autoMatch(TENANT_A, account.id, {} as AutoMatchDto);
    expect(auto).toEqual({ matched: 1, ambiguous: 0, stillUnmatched: 1 });
    const matched = await service.listStatementLines(TENANT_A, account.id, { status: StatementLineStatus.MATCHED });
    expect(matched[0].matchedJournalLineId).toBe(receipt);

    let summary = await service.summary(TENANT_A, account.id, '2024-10-31');
    expect(summary).toEqual(
      expect.objectContaining({
        bookBalance: 3_800_000,
        bankBalance: 4_975_000,
        unmatchedBankWithdrawals: 25_000,
        unmatchedBookCredits: 1_200_000,
        difference: 0,
      }),
    );

    const fee = (await service.listStatementLines(TENANT_A, account.id, { status: StatementLineStatus.UNMATCHED }))[0];
    const created = await service.createEntryFromLine(TENANT_A, fee.id, { counterAccountCode: '5030' });
    expect(created.matchMethod).toBe(MatchMethod.CREATED);
    expect(created.createdJournalEntryId).not.toBeNull();

    summary = await service.summary(TENANT_A, account.id, '2024-10-31');
    expect(summary.bookBalance).toBe(3_775_000);
    expect(summary.unmatchedStatementCount).toBe(0);
    expect(summary.difference).toBe(0);
  });

  it('createEntryFromLine rolls the journal entry back when the match fails', async () => {
    const { service, accounting, repo } = setup();
    const account = await seedAccount(service);
    await service.importStatementLines(TENANT_A, account.id, [line('2024-10-20', -25_000)]);
    const fee = (await service.listStatementLines(TENANT_A, account.id, {}))[0];
    const before = accounting.lines.length;
    jest.spyOn(repo, 'setMatch').mockResolvedValueOnce(false);
    await expect(
      service.createEntryFromLine(TENANT_A, fee.id, { counterAccountCode: '5030' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(accounting.lines.length).toBe(before);
  });

  it('unmatch refuses a line matched via a created journal entry (409)', async () => {
    const { service } = setup();
    const account = await seedAccount(service);
    await service.importStatementLines(TENANT_A, account.id, [line('2024-10-20', -25_000)]);
    const fee = (await service.listStatementLines(TENANT_A, account.id, {}))[0];
    await service.createEntryFromLine(TENANT_A, fee.id, { counterAccountCode: '5030' });
    await expect(service.unmatch(TENANT_A, fee.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('manual match checks amount/direction and one-to-one use of a book line', async () => {
    const { service, accounting } = setup();
    const account = await seedAccount(service);
    const bookId = accounting.addLine(TENANT_A, 1, '2024-10-01', 300);
    const [first, second] = await service.importStatementLines(TENANT_A, account.id, [
      line('2024-10-20', 300),
      line('2024-10-20', 300),
    ]);
    const otherBook = accounting.addLine(TENANT_A, 1, '2024-10-01', 999);
    await expect(service.manualMatch(TENANT_A, first, otherBook)).rejects.toBeInstanceOf(BadRequestException);

    const result = await service.manualMatch(TENANT_A, first, bookId);
    expect(result.matchMethod).toBe(MatchMethod.MANUAL);
    await expect(service.manualMatch(TENANT_A, second, bookId)).rejects.toBeInstanceOf(ConflictException);

    const undone = await service.unmatch(TENANT_A, first);
    expect(undone.matchedJournalLineId).toBeNull();
    await expect(service.manualMatch(TENANT_A, second, bookId)).resolves.toEqual(
      expect.objectContaining({ matchedJournalLineId: bookId }),
    );
  });

  it('undo of an import keeps matched lines', async () => {
    const { service, accounting } = setup();
    const account = await seedAccount(service);
    const bookId = accounting.addLine(TENANT_A, 1, '2024-10-06', 10);
    const ids = await service.importStatementLines(TENANT_A, account.id, [line('2024-10-06', 10), line('2024-10-07', 20)]);
    await service.manualMatch(TENANT_A, ids[0], bookId);
    await expect(service.removeImportedLines(TENANT_A, ids)).resolves.toEqual({ removed: 1, refused: [ids[0]] });
  });
});

describe('BankingService tenant isolation', () => {
  it("tenant B can neither see nor touch tenant A's account, lines or ledger lines", async () => {
    const { service, accounting } = setup();
    const account = await seedAccount(service);
    const bookId = accounting.addLine(TENANT_A, 1, '2024-10-06', 10);
    const [lineId] = await service.importStatementLines(TENANT_A, account.id, [line('2024-10-06', 10)]);

    expect(await service.listAccounts(TENANT_B)).toEqual([]);
    await expect(service.listStatementLines(TENANT_B, account.id, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listBookLines(TENANT_B, account.id, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.autoMatch(TENANT_B, account.id, {} as AutoMatchDto)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.summary(TENANT_B, account.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.manualMatch(TENANT_B, lineId, bookId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.unmatch(TENANT_B, lineId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createEntryFromLine(TENANT_B, lineId, { counterAccountCode: '5030' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.importStatementLines(TENANT_B, account.id, [line('2024-10-06', 1)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.removeImportedLines(TENANT_B, [lineId])).resolves.toEqual({ removed: 0, refused: [] });
    expect(await service.findExistingDedupeKeys(TENANT_B, ['anything'])).toEqual([]);
  });

  it("tenant A cannot match its statement line to tenant B's ledger line", async () => {
    const { service, accounting } = setup();
    const accountA = await seedAccount(service);
    const foreignBook = accounting.addLine(TENANT_B, 3, '2024-10-06', 10);
    const [lineId] = await service.importStatementLines(TENANT_A, accountA.id, [line('2024-10-06', 10)]);
    await expect(service.manualMatch(TENANT_A, lineId, foreignBook)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.autoMatch(TENANT_A, accountA.id, {} as AutoMatchDto)).matched).toBe(0);
  });
});

describe('BankingController', () => {
  const requestWith = (user: unknown) => ({ user }) as unknown as AuthenticatedRequest;

  it('takes the tenant from the JWT and requires tenant admin', async () => {
    const service = { listAccounts: jest.fn(async () => []) };
    const controller = new BankingController(service as never);
    await controller.listAccounts(requestWith({ tenantId: TENANT_A, tenantRole: TenantRole.OWNER }));
    expect(service.listAccounts).toHaveBeenCalledWith(TENANT_A);
    await expect(
      controller.listAccounts(requestWith({ tenantId: TENANT_A, tenantRole: TenantRole.MEMBER })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DTO validation', () => {
  it('rejects a bad IBAN and a missing ledger account', async () => {
    const dto = plainToInstance(CreateBankAccountDto, {
      name: 'x',
      accountNumber: '123',
      iban: 'IR12',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual(['iban', 'ledgerAccountId']);
  });

  it('caps the auto-match window', async () => {
    const errors = await validate(plainToInstance(AutoMatchDto, { windowDays: 90 }));
    expect(errors.map((error) => error.property)).toEqual(['windowDays']);
  });
});
