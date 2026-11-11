import { Injectable } from '@nestjs/common';
import { LoginTimeWindow, UserLoginScheduleEntity } from '../entities/user-login-schedule.entity';
import { TenantScope } from '../services/tenant-scope';

@Injectable()
export class LoginSchedulesRepository {
  constructor(private readonly scope: TenantScope) {}

  findByTenantUser(tenantId: string, userId: string): Promise<UserLoginScheduleEntity | null> {
    return this.scope.run(tenantId, (m) =>
      m.findOne(UserLoginScheduleEntity, { where: { tenantId, userId } }),
    );
  }

  saveSchedule(
    tenantId: string,
    userId: string,
    data: { timezone?: string; enforceSchedule?: boolean; windows?: LoginTimeWindow[] },
  ): Promise<UserLoginScheduleEntity> {
    return this.scope.run(tenantId, async (m) => {
      let schedule = await m.findOne(UserLoginScheduleEntity, { where: { tenantId, userId } });
      if (!schedule) {
        schedule = m.create(UserLoginScheduleEntity, {
          tenantId,
          userId,
          timezone: data.timezone ?? 'Asia/Tehran',
          enforceSchedule: data.enforceSchedule ?? true,
          windows: data.windows ?? [],
        });
      } else {
        if (data.timezone !== undefined) schedule.timezone = data.timezone;
        if (data.enforceSchedule !== undefined) schedule.enforceSchedule = data.enforceSchedule;
        if (data.windows !== undefined) schedule.windows = data.windows;
      }
      return m.save(UserLoginScheduleEntity, schedule);
    });
  }

  async removeSchedule(tenantId: string, userId: string): Promise<void> {
    await this.scope.run(tenantId, (m) =>
      m.delete(UserLoginScheduleEntity, { tenantId, userId }),
    );
  }
}
