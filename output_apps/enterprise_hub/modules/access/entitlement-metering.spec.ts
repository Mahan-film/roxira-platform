import 'reflect-metadata';
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { EntitlementService, USAGE_METERS, computePeriodKey } from './services/entitlement.service';
import { StructureService } from './services/structure.service';
import { AssistantService } from '../assistant/services/assistant.service';
import { CaptureService } from '../invoice_capture/services/capture.service';
import { TenantScope } from './services/tenant-scope';

const T1 = '11111111-1111-4111-8111-111111111111';

function makeMockScope(initialUsed = 0, planRow?: { plan_key: string; limits: Record<string, number>; rollover_day: number }) {
  let used = initialUsed;
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM tenant_plans')) {
        return planRow ? [planRow] : [];
      }
      if (sql.includes('FROM usage_counters')) {
        return [{ used }];
      }
      if (sql.includes('INSERT INTO usage_counters')) {
        return [];
      }
      if (sql.includes('UPDATE usage_counters') && sql.includes('RETURNING used')) {
        const n = Number(params[3]);
        const limit = Number(params[4]);
        if (used + n <= limit) {
          used += n;
          return [{ used }];
        }
        return [];
      }
      if (sql.includes('UPDATE usage_counters')) {
        const n = Number(params[3]);
        used = Math.max(0, used - n);
        return [];
      }
      return [];
    }),
  };
  return {
    scope: {
      within: jest.fn(async (_t: string, _u: unknown, fn: (m: typeof manager) => Promise<unknown>) => fn(manager)),
    } as unknown as TenantScope,
    getUsed: () => used,
  };
}

describe('EntitlementService & Metering Wiring (T145)', () => {
  it('supports all six required meters', () => {
    expect(USAGE_METERS).toEqual([
      'ai_messages',
      'ocr_pages',
      'voice_minutes',
      'branches',
      'office_users',
      'payroll_employees',
    ]);
  });

  it('computes monthly rollover period keys based on rolloverDay', () => {
    // rolloverDay = 15: Nov 14 belongs to 2026-10, Nov 15 belongs to 2026-11
    expect(computePeriodKey('ai_messages', new Date('2026-11-14T12:00:00Z'), 15)).toBe('2026-10');
    expect(computePeriodKey('ai_messages', new Date('2026-11-15T00:00:00Z'), 15)).toBe('2026-11');
    // Jan 5 with rolloverDay = 10 rolls back to 2025-12
    expect(computePeriodKey('ocr_pages', new Date('2026-01-05T00:00:00Z'), 10)).toBe('2025-12');
    // Capacity meters always use 'current'
    expect(computePeriodKey('branches', new Date('2026-11-15T00:00:00Z'), 15)).toBe('current');
  });

  it('fails closed on unknown meter or unknown plan', async () => {
    const { scope } = makeMockScope(0, { plan_key: 'nonexistent', limits: {}, rollover_day: 1 });
    const service = new EntitlementService(scope);
    await expect(service.check(T1, 'bogus_meter' as any)).rejects.toThrow(BadRequestException);
    await expect(service.check(T1, 'ai_messages')).rejects.toThrow(ForbiddenException);
  });

  it('checks and consumes up to limit, then throws limit reached', async () => {
    const { scope } = makeMockScope(0, { plan_key: 'starter', limits: { ai_messages: 2 }, rollover_day: 1 });
    const service = new EntitlementService(scope);

    const c1 = await service.check(T1, 'ai_messages', 1);
    expect(c1.allowed).toBe(true);
    expect(c1.remaining).toBe(2);

    const r1 = await service.consume(T1, 'ai_messages', 1);
    expect(r1.used).toBe(1);
    expect(r1.remaining).toBe(1);

    await service.consume(T1, 'ai_messages', 1);
    await expect(service.consume(T1, 'ai_messages', 1)).rejects.toThrow(/limit reached/i);
  });

  it('wires branch creation through EntitlementService.consume', async () => {
    const entitlements = { consume: jest.fn().mockRejectedValue(new HttpException('Usage limit reached for branches (limit: 2).', 429)) } as unknown as EntitlementService;
    const repo = { findBranch: jest.fn(), createBranch: jest.fn() } as any;
    const audit = { record: jest.fn() } as any;
    const structure = new StructureService(repo, audit, entitlements);

    await expect(structure.createBranch({ tenantId: T1, userId: 'u1' } as any, { name: 'شعبه ۲' })).rejects.toThrow(/limit reached/i);
    expect(repo.createBranch).not.toHaveBeenCalled();
  });

  it('releases consumed branch slot when repo.createBranch throws', async () => {
    const entitlements = {
      consume: jest.fn().mockResolvedValue({ allowed: true, meter: 'branches', periodKey: 'current', limit: 2, used: 1, remaining: 1 }),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntitlementService;
    const repo = {
      findBranch: jest.fn(),
      createBranch: jest.fn().mockRejectedValue(new Error('DB constraint error')),
    } as any;
    const audit = { record: jest.fn() } as any;
    const structure = new StructureService(repo, audit, entitlements);

    await expect(structure.createBranch({ tenantId: T1, userId: 'u1' } as any, { name: 'شعبه ۲' })).rejects.toThrow('DB constraint error');
    expect(entitlements.release).toHaveBeenCalledWith(T1, 'branches', 1);
  });

  it('wires assistant chat through EntitlementService.consume(ai_messages)', async () => {
    const entitlements = { consume: jest.fn().mockRejectedValue(new HttpException('Usage limit reached for ai_messages.', 429)) } as unknown as EntitlementService;
    const llm = { complete: jest.fn() } as any;
    const tools = { definitions: jest.fn() } as any;
    const rateLimiter = { consume: jest.fn().mockResolvedValue(undefined) } as any;
    const assistant = new AssistantService(llm, tools, rateLimiter, undefined, entitlements);

    await expect(
      assistant.chat({ user: { tenantId: T1, sub: 'u1' } } as any, { message: 'سلام' }),
    ).rejects.toThrow(/limit reached/i);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('wires OCR invoice capture through EntitlementService.consume(ocr_pages)', async () => {
    const entitlements = { consume: jest.fn().mockRejectedValue(new HttpException('Usage limit reached for ocr_pages.', 429)) } as unknown as EntitlementService;
    const repo = { findSettings: jest.fn().mockResolvedValue(null), usageSince: jest.fn().mockResolvedValue({ costUsd: 0, documents: 0 }) } as any;
    const llm = { extract: jest.fn() } as any;
    const accounting = {} as any;
    const capture = new CaptureService(repo, llm, accounting, entitlements);

    await expect(capture.create(T1, 'u1', undefined, { text: 'فاکتور شماره ۱' })).rejects.toThrow(/limit reached/i);
    expect(llm.extract).not.toHaveBeenCalled();
  });
});
