import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * موجودیت انبار سازمانی — نگاشت مستقیم به جدول موجود `erp_warehouses`.
 *
 * تنها از طریق InventoryRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'erp_warehouses' })
@Index('IDX_erp_warehouses_tenant_name', ['tenantId', 'name'], {
  unique: true,
})
export class WarehouseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک انبار (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Index()
  @Column({ type: 'varchar', length: 50, name: 'location_code' })
  locationCode: string;

  /** Store (shop/branch) this warehouse belongs to; null for a stand-alone warehouse. */
  @Index()
  @Column({ type: 'int', name: 'store_id', nullable: true })
  storeId: number | null;

  /** An inactive warehouse takes no new movements and is hidden from pickers. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
