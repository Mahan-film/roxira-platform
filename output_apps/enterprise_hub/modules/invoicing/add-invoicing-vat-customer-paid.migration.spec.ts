import { AddInvoicingVatCustomerPaid1789210000000 } from '../../migrations/1789210000000-AddInvoicingVatCustomerPaid';

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

describe('AddInvoicingVatCustomerPaid migration', () => {
  it('adds PAID to the invoice status enum and new invoice columns', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoicingVatCustomerPaid1789210000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TYPE "public"."invoices_status_enum" ADD VALUE IF NOT EXISTS 'PAID'`,
    );
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "customer_id" integer`);
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "issued_at" TIMESTAMP`);
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP`);
  });

  it('adds the tenant VAT default and customer index', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoicingVatCustomerPaid1789210000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "default_vat_rate" numeric(5,4) NOT NULL DEFAULT 0.1`,
    );
    expect(sql).toContain('IDX_invoices_tenant_customer');
    expect(sql).toContain('("tenant_id", "customer_id")');
  });

  it('down() reverses the non-enum changes', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoicingVatCustomerPaid1789210000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      `ALTER TABLE "tenants" DROP COLUMN IF EXISTS "default_vat_rate"`,
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_invoices_tenant_customer"');
    expect(sql).toContain(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "customer_id"`,
    );
  });
});
