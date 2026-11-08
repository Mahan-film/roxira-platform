import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

export const DATA_IMPORT_AND_DAMAGES_RLS_TABLES = [
  'damage_calculations',
  'data_import_batch_items',
  'data_import_batches',
  'data_import_mapping_memory',
] as const;

export class EnableRlsDataImportAndDamages1789900001000 implements MigrationInterface {
  name = 'EnableRlsDataImportAndDamages1789900001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of DATA_IMPORT_AND_DAMAGES_RLS_TABLES) {
      await enableTenantRls(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...DATA_IMPORT_AND_DAMAGES_RLS_TABLES].reverse()) {
      await disableTenantRls(queryRunner, table);
    }
  }
}
