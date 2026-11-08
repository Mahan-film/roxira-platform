import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ApprovalDecisionKind, ApprovalRequestStatus } from '../constants/approvals.constants';
import {
  ApprovalDelegationView,
  ApprovalRequestView,
  ApprovalRuleView,
  ApprovalStepDecisionView,
  ApprovalStepSnapshot,
} from '../dto/approvals.dto';

export interface InsertRuleParams {
  resourceType: string;
  stepOrder: number;
  minAmountMinor: string;
  maxAmountMinor: string | null;
  approverRole: string;
  approverUserId: string | null;
  escalationAfterMinutes: number | null;
  escalateToRole: string | null;
  requireDistinctApprover: boolean;
  active: boolean;
  createdBy: string;
}

export interface InsertDelegationParams {
  delegatorUserId: string;
  delegatorRole: string;
  delegateUserId: string;
  resourceType: string | null;
  maxAmountMinor: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

export interface InsertRequestParams {
  resourceType: string;
  resourceId: string;
  amountMinor: string;
  requestedBy: string;
  requestedByRole: string;
  status: ApprovalRequestStatus;
  currentStep: number;
  totalSteps: number;
  stepsSnapshot: ApprovalStepSnapshot[];
  payload: Record<string, unknown>;
  escalationDueAt: Date | null;
}

export interface InsertStepDecisionParams {
  requestId: string;
  stepOrder: number;
  decision: ApprovalDecisionKind;
  actorUserId: string;
  actorRole: string;
  delegatedFromUserId: string | null;
  comment: string | null;
  decidedAt: Date;
}

@Injectable()
export class ApprovalsRepository {
  constructor(private readonly scope: TenantScope) {}

  transaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  within<T>(
    tenantId: string,
    manager: EntityManager | undefined,
    work: (m: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  async upsertRule(
    tenantId: string,
    params: InsertRuleParams,
    manager?: EntityManager,
  ): Promise<ApprovalRuleView> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `INSERT INTO "tenant_approval_rules" (
           "tenant_id", "resource_type", "step_order", "min_amount_minor", "max_amount_minor",
           "approver_role", "approver_user_id", "escalation_after_minutes", "escalate_to_role",
           "require_distinct_approver", "active", "created_by", "updated_at"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
         ON CONFLICT ("tenant_id", "resource_type", "step_order", "min_amount_minor")
         DO UPDATE SET
           "max_amount_minor" = EXCLUDED."max_amount_minor",
           "approver_role" = EXCLUDED."approver_role",
           "approver_user_id" = EXCLUDED."approver_user_id",
           "escalation_after_minutes" = EXCLUDED."escalation_after_minutes",
           "escalate_to_role" = EXCLUDED."escalate_to_role",
           "require_distinct_approver" = EXCLUDED."require_distinct_approver",
           "active" = EXCLUDED."active",
           "updated_at" = now()
         RETURNING *`,
        [
          tenantId,
          params.resourceType,
          params.stepOrder,
          params.minAmountMinor,
          params.maxAmountMinor,
          params.approverRole,
          params.approverUserId,
          params.escalationAfterMinutes,
          params.escalateToRole,
          params.requireDistinctApprover,
          params.active,
          params.createdBy,
        ],
      )) as Array<Record<string, unknown>>;
      return mapRule(rows[0]);
    });
  }

  async listRules(
    tenantId: string,
    resourceType?: string,
    manager?: EntityManager,
  ): Promise<ApprovalRuleView[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = resourceType
        ? ((await m.query(
            `SELECT * FROM "tenant_approval_rules"
             WHERE "tenant_id" = $1 AND "resource_type" = $2
             ORDER BY "step_order" ASC, "min_amount_minor" ASC`,
            [tenantId, resourceType],
          )) as Array<Record<string, unknown>>)
        : ((await m.query(
            `SELECT * FROM "tenant_approval_rules"
             WHERE "tenant_id" = $1
             ORDER BY "resource_type" ASC, "step_order" ASC, "min_amount_minor" ASC`,
            [tenantId],
          )) as Array<Record<string, unknown>>);
      return rows.map(mapRule);
    });
  }

  async findMatchingRules(
    tenantId: string,
    resourceType: string,
    amountMinor: string,
    manager?: EntityManager,
  ): Promise<ApprovalRuleView[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `SELECT * FROM "tenant_approval_rules"
         WHERE "tenant_id" = $1
           AND "resource_type" = $2
           AND "active" = true
           AND "min_amount_minor" <= $3::bigint
           AND ("max_amount_minor" IS NULL OR "max_amount_minor" >= $3::bigint)
         ORDER BY "step_order" ASC, "min_amount_minor" DESC`,
        [tenantId, resourceType, amountMinor],
      )) as Array<Record<string, unknown>>;
      return rows.map(mapRule);
    });
  }

  async createDelegation(
    tenantId: string,
    params: InsertDelegationParams,
    manager?: EntityManager,
  ): Promise<ApprovalDelegationView> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `INSERT INTO "tenant_approval_delegations" (
           "tenant_id", "delegator_user_id", "delegator_role", "delegate_user_id",
           "resource_type", "max_amount_minor", "starts_at", "ends_at", "reason"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          params.delegatorUserId,
          params.delegatorRole,
          params.delegateUserId,
          params.resourceType,
          params.maxAmountMinor,
          params.startsAt,
          params.endsAt,
          params.reason,
        ],
      )) as Array<Record<string, unknown>>;
      return mapDelegation(rows[0]);
    });
  }

  async revokeDelegation(
    tenantId: string,
    delegationId: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<ApprovalDelegationView | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      const res = await m.query(
        `UPDATE "tenant_approval_delegations"
         SET "revoked_at" = $3
         WHERE "tenant_id" = $1 AND "id" = $2
         RETURNING *`,
        [tenantId, delegationId, now],
      );
      const row = firstReturningRow(res);
      return row ? mapDelegation(row) : null;
    });
  }

  async findActiveDelegationsForDelegate(
    tenantId: string,
    delegateUserId: string,
    resourceType: string,
    amountMinor: string,
    at: Date,
    manager?: EntityManager,
  ): Promise<ApprovalDelegationView[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `SELECT * FROM "tenant_approval_delegations"
         WHERE "tenant_id" = $1
           AND "delegate_user_id" = $2
           AND "revoked_at" IS NULL
           AND "starts_at" <= $5
           AND "ends_at" > $5
           AND ("resource_type" IS NULL OR "resource_type" = $3)
           AND ("max_amount_minor" IS NULL OR "max_amount_minor" >= $4::bigint)
         ORDER BY "created_at" DESC`,
        [tenantId, delegateUserId, resourceType, amountMinor, at],
      )) as Array<Record<string, unknown>>;
      return rows.map(mapDelegation);
    });
  }

  async createRequest(
    tenantId: string,
    params: InsertRequestParams,
    manager?: EntityManager,
  ): Promise<ApprovalRequestView> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `INSERT INTO "tenant_approval_requests" (
           "tenant_id", "resource_type", "resource_id", "amount_minor",
           "requested_by", "requested_by_role", "status", "current_step",
           "total_steps", "steps_snapshot", "payload", "escalation_due_at"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
         RETURNING *`,
        [
          tenantId,
          params.resourceType,
          params.resourceId,
          params.amountMinor,
          params.requestedBy,
          params.requestedByRole,
          params.status,
          params.currentStep,
          params.totalSteps,
          JSON.stringify(params.stepsSnapshot),
          JSON.stringify(params.payload),
          params.escalationDueAt,
        ],
      )) as Array<Record<string, unknown>>;
      return mapRequest(rows[0]);
    });
  }

  async findRequestById(
    tenantId: string,
    requestId: string,
    manager?: EntityManager,
  ): Promise<ApprovalRequestView | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `SELECT * FROM "tenant_approval_requests"
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, requestId],
      )) as Array<Record<string, unknown>>;
      if (!rows[0]) return null;
      const decisions = await this.listStepDecisions(tenantId, requestId, m);
      return { ...mapRequest(rows[0]), decisions };
    });
  }

  async findRequestForUpdate(
    tenantId: string,
    requestId: string,
    manager: EntityManager,
  ): Promise<ApprovalRequestView | null> {
    const rows = (await manager.query(
      `SELECT * FROM "tenant_approval_requests"
       WHERE "tenant_id" = $1 AND "id" = $2
       FOR UPDATE`,
      [tenantId, requestId],
    )) as Array<Record<string, unknown>>;
    if (!rows[0]) return null;
    const decisions = await this.listStepDecisions(tenantId, requestId, manager);
    return { ...mapRequest(rows[0]), decisions };
  }

  async listRequests(
    tenantId: string,
    status?: ApprovalRequestStatus,
    manager?: EntityManager,
  ): Promise<ApprovalRequestView[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = status
        ? ((await m.query(
            `SELECT * FROM "tenant_approval_requests"
             WHERE "tenant_id" = $1 AND "status" = $2
             ORDER BY "created_at" DESC`,
            [tenantId, status],
          )) as Array<Record<string, unknown>>)
        : ((await m.query(
            `SELECT * FROM "tenant_approval_requests"
             WHERE "tenant_id" = $1
             ORDER BY "created_at" DESC`,
            [tenantId],
          )) as Array<Record<string, unknown>>);
      return rows.map(mapRequest);
    });
  }

  async updateRequestState(
    tenantId: string,
    requestId: string,
    patch: {
      status: ApprovalRequestStatus;
      currentStep: number;
      stepsSnapshot: ApprovalStepSnapshot[];
      escalationDueAt: Date | null;
      escalatedCount: number;
      decidedAt: Date | null;
    },
    manager: EntityManager,
  ): Promise<ApprovalRequestView> {
    const res = await manager.query(
      `UPDATE "tenant_approval_requests"
       SET "status" = $3,
           "current_step" = $4,
           "steps_snapshot" = $5::jsonb,
           "escalation_due_at" = $6,
           "escalated_count" = $7,
           "decided_at" = $8,
           "updated_at" = now()
       WHERE "tenant_id" = $1 AND "id" = $2
       RETURNING *`,
      [
        tenantId,
        requestId,
        patch.status,
        patch.currentStep,
        JSON.stringify(patch.stepsSnapshot),
        patch.escalationDueAt,
        patch.escalatedCount,
        patch.decidedAt,
      ],
    );
    const row = firstReturningRow(res)!;
    const decisions = await this.listStepDecisions(tenantId, requestId, manager);
    return { ...mapRequest(row), decisions };
  }

  async insertStepDecision(
    tenantId: string,
    params: InsertStepDecisionParams,
    manager: EntityManager,
  ): Promise<ApprovalStepDecisionView> {
    const rows = (await manager.query(
      `INSERT INTO "tenant_approval_step_decisions" (
         "tenant_id", "request_id", "step_order", "decision",
         "actor_user_id", "actor_role", "delegated_from_user_id", "comment", "decided_at"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tenantId,
        params.requestId,
        params.stepOrder,
        params.decision,
        params.actorUserId,
        params.actorRole,
        params.delegatedFromUserId,
        params.comment,
        params.decidedAt,
      ],
    )) as Array<Record<string, unknown>>;
    return mapStepDecision(rows[0]);
  }

  async listStepDecisions(
    tenantId: string,
    requestId: string,
    manager?: EntityManager,
  ): Promise<ApprovalStepDecisionView[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `SELECT * FROM "tenant_approval_step_decisions"
         WHERE "tenant_id" = $1 AND "request_id" = $2
         ORDER BY "decided_at" ASC, "step_order" ASC`,
        [tenantId, requestId],
      )) as Array<Record<string, unknown>>;
      return rows.map(mapStepDecision);
    });
  }

  async findDueEscalations(
    tenantId: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<ApprovalRequestView[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const rows = (await m.query(
        `SELECT * FROM "tenant_approval_requests"
         WHERE "tenant_id" = $1
           AND "status" = 'PENDING'
           AND "escalation_due_at" IS NOT NULL
           AND "escalation_due_at" <= $2
         ORDER BY "escalation_due_at" ASC`,
        [tenantId, now],
      )) as Array<Record<string, unknown>>;
      return rows.map(mapRequest);
    });
  }
}

function firstReturningRow(result: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const first = result[0];
  if (Array.isArray(first)) {
    return first[0] as Record<string, unknown> | undefined;
  }
  return first as Record<string, unknown>;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapRule(row: Record<string, unknown>): ApprovalRuleView {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    resourceType: String(row.resource_type),
    stepOrder: Number(row.step_order),
    minAmountMinor: String(row.min_amount_minor),
    maxAmountMinor: row.max_amount_minor != null ? String(row.max_amount_minor) : null,
    approverRole: String(row.approver_role),
    approverUserId: row.approver_user_id != null ? String(row.approver_user_id) : null,
    escalationAfterMinutes:
      row.escalation_after_minutes != null ? Number(row.escalation_after_minutes) : null,
    escalateToRole: row.escalate_to_role != null ? String(row.escalate_to_role) : null,
    requireDistinctApprover: Boolean(row.require_distinct_approver),
    active: Boolean(row.active),
    createdBy: String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDelegation(row: Record<string, unknown>): ApprovalDelegationView {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    delegatorUserId: String(row.delegator_user_id),
    delegatorRole: String(row.delegator_role),
    delegateUserId: String(row.delegate_user_id),
    resourceType: row.resource_type != null ? String(row.resource_type) : null,
    maxAmountMinor: row.max_amount_minor != null ? String(row.max_amount_minor) : null,
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    reason: String(row.reason),
    revokedAt: row.revoked_at != null ? toDate(row.revoked_at) : null,
    createdAt: toDate(row.created_at),
  };
}

function mapRequest(row: Record<string, unknown>): ApprovalRequestView {
  const rawSteps = row.steps_snapshot;
  const stepsSnapshot: ApprovalStepSnapshot[] = Array.isArray(rawSteps)
    ? (rawSteps as ApprovalStepSnapshot[])
    : typeof rawSteps === 'string'
      ? (JSON.parse(rawSteps) as ApprovalStepSnapshot[])
      : [];
  const rawPayload = row.payload;
  const payload: Record<string, unknown> =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? (rawPayload as Record<string, unknown>)
      : typeof rawPayload === 'string'
        ? (JSON.parse(rawPayload) as Record<string, unknown>)
        : {};
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    amountMinor: String(row.amount_minor),
    requestedBy: String(row.requested_by),
    requestedByRole: String(row.requested_by_role),
    status: String(row.status) as ApprovalRequestStatus,
    currentStep: Number(row.current_step),
    totalSteps: Number(row.total_steps),
    stepsSnapshot,
    payload,
    escalationDueAt: row.escalation_due_at != null ? toDate(row.escalation_due_at) : null,
    escalatedCount: Number(row.escalated_count ?? 0),
    decidedAt: row.decided_at != null ? toDate(row.decided_at) : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapStepDecision(row: Record<string, unknown>): ApprovalStepDecisionView {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    stepOrder: Number(row.step_order),
    decision: String(row.decision) as ApprovalDecisionKind,
    actorUserId: String(row.actor_user_id),
    actorRole: String(row.actor_role),
    delegatedFromUserId:
      row.delegated_from_user_id != null ? String(row.delegated_from_user_id) : null,
    comment: row.comment != null ? String(row.comment) : null,
    decidedAt: toDate(row.decided_at),
  };
}
