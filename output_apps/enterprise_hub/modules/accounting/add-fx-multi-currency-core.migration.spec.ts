import { AddFxMultiCurrencyCore1789220000000 } from '../../migrations/1789220000000-AddFxMultiCurrencyCore';

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

describe('AddFxMultiCurrencyCore migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddFxMultiCurrencyCore1789220000000();
    expect(migration.name).toBe('AddFxMultiCurrencyCore1789220000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds the FX columns to fin_journal_entry_lines', async () => {
    const { runner, queries } = createRunner();
    await new AddFxMultiCurrencyCore1789220000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "currency" character varying(8) NOT NULL DEFAULT 'IRR'`,
    );
    expect(sql).toContain(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "amount_fx" numeric(24,6)`,
    );
    expect(sql).toContain(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(24,6)`,
    );
    expect(sql).toContain(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "party_code" character varying(64)`,
    );
    expect(sql).toContain('IDX_fin_journal_entry_lines_tenant_currency');
    expect(sql).toContain('IDX_fin_journal_entry_lines_tenant_party');
  });

  it('widens invoices.currency and adds fx_rate/amount_fx', async () => {
    const { runner, queries } = createRunner();
    await new AddFxMultiCurrencyCore1789220000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "currency" character varying(8) NOT NULL DEFAULT 'IRR'`,
    );
    expect(sql).toContain(
      `ALTER TABLE "invoices" ALTER COLUMN "currency" TYPE character varying(8)`,
    );
    expect(sql).toContain(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(24,6) NOT NULL DEFAULT 1`,
    );
    expect(sql).toContain(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_fx" numeric(24,6)`,
    );
  });

  it('does not disable the migration transaction', () => {
    const migration = new AddFxMultiCurrencyCore1789220000000() as unknown as {
      transaction?: boolean;
    };
    expect(migration.transaction).not.toBe(false);
  });

  it('down() drops the added columns and restores the invoice currency width', async () => {
    const { runner, queries } = createRunner();
    await new AddFxMultiCurrencyCore1789220000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "party_code"`,
    );
    expect(sql).toContain(
      `ALTER TABLE "invoices" ALTER COLUMN "currency" TYPE character varying(3)`,
    );
    expect(sql).toContain(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "amount_fx"`,
    );
  });
});
