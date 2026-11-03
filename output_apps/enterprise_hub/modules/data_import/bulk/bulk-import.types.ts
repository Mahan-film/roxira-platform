export type BulkStatus =
  | 'uploading'
  | 'queued'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'ready'
  | 'posting'
  | 'posted'
  | 'expired';

export interface BulkTableInfo {
  idx: number;
  name: string;
  columns: string[];
  rows: number;
}

export interface BulkJob {
  id: string;
  tenantId: string;
  createdBy: string | null;
  fileName: string;
  sizeBytes: number;
  objectKey: string;
  multipartId: string | null;
  driver: 's3' | 'local';
  partBytes: number;
  status: BulkStatus;
  bytesRead: number;
  rowsStaged: number;
  tables: BulkTableInfo[];
  /** Rows already staged per table name; a resumed run skips this many rows of the re-parsed stream. */
  checkpoint: { rows?: Record<string, number> };
  notes: string[];
  review: unknown;
  postProgress: BulkPostProgress | null;
  batchId: string | null;
  error: string | null;
  attempts: number;
  sourceRemoved: boolean;
  rowsRemoved: boolean;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface BulkPostProgress {
  phase: 'posting' | 'posted' | 'failed';
  done: number;
  total: number;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

export const TERMINAL: readonly BulkStatus[] = ['cancelled', 'posted', 'expired'];
