/**
 * Lifecycle states of an organisation / tenant (Task T148).
 */
export enum TenantStatus {
  /** Active organisation with full read/write access. */
  ACTIVE = 'active',
  /** Suspended organisation (e.g. overdue billing). */
  SUSPENDED = 'suspended',
  /**
   * Cancelled organisation in read-only retention period.
   * Mutating operations are rejected by CancelledReadonlyGuard.
   * Full data export (CSV/JSON zip) and read operations remain available until delete_after.
   */
  CANCELLED_READONLY = 'cancelled_readonly',
  /** Organisation and all tenant data have been permanently purged. */
  PURGED = 'purged',
}
