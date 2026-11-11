import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { ChartTemplateService } from '../accounting/services/chart-template.service';
import { CurrencyService } from '../currency/services/currency.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { BankAccountEntity } from './entities/bank-account.entity';
import { CashBoxEntity } from './entities/cash-box.entity';
import { BankCode } from './enums/banking.enum';
import { CashBoxService } from './services/cash-box.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';

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

    // Apply template to Tenant A and B (template includes 1015 out of the box)
    await new ChartTemplateService(acctRepo).apply(TENANT_A, 'iran-trading');
    await new ChartTemplateService(acctRepo).apply(TENANT_B, 'iran-trading');

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
      openingBalance: '10000000.00',
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

  it('rejects duplicate cash box code with 409 Conflict', async () => {
    const cashAcct = await acctRepo.findAccountByCode(TENANT_A, '1011');
    await expect(
      cashBoxService.createCashBox(TENANT_A, {
        name: 'صندوق شعبه دوم با همان کد',
        code: 'BOX-01',
        ledgerAccountId: cashAcct!.id,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('transfers cash to bank (TO_BANK) and creates balanced voucher', async () => {
    const result = await cashBoxService.transferBetweenCashAndBank(TENANT_A, {
      cashBoxId: cashBoxA.id,
      bankAccountId: bankAccountA.id,
      direction: 'TO_BANK',
      amount: '5000000.00',
      date: '2026-05-10',
      idempotencyKey: 'idem-xfer-001',
    });

    expect(Number(result.amount)).toBe(5000000);
    expect(result.voucher.replayed).toBe(false);

    // Verify journal entry lines: Dr Bank 1012 / Cr Cash 1011
    const entry = await acctRepo.findEntryById(TENANT_A, result.voucher.entryId);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('POSTED');

    const lines = entry!.lines ?? [];
    const bankLine = lines.find((l) => l.account?.code === '1012');
    const cashLine = lines.find((l) => l.account?.code === '1011');
    expect(Number(bankLine!.debit)).toBe(5000000);
    expect(Number(cashLine!.credit)).toBe(5000000);
  });

  it('replaying transfer with same key returns existing voucher (replayed: true)', async () => {
    const replay = await cashBoxService.transferBetweenCashAndBank(TENANT_A, {
      cashBoxId: cashBoxA.id,
      bankAccountId: bankAccountA.id,
      direction: 'TO_BANK',
      amount: '5000000.00',
      date: '2026-05-10',
      idempotencyKey: 'idem-xfer-001',
    });

    expect(replay.voucher.replayed).toBe(true);
  });

  it('replaying transfer with same key but different body rejects with 409 Conflict', async () => {
    await expect(
      cashBoxService.transferBetweenCashAndBank(TENANT_A, {
        cashBoxId: cashBoxA.id,
        bankAccountId: bankAccountA.id,
        direction: 'TO_BANK',
        amount: '8000000.00',
        date: '2026-05-10',
        idempotencyKey: 'idem-xfer-001',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('transfers bank to cash (TO_CASH) and creates balanced voucher', async () => {
    const result = await cashBoxService.transferBetweenCashAndBank(TENANT_A, {
      cashBoxId: cashBoxA.id,
      bankAccountId: bankAccountA.id,
      direction: 'TO_CASH',
      amount: '2000000.00',
      date: '2026-05-10',
      idempotencyKey: 'idem-xfer-002',
    });

    expect(result.voucher.replayed).toBe(false);

    // Verify journal entry lines: Dr Cash 1011 / Cr Bank 1012
    const entry = await acctRepo.findEntryById(TENANT_A, result.voucher.entryId);
    const lines = entry!.lines ?? [];
    const cashLine = lines.find((l) => l.account?.code === '1011');
    const bankLine = lines.find((l) => l.account?.code === '1012');
    expect(Number(cashLine!.debit)).toBe(2000000);
    expect(Number(bankLine!.credit)).toBe(2000000);
  });

  it('records POS settlement using standard chart 1015 without manual insert', async () => {
    const result = await cashBoxService.settlePos(TENANT_A, {
      bankAccountId: bankAccountA.id,
      terminalNumber: 'TERM-9901',
      date: '2026-05-11',
      grossAmount: '10000000.00',
      feeAmount: '12000.00',
      referenceNumber: 'REF-778899',
      idempotencyKey: 'idem-pos-001',
    });

    expect(result.settlement.terminalNumber).toBe('TERM-9901');
    expect(Number(result.settlement.grossAmount)).toBe(10000000);
    expect(Number(result.settlement.feeAmount)).toBe(12000);
    expect(Number(result.settlement.netAmount)).toBe(9988000);
    expect(result.voucher.replayed).toBe(false);

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

  it('replaying POS settlement with same key returns existing record (replayed: true)', async () => {
    const replay = await cashBoxService.settlePos(TENANT_A, {
      bankAccountId: bankAccountA.id,
      terminalNumber: 'TERM-9901',
      date: '2026-05-11',
      grossAmount: '10000000.00',
      feeAmount: '12000.00',
      referenceNumber: 'REF-778899',
      idempotencyKey: 'idem-pos-001',
    });

    expect(replay.voucher.replayed).toBe(true);
    expect(replay.settlement.id).toBeDefined();
  });

  it('replaying POS settlement with same key but different gross amount throws 409 Conflict', async () => {
    await expect(
      cashBoxService.settlePos(TENANT_A, {
        bankAccountId: bankAccountA.id,
        terminalNumber: 'TERM-9901',
        date: '2026-05-11',
        grossAmount: '15000000.00',
        feeAmount: '12000.00',
        referenceNumber: 'REF-778899',
        idempotencyKey: 'idem-pos-001',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects POS settlement when fee is greater than gross', async () => {
    await expect(
      cashBoxService.settlePos(TENANT_A, {
        bankAccountId: bankAccountA.id,
        terminalNumber: 'TERM-9902',
        date: '2026-05-11',
        grossAmount: '10000.00',
        feeAmount: '15000.00',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects transfer when box is inactive', async () => {
    const inactiveBox = await testDb.scope.within(TENANT_A, undefined, async (m) => {
      const box = m.create(CashBoxEntity, {
        tenantId: TENANT_A,
        name: 'صندوق غیرفعال',
        code: 'BOX-INACTIVE',
        ledgerAccountId: (await acctRepo.findAccountByCode(TENANT_A, '1011'))!.id,
        currency: 'IRR',
        openingBalance: '0',
        active: false,
      });
      return m.save(CashBoxEntity, box);
    });

    await expect(
      cashBoxService.transferBetweenCashAndBank(TENANT_A, {
        cashBoxId: inactiveBox.id,
        bankAccountId: bankAccountA.id,
        direction: 'TO_BANK',
        amount: '100000.00',
        date: '2026-05-10',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('isolates cash boxes across tenants', async () => {
    const listB = await cashBoxService.listCashBoxes(TENANT_B);
    expect(listB).toHaveLength(0);

    await expect(cashBoxService.getCashBox(TENANT_B, cashBoxA.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});
