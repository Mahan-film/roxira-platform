import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MoadianSettlementMethod } from '../enums/moadian.enum';

/**
 * اطلاعات اتصال هر مستأجر به سامانه مودیان (یک ردیف برای هر مستأجر).
 *
 * - `memoryId`: شناسه یکتای حافظه مالیاتی ۶ کاراکتری (از کارپوشه).
 * - `privateKeySealed`: کلید خصوصی RSA، رمزشده با AES-256-GCM
 *   (`utils/secret-box.util.ts`، AAD = tenantId)؛ هرگز متن ساده ذخیره نمی‌شود و
 *   به‌صورت پیش‌فرض از SELECT حذف است.
 * - `nextSerial`: شمارنده سریال داخلی صورتحساب (بخش ۱۰ هگز taxid).
 *
 * فقط از طریق MoadianRepository (با قید tenant_id) قابل دسترسی است.
 */
@Entity({ name: 'moadian_credentials' })
@Index('IDX_moadian_credentials_tenant', ['tenantId'], { unique: true })
export class MoadianCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 6, name: 'memory_id' })
  memoryId: string;

  @Column({ type: 'varchar', length: 14, name: 'economic_code' })
  economicCode: string;

  @Column({ type: 'text', name: 'certificate_pem' })
  certificatePem: string;

  @Column({ type: 'text', name: 'private_key_sealed', select: false })
  privateKeySealed: string;

  @Column({ type: 'varchar', length: 128, name: 'key_fingerprint' })
  keyFingerprint: string;

  @Column({ type: 'varchar', length: 13, name: 'default_sstid', nullable: true })
  defaultSstid: string | null;

  @Column({ type: 'varchar', length: 16, name: 'default_measurement_unit', nullable: true })
  defaultMeasurementUnit: string | null;

  @Column({
    type: 'smallint',
    name: 'settlement_method',
    default: MoadianSettlementMethod.CASH,
  })
  settlementMethod: MoadianSettlementMethod;

  @Column({ type: 'bigint', name: 'next_serial', default: 1 })
  nextSerial: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
