import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { SaveOnboardingProfileDto, SetOnboardingStepDto, UpdateOnboardingDto } from './dto/onboarding.dto';
import { TenantOnboardingProgressEntity } from './entities/tenant-onboarding-progress.entity';
import { ONBOARDING_STEPS, OnboardingStep, OnboardingStepStatus } from './enums/onboarding-step.enum';
import { OnboardingRepository, ProgressPatch } from './repositories/onboarding.repository';
import { OnboardingService } from './services/onboarding.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

/** In-memory stand-in for the repository: one row per tenant, same contract as the real one. */
class FakeRepository {
  rows = new Map<string, TenantOnboardingProgressEntity>();
  updateCalls = 0;
  private row(tenantId: string): TenantOnboardingProgressEntity {
    let row = this.rows.get(tenantId);
    if (!row) {
      row = Object.assign(new TenantOnboardingProgressEntity(), {
        tenantId,
        steps: {},
        economicCode: null,
        nationalId: null,
        dismissed: false,
        firstVisitHandledAt: null,
        completedAt: null,
      });
      this.rows.set(tenantId, row);
    }
    return row;
  }
  async getOrCreate(tenantId: string) {
    return this.row(tenantId);
  }
  async update(tenantId: string, change: (c: TenantOnboardingProgressEntity) => ProgressPatch) {
    this.updateCalls += 1;
    const row = this.row(tenantId);
    Object.assign(row, change(row));
    return row;
  }
}

function build() {
  const repository = new FakeRepository();
  const names = new Map<string, string>([[T1, 'شرکت یک'], [T2, 'شرکت دو']]);
  const tenants = {
    findMyTenant: jest.fn(async (id: string) => (names.has(id) ? ({ id, name: names.get(id) } as TenantEntity) : null)),
    updateName: jest.fn(async (id: string, name: string) => {
      if (!names.has(id)) return null;
      names.set(id, name);
      return { id, name } as TenantEntity;
    }),
  };
  const service = new OnboardingService(repository as unknown as OnboardingRepository, tenants as never);
  return { service, repository, tenants };
}

describe('OnboardingService: save and resume', () => {
  it('a new organisation starts with every step pending, not completed, first visit', async () => {
    const { service } = build();
    const state = await service.get(T1);
    expect(Object.keys(state.steps)).toEqual([...ONBOARDING_STEPS]);
    expect(Object.values(state.steps).every((s) => s === OnboardingStepStatus.PENDING)).toBe(true);
    expect(state).toMatchObject({ completed: false, dismissed: false, firstVisit: true, companyName: 'شرکت یک' });
  });

  it('a recorded step is still there on the next read (resume)', async () => {
    const { service } = build();
    await service.setStep(T1, OnboardingStep.FISCAL_YEAR, OnboardingStepStatus.DONE);
    await service.setStep(T1, OnboardingStep.CHART, OnboardingStepStatus.SKIPPED);
    const state = await service.get(T1);
    expect(state.steps.fiscal_year).toBe('done');
    expect(state.steps.chart).toBe('skipped');
    expect(state.steps.profile).toBe('pending');
    expect(state.completed).toBe(false);
  });

  it('pending reopens a step that was done', async () => {
    const { service } = build();
    await service.setStep(T1, OnboardingStep.USERS, OnboardingStepStatus.DONE);
    const state = await service.setStep(T1, OnboardingStep.USERS, OnboardingStepStatus.PENDING);
    expect(state.steps.users).toBe('pending');
  });

  it('is complete only when every step is done or skipped, and reopening a step undoes it', async () => {
    const { service, repository } = build();
    let state = await service.get(T1);
    for (const step of ONBOARDING_STEPS) {
      expect(state.completed).toBe(false);
      state = await service.setStep(T1, step, step === OnboardingStep.MOADIAN ? OnboardingStepStatus.SKIPPED : OnboardingStepStatus.DONE);
    }
    expect(state.completed).toBe(true);
    expect(repository.rows.get(T1)?.completedAt).toBeInstanceOf(Date);
    state = await service.setStep(T1, OnboardingStep.CHART, OnboardingStepStatus.PENDING);
    expect(state.completed).toBe(false);
    expect(repository.rows.get(T1)?.completedAt).toBeNull();
  });

  it('keeps the progress of two organisations apart', async () => {
    const { service } = build();
    await service.setStep(T1, OnboardingStep.CHART, OnboardingStepStatus.DONE);
    expect((await service.get(T2)).steps.chart).toBe('pending');
  });
});

describe('OnboardingService: profile step', () => {
  it('renames the organisation, stores the identifiers and marks the step done', async () => {
    const { service, tenants } = build();
    const state = await service.saveProfile(T1, { name: 'شرکت نوین', economicCode: '411234567890', nationalId: '10101234567' });
    expect(tenants.updateName).toHaveBeenCalledWith(T1, 'شرکت نوین');
    expect(state).toMatchObject({ companyName: 'شرکت نوین', economicCode: '411234567890', nationalId: '10101234567' });
    expect(state.steps.profile).toBe('done');
  });

  it('clears an identifier that is no longer sent', async () => {
    const { service } = build();
    await service.saveProfile(T1, { name: 'شرکت نوین', economicCode: '411234567890' });
    const state = await service.saveProfile(T1, { name: 'شرکت نوین' });
    expect(state.economicCode).toBeNull();
  });

  it('answers 404 and writes nothing when the organisation does not exist', async () => {
    const { service, repository } = build();
    await expect(service.saveProfile('33333333-3333-4333-8333-333333333333', { name: 'x y' })).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateCalls).toBe(0);
  });
});

describe('OnboardingService: dismiss and first visit', () => {
  it('records the first-visit redirect once and keeps its first timestamp', async () => {
    const { service, repository } = build();
    expect((await service.get(T1)).firstVisit).toBe(true);
    const first = await service.update(T1, { firstVisitHandled: true });
    expect(first.firstVisit).toBe(false);
    const stamp = repository.rows.get(T1)?.firstVisitHandledAt;
    await service.update(T1, { firstVisitHandled: true });
    expect(repository.rows.get(T1)?.firstVisitHandledAt).toBe(stamp);
  });

  it('dismisses and restores the banner without touching the steps', async () => {
    const { service } = build();
    await service.setStep(T1, OnboardingStep.PROFILE, OnboardingStepStatus.DONE);
    expect((await service.update(T1, { dismissed: true })).dismissed).toBe(true);
    const back = await service.update(T1, { dismissed: false });
    expect(back.dismissed).toBe(false);
    expect(back.steps.profile).toBe('done');
  });
});

describe('Onboarding DTO validation', () => {
  const errors = async (cls: new () => object, plain: object) => validate(plainToInstance(cls, plain) as object);

  it('rejects an unknown status and a missing one', async () => {
    expect(await errors(SetOnboardingStepDto, { status: 'finished' })).not.toHaveLength(0);
    expect(await errors(SetOnboardingStepDto, {})).not.toHaveLength(0);
    expect(await errors(SetOnboardingStepDto, { status: 'skipped' })).toHaveLength(0);
  });

  it('profile: name needed, economic code 11-14 digits, national id 10-11 digits, Persian digits accepted', async () => {
    expect(await errors(SaveOnboardingProfileDto, { name: 'a' })).not.toHaveLength(0);
    expect(await errors(SaveOnboardingProfileDto, { name: 'شرکت', economicCode: '123' })).not.toHaveLength(0);
    expect(await errors(SaveOnboardingProfileDto, { name: 'شرکت', economicCode: '12345678901x' })).not.toHaveLength(0);
    expect(await errors(SaveOnboardingProfileDto, { name: 'شرکت', nationalId: '123456789' })).not.toHaveLength(0);
    expect(await errors(SaveOnboardingProfileDto, { name: 'شرکت' })).toHaveLength(0);
    const persian = plainToInstance(SaveOnboardingProfileDto, { name: 'شرکت', economicCode: '۴۱۱۲۳۴۵۶۷۸۹۰', nationalId: '١٠١٠١٢٣٤٥٦٧' });
    expect(await validate(persian)).toHaveLength(0);
    expect(persian.economicCode).toBe('411234567890');
    expect(persian.nationalId).toBe('10101234567');
  });

  it('update: firstVisitHandled can only be true', async () => {
    expect(await errors(UpdateOnboardingDto, { firstVisitHandled: false })).not.toHaveLength(0);
    expect(await errors(UpdateOnboardingDto, { firstVisitHandled: true, dismissed: false })).toHaveLength(0);
  });
});
