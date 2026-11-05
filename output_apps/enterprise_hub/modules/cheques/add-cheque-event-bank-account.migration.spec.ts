import { AddChequeEventBankAccount1789520000000 as Migration } from '../../migrations/1789520000000-AddChequeEventBankAccount';

const runner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('AddChequeEventBankAccount migration', () => {
  it('adds the nullable bank account column to the existing event table', async () => {
    const { runner: r, queries } = runner();
    await new Migration().up(r as never);
    const sql = queries.join('\n');
    expect(sql).toContain('"fin_cheque_events"');
    expect(sql).toContain('"bank_account_id"');
    expect(sql).toContain('integer');
    expect(sql).not.toContain('CREATE TABLE'); // existing FORCE RLS table only
  });

  it('down() drops the column', async () => {
    const { runner: r, queries } = runner();
    await new Migration().down(r as never);
    expect(queries.join('\n')).toContain('DROP COLUMN IF EXISTS "bank_account_id"');
  });
});
