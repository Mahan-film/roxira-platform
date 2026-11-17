import 'reflect-metadata';
import { MigrateLegacyChequeAccounts1789900010200 as Migration } from '../../migrations/1789900010200-MigrateLegacyChequeAccounts';
import { createTestDatabase, describePg, TestDatabaseContext, TEST_T1 as T1, TEST_T2 as T2 } from '../../test/support/test-pg';

/**
 * Real PostgreSQL: the legacy cheque account migration must only touch accounts that carry
 * the legacy seeded cheque name, never accounts that merely share the code (T98 review).
 */
describePg('MigrateLegacyChequeAccounts on PostgreSQL (T98)', () => {
  let testDb: TestDatabaseContext;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => testDb.rawQuery<R>(sql, params);

  const account = async (tenant: string, code: string, name: string, type: string) => {
    const [row] = await q<{ id: number }>(
      `INSERT INTO fin_chart_of_accounts (tenant_id, code, name, account_type, level, currency, balance)
       VALUES ($1, $2, $3, $4::accounttype, 'MOEIN', 'IRR', 0)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [tenant, code, name, type],
    );
    return row.id;
  };

  const line = async (tenant: string, accountId: number, debit: string, credit: string) => {
    const [entry] = await q<{ id: number }>(
      `INSERT INTO fin_journal_entries (tenant_id, entry_number, description) VALUES ($1, $2, 'migration spec') RETURNING id`,
      [tenant, `MIG-${tenant.slice(0, 4)}-${accountId}`],
    );
    // entries must balance: post the opposite side to a neutral account in the same statement
    const offset = await account(tenant, '9999', 'طرف مقابل آزمون', 'EQUITY');
    const [l] = await q<{ id: number }>(
      `INSERT INTO fin_journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit)
       VALUES ($1, $2, $3, $4, $5), ($1, $2, $6, $5, $4) RETURNING id`,
      [tenant, entry.id, accountId, debit, credit, offset],
    );
    return l.id;
  };

  const lineAccountCode = async (lineId: number) =>
    (
      await q<{ code: string }>(
        `SELECT a.code FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id WHERE l.id = $1`,
        [lineId],
      )
    )[0].code;

  beforeAll(async () => {
    testDb = await createTestDatabase('mlca');
    for (const t of [T1, T2]) {
      await q(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [t, t.slice(0, 8)]).catch(() => undefined);
    }
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('keeps a tenant whose 1110/1120/2110 are other accounts untouched; migrates a tenant with the legacy cheque names', async () => {
    // T1: default-chart meaning of the codes (land, accumulated depreciation, long-term loans)
    const land = await account(T1, '1110', 'زمین', 'ASSET');
    const accDep = await account(T1, '1120', 'استهلاک انباشته', 'ASSET');
    const loan = await account(T1, '2110', 'تسهیلات مالی بلندمدت', 'LIABILITY');
    const landLine = await line(T1, land, '500', '0');
    const depLine = await line(T1, accDep, '0', '70');
    const loanLine = await line(T1, loan, '0', '900');

    // T2: legacy seeded cheque accounts
    const legacyIn = await account(T2, '1110', 'اسناد دریافتنی نزد صندوق', 'ASSET');
    const legacyColl = await account(T2, '1120', 'اسناد دریافتنی در جریان وصول', 'ASSET');
    const legacyOut = await account(T2, '2110', 'اسناد پرداختنی', 'LIABILITY');
    const inLine = await line(T2, legacyIn, '100', '0');
    const collLine = await line(T2, legacyColl, '40', '0');
    const outLine = await line(T2, legacyOut, '0', '60');

    // role maps: T1 explicitly maps cheques_receivable to its land account and cheques_in_collection
    // to the new code; T2 maps cheques_receivable to its legacy cheque account
    const insertMap = (t: string, docType: string, role: string, code: string) =>
      q(`INSERT INTO fin_posting_role_maps (tenant_id, doc_type, role, account_code) VALUES ($1, $2, $3, $4)`, [t, docType, role, code]);
    await insertMap(T1, 'cheque', 'cheques_receivable', '1110');
    await insertMap(T1, 'cheque', 'cheques_in_collection', '1023');
    await insertMap(T2, 'cheque', 'cheques_receivable', '1110');
    const roleOf = async (t: string, role: string) =>
      (await q<{ account_code: string }>(`SELECT account_code FROM fin_posting_role_maps WHERE tenant_id = $1 AND role = $2`, [t, role]))[0].account_code;
    const t1Snapshot = async () =>
      (await q<{ id: number; code: string; name: string }>(`SELECT id, code, name FROM fin_chart_of_accounts WHERE tenant_id = $1 AND id = ANY($2) ORDER BY id`, [T1, [land, accDep, loan]]));

    const run = async (dir: 'up' | 'down') => {
      const runner = testDb.owner.createQueryRunner();
      try {
        await new Migration()[dir](runner);
      } finally {
        await runner.release();
      }
    };
    await run('up');

    // T1 untouched: accounts, names and lines
    const t1 = await q<{ code: string; name: string }>(
      `SELECT code, name FROM fin_chart_of_accounts WHERE tenant_id = $1 AND id = ANY($2)`,
      [T1, [land, accDep, loan]],
    );
    expect(t1.map((r) => `${r.code}:${r.name}`).sort()).toEqual(
      ['1110:زمین', '1120:استهلاک انباشته', '2110:تسهیلات مالی بلندمدت'].sort(),
    );
    expect(await lineAccountCode(landLine)).toBe('1110');
    expect(await lineAccountCode(depLine)).toBe('1120');
    expect(await lineAccountCode(loanLine)).toBe('2110');

    // the new target accounts exist for every tenant
    for (const t of [T1, T2]) {
      const codes = (
        await q<{ code: string }>(
          `SELECT code FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code IN ('1021','1023','2011')`,
          [t],
        )
      )
        .map((r) => r.code)
        .sort();
      expect(codes).toEqual(['1021', '1023', '2011']);
    }

    // T2 migrated; legacy accounts are not deleted
    expect(await lineAccountCode(inLine)).toBe('1021');
    expect(await lineAccountCode(collLine)).toBe('1023');
    expect(await lineAccountCode(outLine)).toBe('2011');
    const left = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin_chart_of_accounts WHERE tenant_id = $1 AND id = ANY($2)`,
      [T2, [legacyIn, legacyColl, legacyOut]],
    );
    expect(left[0].n).toBe('3');
    expect(await roleOf(T1, 'cheques_receivable')).toBe('1110');
    expect(await roleOf(T2, 'cheques_receivable')).toBe('1021');

    // down(): the land tenant's role maps, accounts and lines stay untouched; the legacy tenant is restored
    const t1Before = await t1Snapshot();
    await run('down');
    expect(await t1Snapshot()).toEqual(t1Before);
    expect(await roleOf(T1, 'cheques_receivable')).toBe('1110');
    expect(await roleOf(T1, 'cheques_in_collection')).toBe('1023');
    expect(await lineAccountCode(landLine)).toBe('1110');
    expect(await lineAccountCode(depLine)).toBe('1120');
    expect(await lineAccountCode(loanLine)).toBe('2110');
    expect(await roleOf(T2, 'cheques_receivable')).toBe('1110');
    expect(await lineAccountCode(inLine)).toBe('1110');
    expect(await lineAccountCode(collLine)).toBe('1120');
    expect(await lineAccountCode(outLine)).toBe('2110');
  });
});
