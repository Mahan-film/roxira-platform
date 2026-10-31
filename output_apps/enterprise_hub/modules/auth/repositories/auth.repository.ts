import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { AuthServiceDomain } from '../enums/auth-service.enum';

/**
 * لایه Repository ماژول Auth — تنها نقطه دسترسی به جدول `users`.
 * Service و Controller هرگز مستقیماً به TypeORM دسترسی ندارند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class AuthRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.repository.update({ id }, { passwordHash, passwordUpdatedAt: new Date() });
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { username } });
  }

  async findByLoginEmail(loginEmail: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { loginEmail } });
  }

  /** Load a user together with `passwordHash` (a `select: false` column). */
  async findWithPasswordHash(
    where: { id: string } | { username: string } | { loginEmail: string },
  ): Promise<UserEntity | null> {
    return this.repository.findOne({
      where,
      select: {
        id: true,
        phone: true,
        username: true,
        loginEmail: true,
        displayName: true,
        email: true,
        role: true,
        serviceDomain: true,
        tenantId: true,
        tenantRole: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: true,
        passwordUpdatedAt: true,
      },
    });
  }

  async findByPhone(phone: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { phone } });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * فهرست کاربران یک سازمان (مستأجر). فقط کاربران همان `tenantId` بازگردانده
   * می‌شوند؛ جداسازی مستأجر در سطح کوئری تضمین می‌شود (Rule #4 - AGENTS.md).
   */
  async findByTenantId(tenantId: string): Promise<UserEntity[]> {
    return this.repository.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  async create(data: Partial<UserEntity>): Promise<UserEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async save(entity: UserEntity): Promise<UserEntity> {
    return this.repository.save(entity);
  }

  /**
   * ایجاد یا بازیابی کاربر بر اساس شماره همراه و به‌روزرسانی آخرین ورود.
   * (Upsert اتمیِ منطقی در سطح Service — بدون دسترسی مستقیم Controller).
   */
  async findOrCreateByPhone(
    phone: string,
    serviceDomain: AuthServiceDomain,
  ): Promise<{ user: UserEntity; created: boolean }> {
    const existing = await this.findByPhone(phone);

    if (existing) {
      existing.serviceDomain = serviceDomain;
      existing.lastLoginAt = new Date();
      const saved = await this.save(existing);
      return { user: saved, created: false };
    }

    const created = await this.create({
      phone,
      serviceDomain,
      lastLoginAt: new Date(),
    });
    return { user: created, created: true };
  }
}
