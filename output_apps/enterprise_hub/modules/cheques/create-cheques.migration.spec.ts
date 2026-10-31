import { CreateCheques1789410000000 } from '../../migrations/1789410000000-CreateCheques';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('CreateCheques migration', () => {
  it('creates both tables with tenant_id, constraints and tenant-leading indexes', async () => {
    const { runner, queries } = createRunner();
    await new CreateCheques1789410000000().up(runner as never);
    const sql = queries.join('\n');
    for (const table of ['fin_cheques', 'fin_cheque_events']) {
      const create = queries.find((q) => q.includes(`CREATE TABLE IF NOT EXISTS "${table}"`));
      expect(create).toContain('"tenant_id" uuid NOT NULL');
    }
    expect(sql).toContain('ON "fin_cheques" ("tenant_id", "sayad_number") WHERE "sayad_number" IS NOT NULL');
    expect(sql).toContain('ON "fin_cheques" ("tenant_id", "status", "due_date")');
    expect(sql).toContain('ON "fin_cheque_events" ("tenant_id", "cheque_id")');
    expect(sql).toContain("'^[0-9]{16}$'");
    expect(sql).toContain('"amount" > 0');
  });

  it('down() drops events before cheques', async () => {
    const { runner, queries } = createRunner();
    await new CreateCheques1789410000000().down(runner as never);
    expect(queries).toEqual(['DROP TABLE IF EXISTS "fin_cheque_events"', 'DROP TABLE IF EXISTS "fin_cheques"']);
  });
});
