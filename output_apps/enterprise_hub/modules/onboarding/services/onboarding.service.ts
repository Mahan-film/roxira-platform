import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantsService } from '../../tenants/services/tenants.service';
import {
  OnboardingStateDto,
  SaveOnboardingProfileDto,
  UpdateOnboardingDto,
} from '../dto/onboarding.dto';
import { StoredStepStatus, TenantOnboardingProgressEntity } from '../entities/tenant-onboarding-progress.entity';
import { ONBOARDING_STEPS, OnboardingStep, OnboardingStepStatus } from '../enums/onboarding-step.enum';
import { OnboardingRepository, ProgressPatch } from '../repositories/onboarding.repository';

/**
 * Setup-wizard progress of an organisation. Business rules only: the steps map, when the wizard
 * counts as complete, and what the first-login redirect means. Persistence is the repository's.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly tenants: TenantsService,
  ) {}

  async get(tenantId: string): Promise<OnboardingStateDto> {
    const row = await this.repository.getOrCreate(tenantId);
    return this.view(tenantId, row);
  }

  /** Step 1: renames the organisation, keeps the two identifiers and marks the step done. */
  async saveProfile(tenantId: string, dto: SaveOnboardingProfileDto): Promise<OnboardingStateDto> {
    const tenant = await this.tenants.updateName(tenantId, dto.name);
    if (!tenant) throw new NotFoundException('سازمانی برای حساب شما یافت نشد.');
    const row = await this.repository.update(tenantId, (current) => ({
      economicCode: dto.economicCode ?? null,
      nationalId: dto.nationalId ?? null,
      ...this.withStep(current, OnboardingStep.PROFILE, OnboardingStepStatus.DONE),
    }));
    return this.view(tenantId, row, tenant.name);
  }

  /** Records one step as done or skipped, or reopens it (`pending`). */
  async setStep(tenantId: string, step: OnboardingStep, status: OnboardingStepStatus): Promise<OnboardingStateDto> {
    const row = await this.repository.update(tenantId, (current) => this.withStep(current, step, status));
    return this.view(tenantId, row);
  }

  async update(tenantId: string, dto: UpdateOnboardingDto): Promise<OnboardingStateDto> {
    const row = await this.repository.update(tenantId, (current) => {
      const patch: ProgressPatch = {};
      if (dto.dismissed !== undefined) patch.dismissed = dto.dismissed;
      if (dto.firstVisitHandled && !current.firstVisitHandledAt) patch.firstVisitHandledAt = new Date();
      return patch;
    });
    return this.view(tenantId, row);
  }

  /** The new `steps` map and `completedAt` after a status change. */
  private withStep(
    current: TenantOnboardingProgressEntity,
    step: OnboardingStep,
    status: OnboardingStepStatus,
  ): ProgressPatch {
    const steps: Record<string, StoredStepStatus> = { ...(current.steps ?? {}) };
    if (status === OnboardingStepStatus.PENDING) delete steps[step];
    else steps[step] = status;
    const complete = ONBOARDING_STEPS.every((key) => steps[key] !== undefined);
    return { steps, completedAt: complete ? (current.completedAt ?? new Date()) : null };
  }

  private async view(
    tenantId: string,
    row: TenantOnboardingProgressEntity,
    knownName?: string,
  ): Promise<OnboardingStateDto> {
    const companyName = knownName ?? (await this.tenants.findMyTenant(tenantId))?.name ?? '';
    const steps = {} as Record<OnboardingStep, OnboardingStepStatus>;
    for (const key of ONBOARDING_STEPS) {
      steps[key] = (row.steps?.[key] as OnboardingStepStatus | undefined) ?? OnboardingStepStatus.PENDING;
    }
    return {
      steps,
      completed: ONBOARDING_STEPS.every((key) => steps[key] !== OnboardingStepStatus.PENDING),
      dismissed: row.dismissed,
      firstVisit: row.firstVisitHandledAt === null,
      companyName,
      economicCode: row.economicCode,
      nationalId: row.nationalId,
    };
  }
}
