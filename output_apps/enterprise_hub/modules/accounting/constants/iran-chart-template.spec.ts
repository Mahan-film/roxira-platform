import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';
import { AccountBalance, balanceSheet, classify, ReportAccount } from '../reports/statements';
import { CHART_TEMPLATES, ChartTemplateAccount } from './iran-chart-template';

const trading = CHART_TEMPLATES.find((t) => t.key === 'iran-trading')!.accounts;
const byCode = (code: string): ChartTemplateAccount => {
  const account = trading.find((a) => a.code === code);
  if (!account) throw new Error(`no account ${code}`);
  return account;
};

describe('iran chart template (#267)', () => {
  it('has the cheque accounts on notes, not on land, depreciation or long-term loans', () => {
    expect(byCode('1021')).toMatchObject({ accountType: AccountType.ASSET, reportLine: ReportLine.RECEIVABLE });
    expect(byCode('1023')).toMatchObject({ accountType: AccountType.ASSET, reportLine: ReportLine.RECEIVABLE, parentCode: '10' });
    expect(byCode('2011')).toMatchObject({ accountType: AccountType.LIABILITY, reportLine: ReportLine.PAYABLE });
    expect(byCode('1110').reportLine).toBe(ReportLine.FIXED_ASSET);
    expect(byCode('1120').reportLine).toBe(ReportLine.ACCUMULATED_DEPRECIATION);
    expect(byCode('2110').reportLine).toBe(ReportLine.LONG_TERM_LOAN);
  });

  it('maps every moein to a standard kol, except the ones the standard leaves unclear', () => {
    const unclear = trading
      .filter((a) => a.level === AccountLevel.MOEIN && a.standardKolCode === null)
      .map((a) => a.code);
    expect(unclear).toEqual(['4120', '5220']);
    for (const a of trading.filter((x) => x.standardKolCode !== null)) {
      expect(a.standardKolCode).toMatch(/^[1-9]\d$/);
    }
    expect(byCode('101101').standardKolCode).toBe(byCode('1011').standardKolCode);
    expect(trading.filter((a) => a.level !== AccountLevel.MOEIN && a.level !== AccountLevel.TAFSILI).every((a) => a.standardKolCode === null)).toBe(true);
  });

  it('adds the missing equity moeins and the memorandum pair', () => {
    expect(['3060', '3070', '3080', '3090'].map((c) => [byCode(c).accountType, byCode(c).standardKolCode])).toEqual([
      [AccountType.EQUITY, '52'],
      [AccountType.EQUITY, '53'],
      [AccountType.EQUITY, '56'],
      [AccountType.EQUITY, '57'],
    ]);
    expect(byCode('9110')).toMatchObject({ parentCode: '91', reportLine: ReportLine.MEMORANDUM, standardKolCode: '91' });
    expect(byCode('9210')).toMatchObject({ parentCode: '92', reportLine: ReportLine.MEMORANDUM, standardKolCode: '92' });
    expect(byCode('91').parentCode).toBe('9');
    expect(byCode('9').level).toBe(AccountLevel.GROUP);
  });

  it('flags the contra accounts explicitly', () => {
    expect(trading.filter((a) => a.contra).map((a) => a.code)).toEqual(['1025', '1120', '4030']);
  });

  it('keeps codes unique and every parent present in both templates', () => {
    for (const template of CHART_TEMPLATES) {
      const codes = template.accounts.map((a) => a.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const a of template.accounts) {
        if (a.parentCode) expect(codes).toContain(a.parentCode);
      }
    }
  });

  it('keeps memorandum accounts off the balance sheet', () => {
    const row = (code: string, net: bigint): AccountBalance => {
      const t = byCode(code);
      const account: ReportAccount = { id: Number(code), code, name: t.name, accountType: t.accountType, level: t.level, parentCode: t.parentCode, reportLine: t.reportLine };
      return {
        account,
        ...classify(account),
        opening: 0n,
        priorDebit: 0n,
        priorCredit: 0n,
        periodDebit: net > 0n ? net : 0n,
        periodCredit: net < 0n ? -net : 0n,
        closeDebit: 0n,
        closeCredit: 0n,
      };
    };
    const sheet = balanceSheet([row('1011', 100n), row('3010', -100n), row('9110', 5000n), row('9210', -5000n)]);
    expect(sheet.totalAssets).toBe(100n);
    expect(sheet.totalLiabilitiesAndEquity).toBe(100n);
    expect(sheet.checks.every((c) => c.ok)).toBe(true);
  });
});
