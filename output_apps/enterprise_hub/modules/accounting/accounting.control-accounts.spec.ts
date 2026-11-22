import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EntityManager } from 'typeorm';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { TreasuryLedgerPostingAdapter } from '../treasury/posting/treasury-ledger-posting.adapter';
import { TreasuryDocKind } from '../treasury/enums/treasury.enum';
import { CONTROL_REPORT_LINES, CHART_TEMPLATES, isControlReportLine, isControlAccount, LEGACY_CONTROL_ACCOUNTS } from './constants/iran-chart-template';
import { AccountingController } from './controllers/accounting.controller';
import { CreateAccountDto } from './dto/create-account.dto';
import { SetAdjustmentPeriodDto } from './dto/fiscal-year.dto';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { AccountLevel, AccountType, JournalEntryStatus, JournalEntryType, ReportLine } from './enums/accounting.enum';
import { ControlAccountPostingException } from './exceptions/ledger.exceptions';
import { fromDb, minorToDecimal } from './money';
import { AccountingRepository, JournalLineInput } from './repositories/accounting.repository';
import { AccountingService, isAllowedAdjustmentRole } from './services/accounting.service';
import { VoucherToolsService } from './services/voucher-tools.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const currencyStub = {
  convert: (value: number) => value,
  round: (value: number) => value,
} as unknown as CurrencyService;

class InMemoryControlRepo {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  adjustmentPeriodOpen = false;
  private seq = 0;

  seed(rows: Array<{ code: string; name: string; type: AccountType; reportLine?: ReportLine | null; systemPostedOnly: boolean }>) {
    for (const r of rows) {
      this.accounts.push({
        id: ++this.seq,
        tenantId: TENANT_ID,
        code: r.code,
        name: r.name,
        accountType: r.type,
        currency: Currency.IRR,
        balance: '0.00',
        level: AccountLevel.MOEIN,
        parentCode: r.code.slice(0, 2),
        reportLine: r.reportLine ?? null,
        systemPostedOnly: r.systemPostedOnly,
        lines: [],
      });
    }
  }

  async countAccounts(t: string): Promise<number> {
    return this.accounts.filter((a) => a.tenantId === t).length;
  }
  async findAllAccounts(t: string): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter((a) => a.tenantId === t);
  }
  async findAccountByCode(t: string, code: string): Promise<ChartOfAccountEntity | null> {
    return this.accounts.find((a) => a.tenantId === t && a.code === code) ?? null;
  }
  async findAccountsByCodes(t: string, codes: string[]): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter((a) => a.tenantId === t && codes.includes(a.code));
  }
  async createAccount(t: string, data: Partial<ChartOfAccountEntity>): Promise<ChartOfAccountEntity> {
    const acc = { id: ++this.seq, tenantId: t, ...data } as ChartOfAccountEntity;
    this.accounts.push(acc);
    return acc;
  }
  async insertMissingAccounts(t: string, data: Partial<ChartOfAccountEntity>[]): Promise<void> {
    const have = new Set(this.accounts.filter((a) => a.tenantId === t).map((a) => a.code));
    for (const d of data.filter((x) => !have.has(x.code as string))) {
      this.accounts.push({ id: ++this.seq, tenantId: t, balance: '0.00', ...d } as ChartOfAccountEntity);
    }
  }
  async findEntryByNumber(t: string, entryNumber: string): Promise<JournalEntryEntity | null> {
    return this.entries.find((e) => e.tenantId === t && e.entryNumber === entryNumber) ?? null;
  }
  async findEntryById(t: string, id: number): Promise<JournalEntryEntity | null> {
    return this.entries.find((e) => e.tenantId === t && e.id === id) ?? null;
  }
  async lockEntry(t: string, id: number): Promise<JournalEntryEntity | null> {
    return this.findEntryById(t, id);
  }
  async findEntryByIdempotencyKey(): Promise<JournalEntryEntity | null> {
    return null;
  }
  async findReversalOf(): Promise<JournalEntryEntity | null> {
    return null;
  }
  async assertDateOpen(): Promise<void> {
    return;
  }
  async isDateInAdjustmentPeriod(): Promise<boolean> {
    return this.adjustmentPeriodOpen;
  }
  async transaction<T>(_t: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return work({} as EntityManager);
  }
  async persistJournalEntry(
    t: string,
    header: { entryNumber: string; date: Date; description: string; status: JournalEntryStatus; entryType?: JournalEntryType; reversesEntryId?: number | null },
    inputs: JournalLineInput[],
  ): Promise<JournalEntryEntity> {
    const entry = {
      id: ++this.seq,
      tenantId: t,
      entryNumber: header.entryNumber,
      date: header.date,
      description: header.description,
      status: header.status,
      entryType: header.entryType ?? JournalEntryType.NORMAL,
      reversesEntryId: header.reversesEntryId ?? null,
      version: 1,
      lines: [] as JournalEntryLineEntity[],
    } as unknown as JournalEntryEntity;

    for (const i of inputs) {
      const account = this.accounts.find((a) => a.id === i.accountId && a.tenantId === t)!;
      if (header.status === JournalEntryStatus.POSTED) {
        account.balance = minorToDecimal(fromDb(account.balance) + i.debitMinor - i.creditMinor);
      }
      entry.lines.push({
        id: ++this.seq,
        tenantId: t,
        journalEntryId: entry.id,
        accountId: i.accountId,
        account,
        debit: minorToDecimal(i.debitMinor),
        credit: minorToDecimal(i.creditMinor),
        currency: i.currency ?? Currency.IRR,
        isRounding: i.isRounding ?? false,
      } as unknown as JournalEntryLineEntity);
    }
    this.entries.push(entry);
    return entry;
  }
  async replaceEntryContent(
    t: string,
    id: number,
    header: { entryNumber: string; date: Date; description: string },
    inputs: JournalLineInput[],
  ): Promise<void> {
    const entry = this.entries.find((e) => e.tenantId === t && e.id === id)!;
    entry.entryNumber = header.entryNumber;
    entry.date = header.date;
    entry.description = header.description;
    entry.lines = inputs.map((i) => ({
      id: ++this.seq,
      tenantId: t,
      journalEntryId: id,
      accountId: i.accountId,
      account: this.accounts.find((a) => a.id === i.accountId && a.tenantId === t)!,
      debit: minorToDecimal(i.debitMinor),
      credit: minorToDecimal(i.creditMinor),
      currency: i.currency ?? Currency.IRR,
      isRounding: i.isRounding ?? false,
    })) as unknown as JournalEntryLineEntity[];
  }
  async setEntryStatus(t: string, entry: JournalEntryEntity, target: JournalEntryStatus): Promise<void> {
    const found = this.entries.find((e) => e.tenantId === t && e.id === entry.id)!;
    found.status = target;
  }
}

describe('T226 Control accounts are system-posted only', () => {
  let repo: InMemoryControlRepo;
  let service: AccountingService;

  beforeEach(() => {
    repo = new InMemoryControlRepo();
    repo.seed([
      { code: '1010', name: 'نقد و بانک', type: AccountType.ASSET, reportLine: ReportLine.CASH, systemPostedOnly: false },
      { code: '1020', name: 'حساب‌های دریافتنی تجاری', type: AccountType.ASSET, reportLine: ReportLine.RECEIVABLE, systemPostedOnly: true },
      { code: '2010', name: 'حساب‌های پرداختنی تجاری', type: AccountType.LIABILITY, reportLine: ReportLine.PAYABLE, systemPostedOnly: true },
      { code: '1030', name: 'موجودی کالا', type: AccountType.ASSET, reportLine: ReportLine.INVENTORY, systemPostedOnly: true },
      { code: '1110', name: 'دارایی ثابت مشهود', type: AccountType.ASSET, reportLine: ReportLine.FIXED_ASSET, systemPostedOnly: true },
      { code: '1120', name: 'استهلاک انباشته', type: AccountType.ASSET, reportLine: ReportLine.ACCUMULATED_DEPRECIATION, systemPostedOnly: true },
      { code: '4010', name: 'درآمد فروش', type: AccountType.REVENUE, reportLine: ReportLine.REVENUE, systemPostedOnly: false },
      { code: '5020', name: 'هزینه اجاره', type: AccountType.EXPENSE, reportLine: ReportLine.OPERATING_EXPENSE, systemPostedOnly: false },
    ]);
    service = new AccountingService(repo as unknown as AccountingRepository, currencyStub);
  });

  describe('Chart templates and single source of truth', () => {
    it('flags AR, AP, inventory, and fixed-asset report lines in iran-trading template', () => {
      const trading = CHART_TEMPLATES.find((t) => t.key === 'iran-trading')!;
      for (const acc of trading.accounts) {
        expect(acc.systemPostedOnly).toBe(isControlReportLine(acc.reportLine));
      }
      expect(CONTROL_REPORT_LINES.has(ReportLine.RECEIVABLE)).toBe(true);
      expect(CONTROL_REPORT_LINES.has(ReportLine.PAYABLE)).toBe(true);
      expect(CONTROL_REPORT_LINES.has(ReportLine.INVENTORY)).toBe(true);
      expect(CONTROL_REPORT_LINES.has(ReportLine.FIXED_ASSET)).toBe(true);
      expect(CONTROL_REPORT_LINES.has(ReportLine.ACCUMULATED_DEPRECIATION)).toBe(true);
    });

    it('derives systemPostedOnly on default bootstrap without hardcoded duplicate list', async () => {
      const freshRepo = new InMemoryControlRepo();
      const freshService = new AccountingService(freshRepo as unknown as AccountingRepository, currencyStub);
      const accounts = await freshService.listAccounts(TENANT_ID);
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      expect(byCode.get('1020')?.systemPostedOnly).toBe(true);
      expect(byCode.get('1030')?.systemPostedOnly).toBe(true);
      expect(byCode.get('2010')?.systemPostedOnly).toBe(true);
      expect(byCode.get('1010')?.systemPostedOnly).toBe(false);
    });

    it('auto-derives systemPostedOnly from reportLine when creating a new account', async () => {
      const created = await service.createAccount(TENANT_ID, {
        code: '1119',
        name: 'ماشین‌آلات تولید',
        accountType: AccountType.ASSET,
        reportLine: ReportLine.FIXED_ASSET,
      });
      expect(created.systemPostedOnly).toBe(true);
    });

    it('ignores client systemPostedOnly: false when creating a control account', async () => {
      const created = await service.createAccount(TENANT_ID, {
        code: '1029',
        name: 'مطالبات خاص تجاری',
        accountType: AccountType.ASSET,
        reportLine: ReportLine.RECEIVABLE,
        systemPostedOnly: false,
      });
      expect(created.systemPostedOnly).toBe(true);
    });

    it('ignores client systemPostedOnly: false when importing standard control account code without reportLine', async () => {
      const freshRepo = new InMemoryControlRepo();
      const freshService = new AccountingService(freshRepo as unknown as AccountingRepository, currencyStub);
      await freshService.importAccounts(TENANT_ID, [
        {
          code: '1020',
          name: 'حساب‌های دریافتنی تجاری',
          accountType: AccountType.ASSET,
          systemPostedOnly: false,
        },
      ]);
      const created = await freshRepo.findAccountByCode(TENANT_ID, '1020');
      expect(created?.systemPostedOnly).toBe(true);
    });

    it('ignores client systemPostedOnly: false when importing control accounts', async () => {
      const freshRepo = new InMemoryControlRepo();
      const freshService = new AccountingService(freshRepo as unknown as AccountingRepository, currencyStub);
      await freshService.importAccounts(TENANT_ID, [
        {
          code: '2019',
          name: 'بستانکاران خاص تجاری',
          accountType: AccountType.LIABILITY,
          reportLine: ReportLine.PAYABLE,
          systemPostedOnly: false,
        },
      ]);
      const created = await freshRepo.findAccountByCode(TENANT_ID, '2019');
      expect(created?.systemPostedOnly).toBe(true);
    });

    it('accurately identifies control accounts and does not flag custom/non-control accounts without reportLine', async () => {
      // Legacy unclassified accounts match strictly on BOTH code AND exact default Persian name
      expect(isControlAccount({ code: '1020', reportLine: null, name: 'حساب‌های دریافتنی تجاری' })).toBe(true);
      expect(isControlAccount({ code: '1030', reportLine: null, name: 'موجودی کالا' })).toBe(true);
      expect(isControlAccount({ code: '2010', reportLine: null, name: 'حساب‌های پرداختنی تجاری' })).toBe(true);
      expect(LEGACY_CONTROL_ACCOUNTS['1020']).toBe('حساب‌های دریافتنی تجاری');

      // Custom account with legacy code or other codes without reportLine is NOT control
      expect(isControlAccount({ code: '1020', reportLine: null, name: 'سایر حساب‌های متفرقه' })).toBe(false);
      expect(isControlAccount({ code: '1020', reportLine: null, name: '' })).toBe(false);
      expect(isControlAccount({ code: '1020', reportLine: null })).toBe(false);
      expect(isControlAccount({ code: '1110', reportLine: null, name: 'x' })).toBe(false);
      expect(isControlAccount({ code: '1120', reportLine: null, name: 'custom' })).toBe(false);

      // Account { code: '1115', reportLine: undefined, name: 'x' } may be created with systemPostedOnly: false
      const nonControl = await service.createAccount(TENANT_ID, {
        code: '1115',
        name: 'x',
        accountType: AccountType.ASSET,
        reportLine: undefined,
        systemPostedOnly: false,
      });
      expect(nonControl.systemPostedOnly).toBe(false);
    });
  });

  describe('Manual posting rejection for each control account type', () => {
    const cases: Array<[string, string, string]> = [
      ['AR (1020)', '1020', '4010'],
      ['AP (2010)', '5020', '2010'],
      ['Inventory (1030)', '1030', '1010'],
      ['Fixed Asset (1110)', '1110', '1010'],
      ['Accumulated Depreciation (1120)', '5020', '1120'],
    ];

    it.each(cases)('refuses manual journal touching %s with 422', async (_label, debitCode, creditCode) => {
      await expect(
        service.createJournalEntry(
          TENANT_ID,
          {
            entryNumber: `MAN-${debitCode}-${creditCode}`,
            description: 'ثبت دستی غیرمجاز',
            lines: [
              { accountCode: debitCode, debit: 1000, credit: 0 },
              { accountCode: creditCode, debit: 0, credit: 1000 },
            ],
          },
          undefined,
          { isSystem: false, actorRole: 'accountant' },
        ),
      ).rejects.toThrow(ControlAccountPostingException);
    });

    it('fails closed when options are omitted', async () => {
      await expect(
        service.createJournalEntry(TENANT_ID, {
          entryNumber: 'NO-OPT-1020',
          description: 'بدون گزینه',
          lines: [
            { accountCode: '1020', debit: 500, credit: 0 },
            { accountCode: '4010', debit: 0, credit: 500 },
          ],
        }),
      ).rejects.toThrow(ControlAccountPostingException);
    });

    it('allows manual posting on regular non-control accounts', async () => {
      const entry = await service.createJournalEntry(
        TENANT_ID,
        {
          entryNumber: 'REG-01',
          description: 'پرداخت اجاره',
          lines: [
            { accountCode: '5020', debit: 1000, credit: 0 },
            { accountCode: '1010', debit: 0, credit: 1000 },
          ],
        },
        undefined,
        { isSystem: false, actorRole: 'sales' },
      );
      expect(entry.entryNumber).toBe('REG-01');
    });
  });

  describe('Server-side adjustment period exception and role enforcement', () => {
    it.each(['owner', 'admin', 'accountant', 'partner_advisor', 'OWNER', 'ACCOUNTANT'])(
      'allows authorized role %s when server-side adjustment period is open',
      async (role) => {
        repo.adjustmentPeriodOpen = true;
        const created = await service.createJournalEntry(
          TENANT_ID,
          {
            entryNumber: `ADJ-${role}`,
            description: 'سند تعدیلات پایان سال',
            lines: [
              { accountCode: '1020', debit: 2000, credit: 0 },
              { accountCode: '4010', debit: 0, credit: 2000 },
            ],
          },
          undefined,
          { isSystem: false, actorRole: role },
        );
        expect(created.entryNumber).toBe(`ADJ-${role}`);
      },
    );

    it.each(['sales', 'hr', 'read_only', 'cheque_reviewer', null, undefined])(
      'refuses unauthorized role %s even when adjustment period is open',
      async (role) => {
        repo.adjustmentPeriodOpen = true;
        await expect(
          service.createJournalEntry(
            TENANT_ID,
            {
              entryNumber: `ADJ-DENY-${String(role)}`,
              description: 'سند غیرمجاز',
              lines: [
                { accountCode: '1020', debit: 2000, credit: 0 },
                { accountCode: '4010', debit: 0, credit: 2000 },
              ],
            },
            undefined,
            { isSystem: false, actorRole: role },
          ),
        ).rejects.toThrow(ControlAccountPostingException);
      },
    );

    it('rejects updateVoucher touching control accounts when adjustment period is closed and allows when open', async () => {
      const draft = await service.createJournalEntry(
        TENANT_ID,
        {
          entryNumber: 'DRF-1',
          description: 'پیش‌نویس عادی',
          status: JournalEntryStatus.DRAFT,
          lines: [
            { accountCode: '5020', debit: 1000, credit: 0 },
            { accountCode: '1010', debit: 0, credit: 1000 },
          ],
        },
        undefined,
        { isSystem: false, actorRole: 'accountant' },
      );

      // Closed adjustment period -> rejected
      await expect(
        service.updateVoucher(
          TENANT_ID,
          draft.id,
          {
            entryNumber: 'DRF-1',
            description: 'تلاش تغییر به حساب کنترلی',
            lines: [
              { accountCode: '1030', debit: 1000, credit: 0 },
              { accountCode: '1010', debit: 0, credit: 1000 },
            ],
          },
          { isSystem: false, actorRole: 'accountant' },
        ),
      ).rejects.toThrow(ControlAccountPostingException);

      // Open adjustment period -> allowed for accountant
      repo.adjustmentPeriodOpen = true;
      const updated = await service.updateVoucher(
        TENANT_ID,
        draft.id,
        {
          entryNumber: 'DRF-1',
          description: 'تعدیل موجودی کالا',
          lines: [
            { accountCode: '1030', debit: 1000, credit: 0 },
            { accountCode: '1010', debit: 0, credit: 1000 },
          ],
        },
        { isSystem: false, actorRole: 'accountant' },
      );
      expect(updated.description).toBe('تعدیل موجودی کالا');

      // Closing adjustment period before posting that draft blocks changeVoucherStatus -> POSTED
      repo.adjustmentPeriodOpen = false;
      await expect(
        service.changeVoucherStatus(
          TENANT_ID,
          draft.id,
          JournalEntryStatus.POSTED,
          null,
          'user-1',
          { isSystem: false, actorRole: 'accountant' },
        ),
      ).rejects.toThrow(ControlAccountPostingException);
    });

    it('matches documented adjustment roles exactly', () => {
      expect(isAllowedAdjustmentRole('owner')).toBe(true);
      expect(isAllowedAdjustmentRole('admin')).toBe(true);
      expect(isAllowedAdjustmentRole('accountant')).toBe(true);
      expect(isAllowedAdjustmentRole('partner_advisor')).toBe(true);
      expect(isAllowedAdjustmentRole('sales')).toBe(false);
      expect(isAllowedAdjustmentRole('partner')).toBe(false);
    });
  });

  describe('System postings and controller/caller wiring', () => {
    it('allows system postings (isSystem: true) on all control accounts regardless of adjustment period', async () => {
      const entry = await service.createJournalEntry(
        TENANT_ID,
        {
          entryNumber: 'SYS-ALL-1',
          description: 'سند سیستمی زیرسیستم‌ها',
          lines: [
            { accountCode: '1020', debit: 1000, credit: 0 },
            { accountCode: '1030', debit: 500, credit: 0 },
            { accountCode: '1110', debit: 500, credit: 0 },
            { accountCode: '2010', debit: 0, credit: 1500 },
            { accountCode: '1120', debit: 0, credit: 500 },
          ],
        },
        undefined,
        { isSystem: true },
      );
      expect(entry.entryNumber).toBe('SYS-ALL-1');
    });

    it('TreasuryLedgerPostingAdapter passes isSystem: true when posting to AR/AP', async () => {
      const createSpy = jest.spyOn(service, 'createJournalEntry');
      const adapter = new TreasuryLedgerPostingAdapter(service);
      await adapter.postDocument(
        TENANT_ID,
        { docNumber: 'RC-0001', date: '2026-05-10', description: 'دریافت مشتری' },
        {
          kind: TreasuryDocKind.RECEIPT,
          partyCode: 'C1',
          funds: [{ accountCode: '1010', amount: 10000n }],
          chequeTotal: 0n,
          applied: 10000n,
          writeoff: 0n,
          advance: 0n,
        },
        {} as EntityManager,
      );
      expect(createSpy).toHaveBeenCalledWith(
        TENANT_ID,
        expect.any(Object),
        expect.any(Object),
        { isSystem: true },
      );
    });

    it('AccountingController reads role exclusively from verified request.access.roleKey (never global request.user.role)', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: 1 });
      const controller = new AccountingController(
        { createJournalEntry: createMock } as unknown as AccountingService,
        {} as unknown as VoucherToolsService,
      );

      // Global role ADMIN without request.access -> actorRole must be null (fail closed)
      await controller.createJournalEntry(
        {
          headers: {},
          user: { sub: 'u1', tenantId: TENANT_ID, role: 'ADMIN', tenantRole: 'OWNER' },
        } as never,
        { description: 'test', lines: [] } as never,
      );
      expect(createMock).toHaveBeenLastCalledWith(
        TENANT_ID,
        expect.any(Object),
        undefined,
        { actorRole: null, actorUserId: 'u1' },
      );

      // Verified request.access.roleKey -> forwarded verbatim
      await controller.createJournalEntry(
        {
          headers: {},
          user: { sub: 'u2', tenantId: TENANT_ID, tenantRole: 'MEMBER' },
          access: { roleKey: 'accountant', userId: 'u2', tenantId: TENANT_ID },
        } as never,
        { description: 'test', lines: [] } as never,
      );
      expect(createMock).toHaveBeenLastCalledWith(
        TENANT_ID,
        expect.any(Object),
        undefined,
        { actorRole: 'accountant', actorUserId: 'u2' },
      );
    });

    it('DTO boolean transform rejects coerced non-boolean strings and preserves "false" as false (Lesson 26)', async () => {
      const falseDto = plainToInstance(SetAdjustmentPeriodDto, { open: 'false' }, { enableImplicitConversion: true });
      expect(falseDto.open).toBe(false);
      expect(await validate(falseDto)).toHaveLength(0);

      const badDto = plainToInstance(SetAdjustmentPeriodDto, { open: 'yes' }, { enableImplicitConversion: true });
      expect((await validate(badDto)).length).toBeGreaterThan(0);

      const accFalse = plainToInstance(CreateAccountDto, {
        code: '1099',
        name: 'حساب تست',
        accountType: AccountType.ASSET,
        systemPostedOnly: 'false',
      }, { enableImplicitConversion: true });
      expect(accFalse.systemPostedOnly).toBe(false);
      expect(await validate(accFalse)).toHaveLength(0);
    });
  });
});
