import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportClientErrorDto } from '../dto/report-client-error.dto';
import { ClientErrorAlertSender } from './client-error-alert.sender';
import { ClientErrorsService, scrubText, stripQuery } from './client-errors.service';

const dto = (over: Partial<ReportClientErrorDto> = {}): ReportClientErrorDto =>
  Object.assign(new ReportClientErrorDto(), { message: 'boom', path: '/app/import', ...over });

describe('ReportClientErrorDto', () => {
  it('accepts a minimal valid payload', async () => {
    const o = plainToInstance(ReportClientErrorDto, { message: 'x', path: '/a' });
    expect(await validate(o)).toHaveLength(0);
  });

  it('rejects empty message, oversized stack and unknown kind', async () => {
    const o = plainToInstance(ReportClientErrorDto, {
      message: '',
      path: '/a',
      stack: 's'.repeat(5000),
      kind: 'nope',
    });
    const props = (await validate(o)).map((e) => e.property).sort();
    expect(props).toEqual(['kind', 'message', 'stack']);
  });
});

describe('ClientErrorsService', () => {
  let send: jest.Mock;
  let service: ClientErrorsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    send = jest.fn().mockResolvedValue(true);
    service = new ClientErrorsService({ send } as unknown as ClientErrorAlertSender);
    warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('logs one structured JSON line without query string or tokens', async () => {
    await service.report(dto({ path: '/app/x?token=abc', message: 'bad Bearer abc.def' }));
    const line = warn.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({ event: 'client_error', path: '/app/x' });
    expect(line).not.toContain('abc.def');
  });

  it('alerts once per distinct message within 30 minutes', async () => {
    const t0 = 1_000_000;
    expect((await service.report(dto(), t0)).alerted).toBe(true);
    expect((await service.report(dto(), t0 + 60_000)).alerted).toBe(false);
    expect((await service.report(dto({ message: 'other' }), t0 + 60_000)).alerted).toBe(true);
    expect((await service.report(dto(), t0 + 31 * 60_000)).alerted).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('caps total alerts per window', async () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 15; i++) await service.report(dto({ message: `m${i}` }), t0);
    expect(send).toHaveBeenCalledTimes(10);
  });
});

describe('helpers', () => {
  it('stripQuery and scrubText', () => {
    expect(stripQuery('/a/b?x=1#h')).toBe('/a/b');
    expect(scrubText('mail a@b.com')).toBe('mail [email]');
  });
});
