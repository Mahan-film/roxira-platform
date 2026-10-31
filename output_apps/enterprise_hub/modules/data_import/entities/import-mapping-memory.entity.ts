import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * حافظهٔ نگاشت هر مستأجر: امضای سربرگ‌های یک جدول → موجودیت + نگاشت ستون به فیلد.
 * فقط نام ستون/فیلد ذخیره می‌شود (هیچ مقدار داده‌ای نه). `tenant_id` از توکن تأییدشده می‌آید.
 */
@Entity({ name: 'data_import_mapping_memory' })
@Index('UQ_import_mapping_memory_tenant_signature', ['tenantId', 'signature'], { unique: true })
export class ImportMappingMemoryEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  signature: string;

  @Column({ type: 'varchar', length: 64 })
  entity: string;

  @Column({ type: 'jsonb' })
  mapping: Record<string, string | null>;

  @Column({ type: 'integer', default: 1 })
  uses: number;

  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
