/** Canonical statement fields a column can be mapped to. */
export const STATEMENT_FIELDS = [
  'date',
  'time',
  'description',
  'reference',
  'withdrawal',
  'deposit',
  'amount',
  'balance',
  'chequeNo',
] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];

/** Field to zero-based column index. */
export type ColumnMap = Partial<Record<StatementField, number>>;

export interface StatementRow {
  /** 1-based position in the source table (after the header). */
  rowNo: number;
  /** Gregorian `YYYY-MM-DD`. */
  date: string;
  time: string | null;
  description: string;
  /** Whole rials, bank's point of view. */
  withdrawal: bigint;
  deposit: bigint;
  balance: bigint | null;
  reference: string | null;
  chequeNo: string | null;
  sayadId: string | null;
}

export interface RowIssue {
  rowNo: number;
  message: string;
}

/** What the title rows above the table said (all optional, all untrusted). */
export interface StatementHeaderInfo {
  bankCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  openingBalance: bigint | null;
  closingBalance: bigint | null;
}

export type ParseOutcome =
  | {
      status: 'parsed';
      layoutId: string;
      header: StatementHeaderInfo;
      columnMap: ColumnMap;
      rows: StatementRow[];
      issues: RowIssue[];
      /** True when the file listed newest transactions first (rows were reversed). */
      reversed: boolean;
    }
  | {
      status: 'needs_mapping';
      header: StatementHeaderInfo;
      headers: string[];
      /** Best guess per field; the user confirms or corrects it. */
      suggestedMap: ColumnMap;
      sampleRows: string[][];
      reason: string;
    };
