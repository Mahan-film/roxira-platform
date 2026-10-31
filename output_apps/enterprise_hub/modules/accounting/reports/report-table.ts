/** Format-neutral shape of an exported report. Money cells are minor units (bigint). */
export type ReportCell = string | bigint | null;

export interface ReportColumn {
  title: string;
  /** Relative width in the PDF. */
  width?: number;
  money?: boolean;
}

export interface ReportRow {
  cells: ReportCell[];
  bold?: boolean;
}

export interface ReportTable {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}
