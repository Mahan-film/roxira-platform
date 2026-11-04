import { AddChequeSayadAndPartialPayment1789495000000 as Migration } from '../../migrations/1789495000000-AddChequeSayadAndPartialPayment';

const runner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('AddChequeSayadAndPartialPayment migration', () => {
  it('adds the columns, admits delivered and keeps the audit and amount checks', async () => {
    const { runner: r, queries } = runner();
    await new Migration().up(r as never);
    const sql = queries.join('\n');
    for (const column of ['sayad_registration_status', 'sayad_verified_by', 'sayad_verified_at', 'receiver_national_id', 'spent_to_code', 'spent_to_national_id', 'settled_amount']) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain("'delivered'");
    expect(sql).toContain('"settled_amount" <= "amount"');
    expect(sql).toContain('"sayad_verified" = false OR ("sayad_verified_by" IS NOT NULL');
    expect(sql).not.toContain('CREATE TABLE'); // existing FORCE RLS tables only
  });

  it('down() moves delivered rows back before restoring the old status check', async () => {
    const { runner: r, queries } = runner();
    await new Migration().down(r as never);
    expect(queries[0]).toContain("SET \"status\" = 'registered' WHERE \"status\" = 'delivered'");
    expect(queries.join('\n')).toContain("'registered','deposited','cleared','bounced','returned','spent'");
  });
});
