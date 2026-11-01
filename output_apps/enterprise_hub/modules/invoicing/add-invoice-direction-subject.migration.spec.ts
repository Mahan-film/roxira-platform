import { AddInvoiceDirectionAndSubject1789420000000 } from '../../migrations/1789420000000-AddInvoiceDirectionAndSubject';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('AddInvoiceDirectionAndSubject migration', () => {
  it('adds additive columns whose defaults make every old row an original sale', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoiceDirectionAndSubject1789420000000().up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain(`"direction" character varying(8) NOT NULL DEFAULT 'SALE'`);
    expect(sql).toContain('"einvoice_type" smallint NOT NULL DEFAULT 1');
    expect(sql).toContain('"subject" smallint NOT NULL DEFAULT 1');
    expect(sql).toContain('"related_invoice_id" uuid');
    expect(sql).toContain(`CHECK ("subject" BETWEEN 1 AND 4)`);
    expect(sql).toContain('("tenant_id", "direction")');
  });

  it('down() removes what up() added', async () => {
    const { runner, queries } = createRunner();
    await new AddInvoiceDirectionAndSubject1789420000000().down(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('DROP COLUMN IF EXISTS "posting_meta"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "direction"');
  });
});
