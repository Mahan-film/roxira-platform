import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

export const INVENTORY_RLS_TABLES = [
  'erp_stock_document_lines',
  'erp_stock_documents',
  'erp_stock_items',
  'erp_stores',
  'erp_warehouses',
  'inventory_fifo_batches',
] as const;

export class EnableRlsInventory1789900001100 implements MigrationInterface {
  name = 'EnableRlsInventory1789900001100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of INVENTORY_RLS_TABLES) {
      await enableTenantRls(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...INVENTORY_RLS_TABLES].reverse()) {
      await disableTenantRls(queryRunner, table);
    }
  }
}
