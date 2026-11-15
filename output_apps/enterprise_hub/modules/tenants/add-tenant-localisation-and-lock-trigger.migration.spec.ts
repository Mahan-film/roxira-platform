import { AddTenantLocalisationAndLockTrigger1789900005500 } from '../../migrations/1789900005500-AddTenantLocalisationAndLockTrigger';

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

describe('AddTenantLocalisationAndLockTrigger migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddTenantLocalisationAndLockTrigger1789900005500();
    expect(migration.name).toBe('AddTenantLocalisationAndLockTrigger1789900005500');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds localisation columns to tenants with safe defaults', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantLocalisationAndLockTrigger1789900005500().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('ALTER TABLE "tenants"');
    expect(sql).toContain('"country_code" character varying(2) NOT NULL DEFAULT \'IR\'');
    expect(sql).toContain('"pack_version" character varying(20) NOT NULL DEFAULT \'1.0.0\'');
    expect(sql).toContain('"book_currency_code" character varying(3) NOT NULL DEFAULT \'IRR\'');
    expect(sql).toContain('"default_calendar" character varying(20) NOT NULL DEFAULT \'jalali\'');
    expect(sql).toContain('"timezone" character varying(50) NOT NULL DEFAULT \'Asia/Tehran\'');
    expect(sql).toContain('"locale" character varying(20) NOT NULL DEFAULT \'fa-IR\'');
    expect(sql).toContain('"fiscal_year_start_month" smallint NOT NULL DEFAULT 1');
  });

  it('backfills existing tenants with default pack values', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantLocalisationAndLockTrigger1789900005500().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('UPDATE "tenants"');
    expect(sql).toContain('"country_code" = COALESCE("country_code", \'IR\')');
    expect(sql).toContain('"pack_version" = COALESCE("pack_version", \'1.0.0\')');
    expect(sql).toContain('"book_currency_code" = COALESCE("book_currency_code", \'IRR\')');
    expect(sql).toContain('"default_calendar" = COALESCE("default_calendar", \'jalali\')');
    expect(sql).toContain('"timezone" = COALESCE("timezone", \'Asia/Tehran\')');
    expect(sql).toContain('"locale" = COALESCE("locale", \'fa-IR\')');
    expect(sql).toContain('"fiscal_year_start_month" = COALESCE("fiscal_year_start_month", 1)');
  });

  it('creates the localisation lock trigger function protecting posted entries', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantLocalisationAndLockTrigger1789900005500().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION tenant_guard_localisation_lock()');
    expect(sql).toContain('NEW.country_code IS DISTINCT FROM OLD.country_code');
    expect(sql).toContain('NEW.book_currency_code IS DISTINCT FROM OLD.book_currency_code');
    expect(sql).toContain('SELECT 1 FROM "fin_journal_entries"');
    expect(sql).toContain('"tenant_id" = OLD.id AND "status" = \'POSTED\'');
    expect(sql).toContain('ERRCODE = \'RX003\'');
    expect(sql).toContain('CREATE TRIGGER "TRG_tenants_guard_localisation_lock"');
    expect(sql).toContain('BEFORE UPDATE ON "tenants"');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION tenant_guard_localisation_lock() TO roxira_app');
  });

  it('down() drops triggers, functions and columns cleanly', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantLocalisationAndLockTrigger1789900005500().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP TRIGGER IF EXISTS "TRG_tenants_guard_localisation_lock" ON "tenants"');
    expect(sql).toContain('DROP FUNCTION IF EXISTS tenant_guard_localisation_lock()');
    expect(sql).toContain('DROP COLUMN IF EXISTS "fiscal_year_start_month"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "locale"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "timezone"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "default_calendar"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "book_currency_code"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "pack_version"');
  });
});
