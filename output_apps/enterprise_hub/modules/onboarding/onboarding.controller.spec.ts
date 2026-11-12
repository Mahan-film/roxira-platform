import 'reflect-metadata';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AccessAction, AccessModule } from '../access/catalogue';
import { ACCESS_ACTION_KEY, ACCESS_MODULE_KEY, ANY_MEMBER_KEY } from '../access/decorators';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { OnboardingController } from './controllers/onboarding.controller';
import { OnboardingStepParamDto, SetOnboardingStepDto } from './dto/onboarding.dto';
import { OnboardingStep, OnboardingStepStatus } from './enums/onboarding-step.enum';

const proto = OnboardingController.prototype as unknown as Record<string, object>;
const meta = (key: string, handler: string) => Reflect.getMetadata(key, proto[handler]);

describe('OnboardingController guards', () => {
  it('belongs to the members module, which is never entitlement-gated', () => {
    expect(Reflect.getMetadata(ACCESS_MODULE_KEY, OnboardingController)).toBe(AccessModule.MEMBERS);
  });

  it('reading the state is open to any member of the organisation', () => {
    expect(meta(ANY_MEMBER_KEY, 'get')).toBe(true);
    expect(meta(ACCESS_ACTION_KEY, 'get')).toBeUndefined();
  });

  it.each(['saveProfile', 'setStep', 'update'])('%s needs the admin action (owner and admin only)', (handler) => {
    expect(meta(ACCESS_ACTION_KEY, handler)).toBe(AccessAction.ADMIN);
    expect(meta(ANY_MEMBER_KEY, handler)).toBeUndefined();
  });

  it('exposes only the four documented routes', () => {
    const routes = Object.getOwnPropertyNames(OnboardingController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => `${RequestMethod[meta(METHOD_METADATA, name)]} ${meta(PATH_METADATA, name)}`)
      .sort();
    expect(routes).toEqual(['GET /', 'PATCH /', 'PUT profile', 'PUT steps/:step']);
  });

  it('takes the tenant id from the verified token only and refuses a caller without one', () => {
    const service = { get: jest.fn() };
    const controller = new OnboardingController(service as never);
    const noTenant = { user: { sub: 'u1' } } as unknown as AuthenticatedRequest;
    expect(() => controller.get(noTenant)).toThrow(ForbiddenException);
    expect(service.get).not.toHaveBeenCalled();
    const request = { user: { sub: 'u1', tenantId: 'tenant-from-token' }, query: { tenantId: 'other' }, body: { tenantId: 'other' } } as unknown as AuthenticatedRequest;
    void controller.get(request);
    expect(service.get).toHaveBeenCalledWith('tenant-from-token');
  });

  it('passes the validated step and status to the service', async () => {
    const service = { setStep: jest.fn().mockResolvedValue({}) };
    const controller = new OnboardingController(service as never);
    const request = { user: { sub: 'u1', tenantId: 't1' } } as unknown as AuthenticatedRequest;
    await controller.setStep(request, { step: OnboardingStep.CHART }, { status: OnboardingStepStatus.SKIPPED });
    expect(service.setStep).toHaveBeenCalledWith('t1', 'chart', 'skipped');
  });
});

describe('Onboarding request validation (the global ValidationPipe settings)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });

  it('rejects an unknown step in the path', async () => {
    await expect(pipe.transform({ step: 'payroll' }, { type: 'param', metatype: OnboardingStepParamDto })).rejects.toBeDefined();
    await expect(pipe.transform({ step: 'moadian' }, { type: 'param', metatype: OnboardingStepParamDto })).resolves.toBeDefined();
  });

  it('rejects extra body fields such as a client-supplied tenant id', async () => {
    await expect(
      pipe.transform({ status: 'done', tenantId: '11111111-1111-4111-8111-111111111111' }, { type: 'body', metatype: SetOnboardingStepDto }),
    ).rejects.toBeDefined();
  });
});
