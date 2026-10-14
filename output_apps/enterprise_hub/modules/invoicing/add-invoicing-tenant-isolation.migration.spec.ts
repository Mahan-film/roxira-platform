import { AddInvoicingTenantIsolation1789150000000 } from '../../migrations/1789150000000-AddInvoicingTenantIsolation';

/** Runner ساختگی TypeORM که SQL اجراشده را ثبت می‌کند (بدون پایگاه‌داده). */
const createRunner = () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const runner = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      params.push(values ?? []);
      return undefined;
    }),
  };
  return { runner, queries, params };
};

describe('AddInvoicingTenantIsolation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddInvoicingTenantIsolation1789150000000();
    expect(migration.name).toBe('AddInvoicingTenantIsolation1789150000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds tenant_id, backfills and enforces NOT NULL', async () => {
    const { runner, queries, params } = createRunner();
    await new AddInvoicingTenantIsolation1789150000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      '"invoices" ADD COLUMN IF NOT EXISTS "tenant_id" uuid',
    );
    expect(sql).toContain(
      'UPDATE "invoices" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL',
    );
    expect(sql).toContain(
      '"invoices" ALTER COLUMN "tenant_id" SET NOT NULL',
    );
    expect(params.flat()).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('creates the tenant query indexes including (tenant_id, createdAt)', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoicingTenantIsolation1789150000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('IDX_invoices_tenant_createdAt');
    expect(sql).toContain('("tenant_id", "createdAt")');
  });

  it('converts the global taxInvoiceNumber unique into a composite unique', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoicingTenantIsolation1789150000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_invoices_taxInvoiceNumber"');
    expect(sql).toContain('IDX_invoices_tenant_taxInvoiceNumber');
    expect(sql).toContain('("tenant_id", "taxInvoiceNumber")');
  });

  it('down() restores the global unique and drops tenant artifacts', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoicingTenantIsolation1789150000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_invoices_tenant_taxInvoiceNumber"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_invoices_taxInvoiceNumber"',
    );
    expect(sql).toContain(
      'ALTER TABLE "invoices" DROP COLUMN IF EXISTS "tenant_id"',
    );
  });
});
