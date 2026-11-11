import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CASH_BANK_ACCOUNT,
  COGS_ACCOUNT,
  INVENTORY_ACCOUNT,
  PAYABLE_ACCOUNT,
  POS_CLEARING_ACCOUNT,
  PURCHASES_ACCOUNT,
  RECEIVABLE_ACCOUNT,
  SALES_ACCOUNT,
  VAT_ACCOUNT,
  VAT_RECEIVABLE_ACCOUNT,
} from '../../invoicing/constants/suite-events.constants';
import {
  OPENING_STOCK_EQUITY_ACCOUNT,
  STOCK_ADJUSTMENT_ACCOUNT,
} from '../../inventory/constants/stock-accounts';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../constants/accounting.constants';
import { CHART_TEMPLATES } from '../constants/iran-chart-template';
import { AccountType } from '../enums/accounting.enum';
import { ChartAccountLike, RoleAccountSpec, decideRoleAccount } from './role-account-resolver';

const TYPES: Record<string, AccountType> = {
  دارایی: AccountType.ASSET,
  بدهی: AccountType.LIABILITY,
  سرمایه: AccountType.EQUITY,
  درآمد: AccountType.REVENUE,
  هزینه: AccountType.EXPENSE,
};

/** e2e/fixtures/sample-company/chart-of-accounts.csv: code,name,type,currency. */
function fixtureChart(): ChartAccountLike[] {
  const file = join(__dirname, '../../../../../e2e/fixtures/sample-company/chart-of-accounts.csv');
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [code, name, type] = line.split(',');
      return { code, name, accountType: TYPES[type] };
    });
}

const SPECS: Record<string, RoleAccountSpec> = {
  receivable: RECEIVABLE_ACCOUNT,
  sales: SALES_ACCOUNT,
  vat: VAT_ACCOUNT,
  cash: CASH_BANK_ACCOUNT,
  inventory: INVENTORY_ACCOUNT,
  cogs: COGS_ACCOUNT,
  purchases: PURCHASES_ACCOUNT,
  payable: PAYABLE_ACCOUNT,
  vatReceivable: VAT_RECEIVABLE_ACCOUNT,
  posClearing: POS_CLEARING_ACCOUNT,
  stockAdjustment: STOCK_ADJUSTMENT_ACCOUNT,
  openingEquity: OPENING_STOCK_EQUITY_ACCOUNT,
};

/** "use 1201" or "create 1402". */
function resolve(chart: ChartAccountLike[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SPECS).map(([role, spec]) => {
      const d = decideRoleAccount(chart, spec);
      return [role, `${d.action} ${d.code}`];
    }),
  );
}

const template = (key: string): ChartAccountLike[] => [...CHART_TEMPLATES.find((t) => t.key === key)!.accounts];

describe('decideRoleAccount per role over the real charts', () => {
  it('fixture chart (M1 shop): receivable 1201 not notes 1110, input VAT on its own new account, not 1401', () => {
    expect(resolve(fixtureChart())).toEqual({
      receivable: 'use 1201',
      sales: 'use 4101',
      vat: 'use 2201',
      cash: 'use 1101',
      inventory: 'use 1301',
      cogs: 'use 5101',
      purchases: 'create 5201',
      payable: 'use 2101',
      vatReceivable: 'create 1402',
      posClearing: 'create 1015',
      stockAdjustment: 'create 5301',
      openingEquity: 'create 3030',
    });
  });

  it('default tenant chart (DEFAULT_CHART_OF_ACCOUNTS): unchanged choices', () => {
    expect(resolve(DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ ...a })))).toEqual({
      receivable: 'use 1020',
      sales: 'use 4010',
      vat: 'use 2020',
      cash: 'use 1010',
      inventory: 'use 1030',
      cogs: 'create 5101',
      purchases: 'create 5201',
      payable: 'use 2010',
      vatReceivable: 'create 1401',
      posClearing: 'create 1015',
      stockAdjustment: 'create 5301',
      openingEquity: 'create 3030',
    });
  });

  it('iran-trading template: headers (group/kol) are never chosen', () => {
    expect(resolve([...template('iran-trading')])).toEqual({
      receivable: 'use 1020',
      sales: 'use 4010',
      vat: 'use 2020',
      cash: 'use 1010',
      inventory: 'use 1030',
      cogs: 'use 5110',
      purchases: 'create 5201',
      payable: 'use 2010',
      vatReceivable: 'use 1045',
      posClearing: 'use 1015',
      stockAdjustment: 'create 5301',
      // 3030 is «سایر اندوخته‌ها» here: not reused, the new account takes the next free code.
      openingEquity: 'create 3031',
    });
  });

  it('iran-service template has no stock accounts', () => {
    const r = resolve([...template('iran-service')]);
    expect(r.receivable).toBe('use 1020');
    expect(r.inventory).toBe('create 1301');
    expect(r.cogs).toBe('create 5101');
  });
});

describe('decideRoleAccount rules', () => {
  const acc = (code: string, name: string, accountType = AccountType.ASSET): ChartAccountLike => ({ code, name, accountType });

  it('prefers the default code when its name matches, else the lowest code, whatever the list order', () => {
    const a = acc('1105', 'حساب‌های دریافتنی الف');
    const b = acc('1201', 'حساب‌های دریافتنی تجاری');
    const c = acc('1103', 'حساب‌های دریافتنی ب');
    expect(decideRoleAccount([a, b, c], RECEIVABLE_ACCOUNT)).toEqual({ action: 'use', code: '1201' });
    expect(decideRoleAccount([c, a], RECEIVABLE_ACCOUNT)).toEqual({ action: 'use', code: '1103' });
    expect(decideRoleAccount([a, c], RECEIVABLE_ACCOUNT)).toEqual({ action: 'use', code: '1103' });
  });

  it('excludes notes receivable and payable', () => {
    expect(decideRoleAccount([acc('1110', 'اسناد دریافتنی نزد صندوق')], RECEIVABLE_ACCOUNT)).toEqual(
      expect.objectContaining({ action: 'create', code: '1201' }),
    );
    expect(
      decideRoleAccount([acc('2110', 'اسناد پرداختنی تجاری', AccountType.LIABILITY)], PAYABLE_ACCOUNT),
    ).toEqual(expect.objectContaining({ action: 'create', code: '2101' }));
  });

  it('skips the next codes that are taken, and codes claimed earlier in the plan', () => {
    const chart = [acc('1401', 'پیش‌پرداخت خرید و اجاره'), acc('1402', 'سایر')];
    expect(decideRoleAccount(chart, VAT_RECEIVABLE_ACCOUNT)).toEqual(
      expect.objectContaining({ action: 'create', code: '1403' }),
    );
    expect(decideRoleAccount(chart, VAT_RECEIVABLE_ACCOUNT, new Set(['1403']))).toEqual(
      expect.objectContaining({ code: '1404' }),
    );
  });

  it('matches Arabic yeh/kaf and zero-width spelling variants', () => {
    expect(decideRoleAccount([acc('1201', 'حسابهاي دريافتني تجاري')], RECEIVABLE_ACCOUNT)).toEqual({
      action: 'use',
      code: '1201',
    });
  });
});
