import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * موجودیت سازمان (مستأجر) — نگاشت مستقیم به جدول `tenants`.
 *
 * هر سازمان یک فضای داده‌ای جداگانه است و کاربران با `users.tenant_id` به آن
 * متصل می‌شوند. کاربر بدون سازمان (مثلاً کاربر قاضی هوشمند) مستأجر NULL دارد.
 *
 * دسترسی مستقیم به این موجودیت فقط از طریق TenantsRepository مجاز است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'tenants' })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  /**
   * @deprecated Not read by invoicing (#116, #126). The general VAT rate comes only from the
   * statutory store (`vat_general_rate`) by invoice date; an organisation overrides it with its
   * own row there. Kept (NOT NULL, default 0.1) for the settings API; do not read it anywhere new.
   */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 4,
    name: 'default_vat_rate',
    default: 0.1,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? 0.1 : Number(value)),
    },
  })
  defaultVatRate: number;

  /** ISO 3166-1 alpha-2 country of the organisation; selects the country pack. */
  @Column({ type: 'varchar', length: 2, name: 'country_code', default: 'IR' })
  countryCode: string;

  /** Semantic version of the country pack configured for this tenant. */
  @Column({ type: 'varchar', length: 20, name: 'pack_version', default: '1.0.0' })
  packVersion: string;

  /** ISO 4217 book currency code. Locked once a posted entry exists. */
  @Column({ type: 'varchar', length: 3, name: 'book_currency_code', default: 'IRR' })
  bookCurrencyCode: string;

  /** Presentation and fiscal calendar identifier ('jalali' | 'gregorian'). */
  @Column({ type: 'varchar', length: 20, name: 'default_calendar', default: 'jalali' })
  defaultCalendar: string;

  /** IANA time zone used to turn instants into civil dates. */
  @Column({ type: 'varchar', length: 50, name: 'timezone', default: 'Asia/Tehran' })
  timezone: string;

  /** BCP 47 primary locale code. */
  @Column({ type: 'varchar', length: 20, name: 'locale', default: 'fa-IR' })
  locale: string;

  /** Month (1..12) when the organisation's fiscal year begins. */
  @Column({ type: 'smallint', name: 'fiscal_year_start_month', default: 1 })
  fiscalYearStartMonth: number;

  @Column({ type: 'boolean', default: false, name: 'require_2fa' })
  require2fa: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
