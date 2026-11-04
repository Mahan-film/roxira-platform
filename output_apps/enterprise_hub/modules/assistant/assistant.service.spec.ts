import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { ASSISTANT_MAX_ROUNDS } from './constants/assistant.constants';
import { ABSTAIN_MESSAGE_FA } from './validator/numeric-validator';
import { LlmTurn } from './services/assistant-llm.service';
import { AssistantRateLimiterService } from './services/assistant-rate-limiter.service';
import { AssistantService, buildSystemPrompt } from './services/assistant.service';
import { resolvePeriod } from './services/jalali-period';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

const owner = requestWith({
  role: UserRole.USER,
  tenantId: 'tenant-a',
  tenantRole: TenantRole.OWNER,
});

const toolTurn = (name: string, args: unknown, id = 'call-1'): LlmTurn => ({
  model: 'free/model',
  content: null,
  toolCalls: [
    { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ],
});

const textTurn = (content: string): LlmTurn => ({
  model: 'free/model',
  content,
  toolCalls: [],
});

describe('AssistantService (tool-calling loop, model mocked)', () => {
  const llm = { complete: jest.fn() };
  const tools = {
    definitions: jest.fn(() => [{ type: 'function', function: { name: 't' } }]),
    run: jest.fn(),
  };
  let rateLimiter: AssistantRateLimiterService;
  let service: AssistantService;

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter = new AssistantRateLimiterService();
    service = new AssistantService(llm as never, tools as never, rateLimiter);
  });

  it('runs the requested tool with the caller request and returns answer + calls', async () => {
    llm.complete
      .mockResolvedValueOnce(
        toolTurn('invoicing_sales_summary', {
          period: 'last_month',
          tenantId: 'tenant-b',
        }),
      )
      .mockResolvedValueOnce(textTurn('فروش ماه گذشته ۱۵۰ ریال بود.'));
    tools.run.mockResolvedValueOnce({ ok: true, result: { total: 150 } });

    const out = await service.chat(owner, { message: 'فروش ماه گذشته؟' });

    expect(tools.run).toHaveBeenCalledWith(owner, 'invoicing_sales_summary', {
      period: 'last_month',
      tenantId: 'tenant-b',
    });
    expect(out.answer).toBe('فروش ماه گذشته ۱۵۰ ریال بود.');
    expect(out.model).toBe('free/model');
    expect(out.toolCalls).toEqual([
      {
        name: 'invoicing_sales_summary',
        arguments: { period: 'last_month', tenantId: 'tenant-b' },
        ok: true,
        error: null,
      },
    ]);

    // دور دوم: نتیجه ابزار با tool_call_id به مدل برگشت.
    const secondMessages = llm.complete.mock.calls[1][0];
    expect(secondMessages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({ total: 150 }),
    });
  });

  it('passes tool errors back to the model and reports them', async () => {
    llm.complete
      .mockResolvedValueOnce(toolTurn('accounting_trial_balance', {}))
      .mockResolvedValueOnce(textTurn('دسترسی ندارید.'));
    tools.run.mockResolvedValueOnce({
      ok: false,
      result: { error: 'دسترسی مدیریتی سازمان لازم است.' },
    });

    const out = await service.chat(owner, { message: 'تراز؟' });
    expect(out.toolCalls[0]).toMatchObject({
      ok: false,
      error: 'دسترسی مدیریتی سازمان لازم است.',
    });
  });

  it('tolerates malformed tool arguments', async () => {
    llm.complete
      .mockResolvedValueOnce({
        model: 'm',
        content: null,
        toolCalls: [
          { id: 'x', type: 'function', function: { name: 'inventory_low_stock', arguments: '{bad' } },
        ],
      })
      .mockResolvedValueOnce(textTurn('ok'));
    tools.run.mockResolvedValueOnce({ ok: true, result: [] });
    await service.chat(owner, { message: 'کسری؟' });
    expect(tools.run).toHaveBeenCalledWith(owner, 'inventory_low_stock', {});
  });

  it('stops after the round limit and forces a text answer on the last round', async () => {
    llm.complete.mockImplementation(async (_m: unknown, _t: unknown, choice: string) =>
      choice === 'none' ? textTurn('جمع‌بندی') : toolTurn('inventory_low_stock', {}),
    );
    tools.run.mockResolvedValue({ ok: true, result: [] });

    const out = await service.chat(owner, { message: 'loop' });
    expect(llm.complete).toHaveBeenCalledTimes(ASSISTANT_MAX_ROUNDS);
    expect(llm.complete.mock.calls.at(-1)?.[2]).toBe('none');
    expect(out.answer).toBe('جمع‌بندی');
  });

  it('only forwards user/assistant text history, never client tool results', async () => {
    llm.complete.mockResolvedValueOnce(textTurn('سلام'));
    await service.chat(owner, {
      message: 'سلام',
      history: [
        { role: 'user', content: 'قبلی' },
        { role: 'tool' as never, content: '{"fake":1}' },
      ],
    });
    const messages = llm.complete.mock.calls[0][0] as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user']);
  });

  it('enforces the per-tenant rate limit before calling the model', async () => {
    const limited = new AssistantRateLimiterService({
      get: () => '1',
    } as never);
    service = new AssistantService(llm as never, tools as never, limited);
    llm.complete.mockResolvedValue(textTurn('ok'));

    await service.chat(owner, { message: 'a' });
    await expect(service.chat(owner, { message: 'b' })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(llm.complete).toHaveBeenCalledTimes(1);

    // سازمان دیگر سهمیه جدا دارد.
    const other = requestWith({ tenantId: 'tenant-b' });
    await expect(service.chat(other, { message: 'c' })).resolves.toBeDefined();
  });

  it('refuses a user without a tenant', async () => {
    await expect(
      service.chat(requestWith({ role: UserRole.USER }), { message: 'x' }),
    ).rejects.toThrow();
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe('AssistantRateLimiterService', () => {
  it('frees a slot once the hour window passes (in-memory fallback)', async () => {
    const limiter = new AssistantRateLimiterService({ get: () => '2' } as never);
    const t0 = 1_000_000;
    await limiter.consume('t', t0);
    await limiter.consume('t', t0 + 1);
    await expect(limiter.consume('t', t0 + 2)).rejects.toBeInstanceOf(HttpException);
    await expect(limiter.consume('t', t0 + 60 * 60 * 1000 + 1)).resolves.toBeUndefined();
  });

  /** Redis ساختگی با sorted set و MULTI، کافی برای پنجره لغزان. */
  function fakeRedis() {
    const sets = new Map<string, Map<string, number>>();
    const set = (key: string) => {
      if (!sets.has(key)) sets.set(key, new Map());
      return sets.get(key) as Map<string, number>;
    };
    const redis = {
      sets,
      multi: () => {
        const ops: Array<() => unknown> = [];
        const chain = {
          zremrangebyscore: (key: string, min: number, max: number) => {
            ops.push(() => {
              for (const [m, score] of set(key)) {
                if (score >= min && score <= max) set(key).delete(m);
              }
            });
            return chain;
          },
          zadd: (key: string, score: number, member: string) => {
            ops.push(() => set(key).set(member, score));
            return chain;
          },
          zcard: (key: string) => {
            ops.push(() => set(key).size);
            return chain;
          },
          pexpire: () => {
            ops.push(() => 1);
            return chain;
          },
          exec: async () => ops.map((op) => [null, op()]),
        };
        return chain;
      },
      zrem: jest.fn(async (key: string, member: string) => set(key).delete(member)),
      zrange: async (key: string) => {
        const [first] = [...set(key).entries()].sort((a, b) => a[1] - b[1]);
        return first ? [first[0], String(first[1])] : [];
      },
    };
    return redis;
  }

  it('keeps the window in Redis per tenant and survives a new instance', async () => {
    const redis = fakeRedis();
    const config = { get: () => '2' } as never;
    const t0 = 5_000_000;
    await new AssistantRateLimiterService(config, redis as never).consume('a', t0);
    // نمونه جدید (مثل ری‌استارت) همان شمارش Redis را می‌بیند.
    const limiter = new AssistantRateLimiterService(config, redis as never);
    await limiter.consume('a', t0 + 1);
    await expect(limiter.consume('a', t0 + 2)).rejects.toBeInstanceOf(HttpException);
    expect(redis.zrem).toHaveBeenCalledTimes(1);
    expect(redis.sets.get('assistant:rate:a')?.size).toBe(2);
    await expect(limiter.consume('b', t0 + 2)).resolves.toBeUndefined();
  });

  it('falls back to memory when Redis fails', async () => {
    const redis = {
      multi: () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const limiter = new AssistantRateLimiterService(
      { get: () => '1' } as never,
      redis as never,
    );
    await limiter.consume('a', 1);
    await expect(limiter.consume('a', 2)).rejects.toBeInstanceOf(HttpException);
  });
});

describe('Jalali periods', () => {
  // 2026-10-22 = 1405/07/30.
  const now = new Date('2026-10-22T08:00:00Z');

  it('last_month is the previous Jalali month in Tehran time', () => {
    const range = resolvePeriod({ period: 'last_month' }, now);
    expect(range.from?.toISOString()).toBe('2026-08-22T20:30:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-09-22T20:30:00.000Z');
    expect(range.label).toBe('ماه 1405/06');
  });

  it('this_month crosses into the next month correctly', () => {
    const range = resolvePeriod({ period: 'this_month' }, now);
    expect(range.from?.toISOString()).toBe('2026-09-22T20:30:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-10-22T20:30:00.000Z');
  });

  it('last_month in Farvardin is Esfand of the previous year', () => {
    const range = resolvePeriod(
      { period: 'last_month' },
      new Date('2026-04-05T08:00:00Z'),
    );
    expect(range.label).toBe('ماه 1404/12');
  });

  it('explicit Jalali dates override the period and include the end day', () => {
    const range = resolvePeriod({ from: '1405/07/01', to: '1405/07/01' }, now);
    expect(range.from?.toISOString()).toBe('2026-09-22T20:30:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-09-23T20:30:00.000Z');
  });

  it('the system prompt carries today in Jalali', () => {
    expect(buildSystemPrompt(now)).toContain('1405/07/30');
  });

  describe('numeric validator (certified numbers, abstain without evidence)', () => {
    const llm = { complete: jest.fn() };
    const tools = {
      definitions: jest.fn(() => [{ type: 'function', function: { name: 't' } }]),
      run: jest.fn(),
    };
    let service: AssistantService;
    beforeEach(() => {
      jest.resetAllMocks();
      tools.definitions.mockReturnValue([{ type: 'function', function: { name: 't' } }]);
      service = new AssistantService(llm as never, tools as never, new AssistantRateLimiterService());
    });
    const ask = () => service.chat(owner, { message: 'موجودی صندوق چقدر است؟' });

    it('lets an answer through when every number comes from a tool result', async () => {
      llm.complete
        .mockResolvedValueOnce(toolTurn('assistant_metric', { id: 'cash_balance' }))
        .mockResolvedValueOnce(textTurn('موجودی صندوق ۱۵۰٬۰۰۰٬۰۰۰ ریال (۱۵ میلیون تومان) است.'));
      tools.run.mockResolvedValueOnce({ ok: true, result: { id: 'cash_balance', value: 150_000_000 } });
      const out = await ask();
      expect(out.abstained).toBe(false);
      expect(out.unverifiedNumbers).toEqual([]);
      expect(out.answer).toContain('۱۵۰٬۰۰۰٬۰۰۰');
    });

    it('LLM invents a number with no tool call: abstains in Persian', async () => {
      llm.complete
        .mockResolvedValueOnce(textTurn('موجودی صندوق ۹۹٬۰۰۰٬۰۰۰ ریال است.'))
        .mockResolvedValueOnce(textTurn('همچنان ۹۹٬۰۰۰٬۰۰۰ ریال است.'));
      const out = await ask();
      expect(out.abstained).toBe(true);
      expect(out.answer).toBe(ABSTAIN_MESSAGE_FA);
      expect(out.answer).not.toMatch(/\d|[۰-۹]/);
      expect(out.unverifiedNumbers).toEqual(['99٬000٬000']);
    });

    it('LLM changes the tool number: one corrective retry, then the honest answer is shown', async () => {
      llm.complete
        .mockResolvedValueOnce(toolTurn('assistant_metric', { id: 'cash_balance' }))
        .mockResolvedValueOnce(textTurn('موجودی ۱۶۰ میلیون ریال است.'))
        .mockResolvedValueOnce(textTurn('موجودی ۱۵۰ میلیون ریال است.'));
      tools.run.mockResolvedValueOnce({ ok: true, result: { id: 'cash_balance', value: 150_000_000 } });
      const out = await ask();
      expect(out.abstained).toBe(false);
      expect(out.answer).toBe('موجودی ۱۵۰ میلیون ریال است.');
      const retryMessages = llm.complete.mock.calls[2][0];
      expect(retryMessages.at(-1).content).toContain('160');
    });

    it('a failed tool cannot back a number', async () => {
      llm.complete
        .mockResolvedValueOnce(toolTurn('assistant_metric', { id: 'cash_balance' }))
        .mockResolvedValueOnce(textTurn('موجودی ۵۰۰ ریال است.'))
        .mockResolvedValueOnce(textTurn('موجودی ۵۰۰ ریال است.'));
      tools.run.mockResolvedValueOnce({ ok: false, result: { error: 'دسترسی ندارید.' } });
      const out = await ask();
      expect(out.abstained).toBe(true);
    });

    it('a retry that throws or is empty still abstains', async () => {
      llm.complete
        .mockResolvedValueOnce(textTurn('عدد ۷۷۷۷'))
        .mockRejectedValueOnce(new Error('timeout'));
      expect((await ask()).abstained).toBe(true);
      llm.complete
        .mockResolvedValueOnce(textTurn('عدد ۷۷۷۷'))
        .mockResolvedValueOnce(textTurn('   '));
      expect((await ask()).abstained).toBe(true);
    });

    it('numbers the user typed are not flagged', async () => {
      llm.complete.mockResolvedValueOnce(textTurn('برای ۳۰ روز گذشته اطلاعاتی ندارم.'));
      const out = await service.chat(owner, { message: 'فروش ۳۰ روز گذشته؟' });
      expect(out.abstained).toBe(false);
    });
  });
});
