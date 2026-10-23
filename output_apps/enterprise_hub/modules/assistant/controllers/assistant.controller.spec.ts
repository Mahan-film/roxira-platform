import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { AssistantController } from './assistant.controller';

jest.mock('../../tenants/tenant-context', () => ({
  requireTenantId: jest.fn(() => 'tenant-1'),
}));

describe('AssistantController feature flag', () => {
  const build = (value?: string) => {
    const service = { chat: jest.fn().mockResolvedValue({ answer: 'ok' }) };
    const config = { get: (_k: string, fallback?: string) => value ?? fallback };
    return {
      service,
      controller: new AssistantController(service as never, config as never),
    };
  };
  const req = {} as never;
  const dto = { message: 'x' } as never;

  it('is off by default: chat returns 503 and status reports disabled', async () => {
    const { controller, service } = build(undefined);
    await expect(controller.chat(req, dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(service.chat).not.toHaveBeenCalled();
    expect(controller.status(req)).toEqual({ enabled: false });
  });

  it('works when ASSISTANT_ENABLED=true', async () => {
    const { controller, service } = build('true');
    await expect(controller.chat(req, dto)).resolves.toEqual({ answer: 'ok' });
    expect(service.chat).toHaveBeenCalled();
    expect(controller.status(req)).toEqual({ enabled: true });
  });
});
