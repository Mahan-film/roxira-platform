import { QueryRunner } from 'typeorm';
import {
  DATA_IMPORT_AND_DAMAGES_RLS_TABLES,
  EnableRlsDataImportAndDamages1789900001000,
} from '../../migrations/1789900001000-EnableRlsDataImportAndDamages';

describe('EnableRlsDataImportAndDamages1789900001000', () => {
  it('enables and forces RLS on all 4 data_import and damages tables and reverts cleanly', async () => {
    expect(DATA_IMPORT_AND_DAMAGES_RLS_TABLES).toEqual([
      'damage_calculations',
      'data_import_batch_items',
      'data_import_batches',
      'data_import_mapping_memory',
    ]);

    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsDataImportAndDamages1789900001000();
    await migration.up(runner);
    for (const table of DATA_IMPORT_AND_DAMAGES_RLS_TABLES) {
      expect(queries.some((q) => q.includes(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`))).toBe(
        true,
      );
    }

    queries.length = 0;
    await migration.down(runner);
    for (const table of DATA_IMPORT_AND_DAMAGES_RLS_TABLES) {
      expect(
        queries.some((q) => q.includes(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`)),
      ).toBe(true);
    }
  });
});
