import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_MODULE_KEY } from './decorators';
import { AccessGuard } from './access.guard';
import { AccessService } from './services/access.service';
import { LoginWindowService, UserLoginSchedule } from './services/login-window.service';
import { LoginSchedulesRepository } from './repositories/login-schedules.repository';

describe('Access by Time Window (#230 / T76)', () => {
  let service: LoginWindowService;
  let mockRepo: Partial<LoginSchedulesRepository>;

  beforeEach(() => {
    mockRepo = {
      findByTenantUser: jest.fn(),
      saveSchedule: jest.fn(),
      removeSchedule: jest.fn(),
    };
    service = new LoginWindowService(mockRepo as LoginSchedulesRepository);
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

  it('fails closed when timezone is invalid (Lesson 25)', () => {
    const invalidTz: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'Invalid/City_Nowhere',
      enforceSchedule: true,
      windows: [{ dayOfWeek: 1, startMinute: 480, endMinute: 1020 }],
    };

    const res = service.checkLoginWindow(invalidTz);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('منطقه زمانی نامعتبر');
    expect(() => service.assertLoginWindow(invalidTz)).toThrow(ForbiddenException);
  });

  it('calculates time correctly in Asia/Tehran timezone', () => {
    const schedule: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'Asia/Tehran',
      enforceSchedule: true,
      windows: [
        // Saturday (day 6) from 08:30 (510 min) to 16:30 (990 min)
        { dayOfWeek: 6, startMinute: 510, endMinute: 990 },
      ],
    };

    // 2026-11-07 06:00 UTC = 2026-11-07 09:30 Tehran time (Saturday, within window)
    const tehranMorning = new Date(Date.UTC(2026, 10, 7, 6, 0, 0));
    expect(service.checkLoginWindow(schedule, tehranMorning).allowed).toBe(true);

    // 2026-11-07 14:00 UTC = 2026-11-07 17:30 Tehran time (Saturday, after 16:30)
    const tehranEvening = new Date(Date.UTC(2026, 10, 7, 14, 0, 0));
    const eveningRes = service.checkLoginWindow(schedule, tehranEvening);
    expect(eveningRes.allowed).toBe(false);
    expect(eveningRes.reason).toBe('ورود به سیستم و تمدید نشست خارج از ساعات مجاز کاری امکان‌پذیر نیست.');
  });

  it('supports overnight windows that cross midnight', () => {
    const overnightSchedule: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'UTC',
      enforceSchedule: true,
      windows: [
        // Monday 22:00 (1320) to Tuesday 06:00 (360)
        { dayOfWeek: 1, startMinute: 1320, endMinute: 360 },
      ],
    };

    // Monday 23:30 UTC -> inside overnight window
    const monNight = new Date(Date.UTC(2026, 10, 9, 23, 30, 0));
    expect(service.checkLoginWindow(overnightSchedule, monNight).allowed).toBe(true);

    // Tuesday 04:00 UTC -> inside overnight window
    const tueEarly = new Date(Date.UTC(2026, 10, 10, 4, 0, 0));
    expect(service.checkLoginWindow(overnightSchedule, tueEarly).allowed).toBe(true);

    // Tuesday 07:00 UTC -> outside window
    const tueLate = new Date(Date.UTC(2026, 10, 10, 7, 0, 0));
    expect(service.checkLoginWindow(overnightSchedule, tueLate).allowed).toBe(false);
  });

  it('rejects windows with out-of-range bounds', () => {
    const badRangeSchedule: UserLoginSchedule = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      timezone: 'UTC',
      enforceSchedule: true,
      windows: [
        { dayOfWeek: 7, startMinute: 0, endMinute: 60 }, // dayOfWeek > 6
        { dayOfWeek: 1, startMinute: -1, endMinute: 60 }, // negative startMinute
        { dayOfWeek: 2, startMinute: 0, endMinute: 1500 }, // endMinute > 1439
      ],
    };

    const now = new Date();
    expect(service.checkLoginWindow(badRangeSchedule, now).allowed).toBe(false);
  });

  it('loads schedule from repository in assertAllowed', async () => {
    const mockRepo: Partial<LoginSchedulesRepository> = {
      findByTenantUser: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
        timezone: 'UTC',
        enforceSchedule: true,
        windows: [{ dayOfWeek: 1, startMinute: 480, endMinute: 1020 }],
      }),
    };

    const wiredService = new LoginWindowService(mockRepo as LoginSchedulesRepository);

    // Mon 10:00 UTC (inside)
    const inside = new Date(Date.UTC(2026, 10, 9, 10, 0, 0));
    await expect(wiredService.assertAllowed('tenant-1', 'user-1', inside)).resolves.not.toThrow();

    // Mon 18:00 UTC (outside)
    const outside = new Date(Date.UTC(2026, 10, 9, 18, 0, 0));
    await expect(wiredService.assertAllowed('tenant-1', 'user-1', outside)).rejects.toThrow(
      ForbiddenException,
    );
  });

  describe('AccessGuard wiring', () => {
    it('AccessGuard blocks execution when LoginWindowService denies access', async () => {
      const mockLoginWindow: Partial<LoginWindowService> = {
        assertAllowed: jest.fn().mockRejectedValue(new ForbiddenException('ساعات مجاز به پایان رسیده است')),
      };

      const mockAccessService: Partial<AccessService> = {
        isSessionActive: jest.fn().mockResolvedValue(true),
        resolve: jest.fn().mockResolvedValue({
          userId: 'user-1',
          tenantId: 'tenant-1',
          membershipId: 'm-1',
          roleKey: 'member',
          permissions: new Set(['inventory:read']),
          entitledModules: new Set(['inventory']),
          branchId: null,
          branchScoped: false,
          require2fa: false,
        }),
      };

      const reflector = new Reflector();
      const guard = new AccessGuard(
        reflector,
        mockAccessService as AccessService,
        mockLoginWindow as LoginWindowService,
      );

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            originalUrl: '/v1/inventory/items',
            user: { sub: 'user-1', tenantId: 'tenant-1', sid: 'sess-1' },
          }),
        }),
      } as any;

      // Mock reflector to return module access
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
        if (key === ACCESS_MODULE_KEY) return 'inventory';
        return undefined;
      });

      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
      expect(mockLoginWindow.assertAllowed).toHaveBeenCalledWith('tenant-1', 'user-1');
    });
  });

  describe('DTO Validation for Login Schedules', () => {
    it('validates IANA timezone and rejects invalid timezone strings', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { SetLoginScheduleDto } = await import('./dto/login-schedule.dto');

      const badDto = plainToInstance(SetLoginScheduleDto, {
        timezone: 'Invalid/Non_Existent_Zone',
        enforceSchedule: true,
        windows: [{ dayOfWeek: 1, startMinute: 480, endMinute: 960 }],
      });
      const errors = await validate(badDto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'timezone')).toBe(true);

      const goodDto = plainToInstance(SetLoginScheduleDto, {
        timezone: 'Asia/Tehran',
        enforceSchedule: true,
        windows: [{ dayOfWeek: 1, startMinute: 480, endMinute: 960 }],
      });
      const goodErrors = await validate(goodDto);
      expect(goodErrors.length).toBe(0);
    });

    it('rejects null timezone and trims whitespace', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { SetLoginScheduleDto } = await import('./dto/login-schedule.dto');

      const nullTz = plainToInstance(SetLoginScheduleDto, {
        timezone: null,
        windows: [{ dayOfWeek: 1, startMinute: 480, endMinute: 960 }],
      });
      const nullErrors = await validate(nullTz);
      expect(nullErrors.length).toBeGreaterThan(0);
      expect(nullErrors.some((e) => e.property === 'timezone')).toBe(true);

      const whitespaceTz = plainToInstance(SetLoginScheduleDto, {
        timezone: '  Asia/Tehran  ',
        windows: [{ dayOfWeek: 1, startMinute: 480, endMinute: 960 }],
      });
      const wsErrors = await validate(whitespaceTz);
      expect(wsErrors.length).toBe(0);
      expect(whitespaceTz.timezone).toBe('Asia/Tehran');
    });

    it('rejects windows where startMinute equals endMinute', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { LoginTimeWindowDto } = await import('./dto/login-schedule.dto');

      const equalWindow = plainToInstance(LoginTimeWindowDto, {
        dayOfWeek: 2,
        startMinute: 500,
        endMinute: 500,
      });
      const errors = await validate(equalWindow);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'endMinute')).toBe(true);
    });
  });

  describe('OrgController.setLoginSchedule lockout prevention', () => {
    it('prevents self-lockout or owner lockout even when enforceSchedule is omitted', async () => {
      const { OrgController } = await import('./controllers/org.controller');
      const { BadRequestException } = await import('@nestjs/common');

      const mockMembers = {
        list: jest.fn().mockResolvedValue([
          { userId: 'admin-1', roleKey: 'admin' },
          { userId: 'owner-1', roleKey: 'owner' },
        ]),
      };
      const mockLoginWindow = {
        findByTenantUser: jest.fn().mockResolvedValue(null),
        checkLoginWindow: jest.fn().mockReturnValue({ allowed: false, reason: 'outside window' }),
        saveSchedule: jest.fn(),
      };

      const controller = new OrgController(
        {} as never,
        mockMembers as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        mockLoginWindow as never,
      );

      const req = {
        access: {
          tenantId: 'tenant-1',
          userId: 'admin-1',
          roleKey: 'admin',
        },
      } as never;

      // Caller targeting self with empty/disallowed window and omitted enforceSchedule
      await expect(
        controller.setLoginSchedule(req, 'admin-1', { windows: [] }),
      ).rejects.toThrow(BadRequestException);

      // Caller targeting owner with empty/disallowed window and omitted enforceSchedule
      await expect(
        controller.setLoginSchedule(req, 'owner-1', { windows: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
