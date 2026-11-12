import { ForbiddenException, Injectable } from '@nestjs/common';
import { SystemRole } from '../catalogue';
import { SetLoginScheduleDto } from '../dto/login-schedule.dto';
import { LoginTimeWindow, UserLoginScheduleEntity } from '../entities/user-login-schedule.entity';
import { LoginSchedulesRepository } from '../repositories/login-schedules.repository';

export { LoginTimeWindow };

export interface UserLoginSchedule {
  userId?: string;
  tenantId?: string;
  /** Timezone name e.g. 'Asia/Tehran' or 'UTC' */
  timezone?: string;
  /** If true, login outside windows is strictly forbidden */
  enforceSchedule?: boolean;
  /** Array of permitted time windows throughout the week */
  windows: LoginTimeWindow[];
}

export interface LoginWindowCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class LoginWindowService {
  constructor(
    private readonly repository: LoginSchedulesRepository,
  ) {}

  /**
   * Window ends are exclusive: 08:00-17:00 allows 16:59 and refuses 17:00.
   * Evaluates whether a user is allowed to log in, refresh tokens, or call APIs at the given date/time.
   * Fails closed: if schedule enforcement is enabled and no matching window is active, access is denied (Lesson 25).
   */
  checkLoginWindow(
    schedule: UserLoginSchedule | UserLoginScheduleEntity | null | undefined,
    at: Date = new Date(),
  ): LoginWindowCheckResult {
    // If no schedule configured or enforcement is explicitly disabled, allow
    if (!schedule || !schedule.enforceSchedule) {
      return { allowed: true };
    }

    // If schedule is enforced but windows array is empty, fail closed (Lesson 25)
    if (!schedule.windows || schedule.windows.length === 0) {
      return {
        allowed: false,
        reason: 'هیچ بازه زمانی مجاز برای ورود به سیستم برای شما تعریف نشده است.',
      };
    }

    // Determine target timezone and validate strictly (fail closed on invalid timezone)
    const tz = schedule.timezone || 'Asia/Tehran';
    let dayOfWeek: number;
    let currentMinute: number;

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
      }).formatToParts(at);

      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      currentMinute = hour * 60 + minute;

      const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      if (weekdayMap[weekdayStr] === undefined) {
        return {
          allowed: false,
          reason: `روز هفته نامعتبر در منطقه زمانی: ${tz}`,
        };
      }
      dayOfWeek = weekdayMap[weekdayStr];
    } catch {
      // Invalid/unknown timezone: fail closed (Lesson 25)
      return {
        allowed: false,
        reason: `منطقه زمانی نامعتبر است: ${tz}`,
      };
    }

    // Check if current day and time falls within any configured window
    const inWindow = schedule.windows.some((w) => {
      // Range check on window parameters
      if (
        w.dayOfWeek < 0 ||
        w.dayOfWeek > 6 ||
        w.startMinute < 0 ||
        w.startMinute > 1439 ||
        w.endMinute < 0 ||
        w.endMinute > 1439
      ) {
        return false;
      }

      if (w.startMinute <= w.endMinute) {
        // Standard single-day window
        return (
          w.dayOfWeek === dayOfWeek &&
          currentMinute >= w.startMinute &&
          currentMinute < w.endMinute
        );
      } else {
        // Overnight window that crosses midnight into the next day (e.g. 22:00 -> 06:00)
        const startsToday = w.dayOfWeek === dayOfWeek && currentMinute >= w.startMinute;
        const endsToday = (w.dayOfWeek + 1) % 7 === dayOfWeek && currentMinute < w.endMinute;
        return startsToday || endsToday;
      }
    });

    if (!inWindow) {
      return {
        allowed: false,
        reason: 'ورود به سیستم و تمدید نشست خارج از ساعات مجاز کاری امکان‌پذیر نیست.',
      };
    }

    return { allowed: true };
  }

  /**
   * Asserts login window or throws ForbiddenException.
   */
  assertLoginWindow(
    schedule: UserLoginSchedule | UserLoginScheduleEntity | null | undefined,
    at: Date = new Date(),
  ): void {
    const result = this.checkLoginWindow(schedule, at);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason);
    }
  }

  /**
   * Validates schedule in database for (tenantId, userId) and asserts access.
   * Organization OWNER role is always exempt from login schedule lockouts to ensure
   * a permanent administrative recovery/break-glass path is guaranteed (#738).
   */
  async assertAllowed(
    tenantId: string,
    userId: string,
    at: Date = new Date(),
    roleKey?: string,
  ): Promise<void> {
    if (roleKey === SystemRole.OWNER) {
      return;
    }
    const schedule = await this.repository.findByTenantUser(tenantId, userId);
    if (schedule && schedule.enforceSchedule) {
      this.assertLoginWindow(schedule, at);
    }
  }

  /** Find stored schedule for user. */
  async findByTenantUser(tenantId: string, userId: string): Promise<UserLoginScheduleEntity | null> {
    return this.repository.findByTenantUser(tenantId, userId);
  }

  /** Save or update schedule for user. */
  async saveSchedule(
    tenantId: string,
    userId: string,
    dto: SetLoginScheduleDto,
  ): Promise<UserLoginScheduleEntity> {
    return this.repository.saveSchedule(tenantId, userId, dto);
  }
}
