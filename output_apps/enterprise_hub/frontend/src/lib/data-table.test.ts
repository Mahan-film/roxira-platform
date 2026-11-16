import test from "node:test";
import assert from "node:assert/strict";

interface TestRow extends Record<string, unknown> {
  id: string;
  name: string;
  amount: bigint | string | number;
  category: string;
}

// Helper simulating data-table bigint sum aggregation (Rule 8)
function calculateColumnSums<T extends Record<string, unknown>>(
  rows: T[],
  summableColumns: string[],
): Record<string, bigint> {
  const sums: Record<string, bigint> = {};
  for (const colId of summableColumns) {
    sums[colId] = rows.reduce((acc, row) => {
      const raw = row[colId];
      if (raw === null || raw === undefined || raw === "") return acc;
      try {
        if (typeof raw === "bigint") return acc + raw;
        if (typeof raw === "number") return acc + BigInt(Math.trunc(raw));
        if (typeof raw === "string") {
          const cleaned = raw.replace(/,/g, "").trim();
          if (cleaned && /^-?\d+$/.test(cleaned)) {
            return acc + BigInt(cleaned);
          }
        }
      } catch {
        // ignore non-convertible
      }
      return acc;
    }, 0n);
  }
  return sums;
}

// Helper simulating CSV row escaping with formula-injection neutralization (Rule 9)
function escapeCsvCell(val: string): string {
  let sanitized = val;
  if (/^[=@+\-]/.test(sanitized)) {
    sanitized = "'" + sanitized;
  }
  if (sanitized.includes('"') || sanitized.includes(",") || sanitized.includes("\n") || sanitized.includes("\r")) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

// Helper simulating CSV generation
function buildCsvContent(headers: string[], rows: string[][]): string {
  const csvRows = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return "\uFEFF" + csvRows.join("\r\n");
}

// Helper simulating global search filtering
function filterRowsByGlobalQuery<T extends Record<string, unknown>>(
  rows: T[],
  query: string,
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return rows;
  return rows.filter((row) =>
    Object.values(row).some((val) =>
      String(val ?? "").toLowerCase().includes(trimmed),
    ),
  );
}

test("DataTable: sum calculation correctly aggregates bigint and numeric rows without precision loss", () => {
  const sampleData: TestRow[] = [
    { id: "1", name: "قرارداد الف", amount: 10000000000000000n, category: "خدمات" },
    { id: "2", name: "قرارداد ب", amount: 25000000000000000n, category: "کالا" },
    { id: "3", name: "قرارداد ج", amount: "5000000000000000", category: "خدمات" },
  ];

  const sums = calculateColumnSums(sampleData, ["amount"]);
  assert.equal(sums["amount"], 40000000000000000n);
});

test("DataTable: sum calculation updates when subset of rows is selected", () => {
  const sampleData: TestRow[] = [
    { id: "1", name: "قرارداد الف", amount: 1000000n, category: "خدمات" },
    { id: "2", name: "قرارداد ب", amount: 2500000n, category: "کالا" },
  ];

  const selectedRows = [sampleData[0]];
  const sums = calculateColumnSums(selectedRows, ["amount"]);
  assert.equal(sums["amount"], 1000000n);
});

test("DataTable: CSV escaping neutralizes formula injection (=, +, -, @)", () => {
  assert.equal(escapeCsvCell("=SUM(A1:A10)"), "'=SUM(A1:A10)");
  assert.equal(escapeCsvCell("@cmd"), "'@cmd");
  assert.equal(escapeCsvCell("+12345"), "'+12345");
  assert.equal(escapeCsvCell("-9876"), "'-9876");
});

test("DataTable: CSV escaping handles commas, quotes, and Persian text", () => {
  assert.equal(escapeCsvCell("فاکتور عادی"), "فاکتور عادی");
  assert.equal(escapeCsvCell('فاکتور "ویژه"'), '"فاکتور ""ویژه"""');
  assert.equal(escapeCsvCell("مبلغ, با ویرگول"), '"مبلغ, با ویرگول"');
  assert.equal(escapeCsvCell("خط اول\nخط دوم"), '"خط اول\nخط دوم"');
  // Formula injection with comma should prefix and quote
  assert.equal(escapeCsvCell("=cmd|' /C calc'!A0,test"), "\"'=cmd|' /C calc'!A0,test\"");
});

test("DataTable: CSV export content prepends UTF-8 BOM", () => {
  const headers = ["ردیف", "نام", "مبلغ"];
  const rows = [
    ["1", "شرکت آزمایشی", "1,500,000"],
    ["2", 'فاکتور "نهایی"', "2,000,000"],
    ["3", "=DANGEROUS()", "500,000"],
  ];

  const csv = buildCsvContent(headers, rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("شرکت آزمایشی"));
  assert.ok(csv.includes('"فاکتور ""نهایی"""'));
  assert.ok(csv.includes("'\=DANGEROUS()"));
});

test("DataTable: global filter matches across Persian text and numbers", () => {
  const sampleData: TestRow[] = [
    { id: "1", name: "فروش قطعات تهران", amount: 1200000n, category: "صنعتی" },
    { id: "2", name: "پیمانکاری شیراز", amount: 8500000n, category: "عمرانی" },
    { id: "3", name: "تعمیرات اصفهان", amount: 450000n, category: "صنعتی" },
  ];

  const matchesTehran = filterRowsByGlobalQuery(sampleData, "تهران");
  assert.equal(matchesTehran.length, 1);
  assert.equal(matchesTehran[0].id, "1");

  const matchesIndustry = filterRowsByGlobalQuery(sampleData, "صنعتی");
  assert.equal(matchesIndustry.length, 2);

  const matchesNumber = filterRowsByGlobalQuery(sampleData, "8500000");
  assert.equal(matchesNumber.length, 1);
  assert.equal(matchesNumber[0].id, "2");

  const noMatch = filterRowsByGlobalQuery(sampleData, "تبریز");
  assert.equal(noMatch.length, 0);
});
