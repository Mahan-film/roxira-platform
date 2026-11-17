import { AlertThrottle } from './alert-throttle';
import { ALERT_MAX_PER_HOUR, ALERT_WINDOW_MS } from './constants/ops-errors.constants';
import { buildEvent, computeFingerprint, safeRoute, scrubText, shortId, topAppFrame } from './ops-errors.util';
import { OpsErrorAlertService, formatAlert } from './services/ops-error-alert.service';
import { OpsErrorRow } from './repositories/ops-error-events.repository';

const stackAt = (line: number) =>
  [
    'TypeError: boom',
    '    at Object.<anonymous> (/app/node_modules/foo/index.js:1:1)',
    `    at InvoicingService.create (/app/dist/modules/invoicing/services/invoicing.service.js:${line}:9)`,
  ].join('\n');

describe('scrubText', () => {
  it('masks e-mails, long digit runs, tokens, bearer, JWT and query strings', () => {
    const out = scrubText(
      'user a.b@example.com phone 09121234567 card 6037997412345678 GET /x?token=abc&y=1 Bearer abc.def.ghi ' +
        'eyJhbGciOi.eyJzdWIi.sig key=SECRETVALUE ' +
        'A'.repeat(40),
    );
    expect(out).not.toMatch(/example\.com/);
    expect(out).not.toMatch(/\d{7,}/);
    expect(out).not.toContain('token=abc');
    expect(out).not.toMatch(/abc\.def\.ghi/);
    expect(out).not.toContain('SECRETVALUE');
    expect(out).not.toContain('AAAAAAAA');
  });

  it('keeps short numbers (status codes, ids)', () => {
    expect(scrubText('status 500 on item 12345')).toBe('status 500 on item 12345');
  });
});

describe('fingerprint', () => {
  it('is stable across line numbers, numeric ids and e-mails', () => {
    const a = computeFingerprint('TypeError', 'cannot read id 123 for a@b.com', stackAt(10));
    const b = computeFingerprint('TypeError', 'cannot read id 987654321 for z@y.org', stackAt(99));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs by class, message and top app frame', () => {
    const base = computeFingerprint('TypeError', 'boom', stackAt(1));
    expect(computeFingerprint('RangeError', 'boom', stackAt(1))).not.toBe(base);
    expect(computeFingerprint('TypeError', 'bang', stackAt(1))).not.toBe(base);
    const other = stackAt(1).replace('InvoicingService.create', 'SalesService.create');
    expect(computeFingerprint('TypeError', 'boom', other)).not.toBe(base);
  });

  it('skips node_modules frames and reports function@file without line numbers', () => {
    expect(topAppFrame(stackAt(7))).toBe('InvoicingService.create@invoicing.service.js');
    expect(topAppFrame(undefined)).toBe('no-stack');
  });
});

describe('buildEvent', () => {
  it('truncates, scrubs and drops a non-uuid tenant id', () => {
    const err = new Error(`failed for a@b.com ${'x '.repeat(500)}`);
    const e = buildEvent(err, { route: '/v1/a', httpMethod: 'post', status: 500, tenantId: 'not-a-uuid' });
    expect(e.sampleMessage.length).toBeLessThanOrEqual(300);
    expect(e.sampleMessage).not.toContain('a@b.com');
    expect(e.sampleStack.length).toBeLessThanOrEqual(2000);
    expect(e.tenantId).toBeNull();
    expect(e.httpMethod).toBe('POST');
    expect(shortId(e.fingerprint)).toHaveLength(8);
  });

  it('keeps a valid tenant uuid and handles non-Error throwables', () => {
    const t = '11111111-1111-4111-8111-111111111111';
    expect(buildEvent('oops', { tenantId: t }).tenantId).toBe(t);
    expect(buildEvent('oops').errorClass).toBe('string');
  });

  it('safeRoute drops the query string and masks numeric segments', () => {
    expect(safeRoute(undefined, '/v1/items/42?token=zzz')).toBe('/v1/items/:n');
    expect(safeRoute('/v1/items/:id', '/v1/items/42?x=1')).toBe('/v1/items/:id');
  });
});

describe('AlertThrottle', () => {
  it('caps at 10 per rolling hour and recovers after the window', () => {
    const t = new AlertThrottle(ALERT_MAX_PER_HOUR, ALERT_WINDOW_MS);
    const t0 = 1_000_000;
    const granted = Array.from({ length: 15 }, (_, i) => t.tryAcquire(t0 + i)).filter(Boolean);
    expect(granted).toHaveLength(10);
    expect(t.tryAcquire(t0 + 30 * 60 * 1000)).toBe(false);
    expect(t.tryAcquire(t0 + ALERT_WINDOW_MS + 20)).toBe(true);
  });
});

describe('OpsErrorAlertService', () => {
  const row = (i: number): OpsErrorRow => ({
    id: `id-${i}`,
    fingerprint: `${String(i).padStart(8, '0')}${'a'.repeat(56)}`,
    day: '2026-11-17',
    source: 'backend',
    errorClass: 'TypeError',
    firstSeen: new Date(),
    lastSeen: new Date(),
    count: 3,
    route: '/v1/x',
    httpMethod: 'GET',
    status: 500,
    release: 'abc123',
    tenantId: null,
    sampleMessage: 'secret@example.com 09121234567',
    hourCount: 40,
    prevHourCount: 2,
  });

  it('sends at most 10 Telegram messages per hour and leaves the rest unmarked', async () => {
    const repo = {
      findNewUnalerted: jest.fn(async () => Array.from({ length: 12 }, (_, i) => row(i))),
      findSpikes: jest.fn(async () => [row(50)]),
      markAlerted: jest.fn(async () => undefined),
      markSpikeAlerted: jest.fn(async () => undefined),
    };
    const telegram = { send: jest.fn(async () => true) };
    const svc = new OpsErrorAlertService(repo as never, telegram as never);
    expect(await svc.scan(5_000)).toBe(10);
    expect(telegram.send).toHaveBeenCalledTimes(10);
    expect(repo.markAlerted).toHaveBeenCalledTimes(10);
    // the next scan inside the same hour sends nothing
    expect(await svc.scan(6_000)).toBe(0);
    expect(telegram.send).toHaveBeenCalledTimes(10);
  });

  it('does not mark a row alerted when Telegram delivery fails', async () => {
    const repo = {
      findNewUnalerted: jest.fn(async () => [row(1)]),
      findSpikes: jest.fn(async () => []),
      markAlerted: jest.fn(),
      markSpikeAlerted: jest.fn(),
    };
    const svc = new OpsErrorAlertService(repo as never, { send: jest.fn(async () => false) } as never);
    await svc.scan(1);
    expect(repo.markAlerted).not.toHaveBeenCalled();
  });

  it('alert text has route, count, short id and release but no message or tenant', () => {
    const text = formatAlert('SPIKE', row(7));
    expect(text).toContain('00000007');
    expect(text).toContain('/v1/x');
    expect(text).toContain('count=3');
    expect(text).toContain('release=abc123');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('09121234567');
  });
});
