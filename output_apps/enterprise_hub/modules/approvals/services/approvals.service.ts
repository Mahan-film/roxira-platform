import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { EntityManager } from 'typeorm';
import { AuditService } from '../../access/services/audit.service';
import { MoneyFormatError, parseMinor, toMinor } from '../../accounting/money';
import {
  getPolicyDefinition,
  PolicyValue,
  validatePolicyValue,
} from '../../tenants/policy/policy.registry';
import {
  APPROVAL_ESCALATE_REQUEST_JOB,
  APPROVAL_ESCALATION_QUEUE,
  GROUP_B_MIN_REASON_LENGTH,
  POLICY_CHANGE_RESOURCE_TYPE,
} from '../constants/approvals.constants';
import {
  ApprovalDelegationView,
  ApprovalRequestView,
  ApprovalRuleView,
  ApprovalStepSnapshot,
  CreateApprovalRequestDto,
  CreateApprovalRuleDto,
  CreateDelegationDto,
  DecideApprovalStepDto,
  RequestGroupBPolicyChangeDto,
} from '../dto/approvals.dto';
import { ApprovalsRepository } from '../repositories/approvals.repository';

export interface ApprovalActor {
  userId: string;
  roleKey: string;
}

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly repo: ApprovalsRepository,
    private readonly audit: AuditService,
    @Optional()
    @InjectQueue(APPROVAL_ESCALATION_QUEUE)
    private readonly escalationQueue?: Queue,
  ) {}

  private parseNonNegativeMinor(raw: string | number | undefined | null, fieldName: string): bigint {
    if (raw === undefined || raw === null || raw === '') return 0n;
    try {
      const minor = toMinor(raw);
      if (minor < 0n) {
        throw new BadRequestException(`${fieldName} نمی‌تواند منفی باشد.`);
      }
      return minor;
    } catch (err) {
      if (err instanceof MoneyFormatError) {
        throw new BadRequestException(`فرمت مبلغ در ${fieldName} نامعتبر است: ${err.message}`);
      }
      throw err;
    }
  }

  private assertAdminOrOwner(actor: ApprovalActor): void {
    if (actor.roleKey !== 'owner' && actor.roleKey !== 'admin') {
      throw new ForbiddenException('فقط مالک یا مدیر سازمان مجاز به انجام این عملیات است.');
    }
  }

  /**
   * Creates or updates a table-driven approval rule for `(resourceType, stepOrder, minAmountMinor)`.
   */
  async upsertRule(
    tenantId: string,
    actor: ApprovalActor,
    dto: CreateApprovalRuleDto,
  ): Promise<ApprovalRuleView> {
    this.assertAdminOrOwner(actor);
    const resourceType = dto.resourceType.trim();
    if (!resourceType) {
      throw new BadRequestException('نوع منبع (resourceType) الزامی است.');
    }
    if (!Number.isInteger(dto.stepOrder) || dto.stepOrder < 1) {
      throw new BadRequestException('ترتیب مرحله (stepOrder) باید عدد صحیح بزرگ‌تر یا مساوی ۱ باشد.');
    }
    const minMinor = this.parseNonNegativeMinor(dto.minAmountMinor, 'minAmountMinor');
    const maxMinor =
      dto.maxAmountMinor !== undefined && dto.maxAmountMinor !== null && dto.maxAmountMinor !== ''
        ? this.parseNonNegativeMinor(dto.maxAmountMinor, 'maxAmountMinor')
        : null;
    if (maxMinor !== null && maxMinor < minMinor) {
      throw new BadRequestException('سقف مبلغ (maxAmountMinor) نمی‌تواند کمتر از کف مبلغ (minAmountMinor) باشد.');
    }
    if (
      dto.escalationAfterMinutes !== undefined &&
      dto.escalationAfterMinutes !== null &&
      (!Number.isInteger(dto.escalationAfterMinutes) || dto.escalationAfterMinutes < 1)
    ) {
      throw new BadRequestException('زمان ارجاع خودکار (escalationAfterMinutes) باید عدد صحیح مثبت باشد.');
    }

    return this.repo.transaction(tenantId, async (manager) => {
      const saved = await this.repo.upsertRule(
        tenantId,
        {
          resourceType,
          stepOrder: dto.stepOrder,
          minAmountMinor: minMinor.toString(),
          maxAmountMinor: maxMinor !== null ? maxMinor.toString() : null,
          approverRole: dto.approverRole.trim(),
          approverUserId: dto.approverUserId?.trim() || null,
          escalationAfterMinutes: dto.escalationAfterMinutes ?? null,
          escalateToRole: dto.escalateToRole?.trim() || null,
          requireDistinctApprover: dto.requireDistinctApprover ?? true,
          active: dto.active ?? true,
          createdBy: actor.userId,
        },
        manager,
      );
      await this.audit.record(
        {
          tenantId,
          actorUserId: actor.userId,
          action: 'approval.rule.upserted',
          resourceType: 'approval_rule',
          resourceId: saved.id,
          metadata: {
            resourceType: saved.resourceType,
            stepOrder: saved.stepOrder,
            minAmountMinor: saved.minAmountMinor,
            maxAmountMinor: saved.maxAmountMinor,
            approverRole: saved.approverRole,
          },
        },
        manager,
      );
      return saved;
    });
  }

  listRules(tenantId: string, resourceType?: string): Promise<ApprovalRuleView[]> {
    return this.repo.listRules(tenantId, resourceType);
  }

  /**
   * Resolves the ordered approval steps for a given `resourceType` and `amountMinor` (integer minor units).
   * When multiple active rules match the same `stepOrder` at different thresholds, the rule with the
   * highest `minAmountMinor` takes precedence for that step, and steps are re-numbered 1..N in ascending order.
   */
  async resolveStepsForAmount(
    tenantId: string,
    resourceType: string,
    amountMinor: bigint,
    manager?: EntityManager,
  ): Promise<ApprovalStepSnapshot[]> {
    const matching = await this.repo.findMatchingRules(
      tenantId,
      resourceType,
      amountMinor.toString(),
      manager,
    );

    const byStepOrder = new Map<number, ApprovalRuleView>();
    for (const rule of matching) {
      const existing = byStepOrder.get(rule.stepOrder);
      if (!existing || parseMinor(rule.minAmountMinor) > parseMinor(existing.minAmountMinor)) {
        byStepOrder.set(rule.stepOrder, rule);
      }
    }

    const orderedRules = [...byStepOrder.values()].sort((a, b) => a.stepOrder - b.stepOrder);
    if (orderedRules.length === 0) {
      return [
        {
          stepOrder: 1,
          approverRole: 'owner',
          approverUserId: null,
          minAmountMinor: '0',
          maxAmountMinor: null,
          escalationAfterMinutes: null,
          escalateToRole: null,
          requireDistinctApprover: true,
        },
      ];
    }

    return orderedRules.map((rule, idx) => ({
      stepOrder: idx + 1,
      approverRole: rule.approverRole,
      approverUserId: rule.approverUserId,
      minAmountMinor: rule.minAmountMinor,
      maxAmountMinor: rule.maxAmountMinor,
      escalationAfterMinutes: rule.escalationAfterMinutes,
      escalateToRole: rule.escalateToRole,
      requireDistinctApprover:
        resourceType === POLICY_CHANGE_RESOURCE_TYPE ? true : rule.requireDistinctApprover,
    }));
  }

  /**
   * Creates a time-bounded delegation from `actor` to `dto.delegateUserId`.
   */
  async createDelegation(
    tenantId: string,
    actor: ApprovalActor,
    dto: CreateDelegationDto,
  ): Promise<ApprovalDelegationView> {
    const delegateUserId = dto.delegateUserId.trim();
    if (!delegateUserId) {
      throw new BadRequestException('شناسهٔ نماینده (delegateUserId) الزامی است.');
    }
    if (delegateUserId === actor.userId) {
      throw new BadRequestException('تفویض اختیار به خود امکان‌پذیر نیست.');
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('بازهٔ زمانی تفویض اختیار نامعتبر است (پایان باید پس از شروع باشد).');
    }
    const reason = String(dto.reason ?? '').trim();
    if (reason.length < 5) {
      throw new BadRequestException('دلیل تفویض اختیار باید دست‌کم ۵ نویسه باشد.');
    }
    const maxMinor =
      dto.maxAmountMinor !== undefined && dto.maxAmountMinor !== null && dto.maxAmountMinor !== ''
        ? this.parseNonNegativeMinor(dto.maxAmountMinor, 'maxAmountMinor')
        : null;

    return this.repo.transaction(tenantId, async (manager) => {
      const created = await this.repo.createDelegation(
        tenantId,
        {
          delegatorUserId: actor.userId,
          delegatorRole: actor.roleKey,
          delegateUserId,
          resourceType: dto.resourceType?.trim() || null,
          maxAmountMinor: maxMinor !== null ? maxMinor.toString() : null,
          startsAt,
          endsAt,
          reason,
        },
        manager,
      );
      await this.audit.record(
        {
          tenantId,
          actorUserId: actor.userId,
          action: 'approval.delegation.created',
          resourceType: 'approval_delegation',
          resourceId: created.id,
          metadata: {
            delegatorUserId: created.delegatorUserId,
            delegatorRole: created.delegatorRole,
            delegateUserId: created.delegateUserId,
            resourceType: created.resourceType,
            maxAmountMinor: created.maxAmountMinor,
            startsAt: created.startsAt.toISOString(),
            endsAt: created.endsAt.toISOString(),
            reason: created.reason,
          },
        },
        manager,
      );
      return created;
    });
  }

  async revokeDelegation(
    tenantId: string,
    actor: ApprovalActor,
    delegationId: string,
    now: Date = new Date(),
  ): Promise<ApprovalDelegationView> {
    return this.repo.transaction(tenantId, async (manager) => {
      const revoked = await this.repo.revokeDelegation(tenantId, delegationId, now, manager);
      if (!revoked) {
        throw new NotFoundException('تفویض اختیار مورد نظر یافت نشد.');
      }
      if (
        revoked.delegatorUserId !== actor.userId &&
        actor.roleKey !== 'owner' &&
        actor.roleKey !== 'admin'
      ) {
        throw new ForbiddenException('فقط تفویض‌کننده یا مدیر سازمان می‌تواند تفویض را لغو کند.');
      }
      await this.audit.record(
        {
          tenantId,
          actorUserId: actor.userId,
          action: 'approval.delegation.revoked',
          resourceType: 'approval_delegation',
          resourceId: revoked.id,
        },
        manager,
      );
      return revoked;
    });
  }

  /**
   * Opens a new table-driven approval request and schedules a BullMQ escalation job if the first
   * step carries `escalationAfterMinutes`.
   */
  async createRequest(
    tenantId: string,
    actor: ApprovalActor,
    dto: CreateApprovalRequestDto,
    now: Date = new Date(),
  ): Promise<ApprovalRequestView> {
    const resourceType = dto.resourceType.trim();
    const resourceId = dto.resourceId.trim();
    if (!resourceType || !resourceId) {
      throw new BadRequestException('نوع و شناسهٔ منبع برای درخواست تأیید الزامی است.');
    }
    const amountMinor = this.parseNonNegativeMinor(dto.amountMinor, 'amountMinor');

    const created = await this.repo.transaction(tenantId, async (manager) => {
      const steps = await this.resolveStepsForAmount(tenantId, resourceType, amountMinor, manager);
      const firstStep = steps[0];
      const escalationDueAt =
        firstStep.escalationAfterMinutes != null
          ? new Date(now.getTime() + firstStep.escalationAfterMinutes * 60_000)
          : null;

      const request = await this.repo.createRequest(
        tenantId,
        {
          resourceType,
          resourceId,
          amountMinor: amountMinor.toString(),
          requestedBy: actor.userId,
          requestedByRole: actor.roleKey,
          status: 'PENDING',
          currentStep: 1,
          totalSteps: steps.length,
          stepsSnapshot: steps,
          payload: dto.payload ?? {},
          escalationDueAt,
        },
        manager,
      );

      await this.audit.record(
        {
          tenantId,
          actorUserId: actor.userId,
          action: 'approval.request.created',
          resourceType: 'approval_request',
          resourceId: request.id,
          metadata: {
            targetResourceType: resourceType,
            targetResourceId: resourceId,
            amountMinor: request.amountMinor,
            totalSteps: request.totalSteps,
          },
        },
        manager,
      );

      return request;
    });

    await this.scheduleEscalationJob(created);
    return created;
  }

  /**
   * Group B policy changes require a second distinct approver (#584 item 5 / T2).
   * Validates the policy key and value against `POLICY_REGISTRY`, ensures it belongs to Group B,
   * verifies the 15-character reason minimum, and opens a `policy_change` approval request whose
   * approval by a second distinct owner/admin atomically writes the policy change.
   */
  async requestGroupBPolicyChange(
    tenantId: string,
    actor: ApprovalActor,
    dto: RequestGroupBPolicyChangeDto,
    now: Date = new Date(),
  ): Promise<ApprovalRequestView> {
    const definition = getPolicyDefinition(dto.key);
    if (!definition) {
      throw new NotFoundException(`قاعدهٔ «${dto.key}» شناخته‌شده نیست.`);
    }
    if (definition.group === 'A') {
      throw new ForbiddenException('این قاعده ثابت است و قابل تغییر نیست.');
    }
    if (definition.group !== 'B') {
      throw new BadRequestException('این مسیر فقط برای قواعد حفاظتی گروه «ب» است.');
    }
    this.assertAdminOrOwner(actor);

    const validation = validatePolicyValue(dto.key, dto.value);
    if (!validation.ok) {
      throw new BadRequestException(validation.error);
    }
    const reason = String(dto.reason ?? '').trim();
    if (reason.length < GROUP_B_MIN_REASON_LENGTH) {
      throw new BadRequestException(
        `دلیل تغییر قاعدهٔ گروه «ب» باید دست‌کم ${GROUP_B_MIN_REASON_LENGTH} نویسه باشد.`,
      );
    }

    return this.createRequest(
      tenantId,
      actor,
      {
        resourceType: POLICY_CHANGE_RESOURCE_TYPE,
        resourceId: dto.key,
        amountMinor: 0,
        payload: {
          key: dto.key,
          newValue: dto.value,
          reason,
        },
      },
      now,
    );
  }

  async getRequest(tenantId: string, requestId: string): Promise<ApprovalRequestView> {
    const found = await this.repo.findRequestById(tenantId, requestId);
    if (!found) {
      throw new NotFoundException('درخواست تأیید یافت نشد.');
    }
    return found;
  }

  listRequests(
    tenantId: string,
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ): Promise<ApprovalRequestView[]> {
    return this.repo.listRequests(tenantId, status);
  }

  /**
   * Records an `APPROVED` or `REJECTED` decision on the current step of an open request.
   * Checks direct role/user eligibility or an active delegation within its time and amount window,
   * enforces maker-checker (`requireDistinctApprover`) and distinct multi-step approvers, and
   * when the final step of a Group B `policy_change` request is approved, atomically writes the
   * policy value and protected audit entry.
   */
  async decide(
    tenantId: string,
    requestId: string,
    actor: ApprovalActor,
    dto: DecideApprovalStepDto,
    now: Date = new Date(),
  ): Promise<ApprovalRequestView> {
    const updated = await this.repo.transaction(tenantId, async (manager) => {
      const request = await this.repo.findRequestForUpdate(tenantId, requestId, manager);
      if (!request) {
        throw new NotFoundException('درخواست تأیید یافت نشد.');
      }
      if (request.status !== 'PENDING') {
        throw new ConflictException(`این درخواست قبلاً در وضعیت «${request.status}» قرار گرفته است.`);
      }

      const step = request.stepsSnapshot.find((s) => s.stepOrder === request.currentStep);
      if (!step) {
        throw new ConflictException('مرحلهٔ جاری درخواست تأیید معتبر نیست.');
      }

      const mustDifferFromRequester =
        step.requireDistinctApprover || request.resourceType === POLICY_CHANGE_RESOURCE_TYPE;
      if (mustDifferFromRequester && actor.userId === request.requestedBy) {
        throw new ForbiddenException(
          'درخواست‌کننده نمی‌تواند درخواست خودش را تأیید یا رد کند (نیاز به تأییدکنندهٔ دوم).',
        );
      }

      const priorApprovedByActor = (request.decisions ?? []).some(
        (d) => d.decision === 'APPROVED' && d.actorUserId === actor.userId,
      );
      if (priorApprovedByActor && dto.decision === 'APPROVED') {
        throw new ForbiddenException(
          'یک کاربر نمی‌تواند بیش از یک مرحله از یک درخواست چندمرحله‌ای را تأیید کند.',
        );
      }

      const { authorized, delegatedFromUserId } = await this.authorizeStepActor(
        tenantId,
        request,
        step,
        actor,
        mustDifferFromRequester,
        now,
        manager,
      );
      if (!authorized) {
        throw new ForbiddenException('نقش یا تفویض اختیار فعلی اجازهٔ تصمیم‌گیری در این مرحله را ندارد.');
      }

      await this.repo.insertStepDecision(
        tenantId,
        {
          requestId: request.id,
          stepOrder: request.currentStep,
          decision: dto.decision,
          actorUserId: actor.userId,
          actorRole: actor.roleKey,
          delegatedFromUserId,
          comment: dto.comment?.trim() || null,
          decidedAt: now,
        },
        manager,
      );

      if (dto.decision === 'REJECTED') {
        const rejected = await this.repo.updateRequestState(
          tenantId,
          request.id,
          {
            status: 'REJECTED',
            currentStep: request.currentStep,
            stepsSnapshot: request.stepsSnapshot,
            escalationDueAt: null,
            escalatedCount: request.escalatedCount,
            decidedAt: now,
          },
          manager,
        );
        await this.audit.record(
          {
            tenantId,
            actorUserId: actor.userId,
            action: 'approval.request.rejected',
            resourceType: 'approval_request',
            resourceId: request.id,
            metadata: {
              stepOrder: request.currentStep,
              delegatedFromUserId,
              comment: dto.comment?.trim() || null,
            },
          },
          manager,
        );
        return rejected;
      }

      // APPROVED on current step
      if (request.currentStep < request.totalSteps) {
        const nextStepOrder = request.currentStep + 1;
        const nextStep = request.stepsSnapshot.find((s) => s.stepOrder === nextStepOrder);
        const nextEscalationDueAt =
          nextStep?.escalationAfterMinutes != null
            ? new Date(now.getTime() + nextStep.escalationAfterMinutes * 60_000)
            : null;
        const advanced = await this.repo.updateRequestState(
          tenantId,
          request.id,
          {
            status: 'PENDING',
            currentStep: nextStepOrder,
            stepsSnapshot: request.stepsSnapshot,
            escalationDueAt: nextEscalationDueAt,
            escalatedCount: request.escalatedCount,
            decidedAt: null,
          },
          manager,
        );
        await this.audit.record(
          {
            tenantId,
            actorUserId: actor.userId,
            action: 'approval.step.approved',
            resourceType: 'approval_request',
            resourceId: request.id,
            metadata: {
              approvedStep: request.currentStep,
              nextStep: nextStepOrder,
              delegatedFromUserId,
            },
          },
          manager,
        );
        return advanced;
      }

      // Final step approved
      const finalApproved = await this.repo.updateRequestState(
        tenantId,
        request.id,
        {
          status: 'APPROVED',
          currentStep: request.currentStep,
          stepsSnapshot: request.stepsSnapshot,
          escalationDueAt: null,
          escalatedCount: request.escalatedCount,
          decidedAt: now,
        },
        manager,
      );

      if (request.resourceType === POLICY_CHANGE_RESOURCE_TYPE) {
        await this.applyApprovedGroupBPolicyChange(tenantId, request, actor, manager);
      }

      await this.audit.record(
        {
          tenantId,
          actorUserId: actor.userId,
          action: 'approval.request.approved',
          resourceType: 'approval_request',
          resourceId: request.id,
          metadata: {
            targetResourceType: request.resourceType,
            targetResourceId: request.resourceId,
            amountMinor: request.amountMinor,
            delegatedFromUserId,
          },
        },
        manager,
      );

      return finalApproved;
    });

    if (updated.status === 'PENDING' && updated.escalationDueAt) {
      await this.scheduleEscalationJob(updated);
    }
    return updated;
  }

  private async authorizeStepActor(
    tenantId: string,
    request: ApprovalRequestView,
    step: ApprovalStepSnapshot,
    actor: ApprovalActor,
    mustDifferFromRequester: boolean,
    now: Date,
    manager: EntityManager,
  ): Promise<{ authorized: boolean; delegatedFromUserId: string | null }> {
    const directUserMatch = !step.approverUserId || step.approverUserId === actor.userId;
    const directRoleMatch =
      actor.roleKey === step.approverRole ||
      (actor.roleKey === 'owner' && !step.approverUserId) ||
      (request.resourceType === POLICY_CHANGE_RESOURCE_TYPE &&
        (actor.roleKey === 'owner' || actor.roleKey === 'admin') &&
        !step.approverUserId);

    if (directUserMatch && directRoleMatch) {
      return { authorized: true, delegatedFromUserId: null };
    }

    // Check active delegations for this delegate user
    const delegations = await this.repo.findActiveDelegationsForDelegate(
      tenantId,
      actor.userId,
      request.resourceType,
      request.amountMinor,
      now,
      manager,
    );

    for (const d of delegations) {
      if (mustDifferFromRequester && d.delegatorUserId === request.requestedBy) {
        continue;
      }
      const delegatorUserMatch =
        !step.approverUserId || step.approverUserId === d.delegatorUserId;
      const delegatorRoleMatch =
        d.delegatorRole === step.approverRole ||
        (d.delegatorRole === 'owner' && !step.approverUserId);
      if (delegatorUserMatch && delegatorRoleMatch) {
        return { authorized: true, delegatedFromUserId: d.delegatorUserId };
      }
    }

    return { authorized: false, delegatedFromUserId: null };
  }

  private async applyApprovedGroupBPolicyChange(
    tenantId: string,
    request: ApprovalRequestView,
    secondApprover: ApprovalActor,
    manager: EntityManager,
  ): Promise<void> {
    const key = String(request.payload.key ?? request.resourceId);
    const newValue = request.payload.newValue as PolicyValue;
    const reason = String(request.payload.reason ?? '');

    const definition = getPolicyDefinition(key);
    if (!definition || definition.group !== 'B') {
      throw new BadRequestException(`قاعدهٔ گروه «ب» برای کلید «${key}» معتبر نیست.`);
    }

    const existingRows = (await manager.query(
      `SELECT "value" AS v FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
      [tenantId, key],
    )) as Array<{ v: unknown }>;
    const oldValue = existingRows[0]?.v !== undefined ? existingRows[0].v : definition.default;

    await manager.query(
      `INSERT INTO "tenant_policy_settings" ("tenant_id", "key", "value", "updated_by", "updated_at")
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET
         "value" = EXCLUDED."value",
         "updated_by" = EXCLUDED."updated_by",
         "updated_at" = now()`,
      [tenantId, key, JSON.stringify(newValue), secondApprover.userId.slice(0, 64)],
    );

    await this.audit.record(
      {
        tenantId,
        actorUserId: secondApprover.userId,
        action: 'policy.changed.protected',
        resourceType: 'tenant_policy',
        resourceId: key,
        metadata: {
          key,
          group: 'B',
          oldValue,
          newValue,
          reason,
          requestedBy: request.requestedBy,
          approvedBy: secondApprover.userId,
          approvalRequestId: request.id,
        },
      },
      manager,
    );
  }

  /**
   * Escalates all due pending approval requests for `tenantId` whose `escalation_due_at <= now`.
   * Safe under concurrency: locks each candidate row with `FOR UPDATE` inside `TenantScope`.
   */
  async runDueEscalations(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<{ escalated: number; requestIds: string[] }> {
    const due = await this.repo.findDueEscalations(tenantId, now);
    const requestIds: string[] = [];
    for (const candidate of due) {
      const didEscalate = await this.escalateRequestIfDue(tenantId, candidate.id, now);
      if (didEscalate) {
        requestIds.push(candidate.id);
      }
    }
    return { escalated: requestIds.length, requestIds };
  }

  async escalateRequestIfDue(
    tenantId: string,
    requestId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.repo.transaction(tenantId, async (manager) => {
      const request = await this.repo.findRequestForUpdate(tenantId, requestId, manager);
      if (
        !request ||
        request.status !== 'PENDING' ||
        !request.escalationDueAt ||
        request.escalationDueAt > now
      ) {
        return false;
      }

      const stepsSnapshot = request.stepsSnapshot.map((s) => ({ ...s }));
      const step = stepsSnapshot.find((s) => s.stepOrder === request.currentStep);
      if (!step) return false;

      const previousRole = step.approverRole;
      const targetRole = step.escalateToRole || 'owner';
      step.approverRole = targetRole;
      step.approverUserId = null;

      await this.repo.insertStepDecision(
        tenantId,
        {
          requestId: request.id,
          stepOrder: request.currentStep,
          decision: 'ESCALATED',
          actorUserId: 'system:bullmq',
          actorRole: targetRole,
          delegatedFromUserId: null,
          comment: `Escalated from ${previousRole} to ${targetRole}`,
          decidedAt: now,
        },
        manager,
      );

      await this.repo.updateRequestState(
        tenantId,
        request.id,
        {
          status: 'PENDING',
          currentStep: request.currentStep,
          stepsSnapshot,
          escalationDueAt: null,
          escalatedCount: request.escalatedCount + 1,
          decidedAt: null,
        },
        manager,
      );

      await this.audit.record(
        {
          tenantId,
          actorUserId: 'system:bullmq',
          action: 'approval.request.escalated',
          resourceType: 'approval_request',
          resourceId: request.id,
          metadata: {
            stepOrder: request.currentStep,
            fromRole: previousRole,
            toRole: targetRole,
            escalatedCount: request.escalatedCount + 1,
          },
        },
        manager,
      );

      return true;
    });
  }

  private async scheduleEscalationJob(request: ApprovalRequestView): Promise<void> {
    if (!this.escalationQueue || !request.escalationDueAt) return;
    const delayMs = Math.max(0, request.escalationDueAt.getTime() - Date.now());
    try {
      await this.escalationQueue.add(
        APPROVAL_ESCALATE_REQUEST_JOB,
        {
          tenantId: request.tenantId,
          requestId: request.id,
          stepOrder: request.currentStep,
        },
        {
          delay: delayMs,
          jobId: `approval-escalate-${request.id}-step-${request.currentStep}`,
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue approval escalation job: ${(err as Error).message}`);
    }
  }
}
