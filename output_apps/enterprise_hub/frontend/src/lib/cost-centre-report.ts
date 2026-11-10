import {
  TRIAL_BALANCE_GROUP_LABELS,
  type CostCentreSection,
  type CostCentreTrialBalanceReport,
  type TrialBalanceAmounts,
  type TrialBalanceGroup,
} from "../types/accounting-reports.ts";
import { csvCell } from "./reorder.ts";

/** Formats a centre header label with its code when present. */
export function formatCentreTitle(section: Pick<CostCentreSection, "name" | "code">): string {
  if (!section.code) {
    return section.name;
  }
  return `${section.name} (${section.code})`;
}

/** Returns a Persian label describing the nesting depth of a cost centre. */
export function getCentreDepthLabel(depth: number): string {
  if (depth <= 0) {
    return "سطح اصلی";
  }
  return `زیرمجموعه سطح ${depth}`;
}

/** Filters cost centre sections and their inner rows matching a search term. */
export function filterSections(
  centres: readonly CostCentreSection[],
  search: string,
): CostCentreSection[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return [...centres];
  }

  const result: CostCentreSection[] = [];
  for (const centre of centres) {
    const centreMatches =
      centre.name.toLowerCase().includes(query) ||
      (centre.code && centre.code.toLowerCase().includes(query));

    if (centreMatches) {
      // Keep full section if the centre itself matches
      result.push(centre);
    } else {
      // Otherwise keep section only if it has matching account rows
      const matchingRows = centre.rows.filter(
        (r) =>
          r.code.toLowerCase().includes(query) ||
          r.name.toLowerCase().includes(query),
      );
      if (matchingRows.length > 0) {
        result.push({
          ...centre,
          rows: matchingRows,
        });
      }
    }
  }

  return result;
}

export interface CostCentreReportSummary {
  totalCentres: number;
  totalAccountRows: number;
  isBalanced: boolean | null;
  groups: TrialBalanceGroup[];
}

/** Computes high-level summary metrics from a cost centre report. */
export function calculateReportSummary(report: CostCentreTrialBalanceReport): CostCentreReportSummary {
  let totalAccountRows = 0;
  for (const centre of report.centres) {
    totalAccountRows += centre.rows.length;
  }

  return {
    totalCentres: report.centres.length,
    totalAccountRows,
    isBalanced: report.balanced,
    groups: report.groups,
  };
}

/** Extracts group debit/credit values from an amounts record in group order. */
export function getOrderedGroupAmounts(
  groups: readonly TrialBalanceGroup[],
  amounts: TrialBalanceAmounts,
): Array<{ group: TrialBalanceGroup; debit: string | number; credit: string | number }> {
  return groups.map((group) => ({
    group,
    debit: amounts[`${group}Debit`],
    credit: amounts[`${group}Credit`],
  }));
}

/**
 * Builds a sanitized CSV export of the cost centre trial balance report.
 * All user text is escaped and neutralized against spreadsheet formula injection (=, +, -, @).
 */
export function costCentreTrialBalanceToCsv(report: CostCentreTrialBalanceReport): string {
  const headers = [
    "کد مرکز",
    "نام مرکز هزینه",
    "عمق",
    "کد حساب",
    "نام حساب",
    ...report.groups.flatMap((g) => [
      `${TRIAL_BALANCE_GROUP_LABELS[g]} بدهکار`,
      `${TRIAL_BALANCE_GROUP_LABELS[g]} بستانکار`,
    ]),
  ];

  const lines: string[] = [headers.map(csvCell).join(",")];

  for (const centre of report.centres) {
    const centreCode = centre.code ?? "";
    const centreName = centre.name;
    const depthStr = String(centre.depth);

    // Rows under this centre
    for (const row of centre.rows) {
      const rowCols = [
        centreCode,
        centreName,
        depthStr,
        row.code,
        row.name,
        ...report.groups.flatMap((g) => [
          String(row[`${g}Debit`] ?? 0),
          String(row[`${g}Credit`] ?? 0),
        ]),
      ];
      lines.push(rowCols.map(csvCell).join(","));
    }

    // Centre subtotal row
    const subtotalCols = [
      centreCode,
      `جمع ${centreName}`,
      depthStr,
      "",
      "—",
      ...report.groups.flatMap((g) => [
        String(centre.totals[`${g}Debit`] ?? 0),
        String(centre.totals[`${g}Credit`] ?? 0),
      ]),
    ];
    lines.push(subtotalCols.map(csvCell).join(","));
  }

  // Grand totals row
  const grandTotalCols = [
    "",
    "جمع کل دفاتر",
    "",
    "",
    "—",
    ...report.groups.flatMap((g) => [
      String(report.totals[`${g}Debit`] ?? 0),
      String(report.totals[`${g}Credit`] ?? 0),
    ]),
  ];
  lines.push(grandTotalCols.map(csvCell).join(","));

  return lines.join("\n");
}
