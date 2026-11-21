import { AddTagAndFirmUserIdToJournalEntries1789900015000 } from '../../migrations/1789900015000-AddTagAndFirmUserIdToJournalEntries';

describe('AddTagAndFirmUserIdToJournalEntries1789900015000', () => {
  it('instantiates and has matching migration name', () => {
    const migration = new AddTagAndFirmUserIdToJournalEntries1789900015000();
    expect(migration.name).toBe('AddTagAndFirmUserIdToJournalEntries1789900015000');
  });

  it('runs up() and down() SQL queries via QueryRunner mock', async () => {
    const queries: string[] = [];
    const mockQueryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    };

    const migration = new AddTagAndFirmUserIdToJournalEntries1789900015000();
    await migration.up(mockQueryRunner as any);
    expect(queries.some((q) => q.includes('ALTER TABLE "fin_journal_entries"') && q.includes('"tag"') && q.includes('"firm_user_id"'))).toBe(true);
    expect(queries.some((q) => q.includes('CREATE INDEX') && q.includes('"IDX_fin_journal_entries_tenant_tag"'))).toBe(true);

    queries.length = 0;
    await migration.down(mockQueryRunner as any);
    expect(queries.some((q) => q.includes('DROP INDEX') && q.includes('"IDX_fin_journal_entries_tenant_tag"'))).toBe(true);
    expect(queries.some((q) => q.includes('ALTER TABLE "fin_journal_entries"') && q.includes('DROP COLUMN'))).toBe(true);
  });
});
