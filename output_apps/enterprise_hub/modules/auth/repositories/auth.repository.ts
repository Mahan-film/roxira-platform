import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserEntity } from '../entities/user.entity';
import { AuthServiceDomain } from '../enums/auth-service.enum';

/**
 * لایه Repository ماژول Auth — تنها نقطه دسترسی به جدول `users`.
 * Service و Controller هرگز مستقیماً به TypeORM دسترسی ندارند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class AuthRepository {
  private readonly logger = new Logger(AuthRepository.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.repository.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.user_id', $1, true)`, [id]);
      await m.update(UserEntity, { id }, { passwordHash, passwordUpdatedAt: new Date() });
    });
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    try {
      const rows = await this.repository.query(
        `SELECT * FROM public.lookup_user_by_username($1)`,
        [username],
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repository.create({
          id: r.id,
          phone: r.phone,
          username: r.username,
          managedByTenantId: r.managed_by_tenant_id ?? null,
          loginEmail: r.login_email,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          serviceDomain: r.service_domain,
          tenantId: r.tenant_id,
          tenantRole: r.tenant_role,
          isActive: r.is_active,
          lastLoginAt: r.last_login_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        } as UserEntity);
      }
      return null;
    } catch (err) {
      this.logger.error(`lookup_user_by_username error for ${username}: ${err}`);
      throw err;
    }
  }

  async findByLoginEmail(loginEmail: string): Promise<UserEntity | null> {
    try {
      const rows = await this.repository.query(
        `SELECT * FROM public.lookup_user_by_login_email($1)`,
        [loginEmail],
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repository.create({
          id: r.id,
          phone: r.phone,
          username: r.username,
          managedByTenantId: r.managed_by_tenant_id ?? null,
          loginEmail: r.login_email,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          serviceDomain: r.service_domain,
          tenantId: r.tenant_id,
          tenantRole: r.tenant_role,
          isActive: r.is_active,
          lastLoginAt: r.last_login_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        } as UserEntity);
      }
      return null;
    } catch (err) {
      this.logger.error(`lookup_user_by_login_email error for ${loginEmail}: ${err}`);
      throw err;
    }
  }

  /** Load a user together with `passwordHash` (a `select: false` column). */
  async findWithPasswordHash(
    where: { id: string } | { username: string } | { loginEmail: string },
  ): Promise<UserEntity | null> {
    try {
      let rows: any[] = [];
      if ('id' in where) {
        rows = await this.repository.query(
          `SELECT * FROM public.lookup_user_by_id_with_password($1)`,
          [where.id],
        );
      } else if ('username' in where) {
        rows = await this.repository.query(
          `SELECT * FROM public.lookup_user_by_username($1)`,
          [where.username],
        );
      } else if ('loginEmail' in where) {
        rows = await this.repository.query(
          `SELECT * FROM public.lookup_user_by_login_email($1)`,
          [where.loginEmail],
        );
      }
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repository.create({
          id: r.id,
          phone: r.phone,
          username: r.username,
          managedByTenantId: r.managed_by_tenant_id ?? null,
          loginEmail: r.login_email,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          serviceDomain: r.service_domain,
          tenantId: r.tenant_id,
          tenantRole: r.tenant_role,
          isActive: r.is_active,
          lastLoginAt: r.last_login_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          passwordHash: r.password_hash,
          passwordUpdatedAt: r.password_updated_at,
        } as UserEntity);
      }
      return null;
    } catch (err) {
      this.logger.error(`findWithPasswordHash error: ${err}`);
      throw err;
    }
  }

  async findByPhone(phone: string): Promise<UserEntity | null> {
    try {
      const rows = await this.repository.query(
        `SELECT * FROM public.lookup_user_by_phone($1)`,
        [phone],
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repository.create({
          id: r.id,
          phone: r.phone,
          username: r.username,
          managedByTenantId: r.managed_by_tenant_id ?? null,
          loginEmail: r.login_email,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          serviceDomain: r.service_domain,
          tenantId: r.tenant_id,
          tenantRole: r.tenant_role,
          isActive: r.is_active,
          lastLoginAt: r.last_login_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        } as UserEntity);
      }
      return null;
    } catch (err) {
      this.logger.error(`lookup_user_by_phone error for ${phone}: ${err}`);
      throw err;
    }
  }

  async findById(id: string): Promise<UserEntity | null> {
    try {
      const rows = await this.repository.query(
        `SELECT * FROM public.lookup_user_by_id($1)`,
        [id],
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        return this.repository.create({
          id: r.id,
          phone: r.phone,
          username: r.username,
          managedByTenantId: r.managed_by_tenant_id ?? null,
          loginEmail: r.login_email,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          serviceDomain: r.service_domain,
          tenantId: r.tenant_id,
          tenantRole: r.tenant_role,
          isActive: r.is_active,
          lastLoginAt: r.last_login_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        } as UserEntity);
      }
      return null;
    } catch (err) {
      this.logger.error(`lookup_user_by_id error for ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * فهرست کاربران یک سازمان (مستأجر). فقط کاربران همان `tenantId` بازگردانده
   * می‌شوند؛ جداسازی مستأجر در سطح کوئری تضمین می‌شود (Rule #4 - AGENTS.md).
   */
  async findByTenantId(tenantId: string): Promise<UserEntity[]> {
    return this.repository.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return m.find(UserEntity, {
        where: { tenantId },
        order: { createdAt: 'ASC' },
      });
    });
  }

  async create(data: Partial<UserEntity>): Promise<UserEntity> {
    const entity = this.repository.create(data);
    if (!entity.id) {
      entity.id = randomUUID();
    }
    return this.save(entity);
  }

  async save(entity: UserEntity): Promise<UserEntity> {
    if (!entity.id) {
      entity.id = randomUUID();
    }
    return this.repository.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.user_id', $1, true)`, [entity.id]);
      if (entity.tenantId) {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [entity.tenantId]);
      }
      return m.save(entity);
    });
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
