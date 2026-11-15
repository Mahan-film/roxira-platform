import test from "node:test";
import assert from "node:assert/strict";

interface TestRow extends Record<string, unknown> {
  id: string;
  name: string;
  amount: number;
  category: string;
}

// Helper simulating data-table sum aggregation
function calculateColumnSums<T extends Record<string, unknown>>(
  rows: T[],
  summableColumns: string[],
): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const colId of summableColumns) {
    sums[colId] = rows.reduce((acc, row) => {
      const v = Number(row[colId]) || 0;
      return acc + v;
    }, 0);
  }
  return sums;
}

// Helper simulating CSV row escaping
function escapeCsvCell(val: string): string {
  if (val.includes('"') || val.includes(",") || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
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

test("DataTable: sum calculation correctly aggregates numeric rows", () => {
  const sampleData: TestRow[] = [
    { id: "1", name: "قرارداد الف", amount: 1000000, category: "خدمات" },
    { id: "2", name: "قرارداد ب", amount: 2500000, category: "کالا" },
    { id: "3", name: "قرارداد ج", amount: 500000, category: "خدمات" },
  ];

  const sums = calculateColumnSums(sampleData, ["amount"]);
  assert.equal(sums["amount"], 4000000);
});

test("DataTable: sum calculation updates when subset of rows is selected", () => {
  const sampleData: TestRow[] = [
    { id: "1", name: "قرارداد الف", amount: 1000000, category: "خدمات" },
    { id: "2", name: "قرارداد ب", amount: 2500000, category: "کالا" },
  ];

  const selectedRows = [sampleData[0]];
  const sums = calculateColumnSums(selectedRows, ["amount"]);
  assert.equal(sums["amount"], 1000000);
});

test("DataTable: CSV escaping handles commas, quotes, and Persian text", () => {
  assert.equal(escapeCsvCell("فاکتور عادی"), "فاکتور عادی");
  assert.equal(escapeCsvCell('فاکتور "ویژه"'), '"فاکتور ""ویژه"""');
  assert.equal(escapeCsvCell("مبلغ, با ویرگول"), '"مبلغ, با ویرگول"');
  assert.equal(escapeCsvCell("خط اول\nخط دوم"), '"خط اول\nخط دوم"');
});

test("DataTable: CSV export content prepends UTF-8 BOM", () => {
  const headers = ["ردیف", "نام", "مبلغ"];
  const rows = [
    ["1", "شرکت آزمایشی", "1,500,000"],
    ["2", 'فاکتور "نهایی"', "2,000,000"],
  ];

  const csv = buildCsvContent(headers, rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("شرکت آزمایشی"));
  assert.ok(csv.includes('"فاکتور ""نهایی"""'));
});

test("DataTable: global filter matches across Persian text and numbers", () => {
  const sampleData: TestRow[] = [
    { id: "1", name: "فروش قطعات تهران", amount: 1200000, category: "صنعتی" },
    { id: "2", name: "پیمانکاری شیراز", amount: 8500000, category: "عمرانی" },
    { id: "3", name: "تعمیرات اصفهان", amount: 450000, category: "صنعتی" },
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
