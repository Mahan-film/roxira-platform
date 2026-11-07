// Migration file for CreateSalesDeliveries
// This file creates the erp_sales_deliveries and erp_sales_delivery_lines tables

import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

export class CreateSalesDeliveries1789600000001 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE erp_sales_deliveries (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        number VARCHAR(40) NOT NULL,
        order_id INT NOT NULL REFERENCES erp_sales_orders(id),
        party_code VARCHAR(64) NOT NULL,
        warehouse_id INT NOT NULL,
        delivery_date DATE NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED')),
        idempotency_key VARCHAR(64) NULL,
        stock_document_id INT NULL,
        journal_entry_id INT NULL,
        total_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
        created_by VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_erp_sales_deliveries_tenant_number ON erp_sales_deliveries (tenant_id, number)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_erp_sales_deliveries_tenant_order ON erp_sales_deliveries (tenant_id, order_id)
    `);

    await queryRunner.query(`
      CREATE TABLE erp_sales_delivery_lines (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        delivery_id INT NOT NULL REFERENCES erp_sales_deliveries(id) ON DELETE CASCADE,
        line_no INT NOT NULL,
        order_line_id INT NOT NULL REFERENCES erp_sales_order_lines(id),
        item_id INT NOT NULL,
        sku VARCHAR(64) NOT NULL,
        quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
        line_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
        invoiced_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
        returned_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
        CHECK (invoiced_quantity >= 0 AND invoiced_quantity <= quantity),
        CHECK (returned_quantity >= 0 AND returned_quantity <= quantity)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_erp_sales_delivery_lines_delivery_no ON erp_sales_delivery_lines (delivery_id, line_no)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_erp_sales_delivery_lines_tenant_delivery ON erp_sales_delivery_lines (tenant_id, delivery_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_erp_sales_delivery_lines_tenant_order_line ON erp_sales_delivery_lines (tenant_id, order_line_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS IDX_erp_sales_deliveries_tenant_idempotency ON erp_sales_deliveries (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    `);

    await enableTenantRls(queryRunner, 'erp_sales_deliveries');
    await enableTenantRls(queryRunner, 'erp_sales_delivery_lines');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await disableTenantRls(queryRunner, 'erp_sales_delivery_lines');
    await disableTenantRls(queryRunner, 'erp_sales_deliveries');
    await queryRunner.dropTable('erp_sales_delivery_lines');
    await queryRunner.dropTable('erp_sales_deliveries');
  }
}
