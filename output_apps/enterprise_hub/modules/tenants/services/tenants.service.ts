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

  /** به‌روزرسانی تنظیمات سازمان (فعلاً نرخ پیش‌فرض VAT). */
  async updateSettings(
    tenantId: string,
    dto: UpdateTenantSettingsDto,
  ): Promise<TenantEntity> {
    const tenant = await this.tenantsRepository.updateDefaultVatRate(
      tenantId,
      dto.defaultVatRate,
    );
    if (!tenant) {
      throw new NotFoundException('سازمانی برای حساب شما یافت نشد.');
    }
    return tenant;
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
