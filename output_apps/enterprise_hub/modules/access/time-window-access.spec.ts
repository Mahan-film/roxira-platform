import { ForbiddenException } from '@nestjs/common';
import { LoginWindowService, UserLoginSchedule } from './services/login-window.service';

describe('Access by Time Window (#230 / T76)', () => {
  let service: LoginWindowService;

  beforeEach(() => {
    service = new LoginWindowService();
  });

  it('allows access when no schedule is configured or enforceSchedule is false', () => {
    expect(service.checkLoginWindow(null).allowed).toBe(true);
    expect(service.checkLoginWindow(undefined).allowed).toBe(true);

    const unenforced: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      enforceSchedule: false,
      windows: [],
    };
    expect(service.checkLoginWindow(unenforced).allowed).toBe(true);
  });

  it('fails closed when schedule is enforced but windows list is empty (Lesson 25)', () => {
    const emptyWindows: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      enforceSchedule: true,
      windows: [],
    };

    const res = service.checkLoginWindow(emptyWindows);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('هیچ بازه زمانی مجاز برای ورود به سیستم برای شما تعریف نشده است.');
  });

  it('allows login during an active time window', () => {
    // Window on Monday (day 1) from 08:00 (480) to 17:00 (1020)
    const schedule: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'UTC',
      enforceSchedule: true,
      windows: [
        { dayOfWeek: 1, startMinute: 480, endMinute: 1020 },
      ],
    };

    // 2026-11-09 is a Monday. 10:30 UTC = 10*60 + 30 = 630 min
    const dateInside = new Date(Date.UTC(2026, 10, 9, 10, 30, 0));
    const res = service.checkLoginWindow(schedule, dateInside);
    expect(res.allowed).toBe(true);
    expect(() => service.assertLoginWindow(schedule, dateInside)).not.toThrow();
  });

  it('denies login outside configured time windows with Persian message', () => {
    const schedule: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'UTC',
      enforceSchedule: true,
      windows: [
        { dayOfWeek: 1, startMinute: 480, endMinute: 1020 }, // Mon 08:00 - 17:00
      ],
    };

    // 2026-11-09 20:00 UTC (after 17:00)
    const dateAfter = new Date(Date.UTC(2026, 10, 9, 20, 0, 0));
    const res = service.checkLoginWindow(schedule, dateAfter);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('ورود به سیستم و تمدید نشست خارج از ساعات مجاز کاری امکان‌پذیر نیست.');

    expect(() => service.assertLoginWindow(schedule, dateAfter)).toThrow(ForbiddenException);
  });

  it('supports multiple windows across different days of the week', () => {
    const schedule: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'UTC',
      enforceSchedule: true,
      windows: [
        { dayOfWeek: 6, startMinute: 540, endMinute: 780 },  // Sat morning (09:00 - 13:00)
        { dayOfWeek: 6, startMinute: 960, endMinute: 1200 }, // Sat evening (16:00 - 20:00)
        { dayOfWeek: 0, startMinute: 540, endMinute: 1020 }, // Sun (09:00 - 17:00)
      ],
    };

    // Saturday 11:00 (inside first window)
    const sat11 = new Date(Date.UTC(2026, 10, 7, 11, 0, 0));
    expect(service.checkLoginWindow(schedule, sat11).allowed).toBe(true);

    // Saturday 14:30 (between windows)
    const sat14 = new Date(Date.UTC(2026, 10, 7, 14, 30, 0));
    expect(service.checkLoginWindow(schedule, sat14).allowed).toBe(false);

    // Saturday 18:00 (inside second window)
    const sat18 = new Date(Date.UTC(2026, 10, 7, 18, 0, 0));
    expect(service.checkLoginWindow(schedule, sat18).allowed).toBe(true);
  });
});
