import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { UserRole } from '../enums/user-role.enum';

/**
 * موجودیت کاربر پلتفرم روکسیرا.
 *
 * کاربر با تأیید موفق کد یک‌بارمصرف پیامکی (Kavenegar OTP) ایجاد/بازیابی
 * می‌شود. دسترسی مستقیم به این موجودیت فقط از طریق AuthRepository مجاز است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * شماره همراه ایران به شکل استاندارد 09xxxxxxxxx (یکتا). NULL برای حساب‌هایی
   * که با ایمیل/نام‌کاربری و رمز عبور ساخته شده‌اند (مثلاً roxira.net).
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 11, nullable: true })
  phone: string | null;

  /** Lowercase login name for password sign-in (unique, optional). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'username', nullable: true })
  username: string | null;

  /** Organisation that created this staff account and may reset its password; NULL for self-registered users. */
  @Column({ type: 'uuid', name: 'managed_by_tenant_id', nullable: true })
  managedByTenantId: string | null;

  /** Lowercase email used to sign in and to receive password resets (unique, optional). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 254, name: 'login_email', nullable: true })
  loginEmail: string | null;

  /** scrypt hash (`scrypt$N$r$p$salt$hash`); NULL when the user only uses SMS/passkey. */
  @Column({ type: 'text', name: 'password_hash', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'timestamp', name: 'password_updated_at', nullable: true })
  passwordUpdatedAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Index()
  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  /** آخرین دامنه‌ای که کاربر از آن وارد شده است (روکسیرا یا قاضی هوشمند). */
  @Index()
  @Column({
    type: 'enum',
    enum: AuthServiceDomain,
    default: AuthServiceDomain.ROXIRA,
  })
  serviceDomain: AuthServiceDomain;

  /**
   * شناسه سازمان (مستأجر) کاربر. NULL یعنی کاربر به هیچ سازمانی متصل نیست
   * (مانند کاربر قاضی هوشمند/ghazihoushmand). این ستون عمداً NULLپذیر است
   * چون جدول users با سامانه قاضی هوشمند مشترک است.
   */
  @Index()
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  /**
   * نقش کاربر درون سازمان (OWNER | MEMBER). کاملاً مستقل از نقش سراسری
   * `role`؛ اختیارات سازمانی فقط از این ستون می‌آید و هرگز `UserRole.ADMIN`
   * به بنیان‌گذار خودثبت‌نام داده نمی‌شود.
   */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'tenant_role',
    nullable: true,
  })
  tenantRole: TenantRole | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
