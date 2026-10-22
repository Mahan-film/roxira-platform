import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * دسته ورود داده (Import Batch).
 *
 * هر بار commit یک ردیف در این جدول می‌سازد تا کل ورود (همه ردیف‌های درج‌شده
 * در یک فایل) با یک شناسه قابل undo باشد. `tenant_id` تنها از توکن تأییدشده
 * پر می‌شود و همه کوئری‌ها با قید مستأجر انجام می‌گیرند (Rule #4 - AGENTS.md).
 */
@Entity({ name: 'data_import_batches' })
@Index('IDX_data_import_batches_tenant_created', ['tenantId', 'createdAt'])
export class DataImportBatchEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  entity: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName: string;

  @Column({ type: 'integer', default: 0 })
  inserted: number;

  @Column({ type: 'boolean', default: false })
  undone: boolean;

  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
