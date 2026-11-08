export const APPROVAL_ESCALATION_QUEUE = 'approval-escalations';
export const APPROVAL_ESCALATION_RUN_JOB = 'run-due-approval-escalations';
export const APPROVAL_ESCALATE_REQUEST_JOB = 'escalate-approval-request';

export type ApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
export type ApprovalDecisionKind = 'APPROVED' | 'REJECTED' | 'ESCALATED';

export const POLICY_CHANGE_RESOURCE_TYPE = 'policy_change';
export const GROUP_B_MIN_REASON_LENGTH = 15;
