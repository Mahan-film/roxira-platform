// Migration file for CreateSalesInvoiceDeliveryLines
// This file creates the erp_sales_invoice_delivery_lines table (#563 T1 slice 4).

import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Link between an invoice line (an index into the invoice's `items` array) and the delivery line
 * it invoices. Purely additive: every column carries `tenant_id` and the table is created with
 * FORCE row-level security, so only a TenantScope transaction can touch it.
 */
export class CreateSalesInvoiceDeliveryLines1789600000002 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE erp_sales_invoice_delivery_lines (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        delivery_id INT NOT NULL REFERENCES erp_sales_deliveries(id),
        delivery_line_id INT NOT NULL REFERENCES erp_sales_delivery_lines(id) ON DELETE CASCADE,
        order_line_id INT NOT NULL REFERENCES erp_sales_order_lines(id),
        invoice_line_no INT NOT NULL CHECK (invoice_line_no >= 1),
        quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_erp_sales_invoice_delivery_lines_invoice_line
        ON erp_sales_invoice_delivery_lines (tenant_id, invoice_id, invoice_line_no)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_erp_sales_invoice_delivery_lines_tenant_delivery_line
        ON erp_sales_invoice_delivery_lines (tenant_id, delivery_line_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_erp_sales_invoice_delivery_lines_tenant_invoice
        ON erp_sales_invoice_delivery_lines (tenant_id, invoice_id)
    `);

    await enableTenantRls(queryRunner, 'erp_sales_invoice_delivery_lines');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await disableTenantRls(queryRunner, 'erp_sales_invoice_delivery_lines');
    await queryRunner.dropTable('erp_sales_invoice_delivery_lines');
  }
}
