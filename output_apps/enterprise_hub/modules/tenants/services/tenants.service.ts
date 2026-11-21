import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { TenantEntity } from '../entities/tenant.entity';
import { TenantsRepository } from '../repositories/tenants.repository';

/** حداکثر طول اسلاگ مطابق ستون `tenants.slug`. */
const SLUG_MAX_LENGTH = 80;

/** طول پسوند تصادفی کوتاه برای یکتایی اسلاگ. */
const SLUG_SUFFIX_LENGTH = 6;

/**
 * سرویس سازمان‌ها (مستأجرها).
 *
 * منطق کسب‌وکار کامل اینجا متمرکز است: ساخت اسلاگ یکتا از نام سازمان،
 * ایجاد/بازیابی مستأجر. (اعضا و نقش‌ها در ماژول access هستند.) Controller فقط مسیریابی و
 * Repository فقط پرسیستنس انجام می‌دهد (Rule #3 - AGENTS.md).
 */
@Injectable()
export class TenantsService {
  constructor(private readonly tenantsRepository: TenantsRepository) {}

  /** ایجاد سازمان جدید با اسلاگ یکتا ساخته‌شده از نام + پسوند تصادفی کوتاه. */
  async create(name: string): Promise<TenantEntity> {
    const trimmed = name.trim();
    return this.tenantsRepository.create({
      name: trimmed,
      slug: this.buildSlug(trimmed),
    });
  }

  async findById(id: string): Promise<TenantEntity | null> {
    return this.tenantsRepository.findById(id);
  }

  /** سازمان جاری کاربر بر اساس شناسه مستأجر تأییدشده JWT. */
  async findMyTenant(tenantId: string): Promise<TenantEntity | null> {
    return this.tenantsRepository.findById(tenantId);
  }

  /** به‌روزرسانی تنظیمات سازمان (نرخ پیش‌فرض VAT و بومی‌سازی شرکت). */
  async updateSettings(
    tenantId: string,
    dto: UpdateTenantSettingsDto,
  ): Promise<TenantEntity> {
    const fields: Partial<TenantEntity> = {};
    if (dto.defaultVatRate !== undefined) fields.defaultVatRate = dto.defaultVatRate;
    if (dto.countryCode !== undefined) fields.countryCode = dto.countryCode.toUpperCase();
    if (dto.bookCurrencyCode !== undefined) fields.bookCurrencyCode = dto.bookCurrencyCode.toUpperCase();
    if (dto.defaultCalendar !== undefined) fields.defaultCalendar = dto.defaultCalendar;
    if (dto.timezone !== undefined) fields.timezone = dto.timezone;
    if (dto.locale !== undefined) fields.locale = dto.locale;
    if (dto.fiscalYearStartMonth !== undefined) fields.fiscalYearStartMonth = dto.fiscalYearStartMonth;
    if (dto.noEmployeeTelemetry !== undefined) fields.noEmployeeTelemetry = dto.noEmployeeTelemetry;

    const tenant = await this.tenantsRepository.updateSettings(tenantId, fields);
    if (!tenant) {
      throw new NotFoundException('سازمانی برای حساب شما یافت نشد.');
    }
    return tenant;
  }

  /** تغییر نام سازمان (اسلاگ ثابت می‌ماند تا نشانی‌ها نشکنند). */
  async updateName(tenantId: string, name: string): Promise<TenantEntity | null> {
    return this.tenantsRepository.updateName(tenantId, name.trim());
  }

  /**
   * ساخت اسلاگ امن از نام سازمان.
   *
   * نام‌های غیرلاتین (مانند نام‌های فارسی) ممکن است اسلاگ خالی تولید کنند؛
   * در این حالت به `org` بازمی‌گردیم و همیشه یک پسوند تصادفی کوتاه می‌افزاییم
   * تا برخورد اسلاگ عملاً حذف شود.
   */
  private buildSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = randomBytes(4).toString('hex').slice(0, SLUG_SUFFIX_LENGTH);
    const prefix = base || 'org';
    const maxPrefixLength = SLUG_MAX_LENGTH - SLUG_SUFFIX_LENGTH - 1;
    return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
  }
}
