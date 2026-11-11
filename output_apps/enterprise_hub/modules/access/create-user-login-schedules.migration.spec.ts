import { QueryRunner } from 'typeorm';
import { CreateUserLoginSchedules1789900003000 } from '../../migrations/1789900003000-CreateUserLoginSchedules';
import { TENANT_MATCH } from '../../migrations/data/tenant-rls';

describe('CreateUserLoginSchedules1789900003000', () => {
  it('up() creates table with tenant_id, user_id and enables FORCE RLS', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new CreateUserLoginSchedules1789900003000();
    await migration.up(runner);

    const createTable = queries.find((q) => q.includes('CREATE TABLE IF NOT EXISTS "user_login_schedules"'));
    expect(createTable).toBeDefined();
    expect(createTable).toContain('"tenant_id" uuid NOT NULL');
    expect(createTable).toContain('"user_id" uuid NOT NULL');
    expect(createTable).toContain('"timezone" varchar(64) NOT NULL DEFAULT \'Asia/Tehran\'');
    expect(createTable).toContain('"enforce_schedule" boolean NOT NULL DEFAULT true');
    expect(createTable).toContain('"windows" jsonb NOT NULL DEFAULT \'[]\'::jsonb');

    expect(queries).toContain('ALTER TABLE "user_login_schedules" ENABLE ROW LEVEL SECURITY');
    expect(queries).toContain('ALTER TABLE "user_login_schedules" FORCE ROW LEVEL SECURITY');
    expect(queries).toContain(
      `CREATE POLICY "user_login_schedules_tenant" ON "user_login_schedules" USING (${TENANT_MATCH}) WITH CHECK (${TENANT_MATCH})`,
    );
  });

  it('down() disables RLS and drops table', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new CreateUserLoginSchedules1789900003000();
    await migration.down(runner);

    expect(queries).toContain('DROP POLICY IF EXISTS "user_login_schedules_tenant" ON "user_login_schedules"');
    expect(queries).toContain('ALTER TABLE "user_login_schedules" NO FORCE ROW LEVEL SECURITY');
    expect(queries).toContain('ALTER TABLE "user_login_schedules" DISABLE ROW LEVEL SECURITY');
    expect(queries).toContain('DROP TABLE IF EXISTS "user_login_schedules"');
  });
});
