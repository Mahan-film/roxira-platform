import 'reflect-metadata';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ACCESS_ACTION_KEY, ACCESS_MODULE_KEY } from '../../access/decorators';
import { ReconController } from './recon.controller';

const actionOf = (name: keyof ReconController): AccessAction | undefined =>
  Reflect.getMetadata(ACCESS_ACTION_KEY, ReconController.prototype[name]);

describe('ReconController permissions', () => {
  const service = {
    getSettings: jest.fn(async () => ({})),
    updateSettings: jest.fn(async () => ({})),
    approveDrafts: jest.fn(async () => []),
  };
  const controller = new ReconController(service as never);
  const T = '00000000-0000-4000-8000-00000000000a';

  it('belongs to the banking module', () => {
    expect(Reflect.getMetadata(ACCESS_MODULE_KEY, ReconController)).toBe(AccessModule.BANKING);
  });

  it('separates preparing from posting from administering', () => {
    for (const route of ['rematch', 'decide', 'approve', 'reject', 'reverse'] as const) {
      expect(actionOf(route)).toBe(AccessAction.POST);
    }
    for (const route of ['updateSettings', 'deleteRule', 'audit'] as const) {
      expect(actionOf(route)).toBe(AccessAction.ADMIN);
    }
    expect(actionOf('exportReport')).toBe(AccessAction.EXPORT);
    // No override: POST is banking:create, GET is banking:read.
    expect(actionOf('upload')).toBeUndefined();
    expect(actionOf('answerCheck')).toBeUndefined();
  });

  it('a request without a tenant is refused', () => {
    expect(() => controller.settings({ user: undefined } as never)).toThrow();
  });

  it('the tenant and actor come from the token, never from the request body', async () => {
    const owner = { user: { sub: 'owner-1', tenantId: T } } as never;
    await controller.approve(owner, { draftIds: [1, 2], tenantId: 'evil' } as never);
    expect(service.approveDrafts).toHaveBeenCalledWith(T, 'owner-1', [1, 2]);
    await controller.updateSettings(owner, { autoPostFees: false });
    expect(service.updateSettings).toHaveBeenCalledWith(T, 'owner-1', { autoPostFees: false });
  });
});
