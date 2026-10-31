import 'reflect-metadata';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ACCESS_ACTION_KEY, ACCESS_MODULE_KEY } from '../../access/decorators';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { CaptureController } from './capture.controller';

const req = (user: Record<string, unknown> | undefined): never => ({ user }) as never;
const make = (enabled = 'true') => {
  const service = {
    create: jest.fn(async () => ({})), updateSettings: jest.fn(async () => ({ autoEnabled: true, minConfidence: '0.95', dailyCostCapUsd: '1', dailyDocCap: 100 })),
    upsertRule: jest.fn(async () => ({})), post: jest.fn(async () => ({})), queue: jest.fn(async () => []),
  };
  const config = { get: (k: string, d?: string) => (k === 'ASSISTANT_ENABLED' ? enabled : d) };
  return { controller: new CaptureController(service as never, config as never), service };
};
const member = { sub: 'u1', tenantId: 'T1', role: 'USER', tenantRole: 'MEMBER' };
const owner = { ...member, tenantRole: 'OWNER' };
const settings = { autoEnabled: true, minConfidence: 0.95, dailyCostCapUsd: 1, dailyDocCap: 10 };

describe('CaptureController', () => {
  it('takes the tenant only from the JWT', async () => {
    const { controller, service } = make();
    await controller.queue(req(member));
    expect(service.queue).toHaveBeenCalledWith('T1');
    expect(() => controller.queue(req({ sub: 'u' }))).toThrow(ForbiddenException);
  });

  it('is off unless ASSISTANT_ENABLED is on', async () => {
    const { controller } = make('');
    expect(() => controller.queue(req(member))).toThrow(ServiceUnavailableException);
  });

  it('auto mode and vendor rules need accounting:admin, posting needs accounting:post', () => {
    const action = (name: 'putSettings' | 'putRule' | 'post' | 'reverse') =>
      Reflect.getMetadata(ACCESS_ACTION_KEY, CaptureController.prototype[name]);
    expect(action('putSettings')).toBe(AccessAction.ADMIN);
    expect(action('putRule')).toBe(AccessAction.ADMIN);
    expect(action('post')).toBe(AccessAction.POST);
    expect(action('reverse')).toBe(AccessAction.POST);
    expect(Reflect.getMetadata(ACCESS_MODULE_KEY, CaptureController)).toBe(AccessModule.ACCOUNTING);
  });

  it('the tenant and actor come from the token', async () => {
    const { controller, service } = make();
    await controller.post(req(member), '00000000-0000-4000-8000-000000000001');
    expect(service.post).toHaveBeenCalledWith('T1', 'u1', '00000000-0000-4000-8000-000000000001');
  });
});
