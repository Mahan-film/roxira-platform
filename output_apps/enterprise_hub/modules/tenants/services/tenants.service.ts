import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { UserEntity } from '../../auth/entities/user.entity';
import { AuthServiceDomain } from '../../auth/enums/auth-service.enum';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { AddTenantMemberDto } from '../dto/add-tenant-member.dto';
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
 * ایجاد/بازیابی مستأجر و مدیریت اعضای سازمان. Controller فقط مسیریابی و
 * Repository فقط پرسیستنس انجام می‌دهد (Rule #3 - AGENTS.md).
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly tenantsRepository: TenantsRepository,
    private readonly authRepository: AuthRepository,
  ) {}

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

  /** فهرست اعضای سازمان؛ فقط کاربران همان مستأجر بازگردانده می‌شوند. */
  async listMembers(tenantId: string): Promise<UserEntity[]> {
    return this.authRepository.findByTenantId(tenantId);
  }

  /**
   * افزودن عضو به سازمان (find-or-create بر اساس شماره همراه).
   *
   * اگر شماره به سازمان دیگری تعلق داشته باشد با ۴۰۹ رد می‌شود؛ در غیر این
   * صورت `tenant_id` و `tenant_role` کاربر تنظیم می‌گردد. claimهای توکن در
   * ورود بعدی کاربر به‌روزرسانی می‌شوند.
   */
  async addMember(
    tenantId: string,
    dto: AddTenantMemberDto,
  ): Promise<UserEntity> {
    const existing = await this.authRepository.findByPhone(dto.phone);
    if (existing?.tenantId && existing.tenantId !== tenantId) {
      throw new ConflictException('این شماره عضو سازمان دیگری است.');
    }

    const { user } = await this.authRepository.findOrCreateByPhone(
      dto.phone,
      AuthServiceDomain.ROXIRA,
    );

    user.tenantId = tenantId;
    user.tenantRole = dto.tenantRole;
    return this.authRepository.save(user);
  }

  /**
   * حذف عضو از سازمان: فقط اعضای همان مستأجر، و مالک نمی‌تواند خودش را حذف
   * کند. عضویت با NULL کردن `tenant_id`/`tenant_role` قطع می‌شود (بدون حذف
   * کاربر، چون جدول users با سامانه قاضی هوشمند مشترک است).
   */
  async removeMember(
    tenantId: string,
    userId: string,
    callerUserId: string,
  ): Promise<void> {
    const user = await this.authRepository.findById(userId);
    if (!user || user.tenantId !== tenantId) {
      throw new NotFoundException('کاربر موردنظر عضو سازمان شما نیست.');
    }
    if (user.id === callerUserId) {
      throw new BadRequestException('امکان حذف خودتان از سازمان وجود ندارد.');
    }

    user.tenantId = null;
    user.tenantRole = null;
    await this.authRepository.save(user);
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
