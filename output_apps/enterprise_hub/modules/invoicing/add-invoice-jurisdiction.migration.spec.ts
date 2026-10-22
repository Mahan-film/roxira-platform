import { AddInvoiceJurisdiction1789260000000 } from '../../migrations/1789260000000-AddInvoiceJurisdiction';

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

describe('AddInvoiceJurisdiction migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddInvoiceJurisdiction1789260000000();
    expect(migration.name).toBe('AddInvoiceJurisdiction1789260000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds the jurisdiction column with an IR default', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoiceJurisdiction1789260000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "jurisdiction" character varying(8) NOT NULL DEFAULT 'IR'`,
    );
  });

  it('does not disable the migration transaction', () => {
    const migration = new AddInvoiceJurisdiction1789260000000() as unknown as {
      transaction?: boolean;
    };
    expect(migration.transaction).not.toBe(false);
  });

  it('down() drops the jurisdiction column', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoiceJurisdiction1789260000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "jurisdiction"`,
    );
  });
});
