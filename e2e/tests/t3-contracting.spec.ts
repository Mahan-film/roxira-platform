import type { Page } from '@playwright/test';
import { test, expect, findSessionFile, loginAsTestTenant, openApp, SESSION_STORAGE_KEY } from '../app/fixtures';
import { apiGet } from './m1/import-ui';

/**
 * T3 gate (#227): a contractor-side contract with 3 progress statements, retention and a partial release,
 * an advance and its recovery, and an employer-side contract on the same project, driven through the real
 * API of a sandbox tenant and the three contracting pages. Ledger and project report are asserted to the
 * hand-computed numbers below (rial). The same numbers are proven against a real PostgreSQL, without a
 * browser, by output_apps/enterprise_hub/modules/contracting/contracting.gate.pg.spec.ts.
 *
 * Runs only against a loopback sandbox with a session (see m1-shop-month.spec.ts):
 *   bash scripts/infra/e2e/mkuser.sh m1 ; E2E_BASE_URL=... APP_E2E_SESSION_FILE_M1=... npx playwright test t3-contracting
 * The accounts it creates (92xx-95xx) are its own, and each document type is mapped to them separately,
 * so it does not disturb the mapping of other gate steps. Ledger checks are deltas of the account turnover.
 *
 * Hand computation (contractor contract 1,000,000,000; mechanical insurance 7% x (1 + 0.1 addon); retention 10%):
 *   advance 100,000,000 (cap 20% = 200,000,000).
 *   statement 1: cumulative 300m, period 300m, retention 30m, insurance 23.1m, recovery 30m, net 216.9m
 *   statement 2: cumulative 700m, period 400m, retention 40m, insurance 30.8m, recovery 40m, net 289.2m
 *   statement 3: cumulative 1,000m, period 300m, retention 30m, insurance 23.1m, recovery 30m, net 216.9m
 *   release of 50m of the 100m held. Employer contract: one statement 400m, retention 40m, net 360m.
 */
const M = 1_000_000;
const RUN = String(Date.now()).slice(-6);

const ACCOUNTS: Array<[string, string, string]> = [
  ['9201', 'طلب از کارفرما', 'ASSET'],
  ['9250', 'سپرده حسن انجام کار نزد کارفرما', 'ASSET'],
  ['9252', 'پیش‌پرداخت به پیمانکار', 'ASSET'],
  ['9251', 'پیش‌دریافت قرارداد', 'LIABILITY'],
  ['9301', 'بدهی به پیمانکار', 'LIABILITY'],
  ['9302', 'سپرده حسن انجام کار پرداختنی', 'LIABILITY'],
  ['9303', 'بیمه پیمانکار پرداختنی', 'LIABILITY'],
  ['9401', 'درآمد پیمانکاری', 'REVENUE'],
  ['9501', 'هزینه بیمه صورت وضعیت', 'EXPENSE'],
  ['9502', 'هزینه پیمانکاران جزء', 'EXPENSE'],
];
const MAPPING: Record<string, Record<string, string>> = {
  'contract.statement.contractor': { receivable: '9201', retention_receivable: '9250', contract_insurance_expense: '9501', advance_received: '9251', revenue: '9401' },
  'contract.statement.employer': { purchases: '9502', payable: '9301', retention_payable: '9302', insurance_payable: '9303', advance_paid: '9252' },
  'contract.advance.contractor': { receivable: '9201', advance_received: '9251' },
  'contract.retention_release.contractor': { receivable: '9201', retention_receivable: '9250' },
};

async function call<T = unknown>(page: Page, method: 'POST' | 'PUT', route: string, body?: unknown, expectStatus?: number): Promise<{ status: number; body: T }> {
  const token = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
  }, SESSION_STORAGE_KEY);
  expect(token, 'the test session is in localStorage').toBeTruthy();
  const response = await page.request.fetch(`/api/backend/enterprise-hub/${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  if (expectStatus !== undefined) expect(response.status(), `${method} ${route}`).toBe(expectStatus);
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as T };
}

type TbRow = { code: string; turnoverDebit: number | string; turnoverCredit: number | string };
async function turnover(page: Page): Promise<Record<string, number>> {
  const report = await apiGet<{ rows: TbRow[] }>(page, 'accounting/reports/trial-balance?columns=10');
  const out: Record<string, number> = {};
  for (const r of report.rows) out[r.code] = Number(r.turnoverDebit) - Number(r.turnoverCredit);
  return out;
}

test.describe('T3 gate · contract, 3 statements, retention and release, advance and recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ sessionKind: 'm1' });

  test.beforeEach(({ baseURL }, testInfo) => {
    testInfo.skip(!findSessionFile('m1', testInfo.project.name), 'no sandbox session: set APP_E2E_SESSION_FILE_M1 (scripts/infra/e2e/mkuser.sh m1)');
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(!['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1', `the gate writes data; refusing ${baseURL ?? 'no baseURL'}`);
  });

  let before: Record<string, number> = {};
  let contractId = 0;
  let employerContractId = 0;
  let projectId = 0;

  test('01 setup: accounts, document mappings, parties, organisation figures, project and contracts', async ({ page }) => {
    await loginAsTestTenant(page, '/app/contracting');
    for (const [code, name, accountType] of ACCOUNTS) {
      const { status } = await call(page, 'POST', 'accounting/accounts', { code, name, accountType, currency: 'IRR' });
      expect([201, 409]).toContain(status);
    }
    for (const [docType, roles] of Object.entries(MAPPING)) {
      for (const [role, accountCode] of Object.entries(roles)) {
        await call(page, 'PUT', `posting-rules/${docType}/roles/${role}`, { accountCode });
        // 204 on success; a repeat run answers the same
      }
    }
    await call(page, 'POST', 'parties', { code: `T3C${RUN}`, name: 'شرکت کارفرمای نمونه', role: 'customer' }, 201);
    await call(page, 'POST', 'parties', { code: `T3S${RUN}`, name: 'پیمانکار جزء نمونه', role: 'supplier' }, 201);
    // the two figures the store holds as unclear: the organisation sets them (its own figures, not legal fact)
    for (const [key, value] of [['contract_unemployment_addon_fraction', '0.1'], ['contract_advance_payment_max_rate', '0.2']] as const) {
      await call(page, 'PUT', 'hr/statutory-parameters', { fiscalYear: 1405, key, value, source: 'ثبت‌شده توسط سازمان در آزمون', verified: false }, 200);
    }
    const project = await call<{ id: number }>(page, 'POST', 'contracting/projects', { code: `T3P${RUN}`, name: `ساختمان اداری نمونه ${RUN}`, budget: '1500000000' }, 201);
    projectId = project.body.id;
    const make = async (body: Record<string, unknown>) => {
      const created = await call<{ id: number }>(page, 'POST', 'contracting/contracts', { contractDate: '2026-11-01', projectId, ...body }, 201);
      await call(page, 'PUT', `contracting/contracts/${created.body.id}`, { status: 'active' }, 200);
      return created.body.id;
    };
    contractId = await make({ code: `T3KC${RUN}`, title: 'پیمان ساختمان اداری', side: 'contractor', partyCode: `T3C${RUN}`, amount: '1000000000', advanceAmount: '100000000', insuranceType: 'MECHANICAL' });
    employerContractId = await make({ code: `T3KE${RUN}`, title: 'پیمان جزء سفت‌کاری', side: 'employer', partyCode: `T3S${RUN}`, amount: '400000000' });
    before = await turnover(page);
  });

  test('02 advance, three statements, retention release: figures per statement', async ({ page }) => {
    await loginAsTestTenant(page, '/app/contracting');
    await call(page, 'POST', `contracting/contracts/${contractId}/advances`, { date: '2026-11-01', amount: '100000000', requestKey: `adv-${RUN}` }, 201);
    const plan = [
      { cum: '300000000', date: '2026-11-10', ret: 30 * M, ins: 23_100_000, rec: 30 * M, net: 216_900_000 },
      { cum: '700000000', date: '2026-12-01', ret: 40 * M, ins: 30_800_000, rec: 40 * M, net: 289_200_000 },
      { cum: '1000000000', date: '2027-01-01', ret: 30 * M, ins: 23_100_000, rec: 30 * M, net: 216_900_000 },
    ];
    for (const [i, p] of plan.entries()) {
      const created = await call<{ id: number; number: number }>(page, 'POST', `contracting/contracts/${contractId}/statements`, { statementDate: p.date, cumulativeAmount: p.cum }, 201);
      expect(created.body.number).toBe(i + 1);
      const approved = await call<Record<string, number>>(page, 'POST', `contracting/statements/${created.body.id}/approve`, undefined, 200);
      expect(approved.body).toMatchObject({ retentionAmount: p.ret, insuranceAmount: p.ins, advanceRecoveryAmount: p.rec, netPayable: p.net });
      const posted = await call<{ status: string; replayed: boolean }>(page, 'POST', `contracting/statements/${created.body.id}/post`, undefined, 200);
      expect(posted.body).toMatchObject({ status: 'posted', replayed: false });
      expect((await call<{ replayed: boolean }>(page, 'POST', `contracting/statements/${created.body.id}/post`, undefined, 200)).body.replayed).toBe(true);
    }
    await call(page, 'POST', `contracting/contracts/${contractId}/retention-releases`, { date: '2027-02-01', amount: '50000000', requestKey: `rel-${RUN}` }, 201);
    expect((await call(page, 'POST', `contracting/contracts/${contractId}/retention-releases`, { date: '2027-02-02', amount: '50000001' })).status).toBe(400);

    const sub = await call<{ id: number }>(page, 'POST', `contracting/contracts/${employerContractId}/statements`, { statementDate: '2026-12-15', cumulativeAmount: '400000000' }, 201);
    await call(page, 'POST', `contracting/statements/${sub.body.id}/approve`, undefined, 200);
    await call(page, 'POST', `contracting/statements/${sub.body.id}/post`, undefined, 200);
  });

  test('03 ledger: account turnover moved by exactly the hand-computed amounts', async ({ page }) => {
    await loginAsTestTenant(page, '/app/contracting');
    const after = await turnover(page);
    const delta = (code: string) => (after[code] ?? 0) - (before[code] ?? 0);
    // net debit: receivable 100 + 216.9 + 289.2 + 216.9 + 50 = 873m; retention asset 100 - 50 = 50m; insurance expense 77m;
    // advance received 100 credited, 100 recovered = 0; revenue -1,000m; subcontract cost 400m; payable -360m; retention payable -40m
    expect(delta('9201')).toBe(873 * M);
    expect(delta('9250')).toBe(50 * M);
    expect(delta('9501')).toBe(77 * M);
    expect(delta('9251')).toBe(0);
    expect(delta('9401')).toBe(-1000 * M);
    expect(delta('9502')).toBe(400 * M);
    expect(delta('9301')).toBe(-360 * M);
    expect(delta('9302')).toBe(-40 * M);
  });

  test('04 project report: budget 1,500m against actual 400m against billed 1,000m', async ({ page }) => {
    await loginAsTestTenant(page, '/app/contracting/profitability');
    const report = await apiGet<{ projects: Array<Record<string, unknown>> }>(page, 'contracting/reports/profitability');
    const row = report.projects.find((p) => p.projectId === projectId);
    expect(row).toMatchObject({ budget: 1500 * M, billed: 1000 * M, budgetRemaining: 1100 * M, margin: 600 * M, ledgerLinked: false, actual: { subcontracts: 400 * M, ledger: null, total: 400 * M } });
    await expect(page.getByText(`ساختمان اداری نمونه ${RUN}`)).toBeVisible();
    await expect(page.getByText('مرکز هزینه تعریف نشده').first()).toBeVisible();
  });

  test('05 pages: the contract shows three posted statements with the figures they used', async ({ page }) => {
    await openApp(page, `/app/contracting/contracts/${contractId}`);
    await expect(page.getByRole('heading', { name: new RegExp(`T3KC${RUN}`) })).toBeVisible();
    await expect(page.getByText('ثبت‌شده').first()).toBeVisible();
    await expect(page.getByText('مقدار ثبت‌شده سازمان (تأیید قانونی نشده)').first()).toBeVisible();
    await openApp(page, '/app/contracting');
    await expect(page.getByRole('link', { name: `T3KC${RUN}` })).toBeVisible();
  });
});
