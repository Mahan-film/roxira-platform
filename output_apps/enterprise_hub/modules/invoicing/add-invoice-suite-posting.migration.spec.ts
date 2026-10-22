import { AddInvoiceSuitePosting1789250000000 } from '../../migrations/1789250000000-AddInvoiceSuitePosting';

/** Runner ساختگی TypeORM که SQL اجراشده را ثبت می‌کند (بدون پایگاه‌داده). */
const createRunner = () => {
  const queries: string[] = [];
  const runner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return undefined;
    }),
  };
  return { runner, queries };
};

describe('AddInvoiceSuitePosting migration', () => {
  it('adds the nullable posting columns to invoices', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoiceSuitePosting1789250000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ADD COLUMN IF NOT EXISTS "journal_entry_id" integer`,
    );
    expect(sql).toContain(
      `ADD COLUMN IF NOT EXISTS "paid_journal_entry_id" integer`,
    );
    expect(sql).toContain(
      `ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" integer`,
    );
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "posting_error" text`);
  });

  it('down() drops every added column', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoiceSuitePosting1789250000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(`DROP COLUMN IF EXISTS "journal_entry_id"`);
    expect(sql).toContain(`DROP COLUMN IF EXISTS "paid_journal_entry_id"`);
    expect(sql).toContain(`DROP COLUMN IF EXISTS "reversal_journal_entry_id"`);
    expect(sql).toContain(`DROP COLUMN IF EXISTS "posting_error"`);
  });
});
