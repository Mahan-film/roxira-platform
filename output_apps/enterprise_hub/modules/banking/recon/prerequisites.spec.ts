import { ibanFor, statementCsv, TXNS, OPENING, closingBalance, gregorian } from './__fixtures__/statements';
import {
  evaluatePrerequisites,
  ImportedPeriod,
  KnownBankAccount,
  PrerequisiteInput,
} from './prerequisites';
import { isValidIban, normaliseAccountNumber, normaliseIban } from './iban';
import { parseStatement, readGrid } from './parse/statement-parser';

const account = (over: Partial<KnownBankAccount> = {}): KnownBankAccount => ({
  id: 1,
  name: 'ملت - جاری',
  bankCode: 'mellat',
  accountNumber: '0102345678001',
  iban: null,
  openingBalance: BigInt(OPENING),
  ...over,
});

function inputFor(bank = 'mellat', over: Partial<PrerequisiteInput> = {}, csv?: Buffer): PrerequisiteInput {
  const file = readGrid(csv ?? statementCsv(bank), 'x.csv');
  const outcome = parseStatement(file);
  if (outcome.status !== 'parsed') throw new Error('fixture must parse');
  return {
    header: outcome.header,
    rows: outcome.rows,
    fileSha256: file.sha256,
    accounts: [account()],
    imported: [],
    ...over,
  };
}

const codes = (result: ReturnType<typeof evaluatePrerequisites>, severity: string) =>
  result.checks.filter((c) => c.severity === severity).map((c) => c.code);

describe('IBAN helpers', () => {
  it('validates the mod-97 checksum and normalises spacing and Persian digits', () => {
    const iban = ibanFor('012');
    expect(isValidIban(iban)).toBe(true);
    expect(isValidIban(iban.slice(0, -1) + (iban.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(normaliseIban(`ir ${iban.slice(2, 6)}-${iban.slice(6)}`)).toBe(iban);
    expect(normaliseAccountNumber('۰۱۰۲-۳۴۵.۶۷۸')).toBe('102345678');
  });
});

describe('prerequisite checks', () => {
  it('happy path: account detected by number, period, no overlap, balances consistent', () => {
    const result = evaluatePrerequisites(inputFor());
    expect(result.resolvedAccountId).toBe(1);
    expect(result.canProceed).toBe(true);
    expect(result.period).toEqual({ from: gregorian('1403/07/01'), to: gregorian('1403/07/15') });
    expect(result.opening).toBe(BigInt(OPENING));
    expect(result.closing).toBe(BigInt(closingBalance()));
  });

  it('IBAN takes priority over the account number', () => {
    const result = evaluatePrerequisites(
      inputFor('mellat', { accounts: [account({ accountNumber: '999', iban: ibanFor('012') })] }),
    );
    expect(result.resolvedAccountId).toBe(1);
    expect(result.checks.find((c) => c.code === 'account_match')?.evidence[0]).toMatch(/شبا/);
  });

  it('IBAN and number pointing at different accounts must be asked, not guessed', () => {
    const result = evaluatePrerequisites(
      inputFor('mellat', {
        accounts: [
          account({ id: 1, accountNumber: '0102345678001' }),
          account({ id: 2, name: 'دوم', accountNumber: '555', iban: ibanFor('012') }),
        ],
      }),
    );
    expect(result.canProceed).toBe(false);
    expect(result.resolvedAccountId).toBeNull();
    expect(result.checks.find((c) => c.code === 'account_match')?.choices.map((c) => c.id)).toEqual([
      'account:2',
      'account:1',
    ]);
  });

  it('unknown account offers a guided create step', () => {
    const result = evaluatePrerequisites(inputFor('mellat', { accounts: [account({ accountNumber: '777' })] }));
    expect(result.canProceed).toBe(false);
    expect(result.offerCreateAccount).toBe(true);
    const ask = result.checks.find((c) => c.code === 'account_match')!;
    expect(ask.choices[0].id).toBe('create');
    // Evidence is masked: only the tail of the account number/IBAN is shown.
    expect(ask.evidence.join(' ')).not.toContain('0102345678001');
  });

  it('a statement without any account identifier asks which account it belongs to', () => {
    const csv = Buffer.from(
      ['تاریخ,زمان,شرح,شماره پیگیری,بدهکار,بستانکار,مانده', '1403/07/01,09:00,واریز,12345,0,"1,000","1,000"'].join('\n'),
    );
    const result = evaluatePrerequisites(inputFor('mellat', {}, csv));
    expect(result.checks.find((c) => c.code === 'account_match')?.severity).toBe('ask');
    expect(result.offerCreateAccount).toBe(false);
  });

  it('a confirmed account choice unblocks the check', () => {
    const result = evaluatePrerequisites(
      inputFor('mellat', { accounts: [account({ accountNumber: '777' })], confirmations: { account_match: 'account:1' } }),
    );
    expect(result.resolvedAccountId).toBe(1);
    expect(result.canProceed).toBe(true);
  });

  it('a bank that differs from the account asks for confirmation', () => {
    const base = inputFor('mellat', { accounts: [account({ bankCode: 'melli' })] });
    const result = evaluatePrerequisites(base);
    expect(codes(result, 'ask')).toContain('bank_match');
    const confirmed = evaluatePrerequisites({ ...base, confirmations: { bank_match: 'confirm' } });
    expect(confirmed.canProceed).toBe(true);
  });

  it('an invalid IBAN checksum blocks', () => {
    const base = inputFor();
    const bad = ibanFor('012').slice(0, -1) + (ibanFor('012').endsWith('1') ? '2' : '1');
    const result = evaluatePrerequisites({ ...base, header: { ...base.header, iban: bad } });
    expect(codes(result, 'block')).toContain('iban_checksum');
    expect(result.canProceed).toBe(false);
  });

  it('rows outside the period in the header block', () => {
    const base = inputFor();
    const result = evaluatePrerequisites({ ...base, header: { ...base.header, periodTo: gregorian('1403/07/10') } });
    expect(codes(result, 'block')).toContain('period');
  });

  it('the same file twice is blocked', () => {
    const base = inputFor();
    const earlier: ImportedPeriod = {
      sessionId: 9,
      fileSha256: base.fileSha256,
      from: gregorian('1403/07/01'),
      to: gregorian('1403/07/15'),
      openingBalance: BigInt(OPENING),
      closingBalance: BigInt(closingBalance()),
    };
    const result = evaluatePrerequisites({ ...base, imported: [earlier] });
    expect(codes(result, 'block')).toContain('duplicate_file');
  });

  it('an overlapping period asks, and "only new rows" lets it proceed', () => {
    const base = inputFor();
    const earlier: ImportedPeriod = {
      sessionId: 9,
      fileSha256: 'other',
      from: gregorian('1403/06/20'),
      to: gregorian('1403/07/05'),
      openingBalance: 1n,
      closingBalance: 2n,
    };
    expect(codes(evaluatePrerequisites({ ...base, imported: [earlier] }), 'ask')).toContain('period_overlap');
    const ok = evaluatePrerequisites({
      ...base,
      imported: [earlier],
      confirmations: { period_overlap: 'skip_existing' },
    });
    expect(ok.checks.find((c) => c.code === 'period_overlap')?.severity).toBe('warn');
    expect(ok.canProceed).toBe(true);
  });

  it('opening balance must continue the previous period; a mismatch asks, a gap warns', () => {
    const base = inputFor();
    const previous = (closing: bigint, to: string): ImportedPeriod => ({
      sessionId: 8,
      fileSha256: 'prev',
      from: gregorian('1403/06/01'),
      to,
      openingBalance: 0n,
      closingBalance: closing,
    });
    const mismatch = evaluatePrerequisites({ ...base, imported: [previous(5n, gregorian('1403/06/31'))] });
    expect(codes(mismatch, 'ask')).toContain('opening_continuity');
    const accepted = evaluatePrerequisites({
      ...base,
      imported: [previous(5n, gregorian('1403/06/31'))],
      confirmations: { opening_continuity: 'accept' },
    });
    expect(accepted.canProceed).toBe(true);
    const gap = evaluatePrerequisites({ ...base, imported: [previous(BigInt(OPENING), gregorian('1403/06/20'))] });
    expect(gap.checks.find((c) => c.code === 'opening_continuity')?.severity).toBe('warn');
    expect(gap.canProceed).toBe(true);
  });

  it('the first import is compared with the bank account opening balance', () => {
    const result = evaluatePrerequisites(inputFor('mellat', { accounts: [account({ openingBalance: 7n })] }));
    expect(codes(result, 'ask')).toContain('opening_continuity');
  });

  it('a broken running balance is reported with the first bad row, and needs a decision', () => {
    const csv = statementCsv('mellat', { breakBalanceAt: 3 });
    const result = evaluatePrerequisites(inputFor('mellat', {}, csv));
    const check = result.checks.find((c) => c.code === 'running_balance')!;
    expect(check.severity).toBe('ask');
    expect(check.message).toContain('سطر 4');
    expect(result.canProceed).toBe(false);
    expect(
      evaluatePrerequisites({ ...inputFor('mellat', {}, csv), confirmations: { running_balance: 'continue' } }).canProceed,
    ).toBe(true);
  });

  it('answering "cancel" to any question stops the import', () => {
    const base = inputFor('mellat', { accounts: [account({ bankCode: 'melli' })] });
    expect(evaluatePrerequisites({ ...base, confirmations: { bank_match: 'cancel' } }).canProceed).toBe(false);
  });

  it('TXNS fixture is consistent with the statement closing balance', () => {
    expect(closingBalance()).toBe(OPENING + 50_000_000 - 12_000_000 - 350_000 - 15_000 - 30_000_000 + 20_000_000 - 8_000_000 - 5_000_000 - 40_000_000);
    expect(TXNS).toHaveLength(9);
  });
});
