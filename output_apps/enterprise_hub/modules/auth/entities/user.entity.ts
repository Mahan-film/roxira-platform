import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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

  /** شماره همراه ایران به شکل استاندارد 09xxxxxxxxx (یکتا). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 11 })
  phone: string;

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

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
