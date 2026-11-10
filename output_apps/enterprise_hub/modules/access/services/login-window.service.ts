import { ForbiddenException, Injectable } from '@nestjs/common';

export interface LoginTimeWindow {
  /** Day of week: 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday */
  dayOfWeek: number;
  /** Start time in minutes from midnight (e.g. 08:30 = 8*60 + 30 = 510) */
  startMinute: number;
  /** End time in minutes from midnight (e.g. 17:00 = 17*60 = 1020) */
  endMinute: number;
}

export interface UserLoginSchedule {
  userId: string;
  tenantId: string;
  /** Timezone name e.g. 'Asia/Tehran' or 'UTC' */
  timezone?: string;
  /** If true, login outside windows is strictly forbidden */
  enforceSchedule: boolean;
  /** Array of permitted time windows throughout the week */
  windows: LoginTimeWindow[];
}

export interface LoginWindowCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class LoginWindowService {
  /**
   * Evaluates whether a user is allowed to log in or refresh tokens at the given date/time.
   * Fails closed: if schedule enforcement is enabled and no matching window is active, access is denied.
   */
  checkLoginWindow(
    schedule: UserLoginSchedule | null | undefined,
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

    // Determine day of week and current minute in target timezone
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

      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? at.getUTCHours());
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? at.getUTCMinutes());
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
      dayOfWeek = weekdayMap[weekdayStr] ?? at.getUTCDay();
    } catch {
      // Fallback to UTC if timezone is invalid
      dayOfWeek = at.getUTCDay();
      currentMinute = at.getUTCHours() * 60 + at.getUTCMinutes();
    }

    // Check if current day and time falls within any configured window
    const inWindow = schedule.windows.some((w) => {
      if (w.dayOfWeek !== dayOfWeek) {
        return false;
      }
      return currentMinute >= w.startMinute && currentMinute <= w.endMinute;
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
  assertLoginWindow(schedule: UserLoginSchedule | null | undefined, at: Date = new Date()): void {
    const result = this.checkLoginWindow(schedule, at);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason);
    }
  }
}
