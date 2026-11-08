import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PolicyValue } from '../../tenants/policy/policy.registry';
import { ApprovalDecisionKind, ApprovalRequestStatus } from '../constants/approvals.constants';

export class CreateApprovalRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resourceType!: string;

  @IsInt()
  @Min(1)
  stepOrder!: number;

  /** Integer minor units (string or whole number, parsed via modules/accounting/money.ts). */
  @IsOptional()
  minAmountMinor?: string | number;

  /** Upper bound in integer minor units (inclusive), or null/omitted for unbounded. */
  @IsOptional()
  maxAmountMinor?: string | number | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  approverRole!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  approverUserId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  escalationAfterMinutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  escalateToRole?: string | null;

  @IsOptional()
  @IsBoolean()
  requireDistinctApprover?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateDelegationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  delegateUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceType?: string | null;

  @IsOptional()
  maxAmountMinor?: string | number | null;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class CreateApprovalRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resourceType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  resourceId!: string;

  @IsOptional()
  amountMinor?: string | number;

  @IsOptional()
  payload?: Record<string, unknown>;
}

export class DecideApprovalStepDto {
  @IsString()
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RequestGroupBPolicyChangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  key!: string;

  @IsNotEmpty()
  value!: PolicyValue;

  @IsString()
  @MinLength(15)
  @MaxLength(1000)
  reason!: string;
}

export interface ApprovalStepSnapshot {
  stepOrder: number;
  approverRole: string;
  approverUserId: string | null;
  minAmountMinor: string;
  maxAmountMinor: string | null;
  escalationAfterMinutes: number | null;
  escalateToRole: string | null;
  requireDistinctApprover: boolean;
}

export interface ApprovalRuleView {
  id: string;
  tenantId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalDelegationView {
  id: string;
  tenantId: string;
  delegatorUserId: string;
  delegatorRole: string;
  delegateUserId: string;
  resourceType: string | null;
  maxAmountMinor: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ApprovalStepDecisionView {
  id: string;
  requestId: string;
  stepOrder: number;
  decision: ApprovalDecisionKind;
  actorUserId: string;
  actorRole: string;
  delegatedFromUserId: string | null;
  comment: string | null;
  decidedAt: Date;
}

export interface ApprovalRequestView {
  id: string;
  tenantId: string;
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
  escalatedCount: number;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  decisions?: ApprovalStepDecisionView[];
}
