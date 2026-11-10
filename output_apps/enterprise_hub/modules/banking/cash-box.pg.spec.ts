import 'reflect-metadata';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { ChartTemplateService } from '../accounting/services/chart-template.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { CashBoxService } from './services/cash-box.service';
import { BankAccountEntity } from './entities/bank-account.entity';
import { BankCode } from './enums/banking.enum';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { AccountLevel, AccountType } from '../accounting/enums/accounting.enum';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { NotFoundException } from '@nestjs/common';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describePg('Cash boxes and POS settlements on PostgreSQL (T54)', () => {
  let testDb: TestDatabaseContext;
  let cashBoxService: CashBoxService;
  let acctRepo: AccountingRepository;
  let bankAccountA: BankAccountEntity;
  let cashBoxA: { id: number };

  beforeAll(async () => {
    testDb = await createTestDatabase('cashbox_pg');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    acctRepo = new AccountingRepository(testDb.scope);
    const accounting = new AccountingService(acctRepo, currency);
    const postingRepo = new PostingRulesRepository(testDb.scope);
    const postingRules = new PostingRulesService(postingRepo, accounting);
    cashBoxService = new CashBoxService(testDb.scope, postingRules);

    // Apply template to Tenant A and B
    await new ChartTemplateService(acctRepo).apply(TENANT_A, 'iran-trading');
    await new ChartTemplateService(acctRepo).apply(TENANT_B, 'iran-trading');

    // Create 1015 POS clearing account for Tenant A
    await testDb.scope.within(TENANT_A, undefined, async (m) => {
      const pos = m.create(ChartOfAccountEntity, {
        tenantId: TENANT_A,
        code: '1015',
        name: 'حساب واسط پوز',
        accountType: AccountType.ASSET,
        level: AccountLevel.MOEIN,
        parentCode: '10',
        currency: 'IRR',
        balance: '0',
      });
      await m.save(ChartOfAccountEntity, pos);
    });

    // Fetch account IDs for 1012 and 1011
    const [bankAcctRow, cashAcctRow] = await Promise.all([
      acctRepo.findAccountByCode(TENANT_A, '1012'),
      acctRepo.findAccountByCode(TENANT_A, '1011'),
    ]);

    // Create Bank Account for Tenant A using testDb.scope
    bankAccountA = await testDb.scope.within(TENANT_A, undefined, async (m) => {
      const bank = m.create(BankAccountEntity, {
        tenantId: TENANT_A,
        name: 'بانک ملت شعبه مرکزی',
        bankCode: BankCode.MELLAT,
        accountNumber: '1234567890',
        ledgerAccountId: bankAcctRow!.id,
        currency: 'IRR',
        openingBalance: 0,
      });
      return m.save(BankAccountEntity, bank);
    });

    // Create Cash Box for Tenant A
    cashBoxA = await cashBoxService.createCashBox(TENANT_A, {
      name: 'صندوق فروشگاه ۱',
      code: 'BOX-01',
      ledgerAccountId: cashAcctRow!.id,
      currency: 'IRR',
      openingBalance: 10_000_000,
    });
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('lists cash boxes of the tenant with code ordering', async () => {
    const list = await cashBoxService.listCashBoxes(TENANT_A);
    expect(list).toHaveLength(1);
    expect(list[0].code).toBe('BOX-01');
    expect(list[0].name).toBe('صندوق فروشگاه ۱');
  });

  it('transfers cash to bank and creates balanced voucher', async () => {
    const result = await cashBoxService.transferBetweenCashAndBank(TENANT_A, {
      cashBoxId: cashBoxA.id,
      bankAccountId: bankAccountA.id,
      direction: 'TO_BANK',
      amount: '5000000.00',
      date: '2026-05-10',
    });

    expect(result.amount).toBe(5000000);
    expect(result.voucher.replayed).toBe(false);

    // Verify journal entry lines
    const entry = await acctRepo.findEntryById(TENANT_A, result.voucher.entryId);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('POSTED');

    const lines = entry!.lines ?? [];
    const bankLine = lines.find((l) => l.account?.code === '1012');
    const cashLine = lines.find((l) => l.account?.code === '1011');
    expect(Number(bankLine!.debit)).toBe(5000000);
    expect(Number(cashLine!.credit)).toBe(5000000);
  });

  it('records POS settlement and deducts bank fee in voucher', async () => {
    const result = await cashBoxService.settlePos(TENANT_A, {
      bankAccountId: bankAccountA.id,
      terminalNumber: 'TERM-9901',
      date: '2026-05-11',
      grossAmount: '10000000.00',
      feeAmount: '12000.00',
      referenceNumber: 'REF-778899',
    });

    expect(result.settlement.terminalNumber).toBe('TERM-9901');
    expect(Number(result.settlement.grossAmount)).toBe(10000000);
    expect(Number(result.settlement.feeAmount)).toBe(12000);
    expect(Number(result.settlement.netAmount)).toBe(9988000);

    const entry = await acctRepo.findEntryById(TENANT_A, result.voucher.entryId);
    expect(entry).toBeDefined();

    const lines = entry!.lines ?? [];
    const bankLine = lines.find((l) => l.account?.code === '1012');
    const feeLine = lines.find((l) => l.account?.code === '5210');
    const posLine = lines.find((l) => l.account?.code === '1015');

    expect(Number(bankLine!.debit)).toBe(9988000);
    expect(Number(feeLine!.debit)).toBe(12000);
    expect(Number(posLine!.credit)).toBe(10000000);
  });

  it('isolates cash boxes across tenants', async () => {
    const listB = await cashBoxService.listCashBoxes(TENANT_B);
    expect(listB).toHaveLength(0);

    await expect(cashBoxService.getCashBox(TENANT_B, cashBoxA.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});
