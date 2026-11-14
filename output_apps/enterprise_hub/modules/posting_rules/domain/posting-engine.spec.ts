import { ReportLine } from '../../accounting/enums/accounting.enum';
import { ChartTemplates } from './chart-codes.spec-helper';
import { DEFAULT_ROLE_ACCOUNTS, POSTING_ROLE_KEYS, POSTING_ROLES, PostingRole } from '../constants/posting-roles';
import { buildProposal, netByAccount, reverseProposal, toJournalLines } from './posting-engine';
import { PostingRuleError } from './posting-error';
import { findTemplate, POSTING_TEMPLATES } from './posting-templates';

const payroll = { gross: 10_000n, employerCost: 2_000n, insurance: 3_000n, incomeTax: 500n, otherDeductions: 0n, net: 8_500n };

describe('posting templates', () => {
  it('has unique doc types and only known roles and amount names', () => {
    expect(new Set(POSTING_TEMPLATES.map((t) => t.docType)).size).toBe(POSTING_TEMPLATES.length);
    for (const t of POSTING_TEMPLATES) {
      for (const line of t.lines) {
        expect(POSTING_ROLE_KEYS).toContain(line.role);
        expect(t.amounts).toContain(line.amount);
      }
    }
  });

  it('every global default account exists as a posting-level account in the Iran trading chart with expected nature', () => {
    const accounts = ChartTemplates.postingAccounts();
    for (const [role, code] of Object.entries(DEFAULT_ROLE_ACCOUNTS)) {
      const def = POSTING_ROLES[role as PostingRole];
      expect(def).toBeDefined();
      const account = accounts.get(code!);
      expect(account).toBeDefined();
      expect(def.types as readonly string[]).toContain(account!.accountType);
    }
    for (const role of ['cheques_receivable', 'cheques_in_collection', 'cheques_payable', 'bank', 'receivable', 'payable'] as const) {
      const account = accounts.get(DEFAULT_ROLE_ACCOUNTS[role]!)!;
      expect([ReportLine.FIXED_ASSET, ReportLine.ACCUMULATED_DEPRECIATION, ReportLine.LONG_TERM_LOAN]).not.toContain(account.reportLine);
    }
    expect(DEFAULT_ROLE_ACCOUNTS.cheques_in_collection).not.toBe(DEFAULT_ROLE_ACCOUNTS.cheques_receivable);
    expect(DEFAULT_ROLE_ACCOUNTS.cheques_in_collection).toBe('1023');
    expect(DEFAULT_ROLE_ACCOUNTS.cheques_receivable).toBe('1021');
  });

  it('every role used by a template has a default or is documented as tenant-mapped', () => {
    const used = new Set(POSTING_TEMPLATES.flatMap((t) => t.lines.map((l) => l.role)));
    const noDefault = [...used].filter((r) => !DEFAULT_ROLE_ACCOUNTS[r] && !POSTING_TEMPLATES.some((t) => t.defaults?.[r]));
    // `counter` is chosen per document; the contract roles (T3) have no global account, the tenant maps them before the first post.
    expect([...noDefault].sort()).toEqual(['advance_paid', 'advance_received', 'contract_insurance_expense', 'counter', 'retention_payable', 'retention_receivable']);
  });
});

describe('buildProposal', () => {
  it('builds the monthly payroll voucher with the legacy accounts', () => {
    const p = buildProposal({ docType: 'payroll.run', amounts: payroll });
    expect(p.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['5010', 10_000n, 0n],
      ['5040', 2_000n, 0n],
      ['2030', 0n, 3_000n],
      ['2040', 0n, 500n],
      ['2050', 0n, 8_500n],
    ]);
    expect(p.total).toBe(12_000n);
  });

  it('uses the tenant mapping, then overrides, in that order', () => {
    const p = buildProposal({
      docType: 'bank.receipt',
      amounts: { amount: 500n },
      mapping: { bank: '1099', counter: '1020' },
      overrides: { bank: '1012' },
    });
    expect(p.lines.map((l) => l.accountCode)).toEqual(['1012', '1020']);
  });

  it('refuses an unmapped role with a Persian message', () => {
    expect(() => buildProposal({ docType: 'bank.receipt', amounts: { amount: 5n }, overrides: { bank: '1012' } })).toThrow(/حسابی تعیین نشده/);
  });

  it('refuses an unbalanced voucher', () => {
    try {
      buildProposal({ docType: 'payroll.run', amounts: { ...payroll, net: 8_499n } });
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PostingRuleError);
      expect((e as PostingRuleError).code).toBe('UNBALANCED');
      expect(JSON.stringify((e as PostingRuleError).getResponse())).toContain('تراز نیست');
    }
  });

  it('refuses a missing amount, a negative amount, an empty voucher and an unknown type', () => {
    expect(() => buildProposal({ docType: 'asset.depreciation', amounts: {} })).toThrow(/ارسال نشده/);
    expect(() => buildProposal({ docType: 'asset.depreciation', amounts: { charge: -1n } })).toThrow(/منفی/);
    expect(() => buildProposal({ docType: 'asset.depreciation', amounts: { charge: 0n } })).toThrow(/مبلغی برای ثبت ندارد/);
    expect(() => buildProposal({ docType: 'nope', amounts: {} })).toThrow(/قالب ثبت خودکار ندارد/);
  });

  it('carries the party code only on party lines', () => {
    const p = buildProposal({ docType: 'invoice.sale', amounts: { total: 110n, net: 100n, vat: 10n }, partyCode: 'C-1' });
    expect(p.lines.map((l) => l.partyCode)).toEqual(['C-1', undefined, undefined]);
  });

  it('drops zero lines but keeps the voucher balanced', () => {
    const p = buildProposal({ docType: 'invoice.sale', amounts: { total: 100n, net: 100n, vat: 0n } });
    expect(p.lines).toHaveLength(2);
  });

  it('reversal nets to zero and renders as decimal strings', () => {
    const p = buildProposal({ docType: 'payroll.run', amounts: payroll });
    expect([...netByAccount(p, reverseProposal(p)).values()].every((v) => v === 0n)).toBe(true);
    expect(toJournalLines(p)[0]).toMatchObject({ accountCode: '5010', debit: '100.00', credit: '0.00' });
  });

  it('payslip template keeps its legacy defaults (5010 / 2010 / 1010)', () => {
    const t = findTemplate('payroll.payslip')!.docType;
    const p = buildProposal({ docType: t, amounts: { gross: 100n, deductions: 30n, net: 70n } });
    expect(p.lines.map((l) => l.accountCode)).toEqual(['5010', '2010', '1010']);
  });

  it('builds the matched supplier invoice (GRNI, price variance, VAT, payable) balanced', () => {
    const p = buildProposal({
      docType: 'purchase.invoice',
      amounts: {
        grni: 50_000_000n,
        variance_debit: 1_000_000n,
        variance_credit: 0n,
        vat: 4_590_000n,
        payable: 55_590_000n,
      },
      partyCode: 'SUP-1',
    });
    expect(p.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['2013', 50_000_000n, 0n],
      ['5120', 1_000_000n, 0n],
      ['1045', 4_590_000n, 0n],
      ['2010', 0n, 55_590_000n],
    ]);
    expect(p.lines[3].partyCode).toBe('SUP-1');
    expect(p.total).toBe(55_590_000n);
  });

  it('posts a negative purchase price variance as a credit to the variance account', () => {
    const p = buildProposal({
      docType: 'purchase.invoice',
      amounts: {
        grni: 50_000_000n,
        variance_debit: 0n,
        variance_credit: 1_000_000n,
        vat: 0n,
        payable: 49_000_000n,
      },
    });
    expect(p.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['2013', 50_000_000n, 0n],
      ['5120', 0n, 1_000_000n],
      ['2010', 0n, 49_000_000n],
    ]);
  });
});
