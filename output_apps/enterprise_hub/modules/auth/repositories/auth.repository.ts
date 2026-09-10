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

  async findByPhone(phone: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { phone } });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id } });
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
