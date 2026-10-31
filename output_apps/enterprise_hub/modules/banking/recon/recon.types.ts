import { Question } from './questions';
import { PrerequisiteCheck } from './prerequisites';
import { ColumnMap, RowIssue } from './types';

export interface SessionView {
  id: number;
  status: string;
  fileName: string;
  bankAccountId: number | null;
  period: { from: string; to: string } | null;
  header: Record<string, unknown>;
  checks: PrerequisiteCheck[];
  rowCount?: number;
  skippedRows?: RowIssue[];
  offerCreateAccount?: boolean;
  mapping?: {
    reason: string;
    headers: string[];
    suggestedMap: ColumnMap;
    sampleRows: string[][];
  };
}

export interface DraftView {
  id: number;
  itemId: number;
  date: string;
  description: string;
  amountRial: string;
  direction: 'in' | 'out';
  counterAccountCode: string;
  category: string;
  status: string;
  auto: boolean;
  journalEntryId: number | null;
  reversalEntryId: number | null;
  failureReason: string | null;
}

export interface AnswerQuestionDtoShape {
  choiceId: string;
  personType?: 'real' | 'legal' | 'unknown';
  counterAccountCode?: string;
  keyword?: string;
  remember?: boolean;
}

export interface ReviewView {
  session: SessionView;
  matched: unknown[];
  suggested: unknown[];
  unmatched: unknown[];
  drafts: DraftView[];
  questions: Array<Question & { groupId?: string }>;
  counts: { matched: number; suggested: number; unmatched: number; drafts: number };
}
