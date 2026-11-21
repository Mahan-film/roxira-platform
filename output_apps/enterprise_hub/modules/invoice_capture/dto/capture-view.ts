import { DraftInvoice, Finding, Voucher } from '../domain/capture.types';
import { CaptureStatus } from '../entities/capture.entities';

export interface AiSourceCitation {
  kind: 'document' | 'model' | 'vendor_rule' | 'transcript';
  label: string;
  reference?: string;
}

/** What the draft card renders (API response; no secrets, no raw model output). */
export interface CaptureView {
  id: string;
  status: CaptureStatus;
  aiGenerated: boolean;
  aiLabel?: 'AI-generated draft';
  sourceCitations: AiSourceCitation[];
  sourceKind: string;
  confidence: number;
  fieldConfidence: Record<string, number>;
  draft: DraftInvoice;
  findings: Finding[];
  /** Voucher preview; null while the draft has blocking errors. */
  voucher: Voucher | null;
  vendor: { id: string | null; name: string; isNew: boolean; autoPost: boolean };
  model: string | null;
  costUsd: number;
  entryNumber: string | null;
  journalEntryId: number | null;
  postedBy: string | null;
  autoReasons: string[];
  sourceUrl: string;
  transcript: string | null;
  createdAt: string;
}
