import { QueryRunner } from 'typeorm';
import { AddTagAndFirmUserIdToJournalEntries1789900019200 } from '../../migrations/1789900019200-AddTagAndFirmUserIdToJournalEntries';

describe('AddTagAndFirmUserIdToJournalEntries1789900019200', () => {
  it('adds tag, firm_user_id, adjustment_period_open, and partial index on up()', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as unknown as QueryRunner;

    const migration = new AddTagAndFirmUserIdToJournalEntries1789900019200();
    await migration.up(runner);

    const joined = queries.join('\n');
    expect(joined).toContain('SET LOCAL lock_timeout');
    expect(joined).toContain('ADD COLUMN IF NOT EXISTS "tag" character varying(64)');
    expect(joined).toContain('ADD COLUMN IF NOT EXISTS "firm_user_id" uuid');
    expect(joined).toContain('ADD COLUMN IF NOT EXISTS "adjustment_period_open" boolean NOT NULL DEFAULT false');
    expect(joined).toContain('IDX_fin_journal_entries_tenant_tag');
    expect(joined).toContain('WHERE "tag" IS NOT NULL');
  });

  it('drops index and added columns on down()', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as unknown as QueryRunner;

    const migration = new AddTagAndFirmUserIdToJournalEntries1789900019200();
    await migration.down(runner);

    const joined = queries.join('\n');
    expect(joined).toContain('DROP INDEX IF EXISTS "IDX_fin_journal_entries_tenant_tag"');
    expect(joined).toContain('DROP COLUMN IF EXISTS "adjustment_period_open"');
    expect(joined).toContain('DROP COLUMN IF EXISTS "firm_user_id"');
    expect(joined).toContain('DROP COLUMN IF EXISTS "tag"');
  });
});
