import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PrintDocType, PrintPaperSize } from '../enums/print-template.enum';

export interface PrintColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  widthPercent?: number;
}

export interface PrintTemplateOptions {
  barcodeColumns?: 4 | 5;
  showPrice?: boolean;
  showSku?: boolean;
  headerNotes?: string;
  footerNotes?: string;
  showSignatures?: boolean;
  signatures?: string[];
  [key: string]: any;
}

/**
 * قالب‌های چاپ سفارشی سازمانی (T81 / Print Form Builder).
 *
 * مشخصات و فیلدهای چاپ فاکتور فروش، اسناد خزانه‌داری، حواله‌های انبار
 * و برچسب‌های بارکد ۴ و ۵ ستونه را با اعمال RLS برای هر سازمان ذخیره می‌کند.
 */
@Entity({ name: 'inv_print_templates' })
@Unique('UQ_inv_print_templates_tenant_title', ['tenantId', 'title'])
@Index('IDX_inv_print_templates_lookup', ['tenantId', 'docType', 'paperSize'])
@Index('IDX_inv_print_templates_tenant_default', ['tenantId', 'docType', 'isDefault'])
@Index('UQ_inv_print_templates_tenant_default', ['tenantId', 'docType', 'paperSize'], {
  unique: true,
  where: 'is_default = true',
})
export class PrintTemplateEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'doc_type',
  })
  docType: PrintDocType;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'paper_size',
  })
  paperSize: PrintPaperSize;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', name: 'show_logo', default: true })
  showLogo: boolean;

  @Column({ type: 'varchar', length: 512, name: 'logo_url', nullable: true })
  logoUrl: string | null;

  @Column({
    type: 'jsonb',
    name: 'columns_config',
    default: () => "'[]'::jsonb",
  })
  columnsConfig: PrintColumnConfig[];

  @Column({
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  options: PrintTemplateOptions;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
