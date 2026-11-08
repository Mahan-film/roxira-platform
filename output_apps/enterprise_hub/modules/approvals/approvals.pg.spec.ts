/**
 * Approval engine (#584-5 / T2) on a REAL PostgreSQL as a NOSUPERUSER NOBYPASSRLS role:
 *   1. Table-driven approval steps with integer minor-unit amount thresholds
 *   2. Multi-step progression and maker-checker enforcement (no self-approval or duplicate step approval)
 *   3. Time-bounded and amount-bounded delegation with revocation
 *   4. BullMQ escalation (`runDueEscalations` / `ApprovalEscalationProcessor`)
 *   5. Group B policy changes requiring a second distinct approver and atomically updating `tenant_policy_settings`
 *   6. Cross-tenant FORCE RLS isolation on all 4 approval tables
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55471 npx jest modules/approvals/approvals.pg.spec.ts --runInBand
 */
import 'reflect-metadata';
import * as path from 'path';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuditService } from '../access/services/audit.service';
import { TenantScope } from '../access/services/tenant-scope';
import { APPROVAL_ESCALATE_REQUEST_JOB } from './constants/approvals.constants';
import { ApprovalEscalationProcessor } from './processors/approval-escalation.processor';
import { ApprovalsRepository } from './repositories/approvals.repository';
import { ApprovalsService } from './services/approvals.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'approvals-app-test-only';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Approvals engine on PostgreSQL (NOSUPERUSER NOBYPASSRLS, FORCE RLS)', () => {
  const db = `rx_approvals_${process.pid}_${Date.now()}`;
  const role = `rx_approvals_app_${process.pid}`;
  let admin: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let repo: ApprovalsRepository;
  let service: ApprovalsService;
  let processor: ApprovalEscalationProcessor;
  let auditCalls: Array<Record<string, unknown>>;
  let queuedJobs: Array<{ name: string; data: unknown; opts: unknown }>;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    ownerDs = await new DataSource(options(db)).initialize();
    await ownerDs.runMigrations();
    await ownerDs.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    appDs = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();

    scope = new TenantScope(appDs);
    repo = new ApprovalsRepository(scope);
    auditCalls = [];
    queuedJobs = [];
    const audit = {
      record: async (entry: Record<string, unknown>): Promise<void> => {
        auditCalls.push(entry);
      },
    } as unknown as AuditService;
    const fakeQueue = {
      add: async (name: string, data: unknown, opts: unknown) => {
        queuedJobs.push({ name, data, opts });
        return { id: 'job-1' };
      },
    } as unknown as Queue;
    service = new ApprovalsService(repo, audit, fakeQueue);
    processor = new ApprovalEscalationProcessor(service);
  }, 240_000);

  afterAll(async () => {
    await appDs?.destroy();
    await ownerDs?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('enforces table-driven steps and amount thresholds (1 step below threshold, 2 steps at/above threshold)', async () => {
    const ownerActor = { userId: 'u-owner-1', roleKey: 'owner' };
    const adminActor = { userId: 'u-admin-1', roleKey: 'admin' };
    const requester = { userId: 'u-req-1', roleKey: 'accountant' };

    // Step 1 applies to all purchase_order amounts >= 0 (approver: admin)
    await service.upsertRule(TENANT_A, ownerActor, {
      resourceType: 'purchase_order',
      stepOrder: 1,
      minAmountMinor: '0',
      maxAmountMinor: null,
      approverRole: 'admin',
      requireDistinctApprover: true,
    });

    // Step 2 applies only when amount >= 100_000_000 minor units (approver: owner)
    await service.upsertRule(TENANT_A, ownerActor, {
      resourceType: 'purchase_order',
      stepOrder: 2,
      minAmountMinor: '100000000',
      maxAmountMinor: null,
      approverRole: 'owner',
      requireDistinctApprover: true,
    });

    // Low amount (50_000_000): 1 step only
    const smallReq = await service.createRequest(TENANT_A, requester, {
      resourceType: 'purchase_order',
      resourceId: 'PO-SMALL',
      amountMinor: '50000000',
    });
    expect(smallReq.totalSteps).toBe(1);
    expect(smallReq.currentStep).toBe(1);

    const smallApproved = await service.decide(TENANT_A, smallReq.id, adminActor, {
      decision: 'APPROVED',
      comment: 'تأیید سفارش کوچک',
    });
    expect(smallApproved.status).toBe('APPROVED');

    // High amount (150_000_000): 2 steps required
    const largeReq = await service.createRequest(TENANT_A, requester, {
      resourceType: 'purchase_order',
      resourceId: 'PO-LARGE',
      amountMinor: '150000000',
    });
    expect(largeReq.totalSteps).toBe(2);
    expect(largeReq.currentStep).toBe(1);

    // Requester cannot self-approve
    await expect(
      service.decide(TENANT_A, largeReq.id, requester, { decision: 'APPROVED' }),
    ).rejects.toThrow(/درخواست‌کننده نمی‌تواند/);

    // Step 1 approved by admin -> moves to step 2 (still PENDING)
    const afterStep1 = await service.decide(TENANT_A, largeReq.id, adminActor, {
      decision: 'APPROVED',
      comment: 'تأیید مرحله اول',
    });
    expect(afterStep1.status).toBe('PENDING');
    expect(afterStep1.currentStep).toBe(2);

    // Same user (adminActor) cannot approve step 2 even if they had the role
    await expect(
      service.decide(
        TENANT_A,
        largeReq.id,
        { userId: adminActor.userId, roleKey: 'owner' },
        { decision: 'APPROVED' },
      ),
    ).rejects.toThrow(/بیش از یک مرحله/);

    // Step 2 approved by distinct owner -> APPROVED
    const afterStep2 = await service.decide(TENANT_A, largeReq.id, ownerActor, {
      decision: 'APPROVED',
      comment: 'تأیید نهایی مالک',
    });
    expect(afterStep2.status).toBe('APPROVED');
    expect(afterStep2.decisions).toHaveLength(2);
  });

  it('allows an active delegate within the time and amount window to approve, and blocks revoked or exceeded delegations', async () => {
    const ownerActor = { userId: 'u-owner-1', roleKey: 'owner' };
    const adminDelegator = { userId: 'u-admin-1', roleKey: 'admin' };
    const delegateActor = { userId: 'u-sales-delegate', roleKey: 'sales' };
    const requester = { userId: 'u-req-2', roleKey: 'accountant' };

    await service.upsertRule(TENANT_A, ownerActor, {
      resourceType: 'expense',
      stepOrder: 1,
      minAmountMinor: '0',
      approverRole: 'admin',
      requireDistinctApprover: true,
    });

    const expReq = await service.createRequest(TENANT_A, requester, {
      resourceType: 'expense',
      resourceId: 'EXP-1',
      amountMinor: '20000000',
    });

    // Without delegation, sales user is refused
    await expect(
      service.decide(TENANT_A, expReq.id, delegateActor, { decision: 'APPROVED' }),
    ).rejects.toThrow(/اجازهٔ تصمیم‌گیری/);

    // Admin delegates to sales user up to 30_000_000 minor units
    const delegation = await service.createDelegation(TENANT_A, adminDelegator, {
      delegateUserId: delegateActor.userId,
      resourceType: 'expense',
      maxAmountMinor: '30000000',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-11-15T00:00:00.000Z',
      reason: 'تفویض اختیار در زمان ماموریت',
    });

    const decidedAt = new Date('2026-11-08T12:00:00.000Z');
    const approvedViaDelegation = await service.decide(
      TENANT_A,
      expReq.id,
      delegateActor,
      { decision: 'APPROVED', comment: 'تأیید به نیابت' },
      decidedAt,
    );
    expect(approvedViaDelegation.status).toBe('APPROVED');
    expect(approvedViaDelegation.decisions?.[0].delegatedFromUserId).toBe(adminDelegator.userId);

    // Request above delegation cap (50_000_000 > 30_000_000) is refused for delegate
    const overCapReq = await service.createRequest(TENANT_A, requester, {
      resourceType: 'expense',
      resourceId: 'EXP-OVER',
      amountMinor: '50000000',
    });
    await expect(
      service.decide(TENANT_A, overCapReq.id, delegateActor, { decision: 'APPROVED' }, decidedAt),
    ).rejects.toThrow(/اجازهٔ تصمیم‌گیری/);

    // Revoking delegation blocks subsequent approvals even within cap
    await service.revokeDelegation(TENANT_A, adminDelegator, delegation.id, decidedAt);
    const afterRevokeReq = await service.createRequest(TENANT_A, requester, {
      resourceType: 'expense',
      resourceId: 'EXP-AFTER-REVOKE',
      amountMinor: '10000000',
    });
    await expect(
      service.decide(TENANT_A, afterRevokeReq.id, delegateActor, { decision: 'APPROVED' }, decidedAt),
    ).rejects.toThrow(/اجازهٔ تصمیم‌گیری/);
  });

  it('escalates overdue steps on BullMQ from the initial role to escalateToRole', async () => {
    const ownerActor = { userId: 'u-owner-1', roleKey: 'owner' };
    const requester = { userId: 'u-req-3', roleKey: 'sales' };
    const accountantActor = { userId: 'u-acc-escalated', roleKey: 'accountant' };

    await service.upsertRule(TENANT_A, ownerActor, {
      resourceType: 'credit_override',
      stepOrder: 1,
      minAmountMinor: '0',
      approverRole: 'admin',
      escalationAfterMinutes: 15,
      escalateToRole: 'accountant',
      requireDistinctApprover: true,
    });

    const t0 = new Date('2026-11-08T08:00:00.000Z');
    const req = await service.createRequest(
      TENANT_A,
      requester,
      {
        resourceType: 'credit_override',
        resourceId: 'CRD-99',
        amountMinor: '10000000',
      },
      t0,
    );
    expect(req.escalationDueAt?.toISOString()).toBe('2026-11-08T08:15:00.000Z');
    expect(
      queuedJobs.some(
        (j) =>
          j.name === APPROVAL_ESCALATE_REQUEST_JOB &&
          (j.data as { requestId: string }).requestId === req.id,
      ),
    ).toBe(true);

    // Before due time (08:10), escalation is a no-op
    const early = await service.runDueEscalations(TENANT_A, new Date('2026-11-08T08:10:00.000Z'));
    expect(early.escalated).toBe(0);

    // At due time (08:16), BullMQ processor / runDueEscalations escalates to accountant
    const dueTime = new Date('2026-11-08T08:16:00.000Z');
    const dueResult = await service.runDueEscalations(TENANT_A, dueTime);
    expect(dueResult).toEqual({ escalated: 1, requestIds: [req.id] });

    // Running processor again is idempotent (0 escalated)
    const repeatJob = await processor.process({
      name: APPROVAL_ESCALATE_REQUEST_JOB,
      data: { tenantId: TENANT_A, requestId: req.id },
    } as unknown as Job);
    expect(repeatJob).toEqual({ escalated: 0 });

    // Escalated target role ('accountant') can now approve the request
    const approvedAfterEscalation = await service.decide(
      TENANT_A,
      req.id,
      accountantActor,
      { decision: 'APPROVED', comment: 'تأیید پس از ارجاع خودکار' },
      dueTime,
    );
    expect(approvedAfterEscalation.status).toBe('APPROVED');
    expect(approvedAfterEscalation.escalatedCount).toBe(1);
    expect(approvedAfterEscalation.decisions?.map((d) => d.decision)).toEqual([
      'ESCALATED',
      'APPROVED',
    ]);
  });

  it('requires a second distinct approver for Group B policy changes and atomically updates tenant_policy_settings', async () => {
    const firstAdmin = { userId: 'u-admin-maker', roleKey: 'admin' };
    const secondOwner = { userId: 'u-owner-checker', roleKey: 'owner' };
    const key = 'purchase.invoice_review.reviewer_rule';

    const policyReq = await service.requestGroupBPolicyChange(TENANT_A, firstAdmin, {
      key,
      value: 'creator_may_accept',
      reason: 'تغییر موقت قاعده با تأیید دو نفر از مدیران سازمان',
    });
    expect(policyReq.status).toBe('PENDING');
    expect(policyReq.resourceType).toBe('policy_change');
    expect(policyReq.resourceId).toBe(key);

    // Policy is NOT yet changed in tenant_policy_settings before second approver approves
    await scope.run(TENANT_A, async (m) => {
      const before = await m.query(
        `SELECT "value" FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
        [TENANT_A, key],
      );
      expect(before).toEqual([]);
    });

    // First admin (requester) cannot self-approve their own Group B policy change
    await expect(
      service.decide(TENANT_A, policyReq.id, firstAdmin, { decision: 'APPROVED' }),
    ).rejects.toThrow(/نیاز به تأییدکنندهٔ دوم/);

    // Second distinct approver (owner) approves -> policy is written and audited
    const approved = await service.decide(TENANT_A, policyReq.id, secondOwner, {
      decision: 'APPROVED',
      comment: 'موافقت مدیر دوم با تغییر قاعدهٔ گروه ب',
    });
    expect(approved.status).toBe('APPROVED');

    await scope.run(TENANT_A, async (m) => {
      const rows = (await m.query(
        `SELECT "value", "updated_by" FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
        [TENANT_A, key],
      )) as Array<{ value: unknown; updated_by: string }>;
      expect(rows).toEqual([
        {
          value: 'creator_may_accept',
          updated_by: secondOwner.userId,
        },
      ]);
    });

    expect(
      auditCalls.some(
        (a) =>
          a.action === 'policy.changed.protected' &&
          a.resourceId === key &&
          (a.metadata as Record<string, unknown>).requestedBy === firstAdmin.userId &&
          (a.metadata as Record<string, unknown>).approvedBy === secondOwner.userId,
      ),
    ).toBe(true);
  });

  it('enforces FORCE RLS across tenants on all 4 approval tables as a NOSUPERUSER role', async () => {
    // Tenant B cannot see or mutate any rules, delegations, requests, or decisions of Tenant A
    expect(await service.listRules(TENANT_B)).toEqual([]);
    expect(await service.listRequests(TENANT_B)).toEqual([]);

    const tenantARequests = await service.listRequests(TENANT_A);
    expect(tenantARequests.length).toBeGreaterThan(0);
    const targetRequestId = tenantARequests[0].id;

    await expect(service.getRequest(TENANT_B, targetRequestId)).rejects.toThrow(/یافت نشد/);

    await appDs.transaction(async (m) => {
      await TenantScope.bind(m, TENANT_B);
      expect(
        await m.query(`SELECT "id" FROM "tenant_approval_rules" WHERE "tenant_id" = $1`, [TENANT_A]),
      ).toEqual([]);
      expect(
        await m.query(`SELECT "id" FROM "tenant_approval_delegations" WHERE "tenant_id" = $1`, [TENANT_A]),
      ).toEqual([]);
      expect(
        await m.query(`SELECT "id" FROM "tenant_approval_requests" WHERE "tenant_id" = $1`, [TENANT_A]),
      ).toEqual([]);
      expect(
        await m.query(`SELECT "id" FROM "tenant_approval_step_decisions" WHERE "tenant_id" = $1`, [TENANT_A]),
      ).toEqual([]);
    });
  });
});
