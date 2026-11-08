import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { EntityManager } from 'typeorm';
import { AuditService } from '../access/services/audit.service';
import {
  APPROVAL_ESCALATE_REQUEST_JOB,
  APPROVAL_ESCALATION_RUN_JOB,
} from './constants/approvals.constants';
import { ApprovalEscalationProcessor } from './processors/approval-escalation.processor';
import { ApprovalsRepository } from './repositories/approvals.repository';
import { ApprovalsService } from './services/approvals.service';

const T1 = '11111111-1111-4111-8111-111111111111';

describe('ApprovalsService & ApprovalEscalationProcessor (unit)', () => {
  function makeMockHarness() {
    const audit = {
      record: jest.fn<Promise<void>, [Record<string, unknown>]>(async () => undefined),
    } as unknown as AuditService;
    const queue = {
      add: jest.fn(async () => ({ id: 'job-1' })),
    } as unknown as Queue;
    const fakeManager = {
      query: jest.fn(async () => []),
    } as unknown as EntityManager;

    const repo = {
      transaction: jest.fn(
        <T>(_tenantId: string, work: (m: EntityManager) => Promise<T>) => work(fakeManager),
      ),
      within: jest.fn(
        <T>(_tenantId: string, m: EntityManager | undefined, work: (em: EntityManager) => Promise<T>) =>
          work(m ?? fakeManager),
      ),
      upsertRule: jest.fn(),
      listRules: jest.fn(),
      findMatchingRules: jest.fn(),
      createDelegation: jest.fn(),
      revokeDelegation: jest.fn(),
      findActiveDelegationsForDelegate: jest.fn(async () => []),
      createRequest: jest.fn(),
      findRequestById: jest.fn(),
      findRequestForUpdate: jest.fn(),
      listRequests: jest.fn(),
      updateRequestState: jest.fn(),
      insertStepDecision: jest.fn(async () => ({})),
      listStepDecisions: jest.fn(async () => []),
      findDueEscalations: jest.fn(async () => []),
    } as unknown as jest.Mocked<ApprovalsRepository>;

    const service = new ApprovalsService(repo, audit, queue);
    const processor = new ApprovalEscalationProcessor(service);
    return { service, processor, repo, audit, queue, fakeManager };
  }

  it('validates rule thresholds in integer minor units and rejects negative or inverted bounds', async () => {
    const { service } = makeMockHarness();
    const owner = { userId: 'u-owner', roleKey: 'owner' };

    await expect(
      service.upsertRule(T1, { userId: 'u-acc', roleKey: 'accountant' }, {
        resourceType: 'payment',
        stepOrder: 1,
        approverRole: 'owner',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.upsertRule(T1, owner, {
        resourceType: 'payment',
        stepOrder: 1,
        minAmountMinor: '500000',
        maxAmountMinor: '100000',
        approverRole: 'owner',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.upsertRule(T1, owner, {
        resourceType: 'payment',
        stepOrder: 1,
        minAmountMinor: '12.345',
        approverRole: 'owner',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects self-delegation and invalid time windows', async () => {
    const { service } = makeMockHarness();
    const actor = { userId: 'u-1', roleKey: 'admin' };

    await expect(
      service.createDelegation(T1, actor, {
        delegateUserId: 'u-1',
        startsAt: '2026-11-08T00:00:00.000Z',
        endsAt: '2026-11-09T00:00:00.000Z',
        reason: 'مرخصی سالانه',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createDelegation(T1, actor, {
        delegateUserId: 'u-2',
        startsAt: '2026-11-09T00:00:00.000Z',
        endsAt: '2026-11-08T00:00:00.000Z',
        reason: 'مرخصی سالانه',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('schedules a delayed BullMQ escalation job when a step carries escalationAfterMinutes', async () => {
    const { service, repo, queue } = makeMockHarness();
    const now = new Date('2026-11-08T10:00:00.000Z');
    const dueAt = new Date('2026-11-08T10:30:00.000Z');

    repo.findMatchingRules.mockResolvedValue([
      {
        id: 'r-1',
        tenantId: T1,
        resourceType: 'payment',
        stepOrder: 1,
        minAmountMinor: '0',
        maxAmountMinor: null,
        approverRole: 'admin',
        approverUserId: null,
        escalationAfterMinutes: 30,
        escalateToRole: 'owner',
        requireDistinctApprover: true,
        active: true,
        createdBy: 'u-owner',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    repo.createRequest.mockResolvedValue({
      id: 'req-1',
      tenantId: T1,
      resourceType: 'payment',
      resourceId: 'pay-101',
      amountMinor: '25000000',
      requestedBy: 'u-req',
      requestedByRole: 'accountant',
      status: 'PENDING',
      currentStep: 1,
      totalSteps: 1,
      stepsSnapshot: [
        {
          stepOrder: 1,
          approverRole: 'admin',
          approverUserId: null,
          minAmountMinor: '0',
          maxAmountMinor: null,
          escalationAfterMinutes: 30,
          escalateToRole: 'owner',
          requireDistinctApprover: true,
        },
      ],
      payload: {},
      escalationDueAt: dueAt,
      escalatedCount: 0,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await service.createRequest(
      T1,
      { userId: 'u-req', roleKey: 'accountant' },
      { resourceType: 'payment', resourceId: 'pay-101', amountMinor: '25000000' },
      now,
    );

    expect(queue.add).toHaveBeenCalledWith(
      APPROVAL_ESCALATE_REQUEST_JOB,
      { tenantId: T1, requestId: 'req-1', stepOrder: 1 },
      expect.objectContaining({
        jobId: 'approval-escalate-req-1-step-1',
      }),
    );
  });

  it('ApprovalEscalationProcessor processes both single-request and tenant-wide escalation jobs', async () => {
    const { processor, service } = makeMockHarness();
    jest.spyOn(service, 'escalateRequestIfDue').mockResolvedValue(true);
    jest.spyOn(service, 'runDueEscalations').mockResolvedValue({
      escalated: 2,
      requestIds: ['req-1', 'req-2'],
    });

    const single = await processor.process({
      name: APPROVAL_ESCALATE_REQUEST_JOB,
      data: { tenantId: T1, requestId: 'req-1', stepOrder: 1 },
    } as unknown as Job);
    expect(single).toEqual({ escalated: 1 });

    const batch = await processor.process({
      name: APPROVAL_ESCALATION_RUN_JOB,
      data: { tenantId: T1 },
    } as unknown as Job);
    expect(batch).toEqual({ escalated: 2 });
  });

  it('validates Group B policy change requests and rejects Group A or Group C or short reasons', async () => {
    const { service } = makeMockHarness();
    const owner = { userId: 'u-owner-1', roleKey: 'owner' };

    await expect(
      service.requestGroupBPolicyChange(T1, owner, {
        key: 'ledger.posted_voucher_immutable',
        value: true,
        reason: 'x'.repeat(20),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.requestGroupBPolicyChange(T1, owner, {
        key: 'purchase.three_way.qty_excess_tolerance_bp',
        value: 100,
        reason: 'x'.repeat(20),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.requestGroupBPolicyChange(T1, owner, {
        key: 'purchase.invoice_review.reviewer_rule',
        value: 'creator_may_accept',
        reason: 'too-short',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
