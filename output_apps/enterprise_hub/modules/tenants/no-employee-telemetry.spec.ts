import * as fs from 'fs';
import * as path from 'path';
import {
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { TenantMeResponseDto } from './dto/tenant-me-response.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { TenantEntity } from './entities/tenant.entity';
import { TenantRole } from './enums/tenant-role.enum';
import {
  EMPLOYEE_TELEMETRY_DISABLED_CODE,
  EmployeeTelemetryGuard,
} from './guards/employee-telemetry.guard';
import { TenantsService } from './services/tenants.service';

function makeContext(tenantId?: string | null): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: tenantId === undefined ? undefined : { tenantId },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('T265 tenant no-employee-telemetry mode (works-council safe)', () => {
  describe('UpdateTenantSettingsDto ValidationPipe (Lesson 26)', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    it('accepts boolean true and false', async () => {
      const enabled = await pipe.transform(
        { noEmployeeTelemetry: true },
        { type: 'body', metatype: UpdateTenantSettingsDto },
      );
      expect(enabled.noEmployeeTelemetry).toBe(true);

      const disabled = await pipe.transform(
        { noEmployeeTelemetry: false },
        { type: 'body', metatype: UpdateTenantSettingsDto },
      );
      expect(disabled.noEmployeeTelemetry).toBe(false);
    });

    it('rejects string "false" instead of coercing it to boolean true', async () => {
      await expect(
        pipe.transform(
          { noEmployeeTelemetry: 'false' },
          { type: 'body', metatype: UpdateTenantSettingsDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('EmployeeTelemetryGuard', () => {
    it('allows requests when noEmployeeTelemetry is false', async () => {
      const tenantsService = {
        findMyTenant: jest.fn().mockResolvedValue({
          id: 't-1',
          noEmployeeTelemetry: false,
        } as TenantEntity),
      } as unknown as TenantsService;
      const guard = new EmployeeTelemetryGuard(tenantsService);
      await expect(guard.canActivate(makeContext('t-1'))).resolves.toBe(true);
    });

    it('blocks requests with 403 EMPLOYEE_TELEMETRY_DISABLED when enabled', async () => {
      const tenantsService = {
        findMyTenant: jest.fn().mockResolvedValue({
          id: 't-1',
          noEmployeeTelemetry: true,
        } as TenantEntity),
      } as unknown as TenantsService;
      const guard = new EmployeeTelemetryGuard(tenantsService);
      await expect(guard.canActivate(makeContext('t-1'))).rejects.toThrow(
        ForbiddenException,
      );
      try {
        await guard.canActivate(makeContext('t-1'));
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: EMPLOYEE_TELEMETRY_DISABLED_CODE,
        });
      }
    });

    it('fails closed when tenantId or tenant record is missing', async () => {
      const tenantsService = {
        findMyTenant: jest.fn().mockResolvedValue(null),
      } as unknown as TenantsService;
      const guard = new EmployeeTelemetryGuard(tenantsService);
      await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(makeContext('t-missing'))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  it('TenantsService.updateSettings persists noEmployeeTelemetry and TenantMeResponseDto exposes it', async () => {
    const updatedTenant = {
      id: 't-1',
      name: 'DE-OPS GmbH',
      slug: 'de-ops',
      isActive: true,
      defaultVatRate: 0.19,
      countryCode: 'DE',
      packVersion: '1.0.0',
      bookCurrencyCode: 'EUR',
      defaultCalendar: 'gregorian',
      timezone: 'Europe/Berlin',
      locale: 'de-DE',
      fiscalYearStartMonth: 1,
      require2fa: false,
      noEmployeeTelemetry: true,
      createdAt: new Date(),
    } as TenantEntity;

    const repo = {
      updateSettings: jest.fn().mockResolvedValue(updatedTenant),
    };
    const packRegistry = { getOrThrow: jest.fn(), listSupported: jest.fn() };
    const service = new TenantsService(repo as never, packRegistry as never);
    const result = await service.updateSettings('t-1', {
      noEmployeeTelemetry: true,
    });
    expect(repo.updateSettings).toHaveBeenCalledWith('t-1', {
      noEmployeeTelemetry: true,
    });
    const dto = TenantMeResponseDto.fromEntity(result, TenantRole.OWNER);
    expect(dto.noEmployeeTelemetry).toBe(true);
  });

  it('migration 1789900014200 adds no_employee_telemetry with lock_timeout', () => {
    const migPath = path.resolve(
      __dirname,
      '../../migrations/1789900014200-AddTenantNoEmployeeTelemetryFlag.ts',
    );
    const sql = fs.readFileSync(migPath, 'utf8');
    expect(sql).toContain("SET LOCAL lock_timeout = '3s'");
    expect(sql).toContain('no_employee_telemetry');
    expect(sql).toContain('DEFAULT false');
  });
});
