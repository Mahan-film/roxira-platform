import { MigrateLegacyChequeAccounts1789900004900 as Migration } from '../../migrations/1789900004900-MigrateLegacyChequeAccounts';

const runner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('MigrateLegacyChequeAccounts migration (T98)', () => {
  it('up() ensures target accounts exist via ON CONFLICT and re-points journal lines joining on code only', async () => {
    const { runner: r, queries } = runner();
    await new Migration().up(r as never);
    const sql = queries.join('\n');

    // 1021 target
    expect(sql).toContain('ON CONFLICT ("tenant_id", "code") DO UPDATE');
    expect(sql).toContain('target."code" = \'1021\'');
    expect(sql).not.toContain('target."name" = \'اسناد دریافتنی\'');

    // 1023 target
    expect(sql).toContain('target."code" = \'1023\'');
    expect(sql).not.toContain('target."name" = \'اسناد در جریان وصول\'');

    // 2011 target
    expect(sql).toContain('target."code" = \'2011\'');
    expect(sql).not.toContain('target."name" = \'اسناد پرداختنی\'');

    // Role maps and balance recalculation
    expect(sql).toContain('UPDATE "fin_posting_role_maps"');
    expect(sql).toContain('UPDATE "fin_chart_of_accounts" a');
    expect(sql).toContain("WHERE a.\"code\" IN ('1021', '1023', '2011')");
  });

  it('down() recreates legacy accounts with ON CONFLICT, re-points lines, updates role maps and recalculates balances', async () => {
    const { runner: r, queries } = runner();
    await new Migration().down(r as never);
    const sql = queries.join('\n');

    expect(sql).toContain('target."code" = \'1110\'');
    expect(sql).toContain('target."code" = \'1120\'');
    expect(sql).toContain('target."code" = \'2110\'');
    expect(sql).toContain("WHERE a.\"code\" IN ('1110', '1120', '2110')");
  });
});
