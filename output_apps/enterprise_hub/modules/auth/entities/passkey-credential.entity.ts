import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * موجودیت اعتبارنامه Passkey (WebAuthn Credential) کاربر.
 *
 * هر کاربر می‌تواند چند Passkey (بیومتریک یا سخت‌افزاری) ثبت کند.
 * کلید عمومی در قالب COSE ذخیره و در زمان احراز هویت برای بررسی امضای
 * چالش به کار می‌رود. دسترسی مستقیم فقط از طریق PasskeyRepository مجاز
 * است (Rule #3 — AGENTS.md).
 */
@Entity({ name: 'auth_passkey_credentials' })
export class PasskeyCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** شناسه یکتای اعتبارنامه (Credential ID، کدشده Base64URL). */
  @Index({ unique: true })
  @Column({ type: 'text', name: 'credential_id' })
  credentialId: string;

  /** کلید عمومی COSE کدشده Base64URL. */
  @Column({ type: 'text', name: 'public_key' })
  publicKey: string;

  /** الگوریتم امضا بر مبنای شناسه COSE (ES256=-7، RS256=-257). */
  @Column({ type: 'integer', name: 'public_key_alg' })
  publicKeyAlg: number;

  /** شمارنده امضا (Sign Count) برای تشخیص کلون‌شدن کلید. */
  @Column({ type: 'integer', name: 'sign_count', default: 0 })
  signCount: number;

  /** مسیرهای انتقال Authenticator (usb, nfc, ble, internal). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  transports: string | null;

  /** نوع دستگاه: singleDevice یا multiDevice (Passkey همگام‌شده). */
  @Column({ type: 'varchar', length: 32, name: 'device_type', nullable: true })
  deviceType: string | null;

  /** آیا اعتبارنامه پشتیبان‌گیری/همگام‌سازی شده است؟ */
  @Column({ type: 'boolean', name: 'backed_up', default: false })
  backedUp: boolean;

  /** برچسب اختیاری برای شناسایی دستگاه (مثلاً iPhone). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
