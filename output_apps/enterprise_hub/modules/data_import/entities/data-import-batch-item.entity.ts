import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * ردیف‌های یک دسته ورود داده (Import Batch Item).
 *
 * برای هر ردیف درج‌شده یک نگاشت به شناسه ردیف جدول ماژول مالک (`owner_id`)
 * ذخیره می‌شود تا undo بتواند دقیقاً همان ردیف‌ها را برای همان مستأجر حذف کند.
 */
@Entity({ name: 'data_import_batch_items' })
@Index('IDX_data_import_batch_items_tenant_batch', ['tenantId', 'batchId'])
@Index('IDX_data_import_batch_items_tenant_owner', [
  'tenantId',
  'entity',
  'ownerId',
])
export class DataImportBatchItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'batch_id' })
  batchId: string;

  @Column({ type: 'varchar', length: 64 })
  entity: string;

  @Column({ type: 'integer', name: 'owner_id' })
  ownerId: number;

  @Column({ type: 'integer', name: 'row_number' })
  rowNumber: number;

  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
