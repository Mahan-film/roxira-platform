import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

export type CaptureStatus =
  | 'draft'
  | 'needs_review'
  | 'posted'
  | 'auto_posted'
  | 'rejected'
  | 'reversed';

/** One captured source document and its draft. Every row belongs to exactly one tenant. */
@Entity({ name: 'capture_documents' })
@Index('IDX_capture_documents_tenant_status', ['tenantId', 'status', 'createdAt'])
export class CaptureDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: CaptureStatus;

  @Column({ type: 'varchar', length: 16, name: 'source_kind' })
  sourceKind: 'image' | 'pdf' | 'voice' | 'text';

  @Column({ type: 'varchar', length: 64, name: 'source_sha256' })
  sourceSha256: string;

  /** What the model returned after parsing/normalising (never edited). */
  @Column({ type: 'jsonb' })
  extracted: Record<string, unknown>;

  /** The user's version; the voucher is built from this when present. */
  @Column({ type: 'jsonb', nullable: true })
  edited: Record<string, unknown> | null;

  @Column({ type: 'numeric', precision: 4, scale: 3, default: 0 })
  confidence: string;

  @Column({ type: 'jsonb', name: 'field_confidence', default: () => "'{}'" })
  fieldConfidence: Record<string, number>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  findings: Array<Record<string, unknown>>;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, name: 'cost_usd', default: 0 })
  costUsd: string;

  @Column({ type: 'int', name: 'tokens_in', default: 0 })
  tokensIn: number;

  @Column({ type: 'int', name: 'tokens_out', default: 0 })
  tokensOut: number;

  @Column({ type: 'uuid', name: 'vendor_id', nullable: true })
  vendorId: string | null;

  @Column({ type: 'varchar', length: 400, name: 'dedupe_key', nullable: true })
  dedupeKey: string | null;

  @Column({ type: 'int', name: 'journal_entry_id', nullable: true })
  journalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'entry_number', nullable: true })
  entryNumber: string | null;

  @Column({ type: 'int', name: 'reversal_entry_id', nullable: true })
  reversalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'created_by' })
  createdBy: string;

  /** User id, or `auto` for an auto-post. */
  @Column({ type: 'varchar', length: 64, name: 'posted_by', nullable: true })
  postedBy: string | null;

  @Column({ type: 'timestamptz', name: 'posted_at', nullable: true })
  postedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'reviewed_at', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}

/** The source image/PDF/audio kept to show next to the draft (bounded by the upload limit). */
@Entity({ name: 'capture_files' })
export class CaptureFileEntity {
  @PrimaryColumn({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  mime: string;

  @Column({ type: 'bytea' })
  bytes: Buffer;
}

/** Sellers/buyers learned from captured documents; `account_hits` is the tenant's account history. */
@Entity({ name: 'capture_vendors' })
@Index('IDX_capture_vendors_tenant_name', ['tenantId', 'normalizedName'])
export class CaptureVendorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, name: 'normalized_name' })
  normalizedName: string;

  @Column({ type: 'varchar', length: 16, name: 'tax_id', nullable: true })
  taxId: string | null;

  @Column({ type: 'jsonb', name: 'account_hits', default: () => "'{}'" })
  accountHits: Record<string, number>;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}

/** Per-vendor posting rule; `auto_post` is the vendor-level opt-in to automatic posting. */
@Entity({ name: 'capture_vendor_rules' })
export class CaptureVendorRuleEntity {
  @PrimaryColumn({ type: 'uuid', name: 'vendor_id' })
  vendorId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32, name: 'account_code' })
  accountCode: string;

  @Column({ type: 'boolean', name: 'auto_post', default: false })
  autoPost: boolean;

  /** Largest invoice (IRR, exact decimal string) the rule may auto-post. */
  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'max_amount_irr' })
  maxAmountIrr: string;

  @Column({ type: 'varchar', length: 64, name: 'updated_by' })
  updatedBy: string;
}

@Entity({ name: 'capture_settings' })
export class CaptureSettingsEntity {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'boolean', name: 'auto_enabled', default: false })
  autoEnabled: boolean;

  @Column({ type: 'numeric', precision: 4, scale: 3, name: 'min_confidence', default: 0.95 })
  minConfidence: string;

  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'daily_cost_cap_usd', default: 1 })
  dailyCostCapUsd: string;

  @Column({ type: 'int', name: 'daily_doc_cap', default: 100 })
  dailyDocCap: number;

  @Column({ type: 'varchar', length: 64, name: 'updated_by', nullable: true })
  updatedBy: string | null;
}

/** Append-only (DB trigger): who/what/which model produced or posted a document. */
@Entity({ name: 'capture_audit' })
@Index('IDX_capture_audit_tenant_doc', ['tenantId', 'documentId'])
export class CaptureAuditEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'varchar', length: 32 })
  action: string;

  @Column({ type: 'varchar', length: 64 })
  actor: string;

  @Column({ type: 'varchar', length: 64, name: 'source_sha256', nullable: true })
  sourceSha256: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  detail: Record<string, unknown>;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
